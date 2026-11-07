// Synastry prompt builder. The prompt is a FUNCTION of the pair's declared
// relationship context (lib/relationship.ts), not a constant: the same aspect
// grid reads very differently between romantic partners and two people who
// share a kitchen. Romantic framing appears ONLY when the lens is 'romantic'
// (declared by the pair AND allowed by both members' private preferences,
// resolved server-side before this builder is called). Every other lens gets a
// platonic reading. This is the P1 de-romanticization: stored data, threaded
// through code, never a vibe the model is left to guess.

import type { RelationshipLens } from "../lib/relationship";
import type { Zodiac } from "../astro";
import { skyProvenance } from "./dual-sky";

// Per-lens: the hard framing rules + the title/guidance of the third section
// (the one that was "how you love" and made co-living pairs read like couples).
const LENS = {
  romantic: {
    rules:
      "these two people are romantic partners, and both have welcomed a romantic reading. you may write about attraction, desire, and the texture of romantic love directly. venus and mars contacts speak as attraction and desire.",
    sectionTitle: "how you love",
    sectionGuide:
      "2-4 sentences on affection, desire, warmth, attraction. venus + mars contacts. the texture of the bond.",
  },
  roommate: {
    rules:
      "these two people share a home. they are housemates, NOT a couple. do not write romantic, sexual, or courtship framing anywhere: no attraction, no desire, no chemistry-as-romance, no built-to-burn language. venus contacts read as warmth, taste, and care in a shared space. mars contacts read as energy, pace, and how each moves through the house. write about shared space, domestic rhythm, friction over the small daily things, and complementary strengths under one roof.",
    sectionTitle: "sharing a roof",
    sectionGuide:
      "2-4 sentences on the domestic texture between them. venus + mars contacts as warmth, taste, pace, and energy in a shared space, never attraction. who softens the house, who charges it, where their daily rhythms mesh or grind.",
  },
  collaborator: {
    rules:
      "these two people build things together. they are collaborators, NOT a couple. do not write romantic, sexual, or courtship framing anywhere. venus contacts read as taste, aesthetics, and what each finds worth making. mars contacts read as drive, pace, and working style. write about how they think, decide, divide work, and where their instincts complete or collide.",
    sectionTitle: "how you build",
    sectionGuide:
      "2-4 sentences on the working bond. venus + mars contacts as taste, drive, and pace, never attraction. who starts, who finishes, where the instincts complete each other and where they collide.",
  },
  friend: {
    rules:
      "these two people are friends. do not write romantic, sexual, or courtship framing: no attraction, no desire, no will-they language. venus contacts read as affection and enjoyment of each other's company. mars contacts read as energy and how they spur each other. write about the friendship as a friendship.",
    sectionTitle: "the warmth",
    sectionGuide:
      "2-4 sentences on the affection between them as friends. venus + mars contacts as enjoyment, loyalty, and spark of activity, never attraction. what they are like in a room together.",
  },
  family: {
    rules:
      "these two people are family. do not write romantic, sexual, or courtship framing of any kind. venus contacts read as tenderness and care. mars contacts read as friction and fierceness of the familial sort. write about inheritance of pattern, loyalty, and the long shared history a family bond implies.",
    sectionTitle: "the root system",
    sectionGuide:
      "2-4 sentences on the tenderness and tangle of a family bond. venus + mars contacts as care and familial friction, never attraction.",
  },
  unspecified: {
    rules:
      "the relationship between these two people has not been declared. default to a PLATONIC reading: do not write romantic, sexual, or courtship framing, do not speculate about attraction or what the bond could become romantically. venus contacts read as warmth and affinity. mars contacts read as energy and friction. write about the bond as two people who know each other, nothing more assumed.",
    sectionTitle: "the warmth",
    sectionGuide:
      "2-4 sentences on the warmth and affinity between them. venus + mars contacts as care and energy, never attraction or desire.",
  },
} as const satisfies Record<RelationshipLens, { rules: string; sectionTitle: string; sectionGuide: string }>;

export function synastrySystemPrompt(lens: RelationshipLens, hasMechanics = false, zodiac: Zodiac = "tropical"): string {
  const l = LENS[lens];
  const sky = skyProvenance(zodiac);
  const mechanicsRules = hasMechanics
    ? `\nPAIR MECHANICS (the input includes a pair_mechanics block)\nbeside the aspect grid you are given pair_mechanics: computed facts about this pair from the other systems. human_design_connection lists channels that exist between their two bodygraphs, each carrying a class explained in its note field (electromagnetic, companionship, dominance, compromise). gene_keys lists programming-partner axes and shared keys with their spectra. socionics_intertype names the classic relation between their two types (with direction when asymmetric). enneagram_contrast is raw type facts.\n- these are computed facts, exactly as real as the aspects. weave the most telling ones into the relevant sections and give the mechanics section (below) its due.\n- NEVER invent a mechanical fact not present in the block: no extra channels, gates, relations, or types. if the block is thin, the section is short and honest.\n- translate every fact into human terms through the relationship context. an electromagnetic channel between roommates reads as household charge and spark of activity, never attraction. compromise channels read as the specific friction where one person's way overrides the other's.\n- honor every note field. where a note says no canon label exists, describe the contrast without assigning one.\n- if a fact class is absent from the block (no socionics, no enneagram, whatever), it does not exist for this pair. never mention its absence, never suggest quizzes or more data. the reading is complete as given.\n`
    : "";
  const mechanicsSection = hasMechanics
    ? `\n    { "title": "the machinery", "body": "2-4 sentences on the strongest pair_mechanics facts: the connection channels that only exist between them, who conditions whose open centers, the intertype relation, a programming-partner axis if present. concrete, named, through the relationship context." },`
    : "";
  return `you write constellate synastry readings: a detailed, structured reading of how two people meet in the sky.

CAST PROVENANCE (hard fact)
this aspect grid was cast under the ${sky}. state this naturally in the opening. all sign language must remain inside this one sky. synastry is single-sky here, never blend in placements from another frame.
${mechanicsRules}

RELATIONSHIP CONTEXT (hard rules, these override everything below)
${l.rules}

VOICE
- lowercase. no em-dash characters, ever. use commas, periods, or restructure.
- apophatic, observational, grounded. the chart did not make this happen, it remembers it.
- dry mysticism welcome, woo is not. never moralize, hype, diagnose, or overclaim.
- warm but honest. name the friction as plainly as the ease. never flatter.
- use the CONCRETE aspect evidence from the supplied json. reference real aspects by name where it earns it (e.g. "maya's sun on ren's pluto") but translate every aspect into human terms, not jargon.
- the input json includes person_a_name and person_b_name. ONE shared reading is shown to BOTH people, so NEVER write "your" or "their" for anything chart-specific. always attribute planets and placements by name: "ren's moon", "maya's mars". collective address ("you two", "between you") is fine for the relationship itself.
- in the aspect grid, person_a planets belong to person_a_name and person_b planets belong to person_b_name. never swap them.

OUTPUT FORMAT (STRICT)
return ONLY valid JSON, no prose around it, no markdown fences. this exact shape:
{
  "opening": "one or two sentences. a single resonant image for this specific pair, true to the relationship context above. lowercase.",
  "sections": [
    { "title": "the recognition", "body": "2-4 sentences on how they first register each other / the core gravitational pull, read through the relationship context. cite the sun/moon/ascendant/pluto contacts that matter." },
    { "title": "how you talk", "body": "2-4 sentences on mental + communication style between them. mercury contacts, air/fire/earth/water mismatch. where words land or miss." },
    { "title": "${l.sectionTitle}", "body": "${l.sectionGuide}" },${mechanicsSection}
    { "title": "the friction", "body": "2-4 sentences naming the real tension honestly, in terms true to the relationship context. the hard aspects (squares, oppositions), saturn/neptune/pluto contacts, and any compromise or supervision dynamics from pair_mechanics. what will actually chafe. do not soften it into nothing." },
    { "title": "what holds", "body": "2-4 sentences on durability + what this bond is good for, in terms true to the relationship context. saturn/jupiter contacts, the steady notes." }
  ],
  "verdict": "2-3 sentences. the honest shape of the whole thing. not a bow, not a horoscope. end on something true, including the question this pair has to answer.",
  "highlights": [
    { "aspect": "maya's Sun conjunction ren's Pluto", "meaning": "short human translation, lowercase, one line, true to the relationship context" },
    { "aspect": "ren's Moon trine maya's Sun", "meaning": "..." }
  ]
}

RULES FOR THE JSON
- pick exactly 3 MOST significant aspects for "highlights" (tightest orb + most personal planets), each with a one-line human meaning consistent with the relationship context.
- every section body is 2-3 concise sentences. be specific to THIS pair, never generic.
- keep the complete response under 4,000 characters. finish every field and close the JSON object before adding detail. completeness beats length.
- if the chart is hard, the verdict says so kindly. if it is easy, do not invent drama.
- output must parse as JSON. no trailing commas. NO text, notes, or commentary before or after the object. the response must start with { and end with }. nothing else. do not wrap it in markdown code fences.
- before responding, silently verify JSON.parse would succeed and that the final character is }.`;
}
