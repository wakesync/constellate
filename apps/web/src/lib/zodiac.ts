// The zodiac lens: tropical (the seasonal sky) vs sidereal (the fixed-star
// sky). Pure logic + copy for the lens toggle and the first-flip comparison
// reveal. docs/SIDEREAL.md P3.
//
// Production path: components/ZodiacLens.tsx renders the toggle on every
// chart-bearing route (Chart, HumanDesign, GeneKeys); the flip persists via
// POST /me/profile and the reveal is computed here from the two frames.
//
// Framing rule (plan section 1): the lens is a VIEW preference. Copy never
// claims either sky is "the real one".

import type { HumanDesign, NatalChart, Nakshatra, ZodiacSystem } from "./types";

export const ZODIAC_COPY: Record<ZodiacSystem, { name: string; sky: string; blurb: string }> = {
  tropical: {
    name: "tropical",
    sky: "the seasonal sky",
    blurb: "anchored to the march equinox. the zodiac of seasons, the western default.",
  },
  sidereal: {
    name: "sidereal",
    sky: "the fixed-star sky",
    blurb: "anchored to the stars themselves. the zodiac of the vedic tradition.",
  },
};

// The one-line stance shown beside the toggle. Neutral by design.
export const LENS_NEUTRAL_COPY =
  "two anchors for the same sky. neither replaces the other; they measure from different fixed points, now about twenty-four degrees apart.";

const SIGNS = [
  "aries", "taurus", "gemini", "cancer", "leo", "virgo",
  "libra", "scorpio", "sagittarius", "capricorn", "aquarius", "pisces",
] as const;

export function signFromLongitude(lon: number): string {
  const norm = ((lon % 360) + 360) % 360;
  return SIGNS[Math.floor(norm / 30)];
}

// "purva bhadrapada · pada 2"
export function formatNakshatra(n: Nakshatra): string {
  return `${n.name.toLowerCase()} · pada ${n.pada}`;
}

export function ayanamsaLabel(mode?: string | null): string {
  if (!mode) return "lahiri";
  return mode.toLowerCase().replace(/_/g, "-");
}

// ---------------------------------------------------------------------------
// The comparison reveal: what moved when the sky was re-anchored.
// ---------------------------------------------------------------------------

export interface ShiftItem {
  label: string;   // "sun" | "moon" | "rising" | "type" | "profile" | "authority"
  from: string;    // display-ready, lowercase
  to: string;
  changed: boolean;
}

export interface LensShift {
  items: ShiftItem[];                 // sun, moon, rising (whichever are known)
  moon_nakshatra: string | null;      // formatted, from the sidereal chart
  rising_nakshatra: string | null;
  hd: { type: ShiftItem; profile: ShiftItem; authority: ShiftItem } | null;
  ayanamsa: string;                   // e.g. "lahiri"
  computed_at: number;                // epoch ms
}

function planetSign(chart: NatalChart | null | undefined, name: string): string | null {
  const p = chart?.planets?.find((x) => x.name === name);
  return p ? p.sign.toLowerCase() : null;
}

function planetNakshatra(chart: NatalChart | null | undefined, name: string): Nakshatra | null {
  const p = chart?.planets?.find((x) => x.name === name);
  return p?.nakshatra ?? null;
}

function risingSign(chart: NatalChart | null | undefined): string | null {
  const asc = chart?.angles?.ascendant;
  if (typeof asc !== "number") return null;
  return signFromLongitude(asc);
}

function item(label: string, from: string | null, to: string | null): ShiftItem | null {
  if (!from || !to) return null;
  return { label, from, to, changed: from !== to };
}

// Diff the tropical frame against the sidereal frame. Either chart or HD side
// may be missing (no birth data, engine hiccup); we diff what we have and
// never invent a value.
export function computeLensShift(
  tropical: NatalChart | null | undefined,
  sidereal: NatalChart | null | undefined,
  tropicalHd: HumanDesign | null | undefined,
  siderealHd: HumanDesign | null | undefined,
): LensShift {
  const items: ShiftItem[] = [];
  for (const [label, name] of [["sun", "Sun"], ["moon", "Moon"]] as const) {
    const it = item(label, planetSign(tropical, name), planetSign(sidereal, name));
    if (it) items.push(it);
  }
  const rising = item("rising", risingSign(tropical), risingSign(sidereal));
  if (rising) items.push(rising);

  const moonNak = planetNakshatra(sidereal, "Moon");
  const risingNak = sidereal?.ascendant_nakshatra ?? null;

  let hd: LensShift["hd"] = null;
  if (tropicalHd && siderealHd) {
    hd = {
      type: {
        label: "type",
        from: tropicalHd.type.toLowerCase(),
        to: siderealHd.type.toLowerCase(),
        changed: tropicalHd.type !== siderealHd.type,
      },
      profile: {
        label: "profile",
        from: tropicalHd.profile.label,
        to: siderealHd.profile.label,
        changed: tropicalHd.profile.label !== siderealHd.profile.label,
      },
      authority: {
        label: "authority",
        from: tropicalHd.authority.toLowerCase(),
        to: siderealHd.authority.toLowerCase(),
        changed: tropicalHd.authority !== siderealHd.authority,
      },
    };
  }

  return {
    items,
    moon_nakshatra: moonNak ? formatNakshatra(moonNak) : null,
    rising_nakshatra: risingNak ? formatNakshatra(risingNak) : null,
    hd,
    ayanamsa: ayanamsaLabel(sidereal?.ayanamsa?.mode),
    computed_at: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Persistence of the computed reveal (so "see what moved" can reopen it
// without re-flipping the preference). Pure serialize/parse; the component
// owns the localStorage keys.
// ---------------------------------------------------------------------------

export function serializeShift(s: LensShift): string {
  return JSON.stringify(s);
}

export function parseShift(raw: string | null): LensShift | null {
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw) as LensShift;
    if (!obj || !Array.isArray(obj.items)) return null;
    return obj;
  } catch {
    return null;
  }
}
