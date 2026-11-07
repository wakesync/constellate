// Normalize the astro sidecar's chart payloads into the flat shape the web
// client (ChartWheel, Chart route, types.ts NatalChart) consumes.
//
// Astro emits planets as { name, sign, sign_degree, absolute_degree, house,
// retrograde } and angles as ascendant/midheaven objects. The web expects
// { planets: [{ name, sign, house, degree, longitude, retrograde }], angles:
// { ascendant, midheaven }, houses?: number[] }. We do this server-side so the
// contract is stable and the SVG never has to guess field names.
//
// We DO NOT touch services/astro (owned by another worker); we only read + map
// its output here.

type AstroNakshatra = {
  name?: string;
  index?: number;
  pada?: number;
  degree_in_nakshatra?: number;
};

type AstroPlanet = {
  name?: string;
  sign?: string;
  sign_degree?: number;
  absolute_degree?: number;
  house?: number;
  retrograde?: boolean;
  nakshatra?: AstroNakshatra; // sidereal charts only (docs/SIDEREAL.md section 3)
  // transit endpoint reuses the same planet shape under "positions"
};

type AstroAngle = { absolute_degree?: number; nakshatra?: AstroNakshatra };
type AstroHouse = { absolute_degree?: number };

type AstroChart = {
  planets?: AstroPlanet[];
  positions?: AstroPlanet[]; // transits
  ascendant?: AstroAngle;
  midheaven?: AstroAngle;
  houses?: AstroHouse[];
  // sidereal-only keys (docs/SIDEREAL.md section 3). Tropical charts carry
  // NONE of these; we pass them through only when present so tropical output
  // stays byte-identical to the pre-sidereal shape.
  zodiac?: string;
  house_system?: string;
  ayanamsa?: { mode?: string; value_deg?: number };
};

export type WebNakshatra = {
  name: string;
  index: number;
  pada: number;
  degree_in_nakshatra: number;
};

export type WebPlanet = {
  name: string;
  sign: string;
  house: number;
  degree: number;
  longitude: number;
  retrograde: boolean;
  nakshatra?: WebNakshatra; // present on sidereal charts only
};

export type WebChart = {
  planets: WebPlanet[];
  angles: { ascendant: number; midheaven: number };
  houses?: number[];
  // sidereal-only (absent from every tropical chart, keys never emitted):
  zodiac?: "sidereal";
  house_system?: string;
  ayanamsa?: { mode: string; value_deg: number };
  ascendant_nakshatra?: WebNakshatra;
};

function mapNakshatra(n: AstroNakshatra | undefined): WebNakshatra | undefined {
  if (!n || typeof n.name !== "string") return undefined;
  return {
    name: n.name,
    index: typeof n.index === "number" ? n.index : 0,
    pada: typeof n.pada === "number" ? n.pada : 0,
    degree_in_nakshatra: typeof n.degree_in_nakshatra === "number" ? n.degree_in_nakshatra : 0,
  };
}

function mapPlanet(p: AstroPlanet): WebPlanet {
  const out: WebPlanet = {
    name: p.name ?? "",
    sign: p.sign ?? "",
    house: typeof p.house === "number" ? p.house : 0,
    degree: typeof p.sign_degree === "number" ? p.sign_degree : 0,
    longitude: typeof p.absolute_degree === "number" ? p.absolute_degree : 0,
    retrograde: !!p.retrograde,
  };
  // Sidereal-only: the astro sidecar attaches a nakshatra to every planet in a
  // sidereal chart. Tropical planets have no such key, so tropical output is
  // byte-identical to the pre-sidereal mapper.
  const nak = mapNakshatra(p.nakshatra);
  if (nak) out.nakshatra = nak;
  return out;
}

export function normalizeChart(raw: unknown): WebChart {
  const c = (raw ?? {}) as AstroChart;
  const planetsSrc = Array.isArray(c.planets) ? c.planets : Array.isArray(c.positions) ? c.positions : [];
  const planets = planetsSrc.map(mapPlanet);
  const ascendant = c.ascendant?.absolute_degree ?? 0;
  const midheaven = c.midheaven?.absolute_degree ?? (ascendant + 270) % 360;
  const houses = Array.isArray(c.houses)
    ? c.houses.map((h) => (typeof h.absolute_degree === "number" ? h.absolute_degree : 0))
    : undefined;
  const out: WebChart = { planets, angles: { ascendant, midheaven }, houses };
  // Sidereal furniture (whole-sign label, ayanamsa, ascendant nakshatra).
  // Gated on the sidecar's own zodiac marker: a tropical chart never carries
  // it, so no new key can ever appear on a tropical response.
  if (c.zodiac === "sidereal") {
    out.zodiac = "sidereal";
    if (typeof c.house_system === "string") out.house_system = c.house_system;
    if (c.ayanamsa && typeof c.ayanamsa.mode === "string") {
      out.ayanamsa = {
        mode: c.ayanamsa.mode,
        value_deg: typeof c.ayanamsa.value_deg === "number" ? c.ayanamsa.value_deg : 0,
      };
    }
    const ascNak = mapNakshatra(c.ascendant?.nakshatra);
    if (ascNak) out.ascendant_nakshatra = ascNak;
  }
  return out;
}
