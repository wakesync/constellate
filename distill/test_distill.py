"""Offline checks for the distill pipeline (stdlib only, no model calls).
Run: python3 distill/test_distill.py -v
"""
import json
import re
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from prompts import NATAL_SYSTEM, messages_for  # noqa: E402
from quality import check, grounding  # noqa: E402
from teacher import license_ok  # noqa: E402

SAMPLES = [HERE / "data" / "inputs.sample.jsonl", HERE / "data" / "inputs.swe.sample.jsonl"]
# "longitude" in placements is ECLIPTIC longitude (a chart fact), not a birthplace.
BIRTH_KEYS = {"date", "time", "timeZone", "tz", "lat", "lng", "latitude", "calculatedAt", "birth"}


def rows(p):
    with p.open() as f:
        return [json.loads(l) for l in f if l.strip()]


def keys(o):
    if isinstance(o, dict):
        for k, v in o.items():
            yield k
            yield from keys(v)
    elif isinstance(o, list):
        for v in o:
            yield from keys(v)


class Distill(unittest.TestCase):
    def test_samples_carry_no_birth_data(self):
        for p in SAMPLES:
            for r in rows(p):
                self.assertFalse(BIRTH_KEYS & set(keys(r["input"])), (p.name, r["id"]))
                prompt = messages_for(r)[1]["content"]
                self.assertNotRegex(prompt, r"\d{4}-\d{2}-\d{2}")

    def test_prompt_contract_matches_production(self):
        src = (HERE.parent / "server" / "src" / "inference.ts").read_text()
        prod = re.search(r"const SYSTEM = `\$\{DISCLAIMER\} (.*?)`;", src, re.S).group(1)
        self.assertTrue(NATAL_SYSTEM.endswith(prod))

    def test_quality_catches_bad_readings(self):
        r = rows(SAMPLES[0])[0]
        good = " ".join(["word"] * 320) + " Where do you meet? What would help? "
        self.assertEqual(check(r, good, "stop") if r["task"] == "natal" else [], [])
        self.assertIn("truncated", check(r, good, "length"))
        sun = next(p for p in (r["input"]["placements"] if r["task"] == "natal" else r["input"]["a"]["placements"]) if p["body"] == "Sun")
        wrong = next(s for s in ("Aries", "Libra") if s != sun["sign"])
        self.assertIn("wrong-sign", check(r, good + f" Your Sun in {wrong}.", "stop"))
        self.assertEqual(grounding(r, f"Sun in {sun['sign']}"), 1.0)

    def test_romantic_gate(self):
        pair = next(r for r in rows(SAMPLES[0]) if r["task"] == "pair" and not r["input"]["romanticOptIn"])
        self.assertIn("romantic-without-optin", check(pair, "You two are soulmates. Why? How?", "stop"))

    def test_license_gate(self):
        self.assertTrue(license_ok("Qwen/Qwen3-235B-A22B-Instruct-2507"))
        self.assertTrue(license_ok("qwen3:4b-instruct"))
        self.assertFalse(license_ok("Qwen/Qwen2.5-72B-Instruct"))
        self.assertFalse(license_ok("some-frontier-api-model"))

    def test_teacher_sample_is_well_formed(self):
        p = HERE / "data" / "teacher.sample.jsonl"
        if not p.exists():
            self.skipTest("no teacher sample")
        recs = rows(p)
        self.assertGreater(len(recs), 0)
        for r in recs:
            self.assertEqual(r["messages"][0]["role"], "system")
            self.assertTrue(r["completion"])
            self.assertIsInstance(r["problems"], list)


if __name__ == "__main__":
    unittest.main()
