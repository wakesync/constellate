"""Sidereal / Vedic engine tests (pillar P1, lane L1).

Run: .venv/bin/python -m pytest test_sidereal.py -v   (from services/astro/)

Covers:
  1. Ayanamsa golden values vs published Lahiri references (arcminute tolerance).
  2. Sankranti crossing moments vs drikpanchang (independent third-party calculator).
  3. Frame isolation: sidereal call then tropical call == pinned pre-feature
     tropical baseline (regression against swe.set_sid_mode global-state leaks).
  4. Whole-sign houses for sidereal charts (tropical keeps Placidus).
  5. Nakshatra + pada for all planets and the ascendant, with boundary cases.
  6. HD/GK sidereal gate mapping + design-time INSTANT invariance (the 88 deg
     solar arc is frame-independent: the ayanamsa cancels in the arc).
  7. Synastry score invariance across lenses (aspects are angular separations,
     frame-independent).

GOLDEN FIXTURE SOURCES (third-party, independent of this engine):
  - Lahiri ayanamsa @ J2000.0 = 23deg 51' 26"  (Indian Astronomical Ephemeris,
    the standard published Lahiri/Chitrapaksha value; widely reproduced).
  - Mesha Sankranti 2024 (sidereal Sun -> 0 deg Aries, Lahiri):
    2024-04-13 21:15 IST = 15:45 UTC  (drikpanchang.com sankranti tables).
  - Makar Sankranti 2024 (sidereal Sun -> 270 deg, Lahiri):
    2024-01-15 02:54 IST = 2024-01-14 21:24 UTC  (drikpanchang.com).
  Tolerance: 15 minutes of time ~= 0.6 arcmin of solar longitude. We assert
  crossings within 15 min and ayanamsa within 1 arcmin. Residuals come from
  Moshier vs full ephemeris and drikpanchang's own rounding to the minute.

All birth fixtures below are SYNTHETIC (no real user data).
"""

import math
from datetime import datetime, timezone

import pytest
import swisseph as swe

import hd
import main

swe.set_ephe_path(None)

# Synthetic subject: 1990-06-15 14:30 America/New_York, NYC coordinates.
FIX = dict(date="1990-06-15", time_text="14:30", lat=40.7128, lng=-74.0060,
           tz="America/New_York")

# ---------------------------------------------------------------------------
# Pinned PRE-FEATURE tropical baseline for the synthetic subject.
# Captured from the pre-change tree (commit 18bb1d3) by running
# main.compute_chart(...) directly. Any drift here = tropical contamination.
# ---------------------------------------------------------------------------
BASELINE_TROPICAL_PLANETS = {
    "Sun": 84.3882, "Moon": 348.99, "Mercury": 66.1571, "Venus": 49.0961,
    "Mars": 11.236, "Jupiter": 105.9481, "Saturn": 294.016,
    "Uranus": 278.1547, "Neptune": 283.7103, "Pluto": 225.3961,
}
BASELINE_TROPICAL_ASC = 193.6954
BASELINE_TROPICAL_MC = 105.9221
BASELINE_TROPICAL_HOUSE_CUSP_2 = 220.7713  # Placidus, NOT a whole-sign boundary


def _chart(zodiac="tropical", ayanamsa=None):
    kwargs = {}
    if zodiac != "tropical" or ayanamsa is not None:
        kwargs = {"zodiac": zodiac}
        if ayanamsa is not None:
            kwargs["ayanamsa"] = ayanamsa
    return main.compute_chart(FIX["date"], FIX["time_text"], FIX["lat"],
                              FIX["lng"], FIX["tz"], **kwargs)


def _planet(chart, name):
    return next(p for p in chart["planets"] if p["name"] == name)


# ---------------------------------------------------------------------------
# 1. Ayanamsa golden values
# ---------------------------------------------------------------------------
class TestAyanamsaGolden:
    def test_lahiri_j2000(self):
        # Published Lahiri @ 2000-01-01 12:00 UT: 23deg 51' 26" = 23.85722 deg
        jd = swe.julday(2000, 1, 1, 12.0)
        ay = hd.ayanamsa_deg(jd, "LAHIRI")
        assert abs(ay - (23 + 51 / 60 + 26 / 3600)) < 1 / 60, f"got {ay}"

    def test_lahiri_2024_magnitude(self):
        # 2024-era Lahiri is ~24deg 11' (the "~24 deg 10-12'" published band).
        jd = swe.julday(2024, 1, 1, 0.0)
        ay = hd.ayanamsa_deg(jd, "LAHIRI")
        assert 24 + 9 / 60 < ay < 24 + 13 / 60, f"got {ay}"

    def test_precession_direction(self):
        # Ayanamsa grows over time (~50.3 arcsec/year).
        a1990 = hd.ayanamsa_deg(swe.julday(1990, 1, 1, 0.0), "LAHIRI")
        a2024 = hd.ayanamsa_deg(swe.julday(2024, 1, 1, 0.0), "LAHIRI")
        rate_arcsec_yr = (a2024 - a1990) * 3600 / 34.0
        assert 45 < rate_arcsec_yr < 55, f"precession rate {rate_arcsec_yr}"

    def test_fagan_bradley_differs_from_lahiri(self):
        jd = swe.julday(2024, 1, 1, 0.0)
        lahiri = hd.ayanamsa_deg(jd, "LAHIRI")
        fb = hd.ayanamsa_deg(jd, "FAGAN_BRADLEY")
        # Fagan-Bradley runs ~0.88 deg ahead of Lahiri.
        assert 0.5 < (fb - lahiri) < 1.2, f"lahiri={lahiri} fb={fb}"

    def test_unknown_mode_rejected(self):
        with pytest.raises(ValueError):
            hd.ayanamsa_deg(swe.julday(2024, 1, 1, 0.0), "NOT_A_MODE")


# ---------------------------------------------------------------------------
# 2. Sankranti crossings vs drikpanchang (third-party Lahiri calculator)
# ---------------------------------------------------------------------------
def _sidereal_sun(jd):
    trop = swe.calc_ut(jd, swe.SUN, swe.FLG_MOSEPH)[0][0]
    return (trop - hd.ayanamsa_deg(jd, "LAHIRI")) % 360.0


def _find_crossing(jd_lo, jd_hi, target):
    """Bisect for the jd where the sidereal Sun crosses `target` degrees."""
    def f(jd):
        return ((_sidereal_sun(jd) - target + 180.0) % 360.0) - 180.0
    f_lo, f_hi = f(jd_lo), f(jd_hi)
    assert f_lo < 0 < f_hi, f"bracket does not straddle: {f_lo} {f_hi}"
    for _ in range(60):
        mid = 0.5 * (jd_lo + jd_hi)
        if f(mid) < 0:
            jd_lo = mid
        else:
            jd_hi = mid
    return 0.5 * (jd_lo + jd_hi)


class TestSankrantiGolden:
    def test_mesha_sankranti_2024(self):
        # drikpanchang: 2024-04-13 21:15 IST = 15:45 UTC
        jd = _find_crossing(swe.julday(2024, 4, 13, 0.0),
                            swe.julday(2024, 4, 14, 0.0), 0.0)
        expected = swe.julday(2024, 4, 13, 15.75)
        assert abs(jd - expected) * 24 * 60 < 15, \
            f"crossing off by {abs(jd - expected) * 24 * 60:.1f} min"

    def test_makar_sankranti_2024(self):
        # drikpanchang: 2024-01-15 02:54 IST = 2024-01-14 21:24 UTC
        jd = _find_crossing(swe.julday(2024, 1, 14, 0.0),
                            swe.julday(2024, 1, 15, 12.0), 270.0)
        expected = swe.julday(2024, 1, 14, 21.4)
        assert abs(jd - expected) * 24 * 60 < 15, \
            f"crossing off by {abs(jd - expected) * 24 * 60:.1f} min"


# ---------------------------------------------------------------------------
# 3. Frame isolation: tropical NEVER contaminated by sidereal computation
# ---------------------------------------------------------------------------
class TestFrameIsolation:
    def test_sidereal_then_tropical_returns_prefeature_values(self):
        """Regression: swe.set_sid_mode is process-global. A sidereal call
        followed by a tropical call must return the EXACT pre-feature tropical
        values (pinned from commit 18bb1d3)."""
        _chart(zodiac="sidereal")  # potentially contaminating call
        trop = _chart()            # tropical, default args
        for name, lon in BASELINE_TROPICAL_PLANETS.items():
            assert _planet(trop, name)["absolute_degree"] == lon, name
        assert trop["ascendant"]["absolute_degree"] == BASELINE_TROPICAL_ASC
        assert trop["midheaven"]["absolute_degree"] == BASELINE_TROPICAL_MC
        assert trop["houses"][1]["absolute_degree"] == BASELINE_TROPICAL_HOUSE_CUSP_2

    def test_tropical_output_shape_unchanged(self):
        """Pre-feature tropical response carried no zodiac/ayanamsa keys.
        Byte-identity invariant: they must not appear."""
        trop = _chart()
        assert "zodiac" not in trop
        assert "ayanamsa" not in trop
        assert "house_system" not in trop
        assert "nakshatra" not in trop["planets"][0]

    def test_concurrent_lenses_no_contamination(self):
        """FastAPI runs sync endpoints in a threadpool. Hammer both lenses
        from concurrent threads; every tropical result must stay pinned to the
        baseline. (Chart math never uses swisseph's global sidereal mode; the
        only global touch is inside hd.ayanamsa_deg under a lock.)"""
        import concurrent.futures

        def tropical_ok(_):
            c = _chart()
            return _planet(c, "Sun")["absolute_degree"] == BASELINE_TROPICAL_PLANETS["Sun"] \
                and "zodiac" not in c

        def sidereal_ok(_):
            c = _chart(zodiac="sidereal")
            return abs(_planet(c, "Sun")["absolute_degree"] - 60.6645) < 1e-3

        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as ex:
            futs = [ex.submit(tropical_ok, i) if i % 2 else ex.submit(sidereal_ok, i)
                    for i in range(40)]
            assert all(f.result() for f in futs)

    def test_interleaved_calls_stable(self):
        a = _chart()
        _chart(zodiac="sidereal")
        _chart(zodiac="sidereal", ayanamsa="FAGAN_BRADLEY")
        b = _chart()
        a.pop("generated_at")
        b.pop("generated_at")
        assert a == b


# ---------------------------------------------------------------------------
# 4. Sidereal chart: longitudes, whole-sign houses
# ---------------------------------------------------------------------------
class TestSiderealChart:
    def test_sidereal_longitudes_are_tropical_minus_ayanamsa(self):
        trop = _chart()
        sid = _chart(zodiac="sidereal")
        jd = main.to_julian_day_ut(FIX["date"], FIX["time_text"], FIX["tz"])
        ay = hd.ayanamsa_deg(jd, "LAHIRI")
        for p in trop["planets"]:
            sp = _planet(sid, p["name"])
            expect = (p["absolute_degree"] - ay) % 360.0
            assert abs(sp["absolute_degree"] - expect) < 1e-3, p["name"]

    def test_sidereal_metadata(self):
        sid = _chart(zodiac="sidereal")
        assert sid["zodiac"] == "sidereal"
        assert sid["house_system"] == "whole_sign"
        assert sid["ayanamsa"]["mode"] == "LAHIRI"
        # ayanamsa at 1990-06-15 is ~23.72 deg
        assert 23.6 < sid["ayanamsa"]["value_deg"] < 23.8

    def test_pinned_sidereal_positions(self):
        """Pinned from tropical baseline minus Lahiri ayanamsa (23.723746 deg
        @ 1990-06-15 18:30 UT). Tolerance 0.1 arcmin."""
        sid = _chart(zodiac="sidereal")
        tol = 0.1 / 60
        assert abs(_planet(sid, "Sun")["absolute_degree"] - 60.6645) < tol
        assert abs(_planet(sid, "Moon")["absolute_degree"] - 325.2663) < tol
        assert abs(sid["ascendant"]["absolute_degree"] - 169.9717) < tol
        assert _planet(sid, "Sun")["sign"] == "Gemini"       # was Gemini (late)
        assert _planet(sid, "Moon")["sign"] == "Aquarius"    # was Pisces
        assert sid["ascendant"]["sign"] == "Virgo"           # was Libra

    def test_whole_sign_houses(self):
        sid = _chart(zodiac="sidereal")
        # Asc in sidereal Virgo -> house 1 = Virgo, cusps at exact sign starts.
        assert sid["houses"][0]["sign"] == "Virgo"
        assert sid["houses"][0]["absolute_degree"] == 150.0
        for i, h in enumerate(sid["houses"]):
            assert h["degree"] == 0.0, f"whole-sign cusp {i+1} not at 0 deg"
            assert h["absolute_degree"] == (150.0 + 30 * i) % 360.0
        # Planet house = whole-sign offset from asc sign.
        assert _planet(sid, "Sun")["house"] == 10     # Gemini from Virgo
        assert _planet(sid, "Moon")["house"] == 6     # Aquarius from Virgo
        assert _planet(sid, "Saturn")["house"] == 5   # Capricorn from Virgo

    def test_tropical_keeps_placidus(self):
        trop = _chart()
        degrees = {h["degree"] for h in trop["houses"]}
        assert degrees != {0.0}, "tropical houses must remain Placidus"


# ---------------------------------------------------------------------------
# 5. Nakshatras
# ---------------------------------------------------------------------------
class TestNakshatra:
    def test_table_integrity(self):
        assert len(main.NAKSHATRAS) == 27
        assert main.NAKSHATRAS[0] == "Ashwini"
        assert main.NAKSHATRAS[26] == "Revati"
        assert len(set(main.NAKSHATRAS)) == 27

    def test_boundaries(self):
        assert main.nakshatra_of(0.0) == {
            "name": "Ashwini", "index": 1, "pada": 1, "degree_in_nakshatra": 0.0}
        n = main.nakshatra_of(13.3332)          # last sliver of Ashwini
        assert n["name"] == "Ashwini" and n["pada"] == 4
        n = main.nakshatra_of(13.3334)          # first sliver of Bharani
        assert n["name"] == "Bharani" and n["pada"] == 1
        n = main.nakshatra_of(359.99)
        assert n["name"] == "Revati" and n["pada"] == 4
        # 13 deg 20' = 13.3333... exactly starts Bharani
        assert main.nakshatra_of(360.0 / 27.0)["name"] == "Bharani"

    def test_fixture_nakshatras(self):
        """Sidereal Moon 325.27 = Aquarius 25.27 -> Purva Bhadrapada pada 2.
        Sidereal Sun 60.66 -> Mrigashira. Asc 169.97 -> Hasta."""
        sid = _chart(zodiac="sidereal")
        moon = _planet(sid, "Moon")["nakshatra"]
        assert moon["name"] == "Purva Bhadrapada" and moon["pada"] == 2
        assert _planet(sid, "Sun")["nakshatra"]["name"] == "Mrigashira"
        assert sid["ascendant"]["nakshatra"]["name"] == "Hasta"

    def test_every_planet_and_asc_has_nakshatra(self):
        sid = _chart(zodiac="sidereal")
        for p in sid["planets"]:
            nk = p["nakshatra"]
            assert nk["name"] in main.NAKSHATRAS
            assert 1 <= nk["index"] <= 27
            assert 1 <= nk["pada"] <= 4
        assert sid["ascendant"]["nakshatra"]["name"] in main.NAKSHATRAS


# ---------------------------------------------------------------------------
# 6. HD / GK sidereal lens
# ---------------------------------------------------------------------------
class TestSiderealHumanDesign:
    def _jd(self):
        return main.to_julian_day_ut(FIX["date"], FIX["time_text"], FIX["tz"])

    def test_design_instant_frame_invariant(self):
        """The 88-degree solar arc is a DIFFERENCE of longitudes; the ayanamsa
        cancels. The design INSTANT must be identical in both frames."""
        jd = self._jd()
        trop = hd.compute_human_design(jd, "iso")
        sid = hd.compute_human_design(jd, "iso", zodiac="sidereal")
        assert trop["design_datetime_utc"] == sid["design_datetime_utc"]
        # And the sidereal design Sun sits 88 deg of SIDEREAL arc back too
        # (up to the tiny ayanamsa drift over ~89 days, ~12 arcsec).
        p_sun = sid["gates"]["personality"][0]["lon"]
        d_sun = sid["gates"]["design"][0]["lon"]
        arc = (p_sun - d_sun) % 360.0
        assert abs(arc - 88.0) < 0.01, f"sidereal arc {arc}"

    def test_sidereal_gate_mapping_shifts(self):
        """~24 deg back = ~4.3 gates of arc: the personality Sun gate MUST
        differ from tropical for this fixture (tropical gate 12, sidereal 20)."""
        jd = self._jd()
        trop = hd.compute_human_design(jd, "iso")
        sid = hd.compute_human_design(jd, "iso", zodiac="sidereal")
        t_sun = trop["gates"]["personality"][0]
        s_sun = sid["gates"]["personality"][0]
        assert t_sun["gate"] == 12 and t_sun["line"] == 2
        assert s_sun["gate"] == 20 and s_sun["line"] == 1
        # Earth stays opposite Sun in every frame.
        s_earth = sid["gates"]["personality"][1]
        assert abs(((s_sun["lon"] + 180.0) % 360.0) - s_earth["lon"]) < 1e-6

    def test_sidereal_hd_carries_alternate_lens_framing(self):
        jd = self._jd()
        sid = hd.compute_human_design(jd, "iso", zodiac="sidereal")
        assert sid["zodiac"] == "sidereal"
        assert sid["lens"] == "alternate"
        assert sid["canon"] == "tropical"
        assert sid["ayanamsa"]["mode"] == "LAHIRI"

    def test_tropical_hd_output_shape_unchanged(self):
        jd = self._jd()
        trop = hd.compute_human_design(jd, "iso")
        assert "zodiac" not in trop
        assert "lens" not in trop
        assert "ayanamsa" not in trop

    def test_gene_keys_sidereal_propagates_lens(self):
        jd = self._jd()
        sid_hd = hd.compute_human_design(jd, "iso", zodiac="sidereal")
        gk = hd.compute_gene_keys(sid_hd)
        assert gk["zodiac"] == "sidereal"
        assert gk["canon"] == "tropical"
        # Life's Work sphere follows the sidereal personality Sun gate.
        assert gk["activation"]["lifes_work"]["gate"] == 20

    def test_gene_keys_tropical_shape_unchanged(self):
        jd = self._jd()
        gk = hd.compute_gene_keys(hd.compute_human_design(jd, "iso"))
        assert "zodiac" not in gk
        assert "canon" not in gk


# ---------------------------------------------------------------------------
# 7. Synastry invariance (aspects are frame-independent)
# ---------------------------------------------------------------------------
class TestSynastryLens:
    A = dict(date="1990-06-15", time="14:30", lat=40.7128, lng=-74.0060,
             tz="America/New_York")
    B = dict(date="1992-11-03", time="08:15", lat=51.5074, lng=-0.1278,
             tz="Europe/London")

    def _syn(self, zodiac):
        req = main.SynastryRequest(person_a=main.Person(**self.A),
                                   person_b=main.Person(**self.B),
                                   zodiac=zodiac)
        return main.synastry(req)

    def test_score_identical_across_lenses(self):
        """Aspects are angular separations, so the frame cancels EXCEPT for the
        ayanamsa drift between the two birth instants (~50 arcsec/yr of age
        gap; here 2.4 yr -> ~2 arcmin). Integer score must match; weighted
        sums may differ in the last rounding digit only."""
        trop = self._syn("tropical")
        sid = self._syn("sidereal")
        assert trop["score"] == sid["score"]
        assert abs(trop["weighted_harmony"] - sid["weighted_harmony"]) < 0.05
        assert abs(trop["weighted_friction"] - sid["weighted_friction"]) < 0.05
        assert len(trop["aspects"]) == len(sid["aspects"])

    def test_sidereal_synastry_charts_are_sidereal(self):
        sid = self._syn("sidereal")
        assert sid["person_a_chart"]["zodiac"] == "sidereal"
        assert sid["person_b_chart"]["zodiac"] == "sidereal"
        assert sid["zodiac"] == "sidereal"


# ---------------------------------------------------------------------------
# 8. Endpoint plumbing (validation + design-time invariance end to end)
# ---------------------------------------------------------------------------
class TestEndpoints:
    def test_natal_rejects_bad_zodiac(self):
        with pytest.raises(Exception):
            main.NatalRequest(date="1990-06-15", time="14:30", lat=40.7,
                              lng=-74.0, tz="America/New_York", zodiac="draconic")

    def test_natal_rejects_bad_ayanamsa(self):
        req = main.NatalRequest(date="1990-06-15", time="14:30", lat=40.7,
                                lng=-74.0, tz="America/New_York",
                                zodiac="sidereal", ayanamsa="BOGUS")
        with pytest.raises(Exception):
            main.natal(req)

    def test_design_time_identical_across_lenses(self):
        base = dict(date="1990-06-15", time="14:30", lat=40.7128, lng=-74.0060,
                    tz="America/New_York")
        trop = main.design_time(main.NatalRequest(**base))
        sid = main.design_time(main.NatalRequest(**base, zodiac="sidereal"))
        assert trop == sid, "design-time instant must be frame-independent"

    def test_sun_sign_boundary_case(self):
        """2024-04-10: tropical Sun in Aries ~21 deg, sidereal Sun still in
        Pisces (~26-27 deg). The classic one-sign-back flip."""
        trop = main.compute_chart("2024-04-10", "12:00", 28.61, 77.20, "Asia/Kolkata")
        sid = main.compute_chart("2024-04-10", "12:00", 28.61, 77.20, "Asia/Kolkata",
                                 zodiac="sidereal")
        assert _planet(trop, "Sun")["sign"] == "Aries"
        assert _planet(sid, "Sun")["sign"] == "Pisces"
        # Just after Mesha Sankranti the sidereal Sun enters Ashwini.
        sid2 = main.compute_chart("2024-04-14", "12:00", 28.61, 77.20, "Asia/Kolkata",
                                  zodiac="sidereal")
        assert _planet(sid2, "Sun")["sign"] == "Aries"
        assert _planet(sid2, "Sun")["nakshatra"]["name"] == "Ashwini"
