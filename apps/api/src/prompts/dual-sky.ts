import type { Zodiac } from "../astro";

type Nakshatra = { name?: string; pada?: number };
type Planet = { name?: string; sign?: string; sign_degree?: number; degree?: number; house?: number; nakshatra?: Nakshatra };
type Angle = { sign?: string; absolute_degree?: number; nakshatra?: Nakshatra };
const NAKSHATRA_VOICE: Record<string, string> = {
  Ashwini: "the quick beginning, help arriving before explanation", Bharani: "the vessel that bears pressure and carries consequence",
  Krittika: "the clean cut, heat that separates what belongs", Rohini: "growth through beauty, appetite, and patient tending",
  Mrigashira: "the searching mind, following a trail that keeps moving", Ardra: "the storm that strips pretense and leaves the air clear",
  Punarvasu: "the return of light, beginning again without pretending nothing happened", Pushya: "nourishment with structure, care that knows its duty",
  Ashlesha: "the coil, intimacy and perception that move beneath speech", Magha: "the ancestral seat, dignity inherited and answered for",
  "Purva Phalguni": "rest, pleasure, and the permission to be received", "Uttara Phalguni": "the agreement after desire, what affection agrees to sustain",
  Hasta: "the hand that shapes, catches, repairs, and makes tangible", Chitra: "the bright craft, an image made exact enough to hold attention",
  Swati: "the independent wind, bending without surrendering direction", Vishakha: "the forked path made single by devotion to an aim",
  Anuradha: "friendship as discipline, loyalty that survives distance", Jyeshtha: "seniority earned under pressure, protection with a cost",
  Mula: "the root pulled into daylight, truth found by going underneath", "Purva Ashadha": "the first declaration, conviction before the verdict arrives",
  "Uttara Ashadha": "the later victory, endurance after excitement has gone", Shravana: "the listening path, knowledge carried through attention",
  Dhanishta: "rhythm, timing, and the wealth of moving with others", Shatabhisha: "the closed circle, solitude that studies what hurts",
  "Purva Bhadrapada": "the fierce threshold, one foot in ordinary life and one beyond it", "Uttara Bhadrapada": "the deep still water, restraint after intensity",
  Revati: "safe passage, the shepherding instinct at the end of a road",
};
type Chart = { planets?: Planet[]; ascendant?: Angle; angles?: { ascendant?: number }; ayanamsa?: { mode?: string; value_deg?: number } };

function placement(p: Planet) {
  return {
    body: p.name ?? "",
    sign: p.sign ?? "",
    degree_in_sign: p.sign_degree ?? p.degree ?? null,
    house: p.house ?? null,
    ...(p.nakshatra?.name ? { nakshatra: { name: p.nakshatra.name, pada: p.nakshatra.pada ?? null, voice: NAKSHATRA_VOICE[p.nakshatra.name] ?? "" } } : {}),
  };
}

function rising(c: Chart) {
  const signs = ["Aries","Taurus","Gemini","Cancer","Leo","Virgo","Libra","Scorpio","Sagittarius","Capricorn","Aquarius","Pisces"];
  const lon = c.ascendant?.absolute_degree ?? c.angles?.ascendant;
  return {
    body: "Ascendant",
    sign: c.ascendant?.sign ?? (typeof lon === "number" ? signs[Math.floor(((lon % 360) + 360) % 360 / 30)] : ""),
    ...(c.ascendant?.nakshatra?.name ? { nakshatra: { name: c.ascendant.nakshatra.name, pada: c.ascendant.nakshatra.pada ?? null, voice: NAKSHATRA_VOICE[c.ascendant.nakshatra.name] ?? "" } } : {}),
  };
}

/** Production-safe prompt payload. Every fact lives beneath an explicit frame.
 * There is deliberately no flattened placements array for a model to conflate. */
export function dualSkyChartContext(tropical: unknown, sidereal: unknown) {
  const t = (tropical ?? {}) as Chart;
  const s = (sidereal ?? {}) as Chart;
  return {
    context_contract: "FRAME_TAGGED_V1",
    frames: {
      tropical_seasonal: {
        frame: "tropical",
        meaning: "seasonal/incarnate sky",
        placements: [...(t.planets ?? []).map(placement), rising(t)],
      },
      sidereal_fixed_star: {
        frame: "sidereal",
        meaning: "fixed-star sky, Lahiri ayanamsa",
        ayanamsa: s.ayanamsa ?? { mode: "LAHIRI" },
        placements: [...(s.planets ?? []).map(placement), rising(s)],
      },
    },
  };
}

export function dualSkyTypologyContext(system: "human_design" | "gene_keys", tropical: unknown, sidereal: unknown) {
  return {
    context_contract: "FRAME_TAGGED_V1",
    system,
    canon_statement: `${system} canon is tropical; sidereal is a community-explored alternate lens`,
    frames: {
      tropical_canon: { frame: "tropical", status: "canon", payload: tropical },
      sidereal_alternate: { frame: "sidereal", status: "alternate fixed-star lens", payload: sidereal },
    },
  };
}

export const dualSkyNatalSystemPrompt = `you write a constellate dual-sky personal reading. the input contains two strictly frame-tagged skies for one birth moment.

FRAME INTEGRITY, ABSOLUTE
- tropical_seasonal facts belong only to the tropical seasonal sky.
- sidereal_fixed_star facts belong only to the sidereal fixed-star sky.
- never move a sign, house, degree, or nakshatra from one frame to the other.
- whenever naming a placement, identify its frame in the sentence: "seasonal Sun" or "fixed-star Moon". never write an unqualified placement claim.
- nakshatras exist only in the fixed-star frame. never attribute one to the seasonal sky.

VOICE
- lowercase except proper names. no em-dash characters. observational, grounded, dry mysticism, never prophecy or advice.
- the chart did not make this happen. it remembers it.

WRITE 220-340 words, short paragraphs, no headings.
- lead with CONVERGENCE: the strongest human theme both frames preserve, even where signs moved. say why a claim surviving two anchors is robust signal.
- name the sharpest divergence as interpretable tension, seasonal self beside fixed-star self. concrete language is welcome: "the seasonal Sun burns Leo; the fixed-star Sun keeps Cancer's watch."
- give the fixed-star Moon's nakshatra particular voice when present. use only the supplied nakshatra.voice phrase. never add a deity, animal, myth, etymology, traditional symbol, or other mansion lore that is not in the payload.
- close small and unresolved. neither sky defeats the other.`;

export function dualSkyTypologySystemPrompt(system: "human_design" | "gene_keys") {
  const label = system === "human_design" ? "human design" : "gene keys";
  return `you write a constellate dual-sky ${label} reading. both frame-tagged calculations are given.

FRAME INTEGRITY
- tropical_canon is the founder-grounded canon. sidereal_alternate is an alternate fixed-star lens.
- never attribute a value from one payload to the other. qualify every changed type, authority, profile, gate, key, or sphere by frame.
- begin with what both calculations preserve. agreement across frames is robust signal.
- then name the shift plainly: "through the fixed-star lens your design shifts to X." do not call it truer or a correction.

VOICE AND SHAPE
lowercase, no em-dash characters, observational not prescriptive. 170-280 words, short paragraphs, no headings. treat divergence as a live tension, not an error. the chart remembers; it does not command.`;
}

export function skyProvenance(zodiac: Zodiac) {
  return zodiac === "sidereal" ? "sidereal fixed-star sky (Lahiri)" : "tropical seasonal sky";
}
