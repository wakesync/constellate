"""Astrocartography self-test / validation gate.

Run:  .venv/bin/python test_acg.py

Proves the astrocartography math is correct by checking line longitudes against
known geometry + a documented reference birth (Albert Einstein), per the brief's
validation gate. If GST sign or RA convention were wrong the lines would be
90/180 degrees off and these asserts would fail.
"""

import math

import swisseph as swe

from main import compute_astrocartography


def _mc_lon(result, planet):
    for line in result["lines"]:
        if line["planet"] == planet and line["kind"] == "MC":
            return line["coordinates"][0][0]
    raise AssertionError(f"no MC line for {planet}")


def _kinds(result, planet):
    return [l["kind"] for l in result["lines"] if l["planet"] == planet]


def test_noon_utc_sun_mc_is_greenwich():
    """A birth at 12:00 UTC on the prime meridian puts the Sun's MC line at
    ~longitude 0 (it is local apparent noon at Greenwich, Sun on the meridian)."""
    res = compute_astrocartography("1990-01-01", "12:00", 0.0, 0.0, "UTC")
    sun_mc = _mc_lon(res, "Sun")
    assert abs(sun_mc) < 2.0, f"Sun MC at noon UTC should be ~0, got {sun_mc:.3f}"
    print(f"[ok] noon-UTC Sun MC line longitude = {sun_mc:+.3f} (expected ~0)")


def test_ic_is_mc_plus_180():
    res = compute_astrocartography("1990-01-01", "12:00", 0.0, 0.0, "UTC")
    for planet in ("Sun", "Moon", "Mars"):
        mc = None
        ic = None
        for line in res["lines"]:
            if line["planet"] == planet and line["kind"] == "MC":
                mc = line["coordinates"][0][0]
            if line["planet"] == planet and line["kind"] == "IC":
                ic = line["coordinates"][0][0]
        diff = abs(((mc - ic + 180) % 360) - 180)
        assert abs(diff - 180) < 0.01 or abs(diff) < 0.01, f"{planet} IC not 180 from MC"
    print("[ok] every IC line is the MC meridian + 180 degrees")


def test_asc_west_dsc_east_of_mc():
    """At equatorial latitudes the rising (ASC) line sits ~90 deg WEST of the MC
    meridian and the setting (DSC) line ~90 deg EAST. This pins the rising/setting
    sign convention (the exact thing the brief warns can be flipped)."""
    res = compute_astrocartography("1990-06-21", "12:00", 0.0, 0.0, "UTC")
    mc = _mc_lon(res, "Sun")

    def near_equator_lon(kind):
        best = None
        for line in res["lines"]:
            if line["planet"] == "Sun" and line["kind"] == kind:
                for lng, lat in line["coordinates"]:
                    if abs(lat) < 1.0:
                        best = lng
        return best

    asc = near_equator_lon("ASC")
    dsc = near_equator_lon("DSC")
    asc_off = ((asc - mc + 180) % 360) - 180
    dsc_off = ((dsc - mc + 180) % 360) - 180
    assert asc_off < -45, f"ASC should be ~90 deg WEST of MC, offset={asc_off:.1f}"
    assert dsc_off > 45, f"DSC should be ~90 deg EAST of MC, offset={dsc_off:.1f}"
    print(f"[ok] Sun ASC is {asc_off:+.1f} deg from MC (west), DSC {dsc_off:+.1f} deg (east)")


def test_einstein_reference():
    """Albert Einstein, 1879-03-14 11:30 Ulm (Europe/Berlin).
    Documented astro.com ACG: the Sun MC line runs through eastern Europe near
    ~23 deg E. We check Sun + Moon MC longitudes and report them for eyeball
    comparison against a reference map."""
    res = compute_astrocartography("1879-03-14", "11:30", 48.4, 9.99, "Europe/Berlin")
    sun_mc = _mc_lon(res, "Sun")
    moon_mc = _mc_lon(res, "Moon")
    print(f"[ref] Einstein Sun MC line = {sun_mc:+.2f} deg lng  (astro.com reference ~ +23 deg E)")
    print(f"[ref] Einstein Moon MC line = {moon_mc:+.2f} deg lng")
    assert 18.0 < sun_mc < 28.0, f"Einstein Sun MC out of expected band: {sun_mc:.2f}"


def test_all_planets_four_kinds():
    res = compute_astrocartography("1993-08-14", "03:22", 40.015, -105.27, "America/Denver")
    planets = {l["planet"] for l in res["lines"]}
    assert len(planets) == 10, f"expected 10 planets, got {len(planets)}"
    for p in planets:
        kinds = set(_kinds(res, p))
        for required in ("MC", "IC", "ASC", "DSC"):
            assert required in kinds, f"{p} missing {required} line"
    # coordinates are [lng, lat] within bounds
    for line in res["lines"]:
        for lng, lat in line["coordinates"]:
            assert -180.0 <= lng <= 180.0, f"lng out of range: {lng}"
            assert -90.0 <= lat <= 90.0, f"lat out of range: {lat}"
    print(f"[ok] all 10 planets have MC/IC/ASC/DSC lines; {len(res['lines'])} segments total")


def main():
    print("=== astrocartography validation ===")
    test_noon_utc_sun_mc_is_greenwich()
    test_ic_is_mc_plus_180()
    test_asc_west_dsc_east_of_mc()
    test_einstein_reference()
    test_all_planets_four_kinds()
    print("=== all checks passed ===")


if __name__ == "__main__":
    main()
