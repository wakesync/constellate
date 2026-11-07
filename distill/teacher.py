"""Teacher: write readings for synthetic inputs with an open-weights, distillation-permitted model.

Calls any OpenAI-compatible /chat/completions endpoint (vLLM, Ollama, Tinfoil, ...).
Stdlib only. Resumable: rows already present in --out are skipped.

Env:
  TEACHER_BASE_URL   e.g. http://localhost:8001/v1 (vLLM) or http://localhost:11434/v1 (Ollama)
  TEACHER_MODEL      e.g. Qwen/Qwen3-235B-A22B-Instruct-2507 (see docs/OWN-THE-MODEL.md, license)
  TEACHER_API_KEY    optional bearer
  TEACHER_MAX_TOKENS default 900
  TEACHER_TEMPERATURE default 0.7

Usage:
  python3 distill/teacher.py --in distill/data/inputs.jsonl --out distill/data/teacher.jsonl [--limit 50] [--workers 2]
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import threading
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from prompts import messages_for  # noqa: E402
from quality import check  # noqa: E402

# License gate: the teacher must be an open-weights model whose license permits
# using outputs to train another model. Override only after reading the license.
ALLOWED_TEACHER_FAMILIES = ("qwen3", "qwen2.5", "qwen/qwen3", "qwen/qwen2.5", "gpt-oss", "openai/gpt-oss", "mistralai/mistral-small", "olmo", "allenai/olmo")


def license_ok(model: str) -> bool:
    m = model.lower()
    if os.environ.get("TEACHER_LICENSE_ACK") == "1":
        return True
    # Qwen2.5 3B and 72B ship under the Qwen license, not Apache-2.0: require explicit ack.
    if m.startswith(("qwen2.5", "qwen/qwen2.5")) and any(s in m for s in ("-3b", "-72b", ":3b", ":72b")):
        return False
    return m.startswith(ALLOWED_TEACHER_FAMILIES)


def chat(base: str, model: str, key: str, messages: list[dict], max_tokens: int, temperature: float) -> dict:
    body = {"model": model, "messages": messages, "max_tokens": max_tokens, "temperature": temperature, "stream": False}
    if "qwen3" in model.lower():
        body["chat_template_kwargs"] = {"enable_thinking": False}  # vLLM; Ollama -instruct tags ignore it
    headers = {"Content-Type": "application/json", **({"Authorization": f"Bearer {key}"} if key else {})}
    req = urllib.request.Request(base.rstrip("/") + "/chat/completions", json.dumps(body).encode(), headers)
    with urllib.request.urlopen(req, timeout=600) as r:
        return json.load(r)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="inp", default="distill/data/inputs.jsonl")
    ap.add_argument("--out", default="distill/data/teacher.jsonl")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--workers", type=int, default=2)
    ap.add_argument("--split", default="", help="only this split (train|heldout)")
    a = ap.parse_args()
    base, model = os.environ.get("TEACHER_BASE_URL", ""), os.environ.get("TEACHER_MODEL", "")
    if not base or not model:
        print("set TEACHER_BASE_URL and TEACHER_MODEL", file=sys.stderr)
        return 2
    if not license_ok(model):
        print(f"teacher {model!r} is not on the distillation-permitted list; read its license, then TEACHER_LICENSE_ACK=1", file=sys.stderr)
        return 2
    key = os.environ.get("TEACHER_API_KEY", "")
    max_tokens = int(os.environ.get("TEACHER_MAX_TOKENS", "900"))
    temperature = float(os.environ.get("TEACHER_TEMPERATURE", "0.7"))
    rows = [json.loads(l) for l in open(a.inp) if l.strip()]
    if a.split:
        rows = [r for r in rows if r["split"] == a.split]
    out = Path(a.out)
    done = {json.loads(l)["id"] for l in out.open()} if out.exists() else set()
    todo = [r for r in rows if r["id"] not in done]
    if a.limit:
        todo = todo[: max(0, a.limit - len(done))]
    lock = threading.Lock()
    stats = {"ok": 0, "rejected": 0, "error": 0}

    def work(row: dict) -> None:
        msgs = messages_for(row)
        t = time.time()
        try:
            resp = chat(base, model, key, msgs, max_tokens, temperature)
        except Exception as e:  # noqa: BLE001
            with lock:
                stats["error"] += 1
            print(f"{row['id']} error {type(e).__name__}", file=sys.stderr)
            return
        ch = resp["choices"][0]
        text = (ch["message"].get("content") or "").strip()
        problems = check(row, text, ch.get("finish_reason"))
        rec = {"id": row["id"], "split": row["split"], "task": row["task"], "messages": msgs,
               "completion": text, "teacher": model, "finish_reason": ch.get("finish_reason"),
               "usage": resp.get("usage"), "seconds": round(time.time() - t, 1), "problems": problems}
        with lock:
            stats["rejected" if problems else "ok"] += 1
            with out.open("a") as f:
                f.write(json.dumps(rec) + "\n")
        print(f"{row['id']} {row['task']} {'REJECT ' + ','.join(problems) if problems else 'ok'} {rec['seconds']}s", flush=True)

    out.parent.mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor(max_workers=a.workers) as ex:
        list(ex.map(work, todo))
    print(json.dumps(stats))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
