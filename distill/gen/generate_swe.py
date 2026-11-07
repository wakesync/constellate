"""Synthetic charts on the Swiss Ephemeris engine (services/astro), the product's full chart engine.

Same contract as generate.ts (synthetic people, seeded, placements only, never the
synthetic birth data), plus ascendant and Placidus houses when the synthetic birth
time is known, and an optional sidereal (Lahiri) frame. Pair features come from the
engine's own synastry aspects (compute_aspects).

Run with the astro service deps (pip install -r services/astro/requirements.txt):
  python distill/gen/generate_swe.py --n 2000 --seed 7 --out distill/data/inputs.swe.jsonl [--zodiac sidereal]
"""
from __future__ import annotations

import argparse
import json
import os
import random
import sys
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "services" / "astro"))
os.environ.setdefault("ASTRO_BEARER", "unused-offline")
from main import compute_aspects, compute_chart  # noqa: E402

# Synthetic birthplaces: coarse grid cells with their zone, not addresses.
PLACES = [
    (40.7, -74.0, "America/New_York"), (41.9, -87.6, "America/Chicago"), (39.7, -105.0, "America/Denver"),
    (34.0, -118.2, "America/Los_Angeles"), (-23.5, -46.6, "America/Sao_Paulo"), (19.4, -99.1, "America/Mexico_City"),
    (51.5, -0.1, "Europe/London"), (52.5, 13.4, "Europe/Berlin"), (40.4, -3.7, "Europe/Madrid"), (6.5, 3.4, "Africa/Lagos"),
    (-1.3, 36.8, "Africa/Nairobi"), (19.1, 72.9, "Asia/Kolkata"), (35.7, 139.7, "Asia/Tokyo"), (1.35, 103.8, "Asia/Singapore"),
    (-33.9, 151.2, "Australia/Sydney"), (-36.8, 174.8, "Pacific/Auckland"),
]
NAMES = ["ada", "bram", "rowan", "mara", "teo", "juno", "ilse", "kai", "noor", "pim", "soren", "wren", "zia", "oli", "lev", "tamsin"]
RELATIONSHIPS = ["friend", "roommate", "collaborator", "family", "romantic"]
THEME_OF = {"Sun": "identity", "Moon": "emotional needs", "Mercury": "communication", "Venus": "affection and values", "Mars": "conflict and drive"}


def person(r: random.Random, zodiac: str) -> dict:
    d = date(1940, 1, 1) + timedelta(days=r.randrange(25567))
    known = r.random() > 0.12
    t = f"{r.randrange(24):02d}:{r.randrange(60):02d}" if known else "12:00"
    lat, lng, tz = r.choice(PLACES)
    c = compute_chart(d.isoformat(), t, lat + r.uniform(-0.5, 0.5), lng + r.uniform(-0.5, 0.5), tz, zodiac=zodiac)
    placements = [{"body": p["name"], "sign": p["sign"], "degree": round(p["sign_degree"], 2), "longitude": round(p["absolute_degree"], 2),
                   **({"house": p["house"], "retrograde": p["retrograde"]} if known else {"retrograde": p["retrograde"]})} for p in c["planets"]]
    out = {"timeKnown": known, "zodiac": zodiac, "placements": placements, "_planets": c["planets"]}
    if known:  # angles are only meaningful with a real birth time
        out["ascendant"] = {"sign": c["ascendant"]["sign"], "degree": round(c["ascendant"]["sign_degree"], 2)}
        out["midheaven"] = {"sign": c["midheaven"]["sign"], "degree": round(c["midheaven"]["sign_degree"], 2)}
    return out


def features(a: dict, b: dict) -> dict:
    asp = [x for x in compute_aspects(a["_planets"], b["_planets"]) if not x["generational"]]
    asp.sort(key=lambda x: -x["effective"])
    top = [{"label": f"{x['person_a_planet']} {x['aspect']} {x['person_b_planet']}", "harmonious": x["harmonious"], "orb": round(x["orb"], 1)} for x in asp[:8]]
    themes = list(dict.fromkeys(THEME_OF[p] for x in asp[:8] for p in (x["person_a_planet"], x["person_b_planet"]) if p in THEME_OF))
    by = lambda s, n: next((p for p in s["placements"] if p["body"] == n), None)  # noqa: E731
    shared = [f"both {n} in {by(a, n)['sign']}" for n in ("Sun", "Moon", "Venus", "Mars") if by(a, n) and by(b, n) and by(a, n)["sign"] == by(b, n)["sign"]]
    return {"shared": shared, "aspects": top, "themes": themes}


def strip(p: dict) -> dict:
    return {k: v for k, v in p.items() if not k.startswith("_")}


def generate(n: int, seed: int, zodiac: str = "tropical", pairs_ratio: float = 0.5, heldout_ratio: float = 0.1) -> list[dict]:
    r = random.Random(seed)
    rows = []
    for i in range(n):
        split = "heldout" if r.random() < heldout_ratio else "train"
        rid = f"swe-{seed}-{i:05d}"
        if r.random() >= pairs_ratio:
            rows.append({"id": rid, "split": split, "task": "natal", "input": strip(person(r, zodiac))})
            continue
        a, b = person(r, zodiac), person(r, zodiac)
        rel = r.choice(RELATIONSHIPS)
        f = features(a, b)
        na, nb = r.sample(NAMES, 2)
        rows.append({"id": rid, "split": split, "task": "pair", "input": {
            "a": {"name": na, **strip(a)}, "b": {"name": nb, **strip(b)}, "relationship": rel, "romanticOptIn": rel == "romantic",
            "features": f, "priorThemes": f["themes"][:2] if r.random() < 0.3 else []}})
    return rows


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=20)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--zodiac", choices=["tropical", "sidereal"], default="tropical")
    ap.add_argument("--out", default="distill/data/inputs.swe.jsonl")
    a = ap.parse_args()
    rows = generate(a.n, a.seed, a.zodiac)
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    Path(a.out).write_text("".join(json.dumps(x) + "\n" for x in rows))
    print(f"wrote {len(rows)} rows ({sum(x['task'] == 'pair' for x in rows)} pairs) -> {a.out}")
