"""Student vs teacher on held-out synthetic charts.

Both models are called through OpenAI-compatible endpoints with the identical
prompt (distill/prompts.py). Metrics are deterministic (distill/quality.py):
  pass_rate      share of readings with zero safety/format problems
  grounding      share of "<Body> in <Sign>" claims that match the input chart
  romantic_leak  pair readings with romantic language without both opting in
  words, latency per reading, and per-problem counts.
Optionally --judge-* runs a pairwise preference judge (same open teacher by default).

Env: TEACHER_BASE_URL/TEACHER_MODEL/TEACHER_API_KEY and STUDENT_BASE_URL/STUDENT_MODEL/STUDENT_API_KEY.
Teacher outputs already in --teacher-cache (teacher.py output) are reused instead of re-generated.

Usage:
  python3 distill/eval.py --in distill/data/inputs.jsonl --teacher-cache distill/data/teacher.jsonl --out runs/eval.json [--limit 50]
  python3 distill/eval.py --score-only distill/samples/teacher.sample.jsonl   # metrics for an existing JSONL, no model calls
"""
from __future__ import annotations

import argparse
import json
import os
import statistics
import sys
import time
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from prompts import messages_for  # noqa: E402
from quality import ROMANTIC, check, grounding  # noqa: E402
from teacher import chat  # noqa: E402


def score(rows: list[dict], texts: list[str], finishes: list[str | None], secs: list[float]) -> dict:
    probs = [check(r, t, f) for r, t, f in zip(rows, texts, finishes)]
    pairs = [(r, t) for r, t in zip(rows, texts) if r["task"] == "pair" and not r["input"]["romanticOptIn"]]
    c = Counter(p.split(":")[0] for ps in probs for p in ps)
    return {
        "n": len(rows),
        "pass_rate": round(sum(not p for p in probs) / max(1, len(rows)), 3),
        "grounding": round(statistics.mean(grounding(r, t) for r, t in zip(rows, texts)) if rows else 0, 3),
        "romantic_leak": round(sum(bool(ROMANTIC.search(t)) for _, t in pairs) / max(1, len(pairs)), 3),
        "words_median": statistics.median(len(t.split()) for t in texts) if texts else 0,
        "seconds_median": statistics.median(secs) if secs else None,
        "problems": dict(c),
    }


def endpoint(prefix: str) -> tuple[str, str, str]:
    return os.environ.get(f"{prefix}_BASE_URL", ""), os.environ.get(f"{prefix}_MODEL", ""), os.environ.get(f"{prefix}_API_KEY", "")


def generate(rows: list[dict], prefix: str) -> tuple[list[str], list[str | None], list[float]]:
    base, model, key = endpoint(prefix)
    if not base or not model:
        raise SystemExit(f"set {prefix}_BASE_URL and {prefix}_MODEL")
    texts, fins, secs = [], [], []
    for r in rows:
        t = time.time()
        try:
            resp = chat(base, model, key, messages_for(r), 900, 0.7)
            ch = resp["choices"][0]
            texts.append((ch["message"].get("content") or "").strip()); fins.append(ch.get("finish_reason"))
        except Exception:  # noqa: BLE001
            texts.append(""); fins.append("error")
        secs.append(round(time.time() - t, 1))
        print(f"{prefix.lower()} {r['id']} {secs[-1]}s", flush=True)
    return texts, fins, secs


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="inp", default="distill/data/inputs.jsonl")
    ap.add_argument("--teacher-cache", default="")
    ap.add_argument("--out", default="runs/eval.json")
    ap.add_argument("--limit", type=int, default=50)
    ap.add_argument("--score-only", default="")
    a = ap.parse_args()

    if a.score_only:
        recs = [json.loads(l) for l in open(a.score_only) if l.strip()]
        inputs = {json.loads(l)["id"]: json.loads(l) for l in open(a.inp) if l.strip()}
        rows = [inputs[r["id"]] for r in recs]
        print(json.dumps(score(rows, [r["completion"] for r in recs], [r.get("finish_reason") for r in recs],
                               [r.get("seconds", 0) for r in recs]), indent=2))
        return 0

    rows = [json.loads(l) for l in open(a.inp) if l.strip()]
    rows = [r for r in rows if r["split"] == "heldout"][: a.limit]
    cache = {}
    if a.teacher_cache and Path(a.teacher_cache).exists():
        cache = {json.loads(l)["id"]: json.loads(l) for l in open(a.teacher_cache) if l.strip()}
    if all(r["id"] in cache for r in rows):
        t_texts = [cache[r["id"]]["completion"] for r in rows]
        t_fins = [cache[r["id"]].get("finish_reason") for r in rows]
        t_secs = [cache[r["id"]].get("seconds", 0) for r in rows]
    else:
        t_texts, t_fins, t_secs = generate(rows, "TEACHER")
    s_texts, s_fins, s_secs = generate(rows, "STUDENT")
    report = {"heldout_rows": len(rows), "teacher": {"model": endpoint("TEACHER")[1], **score(rows, t_texts, t_fins, t_secs)},
              "student": {"model": endpoint("STUDENT")[1], **score(rows, s_texts, s_fins, s_secs)}}
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    Path(a.out).write_text(json.dumps(report, indent=2))
    with open(Path(a.out).with_suffix(".samples.jsonl"), "w") as f:
        for r, t, s in zip(rows, t_texts, s_texts):
            f.write(json.dumps({"id": r["id"], "teacher": t, "student": s}) + "\n")
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
