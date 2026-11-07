// Western astrology -> shared trait space.
//
// This is the WEAKEST mapper by design, and the doc says so plainly. Sun-sign
// psychology is thin, and without a birth time there are no houses and no
// ascendant, so a chart can be almost mute. We therefore keep every astro weight
// low (<= 0.4) and only emit signals we can defend from element/modality, which
// are the least contested parts of the tradition.
//
// Reads the normalized natal chart:
//   { planets:[{name,sign,house?,...}], angles?, houses? }
// We derive per-planet sign -> (element, modality) and speak cautiously.

import { makeSignal, type Signal } from "../axes";

type Planet = { name?: string; sign?: string };
type Chart = { planets?: Planet[] };

type Element = "fire" | "earth" | "air" | "water";
type Modality = "cardinal" | "fixed" | "mutable";

const SIGN_ELEMENT: Record<string, Element> = {
  Aries: "fire", Leo: "fire", Sagittarius: "fire",
  Taurus: "earth", Virgo: "earth", Capricorn: "earth",
  Gemini: "air", Libra: "air", Aquarius: "air",
  Cancer: "water", Scorpio: "water", Pisces: "water",
};
const SIGN_MODALITY: Record<string, Modality> = {
  Aries: "cardinal", Cancer: "cardinal", Libra: "cardinal", Capricorn: "cardinal",
  Taurus: "fixed", Leo: "fixed", Scorpio: "fixed", Aquarius: "fixed",
  Gemini: "mutable", Virgo: "mutable", Sagittarius: "mutable", Pisces: "mutable",
};

function findPlanet(chart: Chart, name: string): string | undefined {
  return chart.planets?.find((p) => (p.name ?? "").toLowerCase() === name.toLowerCase())?.sign;
}

export function mapAstro(chart: Chart | null | undefined): Signal[] {
  if (!chart || !Array.isArray(chart.planets) || chart.planets.length === 0) return [];
  const out: (Signal | null)[] = [];
  const S = (axis: string, v: number, w: number, e: string) =>
    out.push(makeSignal("astro", axis, v, w, e));

  const sunSign = findPlanet(chart, "Sun");
  const sunEl = sunSign ? SIGN_ELEMENT[sunSign] : undefined;
  const sunMod = sunSign ? SIGN_MODALITY[sunSign] : undefined;

  // --- head_heart from sun element ---------------------------------------
  // Air/fire lean expressive/logical-airy, water leans feeling, earth is neutral.
  // This is genuinely thin, hence weight 0.2, and the doc flags it.
  if (sunEl === "water") {
    S("head_heart", 0.45, 0.25, `your sun is in ${sunSign}, a water sign, which leans toward leading with feeling and emotional current.`);
    S("sensitivity", 0.4, 0.25, `a water sun (${sunSign}) is traditionally the most porous to mood and undercurrent in a room.`);
  } else if (sunEl === "air") {
    S("head_heart", -0.35, 0.2, `your sun is in ${sunSign}, an air sign, which leans toward leading with ideas and mental distance over feeling.`);
    S("abstraction", 0.35, 0.22, `an air sun (${sunSign}) leans toward ideas, concepts, and the space of what could be.`);
  } else if (sunEl === "fire") {
    S("initiation", 0.4, 0.25, `your sun is in ${sunSign}, a fire sign, traditionally quick to initiate and move first.`);
  } else if (sunEl === "earth") {
    S("abstraction", -0.35, 0.22, `your sun is in ${sunSign}, an earth sign, grounded in the tangible and practical over the abstract.`);
  }

  // --- initiation from sun modality --------------------------------------
  // Cardinal signs initiate; fixed signs hold; mutable signs adapt. Low weight.
  if (sunMod === "cardinal") {
    S("initiation", 0.35, 0.22, `your sun is in ${sunSign}, a cardinal sign, which carries a starting, initiating impulse.`);
  } else if (sunMod === "fixed") {
    S("structure", 0.35, 0.2, `your sun is in ${sunSign}, a fixed sign, which holds its shape and resists being moved.`);
  } else if (sunMod === "mutable") {
    S("structure", -0.3, 0.2, `your sun is in ${sunSign}, a mutable sign, adaptable and comfortable letting the shape shift.`);
  }

  // --- conflict from mars element ----------------------------------------
  const marsSign = findPlanet(chart, "Mars");
  const marsEl = marsSign ? SIGN_ELEMENT[marsSign] : undefined;
  if (marsEl === "fire") {
    S("conflict", 0.4, 0.25, `your mars is in ${marsSign}, a fire sign, which meets friction directly and quickly.`);
  } else if (marsEl === "water") {
    S("conflict", -0.35, 0.22, `your mars is in ${marsSign}, a water sign, which tends to move around conflict rather than through it.`);
  }

  // --- moon: emotional style ----------------------------------------------
  // The moon sign is the tradition's core statement about emotional response,
  // as defensible as anything in sign-level astrology. Element speaks to
  // porousness and head/heart; modality to emotional tempo (fixed = steady,
  // holds its state; cardinal/mutable = quicker-moving weather). Weights stay
  // in the same cautious band as the rest of this mapper (<= 0.3).
  const moonSign = findPlanet(chart, "Moon");
  const moonEl = moonSign ? SIGN_ELEMENT[moonSign] : undefined;
  const moonMod = moonSign ? SIGN_MODALITY[moonSign] : undefined;
  if (moonEl === "water") {
    S("sensitivity", 0.45, 0.28, `your moon is in ${moonSign}, a water sign: the emotional weather of a room tends to pass straight into you.`);
    S("head_heart", 0.4, 0.25, `a water moon (${moonSign}) feels first and reasons after. the feeling arrives before the thought.`);
  } else if (moonEl === "earth") {
    S("sensitivity", -0.35, 0.25, `your moon is in ${moonSign}, an earth sign, which keeps emotional weather at arm's length: steady, contained, practical.`);
  } else if (moonEl === "air") {
    S("head_heart", -0.35, 0.25, `your moon is in ${moonSign}, an air sign: feeling routes through thought first, named before it is fully felt.`);
  } else if (moonEl === "fire") {
    S("emotional_tempo", -0.35, 0.22, `your moon is in ${moonSign}, a fire sign: feeling flares fast, burns clean, and resolves quickly.`);
  }
  if (moonMod === "fixed" && moonEl !== "fire") {
    S("emotional_tempo", 0.3, 0.22, `a fixed moon (${moonSign}) holds an emotional state once it settles in; feelings take time to arrive and to leave.`);
  }

  // --- mercury: thinking style ---------------------------------------------
  // Mercury's element is the tradition's statement about how the mind reaches:
  // air/fire toward pattern and possibility, earth toward the tangible, water
  // toward feeling-toned thought. Cautious weight.
  const mercSign = findPlanet(chart, "Mercury");
  const mercEl = mercSign ? SIGN_ELEMENT[mercSign] : undefined;
  if (mercEl === "air") {
    S("abstraction", 0.35, 0.25, `your mercury is in ${mercSign}, an air sign: the mind reaches first for pattern, concept, and what could be.`);
  } else if (mercEl === "earth") {
    S("abstraction", -0.35, 0.25, `your mercury is in ${mercSign}, an earth sign: the mind reaches first for what is tangible, usable, and actual.`);
  } else if (mercEl === "water") {
    S("head_heart", 0.3, 0.2, `your mercury is in ${mercSign}, a water sign: thought arrives already colored by feeling.`);
  } else if (mercEl === "fire") {
    S("initiation", 0.3, 0.2, `your mercury is in ${mercSign}, a fire sign: the mind moves first and fastest, speaking before the room settles.`);
  }

  return out.filter((s): s is Signal => s !== null);
}
