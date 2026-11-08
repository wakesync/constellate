import math
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Literal, Optional
from zoneinfo import ZoneInfo

import swisseph as swe
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

import hd

load_dotenv()

app = FastAPI(title="Constellate Astro Sidecar", version="0.2.0")

ASTRO_BEARER = os.getenv("ASTRO_BEARER", "")

# Use Moshier analytical ephemeris (no data files needed, accurate to arcseconds for our range).
swe.set_ephe_path(None)
EPH_FLAG = swe.FLG_MOSEPH | swe.FLG_SPEED

SIGNS = ["Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo", "Libra",
         "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces"]

# ---------------------------------------------------------------------------
# Zodiac lens. "tropical" (default) = the pre-feature engine, byte-identical
# output. "sidereal" = Vedic frame: every longitude shifted back by the
# ayanamsa (Lahiri default, pluggable), WHOLE-SIGN houses, nakshatra + pada
# for every planet and the ascendant. Sidereal longitudes are computed as
# tropical minus an explicit ayanamsa offset (hd.ayanamsa_deg); we never rely
# on swisseph's process-global sidereal mode for chart math, so concurrent
# tropical requests can never be contaminated. See docs/SIDEREAL.md.
# ---------------------------------------------------------------------------
Zodiac = Literal["tropical", "sidereal"]

# The 27 nakshatras: 13 deg 20' lunar mansions from 0 deg SIDEREAL Aries.
NAKSHATRAS = [
    "Ashwini", "Bharani", "Krittika", "Rohini", "Mrigashira", "Ardra",
    "Punarvasu", "Pushya", "Ashlesha", "Magha", "Purva Phalguni",
    "Uttara Phalguni", "Hasta", "Chitra", "Swati", "Vishakha", "Anuradha",
    "Jyeshtha", "Mula", "Purva Ashadha", "Uttara Ashadha", "Shravana",
    "Dhanishta", "Shatabhisha", "Purva Bhadrapada", "Uttara Bhadrapada",
    "Revati",
]
NAKSHATRA_SIZE = 360.0 / 27.0  # 13 deg 20'
PADA_SIZE = NAKSHATRA_SIZE / 4.0  # 3 deg 20'


def nakshatra_of(sidereal_lon: float) -> Dict[str, Any]:
    """Nakshatra + pada for a SIDEREAL longitude (degrees)."""
    lon = sidereal_lon % 360.0
    idx = int(lon // NAKSHATRA_SIZE)
    within = lon - idx * NAKSHATRA_SIZE
    return {
        "name": NAKSHATRAS[idx],
        "index": idx + 1,               # 1..27 (1 = Ashwini)
        "pada": int(within // PADA_SIZE) + 1,  # 1..4
        "degree_in_nakshatra": round(within, 4),
    }

PLANET_IDS = [
    ("Sun", swe.SUN),
    ("Moon", swe.MOON),
    ("Mercury", swe.MERCURY),
    ("Venus", swe.VENUS),
    ("Mars", swe.MARS),
    ("Jupiter", swe.JUPITER),
    ("Saturn", swe.SATURN),
    ("Uranus", swe.URANUS),
    ("Neptune", swe.NEPTUNE),
    ("Pluto", swe.PLUTO),
]


def require_auth(authorization: Optional[str] = Header(default=None)) -> None:
    if not ASTRO_BEARER:
        raise HTTPException(status_code=503, detail={"error": "astro bearer not configured", "code": "CONFIG_MISSING"})
    if authorization != f"Bearer {ASTRO_BEARER}":
        raise HTTPException(status_code=401, detail={"error": "unauthorized", "code": "UNAUTHORIZED"})


class NatalRequest(BaseModel):
    date: str
    time: str
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    tz: str
    zodiac: Zodiac = "tropical"
    ayanamsa: Optional[str] = None  # only meaningful when zodiac=sidereal; default LAHIRI


class TransitRequest(BaseModel):
    date: str
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    tz: str
    zodiac: Zodiac = "tropical"
    ayanamsa: Optional[str] = None


class Person(BaseModel):
    date: str
    time: str
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    tz: str


class SynastryRequest(BaseModel):
    person_a: Person
    person_b: Person
    zodiac: Zodiac = "tropical"
    ayanamsa: Optional[str] = None


class AstrocartographyRequest(BaseModel):
    date: str
    time: str
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    tz: str
    # Astrocartography lines are computed from equatorial coordinates (RA/Dec)
    # and geography; they are zodiac-frame-independent. The param is accepted
    # for API uniformity and echoed back, but changes nothing.
    zodiac: Zodiac = "tropical"
    ayanamsa: Optional[str] = None


def to_julian_day_ut(date: str, time_text: str, tz: str) -> float:
    """Parse a local birth date/time + IANA tz, convert to UTC, return Julian Day (UT)."""
    if not time_text or time_text.strip() == "":
        time_text = "12:00"
    try:
        hh, mm = (int(x) for x in time_text.split(":")[:2])
    except (ValueError, IndexError):
        hh, mm = 12, 0
    y, mo, d = (int(x) for x in date.split("-")[:3])
    try:
        zone = ZoneInfo(tz)
    except Exception:
        zone = ZoneInfo("UTC")
    local_dt = datetime(y, mo, d, hh, mm, tzinfo=zone)
    utc_dt = local_dt.astimezone(timezone.utc)
    ut_hour = utc_dt.hour + utc_dt.minute / 60.0 + utc_dt.second / 3600.0
    return swe.julday(utc_dt.year, utc_dt.month, utc_dt.day, ut_hour)


def sign_of(lon: float) -> tuple[str, float]:
    lon = lon % 360.0
    return SIGNS[int(lon // 30)], round(lon % 30, 4)


def house_of(lon: float, cusps: List[float]) -> int:
    """Whole-cusp house assignment using 12 Placidus cusps (1..12)."""
    lon = lon % 360.0
    for i in range(12):
        start = cusps[i] % 360.0
        end = cusps[(i + 1) % 12] % 360.0
        if start <= end:
            if start <= lon < end:
                return i + 1
        else:  # wraps past 360
            if lon >= start or lon < end:
                return i + 1
    return 1


def compute_chart(date: str, time_text: str, lat: float, lng: float, tz: str,
                  zodiac: str = "tropical", ayanamsa: Optional[str] = None) -> Dict[str, Any]:
    """Natal chart in the requested zodiac frame.

    tropical (default): Placidus houses, output byte-identical to the
    pre-sidereal engine (regression-pinned in test_sidereal.py).

    sidereal: longitudes = tropical - ayanamsa (explicit offset, never the
    swisseph global sidereal mode), WHOLE-SIGN houses anchored on the sidereal
    ascendant sign, nakshatra + pada on every planet and the ascendant.
    """
    sidereal = zodiac == "sidereal"
    ay_mode = ayanamsa or hd.DEFAULT_AYANAMSA
    jd = to_julian_day_ut(date, time_text, tz)
    ay = hd.ayanamsa_deg(jd, ay_mode) if sidereal else 0.0

    # Houses (Placidus). Returns (cusps[1..12], ascmc) — cusps index 0 unused in swe.
    try:
        cusps, ascmc = swe.houses(jd, lat, lng, b'P')
        cusp_list = list(cusps[0:12]) if len(cusps) == 12 else list(cusps[1:13])
        ascendant = ascmc[0]
        midheaven = ascmc[1]
    except Exception:
        cusp_list = [(i * 30.0) for i in range(12)]
        ascendant = 0.0
        midheaven = 270.0

    if sidereal:
        # Ascendant + MC shift into the sidereal frame; houses become WHOLE
        # SIGNS from the sidereal ascendant sign (Vedic practice).
        ascendant = (ascendant - ay) % 360.0
        midheaven = (midheaven - ay) % 360.0
        asc_sign_start = float(int(ascendant // 30) * 30)
        cusp_list = [(asc_sign_start + 30.0 * i) % 360.0 for i in range(12)]

    planets = []
    for name, pid in PLANET_IDS:
        res = swe.calc_ut(jd, pid, EPH_FLAG)
        lon = (res[0][0] - ay) % 360.0
        speed = res[0][3]
        sign, deg = sign_of(lon)
        planet = {
            "name": name,
            "sign": sign,
            "sign_degree": deg,
            "absolute_degree": round(lon % 360.0, 4),
            "house": house_of(lon, cusp_list),
            "retrograde": speed < 0,
        }
        if sidereal:
            planet["nakshatra"] = nakshatra_of(lon)
        planets.append(planet)

    asc_sign, asc_deg = sign_of(ascendant)
    mc_sign, mc_deg = sign_of(midheaven)

    houses = []
    for i in range(12):
        hs, hd_deg = sign_of(cusp_list[i])
        houses.append({"house": i + 1, "sign": hs, "degree": hd_deg, "absolute_degree": round(cusp_list[i] % 360, 4)})

    out = {
        "engine": "swiss-ephemeris (moshier)",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "input": {"date": date, "time": time_text, "lat": lat, "lng": lng, "tz": tz},
        "ascendant": {"sign": asc_sign, "sign_degree": asc_deg, "absolute_degree": round(ascendant % 360, 4)},
        "midheaven": {"sign": mc_sign, "sign_degree": mc_deg, "absolute_degree": round(midheaven % 360, 4)},
        "planets": planets,
        "houses": houses,
    }
    if sidereal:
        out["zodiac"] = "sidereal"
        out["house_system"] = "whole_sign"
        out["ayanamsa"] = {"mode": ay_mode, "value_deg": round(ay, 6)}
        out["ascendant"]["nakshatra"] = nakshatra_of(ascendant)
    return out


ASPECTS = [
    ("conjunction", 0, 8),
    ("sextile", 60, 5),
    ("square", 90, 6),
    ("trine", 120, 6),
    ("opposition", 180, 8),
]
HARMONIOUS = {"conjunction", "sextile", "trine"}

# Personal planets describe the actual person. Outer/slow planets (Jupiter..Pluto)
# move slowly, so aspects between two slow planets are GENERATIONAL noise shared by
# whole age cohorts, not a signal about these two specific people. We weight them
# accordingly so the score reflects the real relational bond, not the age gap.
PERSONAL = {"Sun", "Moon", "Mercury", "Venus", "Mars"}
SLOW = {"Jupiter", "Saturn", "Uranus", "Neptune", "Pluto"}
OUTER = {"Uranus", "Neptune", "Pluto"}


def _aspect_weight(pa: str, pb: str) -> float:
    # Outer-to-outer = generational, essentially ignore.
    if pa in OUTER and pb in OUTER:
        return 0.1
    # Both personal = the core of synastry, full weight.
    if pa in PERSONAL and pb in PERSONAL:
        return 1.0
    # One personal, one slow = meaningful (how a slow theme touches a personal planet).
    if pa in PERSONAL or pb in PERSONAL:
        return 0.6
    # Slow-to-slow but not both outer (e.g. Jupiter-Saturn) = mild.
    return 0.3


def compute_aspects(planets_a: List[Dict], planets_b: List[Dict]) -> List[Dict]:
    out = []
    for a in planets_a:
        for b in planets_b:
            delta = abs(a["absolute_degree"] - b["absolute_degree"])
            delta = min(delta, 360 - delta)
            for name, angle, orb in ASPECTS:
                off = abs(delta - angle)
                if off <= orb:
                    weight = _aspect_weight(a["name"], b["name"])
                    # Tighter orbs matter more; scale weight by closeness.
                    closeness = 1.0 - (off / orb) * 0.5  # 1.0 exact -> 0.5 at edge
                    out.append({
                        "person_a_planet": a["name"],
                        "person_b_planet": b["name"],
                        "aspect": name,
                        "orb": round(off, 3),
                        "harmonious": name in HARMONIOUS,
                        "weight": round(weight, 2),
                        "generational": a["name"] in OUTER and b["name"] in OUTER,
                        "effective": round(weight * closeness, 3),
                    })
                    break
    return out


# ---------------------------------------------------------------------------
# Astrocartography
#
# For each natal planet we draw four lines across the Earth:
#   MC  - meridian where the planet culminates (on the upper local meridian)
#   IC  - meridian where the planet anti-culminates (lower meridian)
#   ASC - curve where the planet is on the eastern horizon (rising)
#   DSC - curve where the planet is on the western horizon (setting)
#
# Math (validated against synthetic geometry, see test_acg.py):
#   RA, Dec   from swe.calc_ut(jd, planet, FLG_MOSEPH | FLG_EQUATORIAL)
#   GST(deg)  from swe.sidtime(jd) * 15
#   MC line   lon = RA - GST           (IC = lon + 180)
#   ASC/DSC   cos(H) = -tan(phi)*tan(Dec)
#             rising  lon = RA - H - GST   (west of MC, morning side)
#             setting lon = RA + H - GST   (east of MC, evening side)
# Coordinates are emitted GeoJSON style: [lng, lat].
# ---------------------------------------------------------------------------

EQ_FLAG = swe.FLG_MOSEPH | swe.FLG_EQUATORIAL
ACG_LAT_MIN = -70.0
ACG_LAT_MAX = 70.0
ACG_LAT_STEP = 2.0
ACG_LINE_KINDS = ("MC", "IC", "ASC", "DSC")


def _norm180(deg: float) -> float:
    """Normalize a longitude to the [-180, 180) range."""
    return ((deg + 180.0) % 360.0) - 180.0


def _split_antimeridian(points: List[List[float]]) -> List[List[List[float]]]:
    """Split a [lng,lat] polyline into segments wherever it wraps past +/-180
    so the map renderer never draws a stray line across the whole world."""
    segments: List[List[List[float]]] = []
    current: List[List[float]] = []
    prev_lng: Optional[float] = None
    for lng, lat in points:
        if prev_lng is not None and abs(lng - prev_lng) > 180.0:
            if len(current) >= 2:
                segments.append(current)
            current = []
        current.append([lng, lat])
        prev_lng = lng
    if len(current) >= 2:
        segments.append(current)
    return segments


def compute_astrocartography(date: str, time_text: str, lat: float, lng: float, tz: str) -> Dict[str, Any]:
    jd = to_julian_day_ut(date, time_text, tz)
    gst = swe.sidtime(jd) * 15.0  # Greenwich apparent sidereal time, degrees

    lines: List[Dict[str, Any]] = []

    for name, pid in PLANET_IDS:
        res = swe.calc_ut(jd, pid, EQ_FLAG)
        ra = res[0][0]   # right ascension, degrees
        dec = res[0][1]  # declination, degrees

        # MC / IC: vertical meridians (constant longitude, all latitudes).
        lon_mc = _norm180(ra - gst)
        lon_ic = _norm180(lon_mc + 180.0)
        lines.append({"planet": name, "kind": "MC", "coordinates": [[lon_mc, -85.0], [lon_mc, 85.0]]})
        lines.append({"planet": name, "kind": "IC", "coordinates": [[lon_ic, -85.0], [lon_ic, 85.0]]})

        # ASC / DSC: latitude-dependent rising/setting curves.
        asc_points: List[List[float]] = []
        dsc_points: List[List[float]] = []
        tan_dec = math.tan(math.radians(dec))
        phi = ACG_LAT_MIN
        while phi <= ACG_LAT_MAX + 1e-9:
            val = -math.tan(math.radians(phi)) * tan_dec
            if -1.0 <= val <= 1.0:
                hour_angle = math.degrees(math.acos(val))  # 0..180
                asc_points.append([_norm180(ra - hour_angle - gst), phi])
                dsc_points.append([_norm180(ra + hour_angle - gst), phi])
            # else: circumpolar / never-rises at this latitude -> no point here.
            phi += ACG_LAT_STEP

        for seg in _split_antimeridian(asc_points):
            lines.append({"planet": name, "kind": "ASC", "coordinates": seg})
        for seg in _split_antimeridian(dsc_points):
            lines.append({"planet": name, "kind": "DSC", "coordinates": seg})

    return {
        "engine": "swiss-ephemeris (moshier)",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "input": {"date": date, "time": time_text, "lat": lat, "lng": lng, "tz": tz},
        "lines": lines,
        "interpretations": ACG_INTERPRETATIONS,
    }


# Interpretation table. (planet, line_kind) -> a short, observational note.
# Voice: apophatic, dry, never prescriptive. Describes the texture of a place,
# not a verdict or an instruction. Matches apps/api/src/prompts/SYSTEM_BASE.md.
ACG_INTERPRETATIONS: Dict[str, Dict[str, str]] = {
    "Sun": {
        "MC": "where you are seen for what you already are. people here meet the lit version of you first.",
        "IC": "where you return to the root of yourself. the place asks who you are before anyone is watching.",
        "ASC": "where you arrive more vividly. the self steps forward here, sometimes ahead of you.",
        "DSC": "where you find yourself in the mirror of others. the day organizes itself around who you meet.",
    },
    "Moon": {
        "MC": "where your inner weather becomes visible. people sense the tide in you before you name it.",
        "IC": "where you feel most at home, or most undefended. the place holds the part of you that needs holding.",
        "ASC": "where feeling arrives before thought. you read a room here through the body.",
        "DSC": "where closeness comes easily and quietly. the bonds here are made of attention, not words.",
    },
    "Mercury": {
        "MC": "where you are known for how you think and say things. the work here moves through language.",
        "IC": "where the inner monologue gets loud. the place is good for the long private conversation with yourself.",
        "ASC": "where you meet the world mid-sentence. quick to notice, quick to connect.",
        "DSC": "where the talk goes somewhere. exchanges here finish each other's lists.",
    },
    "Venus": {
        "MC": "where you are seen as worth keeping. value and affection tend to find the surface here.",
        "IC": "where pleasure becomes domestic. the place softens, settles, wants to be lived in.",
        "ASC": "where you are easier to be near. a kind of grace meets the room before you do.",
        "DSC": "where attraction does its quiet arithmetic. the people here are drawn, and you to them.",
    },
    "Mars": {
        "MC": "where you are known by what you push for. effort here is visible, sometimes louder than intended.",
        "IC": "where the heat lives underneath. the place keeps the engine running even at rest.",
        "ASC": "where you move first and explain later. the body wants to act here.",
        "DSC": "where friction meets you in other people. a useful heat, if it builds rather than burns.",
    },
    "Jupiter": {
        "MC": "where the horizon looks wider. opportunity here has a way of being seen.",
        "IC": "where you grow from the inside. the place gives more room than it asks for.",
        "ASC": "where you arrive with the door already open. ease, sometimes more than you account for.",
        "DSC": "where generous company finds you. the people here tend to expand the frame.",
    },
    "Saturn": {
        "MC": "where you carry weight in plain sight. the work here is slow and it counts.",
        "IC": "where the foundations are tested. the place asks what holds when no one is watching.",
        "ASC": "where you meet the world composed, sometimes guarded. nothing arrives unearned here.",
        "DSC": "where the lasting bonds are made of patience. saturn is not punishment, it is architecture.",
    },
    "Uranus": {
        "MC": "where you are seen at a slight angle to everyone else. the place rewards the unusual line.",
        "IC": "where the ground shifts on its own schedule. home here is a moving thing.",
        "ASC": "where you arrive already a little outside the pattern. the self resists the obvious here.",
        "DSC": "where the unexpected people find you. connections arrive sideways, rarely on time.",
    },
    "Neptune": {
        "MC": "where the edges of you blur in public. people project, and sometimes you let them.",
        "IC": "where the place returns you to water. the inner life runs deep and not always charted.",
        "ASC": "where you blur into a room before you fully enter it. atmosphere over outline here.",
        "DSC": "where longing finds an object. the connections here are felt more than seen.",
    },
    "Pluto": {
        "MC": "where what is underneath comes to the surface. the place does not let you stay on the surface long.",
        "IC": "where the deep work happens out of view. the foundations here get rebuilt from below.",
        "ASC": "where you arrive at the edges first, and watch. intensity precedes you.",
        "DSC": "where the bonds run all the way down. nothing stays casual here for long.",
    },
}


@app.get("/healthz")
def healthz() -> Dict[str, str]:
    return {"ok": "true", "service": "astro", "engine": "swiss-ephemeris"}


def _validate_ayanamsa(zodiac: str, ayanamsa: Optional[str]) -> None:
    if ayanamsa is not None and ayanamsa not in hd.AYANAMSA_MODES:
        raise HTTPException(status_code=422, detail={
            "error": f"unknown ayanamsa {ayanamsa!r}",
            "code": "INVALID_AYANAMSA",
            "supported": sorted(hd.AYANAMSA_MODES),
        })


@app.post("/natal", dependencies=[Depends(require_auth)])
def natal(req: NatalRequest) -> Dict[str, Any]:
    _validate_ayanamsa(req.zodiac, req.ayanamsa)
    return compute_chart(req.date, req.time, req.lat, req.lng, req.tz,
                         zodiac=req.zodiac, ayanamsa=req.ayanamsa)


@app.post("/transits", dependencies=[Depends(require_auth)])
def transits(req: TransitRequest) -> Dict[str, Any]:
    _validate_ayanamsa(req.zodiac, req.ayanamsa)
    now = datetime.now(ZoneInfo(req.tz) if _valid_tz(req.tz) else timezone.utc)
    chart = compute_chart(req.date, now.strftime("%H:%M"), req.lat, req.lng, req.tz,
                          zodiac=req.zodiac, ayanamsa=req.ayanamsa)
    out = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "date": req.date,
        "lat": req.lat,
        "lng": req.lng,
        "tz": req.tz,
        "positions": chart["planets"],
        "aspects": [],
    }
    if req.zodiac == "sidereal":
        out["zodiac"] = "sidereal"
        out["ayanamsa"] = chart["ayanamsa"]
    return out


def _valid_tz(tz: str) -> bool:
    try:
        ZoneInfo(tz)
        return True
    except Exception:
        return False


@app.post("/synastry", dependencies=[Depends(require_auth)])
def synastry(req: SynastryRequest) -> Dict[str, Any]:
    # Aspects are angular SEPARATIONS between the two charts' longitudes.
    # Note the ayanamsa is evaluated at each person's own birth instant, so
    # sidereal separations differ from tropical ones by the (tiny, arcsecond-
    # scale per year of age gap) ayanamsa drift between the two birthdays.
    # Scores are therefore effectively identical across lenses; the lens
    # changes the sign/nakshatra language you read, not the bond math.
    _validate_ayanamsa(req.zodiac, req.ayanamsa)
    chart_a = compute_chart(req.person_a.date, req.person_a.time, req.person_a.lat, req.person_a.lng, req.person_a.tz,
                            zodiac=req.zodiac, ayanamsa=req.ayanamsa)
    chart_b = compute_chart(req.person_b.date, req.person_b.time, req.person_b.lat, req.person_b.lng, req.person_b.tz,
                            zodiac=req.zodiac, ayanamsa=req.ayanamsa)
    aspects = compute_aspects(chart_a["planets"], chart_b["planets"])

    # Weighted, generational-noise-corrected scoring.
    harm_w = sum(a["effective"] for a in aspects if a["harmonious"])
    hard_w = sum(a["effective"] for a in aspects if not a["harmonious"])
    total_w = harm_w + hard_w

    # Raw counts kept for reference but flagged as not the scoring basis.
    harmonious_count = sum(1 for a in aspects if a["harmonious"])
    hard_count = len(aspects) - harmonious_count
    personal_aspects = [a for a in aspects if not a["generational"] and a["weight"] >= 0.6]

    # Score: balance of weighted harmony vs friction, normalized. NOT capped-at-100 noise.
    harmony_ratio = (harm_w / total_w) if total_w else 0.5
    score = round(harmony_ratio * 100)

    out = {
        "aspects": aspects,
        "harmonious_count": harmonious_count,
        "hard_count": hard_count,
        "weighted_harmony": round(harm_w, 2),
        "weighted_friction": round(hard_w, 2),
        "harmony_ratio": round(harmony_ratio, 3),
        "score": score,
        "personal_aspect_count": len(personal_aspects),
        "person_a_chart": chart_a,
        "person_b_chart": chart_b,
    }
    if req.zodiac == "sidereal":
        out["zodiac"] = "sidereal"
    return out


@app.post("/astrocartography", dependencies=[Depends(require_auth)])
def astrocartography(req: AstrocartographyRequest) -> Dict[str, Any]:
    return compute_astrocartography(req.date, req.time, req.lat, req.lng, req.tz)


# ---------------------------------------------------------------------------
# Human Design + Gene Keys
#
# Mechanics live in hd.py (gate wheel, 88-degree solver, channels, centers,
# type/authority rules, gene keys triads). Sources + verification in
# docs/HUMAN-DESIGN.md. These endpoints take the same birth payload as /natal.
# ---------------------------------------------------------------------------


def _design_iso(jd_birth: float) -> str:
    """ISO-8601 UTC string for the 88-degree design moment."""
    design_jd = hd.design_time_jd(jd_birth)
    y, mo, d, ut_hour = swe.revjul(design_jd)
    hh = int(ut_hour)
    mm = int((ut_hour - hh) * 60)
    ss = int(round((((ut_hour - hh) * 60) - mm) * 60))
    if ss == 60:
        ss = 0
        mm += 1
    if mm == 60:
        mm = 0
        hh += 1
    return f"{int(y):04d}-{int(mo):02d}-{int(d):02d}T{hh:02d}:{mm:02d}:{ss:02d}Z"


@app.post("/humandesign", dependencies=[Depends(require_auth)])
def humandesign(req: NatalRequest) -> Dict[str, Any]:
    _validate_ayanamsa(req.zodiac, req.ayanamsa)
    jd_birth = to_julian_day_ut(req.date, req.time, req.tz)
    design_iso = _design_iso(jd_birth)
    return hd.compute_human_design(jd_birth, design_iso, zodiac=req.zodiac,
                                   ayanamsa=req.ayanamsa or hd.DEFAULT_AYANAMSA)


@app.post("/genekeys", dependencies=[Depends(require_auth)])
def genekeys(req: NatalRequest) -> Dict[str, Any]:
    _validate_ayanamsa(req.zodiac, req.ayanamsa)
    jd_birth = to_julian_day_ut(req.date, req.time, req.tz)
    design_iso = _design_iso(jd_birth)
    hd_payload = hd.compute_human_design(jd_birth, design_iso, zodiac=req.zodiac,
                                         ayanamsa=req.ayanamsa or hd.DEFAULT_AYANAMSA)
    return hd.compute_gene_keys(hd_payload)


@app.post("/astro/design-time", dependencies=[Depends(require_auth)])
def design_time(req: NatalRequest) -> Dict[str, Any]:
    """The UTC instant the Sun was exactly 88 deg of ecliptic longitude before
    its natal position. Solved iteratively (never approximated as 88 days).

    FRAME-INDEPENDENT: the 88 deg arc is a difference of longitudes, so the
    ayanamsa cancels. zodiac/ayanamsa are accepted (API uniformity) but the
    instant and the reported (tropical) longitudes are identical either way;
    invariance is asserted in test_sidereal.py."""
    _validate_ayanamsa(req.zodiac, req.ayanamsa)
    jd_birth = to_julian_day_ut(req.date, req.time, req.tz)
    design_jd = hd.design_time_jd(jd_birth)
    natal_sun = hd._sun_lon(jd_birth)
    design_sun = hd._sun_lon(design_jd)
    arc = (natal_sun - design_sun) % 360.0
    return {
        "design_datetime_utc": _design_iso(jd_birth),
        "solar_arc_deg": round(arc, 6),
        "days_before_birth": round(jd_birth - design_jd, 4),
        "natal_sun_lon": round(natal_sun, 6),
        "design_sun_lon": round(design_sun, 6),
    }
