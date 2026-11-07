// Socionics: Model A, the socion, and the full 16x16 intertype relation matrix.
//
// This is NOT "MBTI with a lowercase last letter". The content that matters here
// is Model A (the 8-function stack per type) and the intertype relations that
// fall out of comparing two people's Model A. Everything below is DERIVED from a
// small set of first principles so it is internally consistent, then verified
// against published tables (see docs/SOCIONICS.md and the invariant test in
// apps/api/test/socionics.matrix.test.ts).
//
// Sources for the ground truth we verify against:
//   - Model A stacks + the 8 information elements: wikisocion (Model A), the
//     Japanese Socionics Society (socionics.or.jp/en/model_a), sociotype.com.
//   - Base/creative per type + quadras: sociotype.com, wikisocion, socionics.or.jp.
//   - The 16x16 relation matrix: socionics.com/rel/relcht.htm, socionicsinsight.com,
//     wikisocion Intertype relations.
// No birth data is used. Socionics needs none.

// ---------------------------------------------------------------------------
// the 8 information elements (aspects)
// ---------------------------------------------------------------------------
export type Element = "Ne" | "Ni" | "Se" | "Si" | "Te" | "Ti" | "Fe" | "Fi";

export const ELEMENTS: { symbol: Element; name: string; blurb: string }[] = [
  { symbol: "Ne", name: "intuition of possibilities", blurb: "the field of what could be. options, potentials, the latent shape inside a thing." },
  { symbol: "Ni", name: "intuition of time", blurb: "the current of time. how things ripen, foreshadow, and arrive. the long view." },
  { symbol: "Se", name: "force / volitional sensing", blurb: "presence and will made physical. territory, impact, the pressure of the now." },
  { symbol: "Si", name: "comfort / sensory experience", blurb: "the body's read on the moment. ease, texture, health, the quality of being here." },
  { symbol: "Te", name: "business logic / efficiency", blurb: "what works. facts, methods, the machinery of getting a real thing done." },
  { symbol: "Ti", name: "structural logic", blurb: "the shape of ideas. consistency, systems, how a framework holds together." },
  { symbol: "Fe", name: "ethics of emotions", blurb: "the weather in a room. expressed feeling, mood, the charge between people." },
  { symbol: "Fi", name: "relational ethics", blurb: "the quiet ledger of closeness. like and dislike, trust, the distance between two people." },
];

export const ELEMENT_NAME: Record<Element, string> = Object.fromEntries(
  ELEMENTS.map((e) => [e.symbol, e.name]),
) as Record<Element, string>;

// dual pairs (an element and the introverted/extroverted partner that completes it):
// Ne<->Si, Ni<->Se, Te<->Fi, Ti<->Fe. Used to build suggestive/PoLR etc.
const DUAL_ELEMENT: Record<Element, Element> = {
  Ne: "Si", Si: "Ne",
  Ni: "Se", Se: "Ni",
  Te: "Fi", Fi: "Te",
  Ti: "Fe", Fe: "Ti",
};

// the "sister" element of the same dichotomy but flipped rationality/irrationality
// used to derive the creative from the base within a quadra-consistent block.
// base+creative are one rational + one irrational, one extroverted + one introverted.

// ---------------------------------------------------------------------------
// Model A: the 8 positions
// ---------------------------------------------------------------------------
export type Block = "Ego" | "Super-Ego" | "Super-Id" | "Id";
export interface ModelAPosition {
  position: number; // 1..8
  role: string;     // Leading, Creative, ...
  block: Block;
  element: Element;
  element_name: string;
  meaning: string;
}

const POSITION_META: { position: number; role: string; block: Block; meaning: string }[] = [
  { position: 1, role: "Leading", block: "Ego", meaning: "the base program. strong, valued, tireless. the lens you see the world through without effort." },
  { position: 2, role: "Creative", block: "Ego", meaning: "the tool. strong and valued, used flexibly to act on what the base perceives." },
  { position: 3, role: "Role", block: "Super-Ego", meaning: "the mask. tried on in public, held briefly, tiring to sustain. you perform it, you do not live in it." },
  { position: 4, role: "Vulnerable", block: "Super-Ego", meaning: "the point of least resistance. weak and unvalued. pressure here is felt as pain; you steer around it." },
  { position: 5, role: "Suggestive", block: "Super-Id", meaning: "the dual-seeking hunger. weak but deeply valued. what you cannot supply for yourself and love to receive." },
  { position: 6, role: "Mobilizing", block: "Super-Id", meaning: "the activating function. weak, valued, energizing when it is fed. it lifts you when someone brings it." },
  { position: 7, role: "Ignoring", block: "Id", meaning: "strong but unvalued. you can do it, you just do not care to. the road not taken, on purpose." },
  { position: 8, role: "Demonstrative", block: "Id", meaning: "strong and effortless, done in the background without announcement. the quiet competence." },
];

// Given a base and creative element, derive the full 8-slot Model A stack.
// The socion structure (Augusta's Model A) fixes the stack from the Ego block:
//   1 base, 2 creative
//   3 role       = same axis as creative, opposite i/e         -> "sister of creative"
//   4 vulnerable = same axis as base, opposite i/e             -> "sister of base"
//   5 suggestive = dual of base
//   6 mobilizing = dual of creative
//   7 ignoring   = same axis as base, same valence family as base but opposite i/e of base's dual... 
// Rather than juggle several ad-hoc rules, we use the canonical and provably
// consistent construction: positions 5..8 are the dual-element mirror of 1..4,
// and 3,4,7,8 come from the "opposite orientation" partners. See derivation below.
function siblingOrientation(el: Element): Element {
  // flip introversion/extroversion within the SAME Jungian dichotomy.
  // Ne<->Ni, Se<->Si, Te<->Ti, Fe<->Fi
  const flip: Record<Element, Element> = {
    Ne: "Ni", Ni: "Ne",
    Se: "Si", Si: "Se",
    Te: "Ti", Ti: "Te",
    Fe: "Fi", Fi: "Fe",
  };
  return flip[el];
}

export function buildModelA(base: Element, creative: Element): ModelAPosition[] {
  // Canonical Model A construction (verified against ILE, SEI, ESE, LII published
  // stacks in the test). The eight elements per type are all eight information
  // elements exactly once; the placement is fully determined by the Ego block.
  // Canonical socion construction, verified against ILE/SEI/ESE/LII:
  //   Ego       (1,2) = base, creative
  //   Super-Id  (5,6) = dual(base), dual(creative)        [valued, weak]
  //   Super-Ego (3,4) = flip(pos5), flip(pos6)            [unvalued, weak]
  //   Id        (7,8) = flip(base), flip(creative)        [unvalued, strong]
  // where flip = same Jungian dichotomy, opposite introversion/extroversion,
  // and dual = the completing element (Ne<->Si, Ni<->Se, Te<->Fi, Ti<->Fe).
  const p1 = base;
  const p2 = creative;
  const p5 = DUAL_ELEMENT[base];         // suggestive: dual of base
  const p6 = DUAL_ELEMENT[creative];     // mobilizing: dual of creative
  const p3 = siblingOrientation(p5);     // role: flip of suggestive
  const p4 = siblingOrientation(p6);     // vulnerable (PoLR): flip of mobilizing
  const p7 = siblingOrientation(base);   // ignoring: flip of base
  const p8 = siblingOrientation(creative); // demonstrative: flip of creative
  const els = [p1, p2, p3, p4, p5, p6, p7, p8];
  return POSITION_META.map((m, i) => ({
    position: m.position,
    role: m.role,
    block: m.block,
    element: els[i],
    element_name: ELEMENT_NAME[els[i]],
    meaning: m.meaning,
  }));
}

// ---------------------------------------------------------------------------
// the 16 types
// ---------------------------------------------------------------------------
export type Quadra = "Alpha" | "Beta" | "Gamma" | "Delta";

export interface SocionicsType {
  code: string;        // ILE, SEI, ...
  mbti_style: string;  // ENTp, ISFp, ... (lowercase last letter, NOT MBTI)
  nickname: string;    // "Seeker"
  alias: string;       // "Don Quixote"
  base: Element;
  creative: Element;
  quadra: Quadra;
}

// base + creative per type (verified). mbti_style uses socionics convention
// (lowercase final letter). NOTE in UI copy: socionics ENTp != MBTI ENTP.
export const TYPES: SocionicsType[] = [
  // Alpha
  { code: "ILE", mbti_style: "ENTp", nickname: "Seeker",      alias: "Don Quixote", base: "Ne", creative: "Ti", quadra: "Alpha" },
  { code: "SEI", mbti_style: "ISFp", nickname: "Mediator",    alias: "Dumas",       base: "Si", creative: "Fe", quadra: "Alpha" },
  { code: "ESE", mbti_style: "ESFj", nickname: "Enthusiast",  alias: "Hugo",        base: "Fe", creative: "Si", quadra: "Alpha" },
  { code: "LII", mbti_style: "INTj", nickname: "Analyst",     alias: "Robespierre", base: "Ti", creative: "Ne", quadra: "Alpha" },
  // Beta
  { code: "EIE", mbti_style: "ENFj", nickname: "Mentor",      alias: "Hamlet",      base: "Fe", creative: "Ni", quadra: "Beta" },
  { code: "LSI", mbti_style: "ISTj", nickname: "Inspector",   alias: "Maxim",       base: "Ti", creative: "Se", quadra: "Beta" },
  { code: "SLE", mbti_style: "ESTp", nickname: "Conqueror",   alias: "Zhukov",      base: "Se", creative: "Ti", quadra: "Beta" },
  { code: "IEI", mbti_style: "INFp", nickname: "Lyricist",    alias: "Yesenin",     base: "Ni", creative: "Fe", quadra: "Beta" },
  // Gamma
  { code: "SEE", mbti_style: "ESFp", nickname: "Politician",  alias: "Napoleon",    base: "Se", creative: "Fi", quadra: "Gamma" },
  { code: "ILI", mbti_style: "INTp", nickname: "Critic",      alias: "Balzac",      base: "Ni", creative: "Te", quadra: "Gamma" },
  { code: "LIE", mbti_style: "ENTj", nickname: "Enterpriser", alias: "Jack London", base: "Te", creative: "Ni", quadra: "Gamma" },
  { code: "ESI", mbti_style: "ISFj", nickname: "Guardian",    alias: "Dreiser",     base: "Fi", creative: "Se", quadra: "Gamma" },
  // Delta
  { code: "LSE", mbti_style: "ESTj", nickname: "Director",    alias: "Stierlitz",   base: "Te", creative: "Si", quadra: "Delta" },
  { code: "EII", mbti_style: "INFj", nickname: "Humanist",    alias: "Dostoevsky",  base: "Fi", creative: "Ne", quadra: "Delta" },
  { code: "IEE", mbti_style: "ENFp", nickname: "Psychologist",alias: "Huxley",      base: "Ne", creative: "Fi", quadra: "Delta" },
  { code: "SLI", mbti_style: "ISTp", nickname: "Craftsman",   alias: "Gabin",       base: "Si", creative: "Te", quadra: "Delta" },
];

export const TYPE_BY_CODE: Record<string, SocionicsType> = Object.fromEntries(
  TYPES.map((t) => [t.code, t]),
);
export const CODES: string[] = TYPES.map((t) => t.code);

export const QUADRA_VALUES: Record<Quadra, { name: Quadra; members: string[]; values: string }> = {
  Alpha: {
    name: "Alpha",
    members: ["ILE", "SEI", "ESE", "LII"],
    values: "warmth and open inquiry. ideas for their own sake, comfort freely shared, a room where anyone can wonder aloud. Ne, Si, Fe, Ti. play, not power.",
  },
  Beta: {
    name: "Beta",
    members: ["EIE", "LSI", "SLE", "IEI"],
    values: "intensity and belonging. loyalty, drama, a cause worth standing inside. Se, Ti, Fe, Ni. the group as a body, the moment as a stage.",
  },
  Gamma: {
    name: "Gamma",
    members: ["SEE", "ILI", "LIE", "ESI"],
    values: "candor and consequence. real results, hard-earned trust, the long game played for keeps. Se, Fi, Te, Ni. no illusions, no performance.",
  },
  Delta: {
    name: "Delta",
    members: ["LSE", "EII", "IEE", "SLI"],
    values: "craft and quiet. steady work, personal ethics, growth without spectacle. Te, Si, Fi, Ne. a good life built slowly, on your own terms.",
  },
};

// ---------------------------------------------------------------------------
// intertype relations
// ---------------------------------------------------------------------------
export type RelationKind =
  | "Identity"
  | "Duality"
  | "Activity"
  | "Mirror"
  | "Semi-Duality"
  | "Mirage"
  | "Look-a-like"
  | "Kindred"          // Comparative / Kindred
  | "Contrary"         // Extinguishment / Contrary
  | "Super-Ego"
  | "Quasi-Identity"
  | "Conflict"
  | "Benefit"          // asymmetric; direction carried separately
  | "Supervision";     // asymmetric; direction carried separately

export type RelationDirection = "benefactor" | "beneficiary" | "supervisor" | "supervisee" | null;

export interface Relation {
  kind: RelationKind;
  direction: RelationDirection; // only set for Benefit / Supervision
  symmetric: boolean;
  title: string;   // human title, e.g. "your dual", "you supervise them"
  blurb: string;   // in-voice description
}

// The relation between two types is a function of how their Model A stacks line
// up. We DERIVE the whole 16x16 matrix from a canonical rule set keyed to the
// socion, then verify it against the published matrix in the test. The derivation
// used here is the standard one: index the socion as a 16-element group and read
// the relation from the transformation that maps one type to the other.
//
// Practically, the cleanest verifiable encoding is the published matrix itself,
// laid out in the canonical socion order, which we then check for the structural
// invariants (identity diagonal, unique symmetric duality, benefit/supervision
// rings of four). We keep the socion order below and the matrix rows aligned to
// it. Direction convention: from the ROW type's point of view toward the COLUMN
// type. "Bn>" = row is Benefactor to column. "Sup>" = row Supervises column.

// canonical socion order (rings of supervision/benefit run cleanly in this order)
export const SOCION_ORDER = [
  "ILE", "SEI", "ESE", "LII",
  "EIE", "LSI", "SLE", "IEI",
  "SEE", "ILI", "LIE", "ESI",
  "LSE", "EII", "IEE", "SLI",
] as const;

// short codes used in the matrix literal below.
type Cell =
  | "Id" | "Du" | "Ac" | "Mr" | "Sd" | "Mg" | "Lk" | "Kn"
  | "Ct" | "Se" | "Qi" | "Cf" | "Bn>" | "Bn<" | "Sup>" | "Sup<";

// 16x16, rows and columns in SOCION_ORDER. Verified against
// socionics.com/rel/relcht.htm and socionicsinsight.com. Bn>/Sup> means the ROW
// type is the benefactor/supervisor of the COLUMN type.
const MATRIX: Cell[][] = [
  // ILE
  ["Id","Du","Ac","Mr","Bn>","Sup>","Lk","Mg","Se","Ct","Qi","Cf","Bn<","Sup<","Kn","Sd"],
  // SEI
  ["Du","Id","Mr","Ac","Sup>","Bn>","Mg","Lk","Ct","Se","Cf","Qi","Sup<","Bn<","Sd","Kn"],
  // ESE
  ["Ac","Mr","Id","Du","Kn","Sd","Bn>","Sup>","Qi","Cf","Se","Ct","Lk","Mg","Bn<","Sup<"],
  // LII
  ["Mr","Ac","Du","Id","Sd","Kn","Sup>","Bn>","Cf","Qi","Ct","Se","Mg","Lk","Sup<","Bn<"],
  // EIE
  ["Bn<","Sup<","Kn","Sd","Id","Du","Ac","Mr","Bn>","Sup>","Lk","Mg","Se","Ct","Qi","Cf"],
  // LSI
  ["Sup<","Bn<","Sd","Kn","Du","Id","Mr","Ac","Sup>","Bn>","Mg","Lk","Ct","Se","Cf","Qi"],
  // SLE
  ["Lk","Mg","Bn<","Sup<","Ac","Mr","Id","Du","Kn","Sd","Bn>","Sup>","Qi","Cf","Se","Ct"],
  // IEI
  ["Mg","Lk","Sup<","Bn<","Mr","Ac","Du","Id","Sd","Kn","Sup>","Bn>","Cf","Qi","Ct","Se"],
  // SEE
  ["Se","Ct","Qi","Cf","Bn<","Sup<","Kn","Sd","Id","Du","Ac","Mr","Bn>","Sup>","Lk","Mg"],
  // ILI
  ["Ct","Se","Cf","Qi","Sup<","Bn<","Sd","Kn","Du","Id","Mr","Ac","Sup>","Bn>","Mg","Lk"],
  // LIE
  ["Qi","Cf","Se","Ct","Lk","Mg","Bn<","Sup<","Ac","Mr","Id","Du","Kn","Sd","Bn>","Sup>"],
  // ESI
  ["Cf","Qi","Ct","Se","Mg","Lk","Sup<","Bn<","Mr","Ac","Du","Id","Sd","Kn","Sup>","Bn>"],
  // LSE
  ["Bn>","Sup>","Lk","Mg","Se","Ct","Qi","Cf","Bn<","Sup<","Kn","Sd","Id","Du","Ac","Mr"],
  // EII
  ["Sup>","Bn>","Mg","Lk","Ct","Se","Cf","Qi","Sup<","Bn<","Sd","Kn","Du","Id","Mr","Ac"],
  // IEE
  ["Kn","Sd","Bn>","Sup>","Qi","Cf","Se","Ct","Lk","Mg","Bn<","Sup<","Ac","Mr","Id","Du"],
  // SLI
  ["Sd","Kn","Sup>","Bn>","Cf","Qi","Ct","Se","Mg","Lk","Sup<","Bn<","Mr","Ac","Du","Id"],
];

const IDX: Record<string, number> = Object.fromEntries(SOCION_ORDER.map((c, i) => [c, i]));

const CELL_META: Record<Cell, { kind: RelationKind; direction: RelationDirection; symmetric: boolean; title: string; blurb: string }> = {
  Id:   { kind: "Identity", direction: null, symmetric: true, title: "your mirror-twin", blurb: "the same type. you see the world through the same lens, which is comfortable and, in time, a little airless. you share the same blind spot, so neither of you covers it." },
  Du:   { kind: "Duality", direction: null, symmetric: true, title: "your dual", blurb: "the completing one. what you cannot supply for yourself, they carry without trying, and the reverse is just as true. the rarest ease. two halves that were cut from the same whole." },
  Ac:   { kind: "Activity", direction: null, symmetric: true, title: "your activator", blurb: "the one who lights you up. contact comes easily and quickly, and you push each other into motion. lovely in bursts. sustained too long, it overheats." },
  Mr:   { kind: "Mirror", direction: null, symmetric: true, title: "your mirror", blurb: "you work the same two tools in opposite order. they say aloud what you only think, and think what you say aloud. productive, faintly corrective, endlessly interesting." },
  Sd:   { kind: "Semi-Duality", direction: null, symmetric: true, title: "your semi-dual", blurb: "almost the completing one. much of the ease of duality, with an occasional misread where the fit slips. close enough to feel the gap." },
  Mg:   { kind: "Mirage", direction: null, symmetric: true, title: "your mirage", blurb: "relaxing, a little dreamlike, hard to build with. you soften each other and lose the thread of the plan. pleasant company, unreliable engine." },
  Lk:   { kind: "Look-a-like", direction: null, symmetric: true, title: "your look-alike", blurb: "business partners at ease. you resemble each other from a distance and cooperate without heat. equal footing, low friction, little spark." },
  Kn:   { kind: "Kindred", direction: null, symmetric: true, title: "your kindred", blurb: "same base, different tool. you reach the same conclusions by roads that do not quite meet. easy company that can quietly compete." },
  Ct:   { kind: "Contrary", direction: null, symmetric: true, title: "your contrary", blurb: "the one who extinguishes. you start warm and talk past each other by degrees. neither wrong, neither reachable, the current keeps reversing." },
  Se:   { kind: "Super-Ego", direction: null, symmetric: true, title: "your super-ego", blurb: "mutual respect across a necessary distance. up close you rub each other's masks raw. it works best with a room between you." },
  Qi:   { kind: "Quasi-Identity", direction: null, symmetric: true, title: "your quasi-identical", blurb: "you seem to agree until you look closely, then the same words turn out to mean different things. shared interests, private misunderstandings." },
  Cf:   { kind: "Conflict", direction: null, symmetric: true, title: "your conflictor", blurb: "the hardest one. your strengths land exactly on their sore places, and theirs on yours. rarely a story of malice. mostly a story of missing each other completely." },
  "Bn>":  { kind: "Benefit", direction: "benefactor", symmetric: false, title: "you give the benefit", blurb: "the gift runs one way, from you toward them. they tend to admire and over-read you; you tend to under-notice them. your leading function feeds their reaching one, and not the reverse." },
  "Bn<":  { kind: "Benefit", direction: "beneficiary", symmetric: false, title: "you receive the benefit", blurb: "the gift runs one way, from them toward you. you tend to admire and over-read them; they tend to under-notice you. their leading function feeds your reaching one, and not the reverse." },
  "Sup>": { kind: "Supervision", direction: "supervisor", symmetric: false, title: "you supervise them", blurb: "you watch them from above without meaning to, seeing the exact spot they feel unsure. they feel subtly corrected near you. you find them interesting; they find you hard to relax around." },
  "Sup<": { kind: "Supervision", direction: "supervisee", symmetric: false, title: "they supervise you", blurb: "they watch you from above without meaning to, landing on the exact spot you feel unsure. you feel subtly corrected near them, quick to explain yourself. the eye is on you." },
};

export function relationBetween(aCode: string, bCode: string): Relation {
  const i = IDX[aCode];
  const j = IDX[bCode];
  if (i === undefined || j === undefined) {
    return { kind: "Identity", direction: null, symmetric: true, title: "unknown", blurb: "" };
  }
  const cell = MATRIX[i][j];
  const m = CELL_META[cell];
  return { kind: m.kind, direction: m.direction, symmetric: m.symmetric, title: m.title, blurb: m.blurb };
}

// expose the raw matrix + helpers for the invariant test.
export const _internal = { MATRIX, SOCION_ORDER, IDX, CELL_META };

// ---------------------------------------------------------------------------
// public shapes
// ---------------------------------------------------------------------------
export interface SocionicsResult {
  type: { code: string; mbti_style: string; nickname: string; alias: string };
  confidence: number;
  quadra: { name: string; values: string };
  model_a: ModelAPosition[];
  dichotomies: { extraversion: number; intuition: number; logic: number; irrationality: number };
  scores: { code: string; score: number }[];
  runner_up: { code: string; score: number } | null;
  dual: { code: string; mbti_style: string; nickname: string };
  completed_at: number;
}

export function dualOf(code: string): SocionicsType {
  // find the type whose base is the dual of this type's base and whose creative
  // is the dual of this type's creative.
  const t = TYPE_BY_CODE[code];
  const dualBase = DUAL_ELEMENT[t.base];
  const dualCreative = DUAL_ELEMENT[t.creative];
  const found = TYPES.find((x) => x.base === dualBase && x.creative === dualCreative);
  // duality relation from the matrix as a cross-check happens in the test.
  return found ?? t;
}
