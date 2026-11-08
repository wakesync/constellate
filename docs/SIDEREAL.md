# SIDEREAL.md - Sidereal / Vedic engine contract (services/astro)

Status: P1 core shipped (lane L1, 2026-07-31). Plan: docs/SIDEREAL.md.

## 1. The frames

Tropical (default, what the engine has always computed) anchors 0 Aries to the
March equinox. Sidereal (Vedic/Jyotish) anchors the signs to the fixed stars.
Precession drifts the two apart ~50.3 arcsec/year; the offset is the
**ayanamsa** (~24 deg 11' in 2024, Lahiri).

Engine rule: **sidereal longitude = tropical longitude - ayanamsa(jd, mode)**.

## 2. API contract

Every chart-bearing endpoint accepts two optional fields:

```json
{ "zodiac": "tropical" | "sidereal",   // default "tropical"
  "ayanamsa": "LAHIRI" | "FAGAN_BRADLEY" | "RAMAN" | "KRISHNAMURTI" }
```

- `zodiac` defaults to `tropical`. Tropical responses are **byte-identical to
  the pre-feature engine**: no new keys appear, all values pinned by
  regression tests. This is the frame-isolation invariant.
- `ayanamsa` is only meaningful when `zodiac=sidereal`; default `LAHIRI`
  (Chitrapaksha, the Indian government standard). Unknown modes -> 422
  `INVALID_AYANAMSA` with the supported list.
- Endpoints: `/natal`, `/transits`, `/synastry`, `/astrocartography`,
  `/humandesign`, `/genekeys`, `/astro/design-time`.
- `/astrocartography` accepts the params for uniformity but the lines are
  computed from equatorial coordinates (RA/Dec) + geography, which are
  zodiac-frame-independent; output is unchanged.
- `/astro/design-time` is frame-independent by construction (section 5).

## 3. Sidereal natal output additions

When `zodiac=sidereal`, `/natal` (and the charts embedded in `/synastry`) add:

```json
{ "zodiac": "sidereal",
  "house_system": "whole_sign",
  "ayanamsa": { "mode": "LAHIRI", "value_deg": 23.723746 },
  ... }
```

- **Houses are WHOLE SIGN** (Vedic practice). The ascendant is computed
  siderally (tropical asc - ayanamsa); house 1 = the ascendant's entire sign,
  cusps at exact sign boundaries (`degree: 0.0`), houses proceed sign by sign.
  Tropical charts keep Placidus, untouched.
- **Every planet and the ascendant carry a `nakshatra` object:**

```json
{ "name": "Purva Bhadrapada", "index": 25, "pada": 2, "degree_in_nakshatra": 5.27 }
```

## 4. Nakshatras

27 lunar mansions of 13 deg 20' (360/27) each, measured from 0 deg SIDEREAL
Aries. Each divides into 4 padas of 3 deg 20'. Index is 1-based (1 = Ashwini).

| # | Nakshatra | # | Nakshatra | # | Nakshatra |
|---|-----------|---|-----------|---|-----------|
| 1 | Ashwini | 10 | Magha | 19 | Mula |
| 2 | Bharani | 11 | Purva Phalguni | 20 | Purva Ashadha |
| 3 | Krittika | 12 | Uttara Phalguni | 21 | Uttara Ashadha |
| 4 | Rohini | 13 | Hasta | 22 | Shravana |
| 5 | Mrigashira | 14 | Chitra | 23 | Dhanishta |
| 6 | Ardra | 15 | Swati | 24 | Shatabhisha |
| 7 | Punarvasu | 16 | Vishakha | 25 | Purva Bhadrapada |
| 8 | Pushya | 17 | Anuradha | 26 | Uttara Bhadrapada |
| 9 | Ashlesha | 18 | Jyeshtha | 27 | Revati |

## 5. Human Design / Gene Keys stance

Per plan section 0: HD (the Human Design founder) and Gene Keys (the author) are **tropical-canon**;
both founders explicitly tied their wheels to the tropical zodiac. Sidereal
HD/GK is a community-explored **alternate lens** (Genetic Matrix et al). We
ship both, honestly framed:

- `zodiac=sidereal` on `/humandesign` / `/genekeys` applies the SAME gate wheel
  (hd.py, Gate 41 @ 2 Aquarius) to sidereal longitudes. The ~24 deg shift is
  ~4.3 gates of arc, so activations, channels, centers, type, profile, and
  authority can all change.
- Sidereal HD/GK payloads carry explicit framing fields:

```json
{ "zodiac": "sidereal", "lens": "alternate", "canon": "tropical",
  "ayanamsa": { "mode": "LAHIRI", "value_deg": ..., "design_value_deg": ... } }
```

- Tropical HD/GK payloads carry NONE of these keys (shape unchanged).
- **The design-time INSTANT is frame-independent.** The design moment is the
  Sun 88 deg of arc before natal; an arc is a longitude DIFFERENCE, so the
  ayanamsa cancels: `(trop_natal - ay) - (trop_design - ay) = trop_natal -
  trop_design`. The only residual is the ayanamsa's own drift over the ~89
  days (~12 arcsec, far below a line width). Same instant, both frames;
  asserted by test. Only the gate MAPPING of the longitudes changes, and each
  chart (personality/design) uses the ayanamsa evaluated at its own instant.

## 6. Concurrency safety (why we never use FLG_SIDEREAL)

`swe.set_sid_mode()` is process-global. FastAPI runs sync endpoints in a
threadpool, so a sidereal request racing a tropical one could contaminate the
tropical output if we passed `FLG_SIDEREAL` to `calc_ut`. Instead:

- ALL chart math computes tropical longitudes exactly as before.
- Sidereal frames subtract an explicit `hd.ayanamsa_deg(jd, mode)` offset.
- `ayanamsa_deg` is the only place the global mode is touched: it sets the
  mode immediately before reading the value, under `hd._SID_LOCK`, so it is
  deterministic under any interleaving.

Regression tests: sidereal-then-tropical returns exact pre-feature pinned
values; 40 interleaved concurrent calls across 8 threads stay clean.

## 7. Golden fixtures (third-party verification)

All fixtures synthetic; no real user birth data.

| Check | External source | Our value | Tolerance |
|-------|-----------------|-----------|-----------|
| Lahiri ayanamsa @ J2000.0 | Indian Astronomical Ephemeris: 23d51'26" | 23d51.43' | 1 arcmin |
| Lahiri ayanamsa @ 2024-01-01 | published band ~24d10-12' | 24d11.5' | band |
| Mesha Sankranti 2024 (sid Sun -> 0 Aries) | drikpanchang: Apr 13 21:15 IST | bisected crossing | 15 min (~0.6 arcmin solar) |
| Makar Sankranti 2024 (sid Sun -> 270) | drikpanchang: Jan 15 02:54 IST | bisected crossing | 15 min |
| Precession rate | ~50.3 arcsec/yr | 1990->2024 mean | 45-55 arcsec/yr |
| Fagan-Bradley vs Lahiri | ~0.88 deg ahead | delta | 0.5-1.2 deg |

Residuals come from Moshier vs full Swiss ephemeris data files (arcseconds)
and drikpanchang's rounding to the minute. All well inside interpretive
resolution (a pada is 3 deg 20').

## 8. Test suite

`services/astro/test_sidereal.py`, 37 tests (pytest). All fail on the
pre-feature tree (25 hard failures + 6 that only pass vacuously via
error-paths); all pass after. Existing tropical suites untouched:
`test_hd.py` (23 checks, script-style, run directly) and `test_acg.py` still
green. `conftest.py` excludes script-style `test_hd.py` from pytest
collection (it sys.exit()s at import; run it as a script).

## 9. Out of scope for this lane

Dashas (deferred, plan section 5), per-user preference + caching (P2,
apps/api), UI lens toggle (P3), sidereal-aware narratives (P4), deploy (P5/L6).
Convergence/harmony stay tropical-canon in v1: the synastry score is
frame-invariant by construction (aspects are angular separations; integer
score asserted identical across lenses in tests).
