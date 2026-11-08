"""Verification tests for the Human Design engine.

Run: python test_hd.py   (from services/astro/, with the .venv active)

Covers:
  1. Gate wheel integrity (64 unique, correct boundaries).
  2. The 88-degree solver (design Sun == natal Sun - 88 deg, mod 360).
  3. Gate/line boundary math at known offsets.
  4. Synthetic chart structure checks.
  5. Canonical channel count == 36.
"""

from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import swisseph as swe

import hd

swe.set_ephe_path(None)

PASS = "PASS"
FAIL = "FAIL"
results = []


def check(name, cond, detail=""):
    results.append((name, PASS if cond else FAIL, detail))


def jd_from_local(date, time_text, tz):
    hh, mm = (int(x) for x in time_text.split(":")[:2])
    y, mo, d = (int(x) for x in date.split("-")[:3])
    local = datetime(y, mo, d, hh, mm, tzinfo=ZoneInfo(tz))
    utc = local.astimezone(timezone.utc)
    ut_hour = utc.hour + utc.minute / 60.0 + utc.second / 3600.0
    return swe.julday(utc.year, utc.month, utc.day, ut_hour)


# --- 1. Wheel integrity -----------------------------------------------------
check("wheel has 64 entries", len(hd.GATE_WHEEL) == 64, str(len(hd.GATE_WHEEL)))
check("wheel entries unique", len(set(hd.GATE_WHEEL)) == 64)
check("wheel starts at gate 41", hd.GATE_WHEEL[0] == 41)
# Gate 41 begins at 2 Aquarius = 302 deg absolute. Midpoint of gate 41 should
# still land in gate 41.
mid41 = hd.gate_line_of(302.0 + hd.GATE_SIZE / 2.0)
check("gate 41 midpoint maps to gate 41", mid41["gate"] == 41, str(mid41))
# Just before 302 should be the last wheel gate (60).
check("just before 302 is gate 60", hd.gate_line_of(301.9)["gate"] == 60,
      str(hd.gate_line_of(301.9)))

# --- 2. Channel count -------------------------------------------------------
check("36 canonical channels", len(hd.CANON_CHANNELS) == 36, str(len(hd.CANON_CHANNELS)))

# --- 3. 88-degree solver ----------------------------------------------------
# Fabricated epoch fixture, not a real birth.
jd_birth = jd_from_local("2001-01-01", "12:00", "UTC")
natal_sun = hd._sun_lon(jd_birth)
design_jd = hd.design_time_jd(jd_birth)
design_sun = hd._sun_lon(design_jd)
arc = (natal_sun - design_sun) % 360.0
check("design sun is 88 deg before natal (arcsec)", abs(arc - 88.0) < 1.0 / 3600.0,
      f"arc={arc:.8f} deg, err={abs(arc-88.0)*3600:.4f} arcsec")
days_back = jd_birth - design_jd
check("design ~88-89 days before birth (not exactly 88)", 86.0 < days_back < 92.0,
      f"{days_back:.4f} days")

# --- 5. Smoke chart integrity ----------------------------------------------
smoke = hd.compute_human_design(jd_birth, "synthetic")
check("smoke has 9 centers", len(smoke["centers"]) == 9)
check("smoke has 13 personality activations", len(smoke["gates"]["personality"]) == 13)
check("smoke has 13 design activations", len(smoke["gates"]["design"]) == 13)
check("smoke type is a valid type",
      smoke["type"] in {"Generator", "Manifesting Generator", "Manifestor", "Projector", "Reflector"},
      smoke["type"])
gk = hd.compute_gene_keys(smoke)
check("gene keys activation has 4 spheres", len(gk["activation"]) == 4)

# --- report -----------------------------------------------------------------
print("\n=== Human Design verification ===")
for name, status, detail in results:
    line = f"[{status}] {name}"
    if detail:
        line += f"  ({detail})"
    print(line)

n_fail = sum(1 for _, s, _ in results if s == FAIL)
print(f"\n{len(results) - n_fail}/{len(results)} passed, {n_fail} failed")

print("\n--- synthetic epoch smoke ---")
print(f"type={smoke['type']} authority={smoke['authority']} profile={smoke['profile']['label']} "
      f"definition={smoke['definition']}")
print(f"design days back = {days_back:.4f}, solar arc = {arc:.6f} deg")

import sys
sys.exit(1 if n_fail else 0)
