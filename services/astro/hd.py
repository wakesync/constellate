"""Human Design + Gene Keys mechanics.

This module is deliberately data-heavy and side-effect free. It exposes:
  - design_time_jd(): the 88-degree solar-arc design moment (iterative solver).
  - gate_line_of(lon): map an ecliptic longitude to (gate, line, color, tone, base).
  - compute_human_design(): full BodyGraph derivation (type/authority/etc).
  - compute_gene_keys(): the Activation Sequence spheres + shadow/gift/siddhi.

MECHANICS + SOURCES are documented in docs/HUMAN-DESIGN.md. The hard parts
(gate wheel order + offset, 88-degree solver, channel/center table, type +
authority rules) are all cited there. Do not "simplify" any of the tables:
a wrong gate or a wrong channel produces a wrong, instantly-spotted chart.
"""

from __future__ import annotations

import math
import threading
from typing import Any, Dict, List, Optional, Tuple

import swisseph as swe

# ---------------------------------------------------------------------------
# Ephemeris flags. Match main.py: Moshier analytical ephemeris, no data files,
# arcsecond accuracy over the supported date range.
# ---------------------------------------------------------------------------
EPH_FLAG = swe.FLG_MOSEPH | swe.FLG_SPEED

# ---------------------------------------------------------------------------
# AYANAMSA (sidereal zodiac offset).
#
# Sidereal longitude = tropical longitude - ayanamsa. We NEVER pass
# FLG_SIDEREAL to swe.calc_ut: swe.set_sid_mode() is PROCESS-GLOBAL state, and
# a sidereal request racing a tropical request could silently contaminate the
# tropical output. Instead every computation in this service is tropical, and
# sidereal frames subtract an explicitly-computed ayanamsa offset. The only
# global-state touch is inside ayanamsa_deg(), which sets the mode immediately
# before reading the value under a lock, so it is deterministic regardless of
# call ordering or threading (FastAPI runs sync endpoints in a threadpool).
#
# Default mode is LAHIRI (Chitrapaksha), the Indian government standard and
# the default in virtually all Vedic software. Pluggable per request.
# ---------------------------------------------------------------------------
AYANAMSA_MODES: Dict[str, int] = {
    "LAHIRI": swe.SIDM_LAHIRI,
    "FAGAN_BRADLEY": swe.SIDM_FAGAN_BRADLEY,
    "RAMAN": swe.SIDM_RAMAN,
    "KRISHNAMURTI": swe.SIDM_KRISHNAMURTI,
}
DEFAULT_AYANAMSA = "LAHIRI"

_SID_LOCK = threading.Lock()


def ayanamsa_deg(jd: float, mode: str = DEFAULT_AYANAMSA) -> float:
    """Ayanamsa value (degrees) at Julian Day jd for the named mode.

    Sets the Swiss Ephemeris sidereal mode immediately before reading, under a
    lock, so concurrent callers can never observe a stale mode. Raises
    ValueError for unknown modes.
    """
    sid_mode = AYANAMSA_MODES.get(mode)
    if sid_mode is None:
        raise ValueError(
            f"unknown ayanamsa mode {mode!r}; supported: {sorted(AYANAMSA_MODES)}")
    with _SID_LOCK:
        swe.set_sid_mode(sid_mode, 0, 0)
        return swe.get_ayanamsa_ut(jd)


# ---------------------------------------------------------------------------
# THE GATE WHEEL.
#
# The 64 I Ching gates are laid around the 360-degree ecliptic in the "Rave
# mandala" order, NOT numeric 1..64 order. The wheel begins with Gate 41 at
# exactly 02 deg 00' 00" Aquarius (= 302.0 deg absolute ecliptic longitude,
# since Aquarius starts at 300 deg). Each gate spans 360/64 = 5.625 deg and is
# subdivided into 6 lines of 0.9375 deg each. Each line further divides into
# 6 colors, each color into 6 tones, each tone into 6 bases (the "design
# crystal" sub-structure).
#
# Order + starting offset verified against two independent sources:
#   - a published by-degree gate table  (full by-degree table,
#     Gate 41 = 2 deg Aquarius, walked sign-by-sign to reconstruct the ring)
#   - the widely published "Rave mandala" gate sequence (Jovian Archive lineage)
# See docs/HUMAN-DESIGN.md for the full boundary cross-check.
#
# Ordered from 302.0 deg (2 Aquarius) going forward (increasing longitude).
# ---------------------------------------------------------------------------
GATE_WHEEL: List[int] = [
    41, 19, 13, 49, 30, 55, 37, 63, 22, 36,   # 2 Aqu -> late Pisces
    25, 17, 21, 51, 42, 3,                     # Aries
    27, 24, 2, 23, 8,                          # Taurus -> early Gemini
    20, 16, 35, 45, 12, 15,                    # Gemini -> early Cancer
    52, 39, 53, 62, 56,                        # Cancer -> early Leo
    31, 33, 7, 4, 29,                          # Leo -> early Virgo
    59, 40, 64, 47, 6, 46,                     # Virgo -> early Libra
    18, 48, 57, 32, 50,                        # Libra -> early Scorpio
    28, 44, 1, 43, 14,                         # Scorpio -> early Sagittarius
    34, 9, 5, 26, 11, 10,                      # Sagittarius -> early Capricorn
    58, 38, 54, 61, 60,                        # Capricorn -> 2 Aquarius (wraps)
]
assert len(GATE_WHEEL) == 64, f"gate wheel must have 64 entries, got {len(GATE_WHEEL)}"
assert len(set(GATE_WHEEL)) == 64, "gate wheel must contain each gate exactly once"

WHEEL_START_LON = 302.0  # 2 deg 00' Aquarius, absolute ecliptic longitude
GATE_SIZE = 360.0 / 64.0        # 5.625 deg
LINE_SIZE = GATE_SIZE / 6.0     # 0.9375 deg
COLOR_SIZE = LINE_SIZE / 6.0
TONE_SIZE = COLOR_SIZE / 6.0
BASE_SIZE = TONE_SIZE / 6.0


def gate_line_of(lon: float) -> Dict[str, int]:
    """Map an absolute ecliptic longitude (deg) to gate/line/color/tone/base.

    We measure the angular distance forward from the wheel start (2 Aquarius),
    divide into gate/line/color/tone/base cells, and index the wheel array.
    """
    offset = (lon - WHEEL_START_LON) % 360.0
    gate_index = int(offset // GATE_SIZE)          # 0..63
    within_gate = offset - gate_index * GATE_SIZE
    line = int(within_gate // LINE_SIZE) + 1       # 1..6
    within_line = within_gate - (line - 1) * LINE_SIZE
    color = int(within_line // COLOR_SIZE) + 1     # 1..6
    within_color = within_line - (color - 1) * COLOR_SIZE
    tone = int(within_color // TONE_SIZE) + 1      # 1..6
    within_tone = within_color - (tone - 1) * TONE_SIZE
    base = int(within_tone // BASE_SIZE) + 1       # 1..6
    return {
        "gate": GATE_WHEEL[gate_index],
        "line": line,
        "color": color,
        "tone": tone,
        "base": base,
    }


# ---------------------------------------------------------------------------
# THE 88-DEGREE DESIGN SOLVER.
#
# The Design chart is cast for the instant the Sun's ecliptic longitude was
# exactly 88.000 degrees LESS than its natal longitude (mod 360). This is
# roughly 88-89 calendar days before birth but the Sun's apparent speed is not
# uniform (Earth's orbit is elliptical), so we must SOLVE for it, never assume
# "88 days". We bisect on the unwrapped solar longitude.
# ---------------------------------------------------------------------------
def _sun_lon(jd: float) -> float:
    res = swe.calc_ut(jd, swe.SUN, EPH_FLAG)
    return res[0][0] % 360.0


def _unwrapped_arc_back(jd_birth: float, jd: float, natal_lon: float) -> float:
    """How many degrees of solar longitude have we gone BACK from natal, as a
    continuous (unwrapped) value in roughly [0, ~90] for jd a few months before
    birth. Handles the 360->0 wrap by adding 360 when the raw diff goes negative.
    """
    lon = _sun_lon(jd)
    diff = (natal_lon - lon) % 360.0
    return diff


def design_time_jd(jd_birth: float) -> float:
    """Return the Julian Day (UT) of the 88-degree-earlier design moment.

    Bisection on solar arc. The Sun moves ~0.985 deg/day, so 88 deg is ~89.3
    days. We bracket generously (86..92 days before birth), then bisect until
    the solar arc equals 88.0 deg to well under an arcsecond.
    """
    natal_lon = _sun_lon(jd_birth)
    target = 88.0

    lo = jd_birth - 92.0   # slightly more than 88 deg back
    hi = jd_birth - 86.0   # slightly less than 88 deg back

    # f(jd) = arc_back(jd) - target. arc_back DECREASES as jd increases
    # (closer to birth -> smaller arc). So f(lo) > 0, f(hi) < 0.
    def f(jd: float) -> float:
        return _unwrapped_arc_back(jd_birth, jd, natal_lon) - target

    f_lo = f(lo)
    f_hi = f(hi)
    # Guard: if the bracket does not straddle a root (extreme edge cases),
    # widen once. This should essentially never fire for real births.
    if f_lo * f_hi > 0:
        lo = jd_birth - 95.0
        hi = jd_birth - 83.0
        f_lo = f(lo)
        f_hi = f(hi)

    for _ in range(100):
        mid = 0.5 * (lo + hi)
        f_mid = f(mid)
        if abs(f_mid) < 1e-9:  # ~3.6e-6 arcsec, far tighter than needed
            return mid
        if (f_lo > 0) == (f_mid > 0):
            lo, f_lo = mid, f_mid
        else:
            hi, f_hi = mid, f_mid
    return 0.5 * (lo + hi)


# ---------------------------------------------------------------------------
# PLANETS. HD uses 13 bodies per chart, in a fixed order. Earth = Sun+180.
# South Node = North Node + 180. We use the TRUE node (swe.TRUE_NODE) which is
# what Jovian Archive / standard HD software uses.
# ---------------------------------------------------------------------------
HD_PLANET_ORDER = [
    "Sun", "Earth", "North Node", "South Node", "Moon", "Mercury",
    "Venus", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto",
]

_SWE_ID = {
    "Sun": swe.SUN, "Moon": swe.MOON, "Mercury": swe.MERCURY, "Venus": swe.VENUS,
    "Mars": swe.MARS, "Jupiter": swe.JUPITER, "Saturn": swe.SATURN,
    "Uranus": swe.URANUS, "Neptune": swe.NEPTUNE, "Pluto": swe.PLUTO,
    "North Node": swe.TRUE_NODE,
}


def _activations(jd: float, ayanamsa_offset: float = 0.0) -> List[Dict[str, Any]]:
    """Compute the 13 activations for a chart at Julian Day jd.

    ayanamsa_offset: degrees subtracted from every tropical longitude before
    gate mapping. 0.0 = tropical (canon). Non-zero = the sidereal lens: the
    same gate wheel applied to sidereal longitudes (community "sidereal HD"
    practice; the Human Design founder's system is tropical-canon).
    """
    lon_of: Dict[str, float] = {}
    for name in ["Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter",
                 "Saturn", "Uranus", "Neptune", "Pluto", "North Node"]:
        res = swe.calc_ut(jd, _SWE_ID[name], EPH_FLAG)
        lon_of[name] = (res[0][0] - ayanamsa_offset) % 360.0
    lon_of["Earth"] = (lon_of["Sun"] + 180.0) % 360.0
    lon_of["South Node"] = (lon_of["North Node"] + 180.0) % 360.0

    out: List[Dict[str, Any]] = []
    for name in HD_PLANET_ORDER:
        lon = lon_of[name]
        gl = gate_line_of(lon)
        out.append({
            "planet": name,
            "lon": round(lon, 6),
            "gate": gl["gate"],
            "line": gl["line"],
            "color": gl["color"],
            "tone": gl["tone"],
            "base": gl["base"],
        })
    return out


# ---------------------------------------------------------------------------
# CENTERS + CHANNELS.
#
# 9 centers, fixed output order. 36 channels, each a pair of gates connecting
# exactly two centers. A center is DEFINED iff at least one channel touching it
# is fully activated (BOTH its gates activated by any planet in either chart).
#
# Channel table is the canonical Human Design 36-channel set. Verified against
# standard BodyGraph references (Jovian Archive lineage). Gate->center mapping
# is implied by the channel endpoints.
# ---------------------------------------------------------------------------
CENTER_ORDER = [
    "Head", "Ajna", "Throat", "G", "Heart",
    "Sacral", "Solar Plexus", "Spleen", "Root",
]

# (gate_a, gate_b, channel_name, center_a, center_b)
CHANNELS: List[Tuple[int, int, str, str, str]] = [
    (64, 47, "Abstraction", "Head", "Ajna"),
    (61, 24, "Awareness", "Head", "Ajna"),
    (63, 4, "Logic", "Head", "Ajna"),
    (17, 62, "Acceptance", "Ajna", "Throat"),
    (43, 23, "Structuring", "Ajna", "Throat"),
    (11, 56, "Curiosity", "Ajna", "Throat"),
    (16, 48, "The Wavelength", "Throat", "Spleen"),
    (20, 57, "The Brainwave", "Throat", "Spleen"),
    (20, 10, "Awakening", "Throat", "G"),
    (31, 7, "The Alpha", "Throat", "G"),
    (8, 1, "Inspiration", "Throat", "G"),
    (33, 13, "The Prodigal", "Throat", "G"),
    (20, 34, "Charisma", "Throat", "Sacral"),
    (12, 22, "Openness", "Throat", "Solar Plexus"),
    (35, 36, "Transitoriness", "Throat", "Solar Plexus"),
    (45, 21, "Money", "Throat", "Heart"),
    (10, 34, "Exploration", "G", "Sacral"),
    (15, 5, "Rhythm", "G", "Sacral"),
    (2, 14, "The Beat", "G", "Sacral"),
    (46, 29, "Discovery", "G", "Sacral"),
    (10, 57, "Perfected Form", "G", "Spleen"),
    (25, 51, "Initiation", "G", "Heart"),
    (34, 57, "Power", "Sacral", "Spleen"),
    (27, 50, "Preservation", "Sacral", "Spleen"),
    (59, 6, "Mating", "Sacral", "Solar Plexus"),
    (42, 53, "Maturation", "Sacral", "Root"),
    (3, 60, "Mutation", "Sacral", "Root"),
    (9, 52, "Concentration", "Sacral", "Root"),
    (26, 44, "Surrender", "Heart", "Spleen"),
    (21, 45, "Money (Ego-Throat)", "Heart", "Throat"),  # dup guard: see note
    (37, 40, "Community", "Solar Plexus", "Heart"),
    (49, 19, "Synthesis", "Solar Plexus", "Root"),
    (55, 39, "Emoting", "Solar Plexus", "Root"),
    (30, 41, "Recognition", "Solar Plexus", "Root"),
    (48, 16, "Talent", "Spleen", "Throat"),  # dup guard: see note
    (57, 34, "Power (Spleen-Sacral)", "Spleen", "Sacral"),  # dup guard
    (57, 20, "The Brainwave (Spleen-Throat)", "Spleen", "Throat"),  # dup guard
    (50, 27, "Preservation (Spleen-Sacral)", "Spleen", "Sacral"),  # dup guard
    (32, 54, "Transformation", "Spleen", "Root"),
    (28, 38, "Struggle", "Spleen", "Root"),
    (18, 58, "Judgment", "Spleen", "Root"),
]

# The list above intentionally contains a few reverse-duplicates from writing
# both endpoints; we canonicalize by frozenset of the gate pair so each physical
# channel is counted once. Build the canonical 36-channel map:
_CANON: Dict[frozenset, Tuple[int, int, str, str, str]] = {}
for a, b, name, ca, cb in CHANNELS:
    key = frozenset((a, b))
    if key not in _CANON:
        _CANON[key] = (a, b, name, ca, cb)
CANON_CHANNELS: List[Tuple[int, int, str, str, str]] = list(_CANON.values())
assert len(CANON_CHANNELS) == 36, f"expected 36 canonical channels, got {len(CANON_CHANNELS)}"

MOTORS = {"Heart", "Solar Plexus", "Root", "Sacral"}


def _channel_key(a: int, b: int) -> str:
    return f"{min(a, b)}-{max(a, b)}"


def compute_bodygraph(active_gates: set) -> Dict[str, Any]:
    """From the full set of activated gates (personality + design), derive the
    defined channels, defined centers, and the connectivity graph."""
    defined_channels: List[Dict[str, Any]] = []
    # adjacency among centers via defined channels (for type connectivity)
    adjacency: Dict[str, set] = {c: set() for c in CENTER_ORDER}
    defined_centers: set = set()

    for a, b, name, ca, cb in CANON_CHANNELS:
        if a in active_gates and b in active_gates:
            defined_channels.append({
                "key": _channel_key(a, b),
                "name": name,
                "gates": [a, b],
                "centers": [ca, cb],
            })
            defined_centers.add(ca)
            defined_centers.add(cb)
            adjacency[ca].add(cb)
            adjacency[cb].add(ca)

    centers = [{"name": c, "defined": c in defined_centers} for c in CENTER_ORDER]
    open_centers = [c for c in CENTER_ORDER if c not in defined_centers]
    return {
        "defined_channels": defined_channels,
        "defined_centers": defined_centers,
        "adjacency": adjacency,
        "centers": centers,
        "open_centers": open_centers,
    }


def _connected(adjacency: Dict[str, set], start: str, target: str, allowed: set) -> bool:
    """BFS over the DEFINED-channel graph: is `target` reachable from `start`
    using only centers in `allowed`?"""
    if start not in allowed or target not in allowed:
        return False
    seen = {start}
    stack = [start]
    while stack:
        node = stack.pop()
        if node == target:
            return True
        for nb in adjacency.get(node, ()):  # neighbors via defined channels
            if nb in allowed and nb not in seen:
                seen.add(nb)
                stack.append(nb)
    return target in seen


def _components(adjacency: Dict[str, set], nodes: set) -> int:
    """Count connected components among the defined centers."""
    seen: set = set()
    comps = 0
    for n in nodes:
        if n in seen:
            continue
        comps += 1
        stack = [n]
        seen.add(n)
        while stack:
            node = stack.pop()
            for nb in adjacency.get(node, ()):
                if nb in nodes and nb not in seen:
                    seen.add(nb)
                    stack.append(nb)
    return comps


def _motor_to_throat(adjacency: Dict[str, set], defined: set) -> bool:
    """Is any motor center connected to the Throat via defined channels?"""
    if "Throat" not in defined:
        return False
    for motor in MOTORS:
        if motor in defined and _connected(adjacency, motor, "Throat", defined):
            return True
    return False


def derive_type(defined: set, adjacency: Dict[str, set]) -> str:
    if not defined:
        return "Reflector"
    sacral = "Sacral" in defined
    motor_throat = _motor_to_throat(adjacency, defined)
    if sacral:
        return "Manifesting Generator" if motor_throat else "Generator"
    # sacral undefined
    if motor_throat:
        return "Manifestor"
    return "Projector"


def derive_authority(defined: set, hd_type: str) -> str:
    if hd_type == "Reflector":
        return "Lunar"
    if "Solar Plexus" in defined:
        return "Emotional"
    if "Sacral" in defined:
        return "Sacral"
    if "Spleen" in defined:
        return "Splenic"
    if "Heart" in defined:
        return "Ego"
    if "G" in defined:
        return "Self-Projected"
    return "Mental"  # Head/Ajna/Throat only (a.k.a. Environmental for Projectors)


STRATEGY = {
    "Generator": "wait to respond",
    "Manifesting Generator": "wait to respond, then inform",
    "Manifestor": "inform before you act",
    "Projector": "wait for the invitation",
    "Reflector": "wait a lunar cycle before deciding",
}
SIGNATURE = {
    "Generator": "satisfaction",
    "Manifesting Generator": "satisfaction",
    "Manifestor": "peace",
    "Projector": "success",
    "Reflector": "surprise",
}
NOT_SELF = {
    "Generator": "frustration",
    "Manifesting Generator": "frustration and anger",
    "Manifestor": "anger",
    "Projector": "bitterness",
    "Reflector": "disappointment",
}

DEFINITION_NAME = {
    0: "None",
    1: "Single",
    2: "Split",
    3: "Triple Split",
    4: "Quadruple Split",
}

# Traditional profile names (personality line / design line).
PROFILE_NAMES = {
    (1, 3): "Investigator / Martyr",
    (1, 4): "Investigator / Opportunist",
    (2, 4): "Hermit / Opportunist",
    (2, 5): "Hermit / Heretic",
    (3, 5): "Martyr / Heretic",
    (3, 6): "Martyr / Role Model",
    (4, 6): "Opportunist / Role Model",
    (4, 1): "Opportunist / Investigator",
    (5, 1): "Heretic / Investigator",
    (5, 2): "Heretic / Hermit",
    (6, 2): "Role Model / Hermit",
    (6, 3): "Role Model / Martyr",
}


def _cross_angle(p_line: int) -> str:
    """Incarnation cross angle from the personality profile line.
    Right Angle = personal destiny (lines 1..3 personality, roughly), Left
    Angle = transpersonal, Juxtaposition = fixed fate (3/5 only-ish). We use the
    standard profile->angle mapping.
    """
    # Standard mapping by profile pair is more exact, but by convention:
    # Right Angle: 1/3,1/4,2/4,2/5,3/5,3/6,4/6  ... Left Angle: 5/1,5/2,6/2,6/3
    # Juxtaposition: 4/1 only. We compute from the full pair in caller.
    return "Right Angle"


def cross_label(p_line: int, d_line: int) -> str:
    pair = (p_line, d_line)
    left = {(5, 1), (5, 2), (6, 2), (6, 3)}
    juxta = {(4, 1)}
    if pair in juxta:
        return "Juxtaposition Cross"
    if pair in left:
        return "Left Angle Cross"
    return "Right Angle Cross"


def compute_human_design(jd_birth: float, design_iso: str,
                         zodiac: str = "tropical",
                         ayanamsa: str = DEFAULT_AYANAMSA) -> Dict[str, Any]:
    """Full BodyGraph derivation.

    zodiac="tropical" (default, canon per the Human Design founder) leaves the output shape
    exactly as before the sidereal feature. zodiac="sidereal" applies the same
    gate wheel to sidereal longitudes (tropical minus ayanamsa, each chart
    using the ayanamsa at its own instant) and marks the payload as the
    ALTERNATE lens. The design-time INSTANT is frame-independent: the 88 deg
    solar arc is a longitude DIFFERENCE, so the ayanamsa cancels and the same
    design moment is used in both frames (asserted in test_sidereal.py).
    """
    design_jd = design_time_jd(jd_birth)
    if zodiac == "sidereal":
        ay_birth = ayanamsa_deg(jd_birth, ayanamsa)
        ay_design = ayanamsa_deg(design_jd, ayanamsa)
    else:
        ay_birth = 0.0
        ay_design = 0.0
    personality = _activations(jd_birth, ay_birth)
    design = _activations(design_jd, ay_design)

    active_gates = {a["gate"] for a in personality} | {a["gate"] for a in design}
    bg = compute_bodygraph(active_gates)
    defined = bg["defined_centers"]
    adjacency = bg["adjacency"]

    hd_type = derive_type(defined, adjacency)
    authority = derive_authority(defined, hd_type)
    definition = "None" if not defined else DEFINITION_NAME.get(
        _components(adjacency, defined), "Quadruple Split")

    p_sun = personality[0]  # Sun is index 0
    p_earth = personality[1]
    d_sun = design[0]
    d_earth = design[1]

    p_line = p_sun["line"]
    d_line = d_sun["line"]
    profile = {
        "personality_line": p_line,
        "design_line": d_line,
        "label": f"{p_line}/{d_line}",
        "name": PROFILE_NAMES.get((p_line, d_line), f"{p_line}/{d_line}"),
    }

    cross = {
        "label": f"{cross_label(p_line, d_line)} ({p_sun['gate']}/{d_sun['gate']} | {p_earth['gate']}/{d_earth['gate']})",
        "gates": [p_sun["gate"], p_earth["gate"], d_sun["gate"], d_earth["gate"]],
    }

    out = {
        "type": hd_type,
        "strategy": STRATEGY[hd_type],
        "authority": authority,
        "profile": profile,
        "definition": definition,
        "signature": SIGNATURE[hd_type],
        "not_self": NOT_SELF[hd_type],
        "incarnation_cross": cross,
        "design_datetime_utc": design_iso,
        "centers": bg["centers"],
        "channels": bg["defined_channels"],
        "gates": {
            "personality": personality,
            "design": design,
        },
        "open_centers": bg["open_centers"],
        "defined_count": len(defined),
    }
    if zodiac == "sidereal":
        # Alternate-lens framing: HD canon is tropical (the Human Design founder explicitly
        # rejected sidereal); this is the community-explored sidereal lens.
        out["zodiac"] = "sidereal"
        out["lens"] = "alternate"
        out["canon"] = "tropical"
        out["ayanamsa"] = {
            "mode": ayanamsa,
            "value_deg": round(ay_birth, 6),
            "design_value_deg": round(ay_design, 6),
        }
    return out


# ---------------------------------------------------------------------------
# GENE KEYS.
#
# Shadow / Gift / Siddhi triad for each of the 64 keys (= gates). Verified
# against the published Gene Keys transmission (the Gene Keys author). Source cited in
# docs/HUMAN-DESIGN.md. codon_ring is intentionally omitted where we could not
# verify the full 21-ring mapping (see doc); we expose null rather than guess.
# ---------------------------------------------------------------------------
GENE_KEYS: Dict[int, Tuple[str, str, str]] = {
    1: ("Entropy", "Freshness", "Beauty"),
    2: ("Dislocation", "Orientation", "Unity"),
    3: ("Chaos", "Innovation", "Innocence"),
    4: ("Intolerance", "Understanding", "Forgiveness"),
    5: ("Impatience", "Patience", "Timelessness"),
    6: ("Conflict", "Diplomacy", "Peace"),
    7: ("Division", "Guidance", "Virtue"),
    8: ("Mediocrity", "Style", "Exquisiteness"),
    9: ("Inertia", "Determination", "Invincibility"),
    10: ("Self-Obsession", "Naturalness", "Being"),
    11: ("Obscurity", "Idealism", "Light"),
    12: ("Vanity", "Discrimination", "Purity"),
    13: ("Discord", "Discernment", "Empathy"),
    14: ("Compromise", "Competence", "Bounty"),
    15: ("Dullness", "Flux", "Bloom"),
    16: ("Indifference", "Versatility", "Mastery"),
    17: ("Opinion", "Foresight", "Omniscience"),
    18: ("Judgement", "Integrity", "Perfection"),
    19: ("Co-dependence", "Sensitivity", "Sacrifice"),
    20: ("Superficiality", "Self-Assurance", "Presence"),
    21: ("Control", "Authority", "Valour"),
    22: ("Dishonour", "Graciousness", "Grace"),
    23: ("Complexity", "Simplicity", "Quintessence"),
    24: ("Addiction", "Invention", "Silence"),
    25: ("Constriction", "Acceptance", "Universal Love"),
    26: ("Pride", "Artfulness", "Invisibility"),
    27: ("Selfishness", "Altruism", "Selflessness"),
    28: ("Purposelessness", "Totality", "Immortality"),
    29: ("Half-heartedness", "Commitment", "Devotion"),
    30: ("Desire", "Lightness", "Rapture"),
    31: ("Arrogance", "Leadership", "Humility"),
    32: ("Failure", "Preservation", "Veneration"),
    33: ("Forgetting", "Mindfulness", "Revelation"),
    34: ("Force", "Strength", "Majesty"),
    35: ("Hunger", "Adventure", "Boundlessness"),
    36: ("Turbulence", "Humanity", "Compassion"),
    37: ("Weakness", "Equality", "Tenderness"),
    38: ("Struggle", "Perseverance", "Honour"),
    39: ("Provocation", "Dynamism", "Liberation"),
    40: ("Exhaustion", "Resolve", "Divine Will"),
    41: ("Fantasy", "Anticipation", "Emanation"),
    42: ("Expectation", "Detachment", "Celebration"),
    43: ("Deafness", "Insight", "Epiphany"),
    44: ("Interference", "Teamwork", "Synarchy"),
    45: ("Dominance", "Synergy", "Communion"),
    46: ("Seriousness", "Delight", "Ecstasy"),
    47: ("Oppression", "Transmutation", "Transfiguration"),
    48: ("Inadequacy", "Resourcefulness", "Wisdom"),
    49: ("Reaction", "Revolution", "Rebirth"),
    50: ("Corruption", "Equilibrium", "Harmony"),
    51: ("Agitation", "Initiative", "Awakening"),
    52: ("Stress", "Restraint", "Stillness"),
    53: ("Immaturity", "Expansion", "Superabundance"),
    54: ("Greed", "Aspiration", "Ascension"),
    55: ("Victimisation", "Freedom", "Freedom"),
    56: ("Distraction", "Enrichment", "Intoxication"),
    57: ("Unease", "Intuition", "Clarity"),
    58: ("Dissatisfaction", "Vitality", "Bliss"),
    59: ("Dishonesty", "Intimacy", "Transparency"),
    60: ("Limitation", "Realism", "Justice"),
    61: ("Psychosis", "Inspiration", "Sanctity"),
    62: ("Intellect", "Precision", "Impeccability"),
    63: ("Doubt", "Inquiry", "Truth"),
    64: ("Confusion", "Imagination", "Illumination"),
}


def _sphere(activation: Dict[str, Any], sphere: str, source: str) -> Dict[str, Any]:
    return {
        "gate": activation["gate"],
        "line": activation["line"],
        "sphere": sphere,
        "source": source,
    }


def compute_gene_keys(hd_payload: Dict[str, Any]) -> Dict[str, Any]:
    """Derive the Gene Keys Activation Sequence from an already-computed HD payload."""
    personality = hd_payload["gates"]["personality"]
    design = hd_payload["gates"]["design"]
    p_sun, p_earth = personality[0], personality[1]
    d_sun, d_earth = design[0], design[1]

    activation = {
        "lifes_work": _sphere(p_sun, "Life's Work", "personality Sun"),
        "evolution": _sphere(p_earth, "Evolution", "personality Earth"),
        "radiance": _sphere(d_sun, "Radiance", "design Sun"),
        "purpose": _sphere(d_earth, "Purpose", "design Earth"),
    }

    used_gates: List[int] = []
    for sph in activation.values():
        g = sph["gate"]
        if g not in used_gates:
            used_gates.append(g)

    keys = []
    for g in used_gates:
        triad = GENE_KEYS.get(g)
        if not triad:
            continue
        shadow, gift, siddhi = triad
        keys.append({
            "gate": g,
            "shadow": shadow,
            "gift": gift,
            "siddhi": siddhi,
            "codon_ring": None,  # not verified; see docs/HUMAN-DESIGN.md
        })

    out = {
        "activation": activation,
        # Venus + Pearl sequences require sphere->planet/derivation mappings we
        # could NOT verify against a primary source. Omitted deliberately rather
        # than invented. See docs/HUMAN-DESIGN.md "what I could NOT verify".
        "venus": None,
        "pearl": None,
        "keys": keys,
    }
    if hd_payload.get("zodiac") == "sidereal":
        # Propagate the alternate-lens framing: Gene Keys canon is tropical
        # (the author correlates the hexagram wheel to the tropical zodiac).
        out["zodiac"] = "sidereal"
        out["lens"] = "alternate"
        out["canon"] = "tropical"
        out["ayanamsa"] = hd_payload.get("ayanamsa")
    return out
