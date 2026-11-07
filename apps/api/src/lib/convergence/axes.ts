// The shared trait space.
//
// Five typology engines describe one person in five private vocabularies. To ask
// where they AGREE and where they OPPOSE, we first need one bounded language they
// can all be translated into. That language is these axes.
//
// Design rules for an axis:
//   - It is a spectrum from a negative pole (-1) to a positive pole (+1), with a
//     neutral middle (0). Neither pole is "better". This is self-knowledge, not a
//     scorecard, so pole names must be non-judgmental.
//   - At least two engines must be able to speak to it. An axis only one engine
//     can reach cannot converge or tense with anything, so it earns no place.
//   - It must be conceptually crisp enough that a mapper can defend a sign and a
//     weight with a one-line rationale (see mappers + docs/CONVERGENCE.md).
//
// We keep the count small (12). More axes would spread thin coverage thinner and
// manufacture the appearance of breadth without adding real triangulation.

export type Axis = {
  id: string;
  label: string;        // lowercase, house voice
  negative_pole: string;
  positive_pole: string;
  description: string;
};

export const AXES: Axis[] = [
  {
    id: "initiation",
    label: "initiation and response",
    negative_pole: "responsive",
    positive_pole: "initiating",
    description:
      "do you move first, or does the world move and you answer. not drive versus laziness, but the natural direction of the first step.",
  },
  {
    id: "recognition",
    label: "recognition",
    negative_pole: "self-contained",
    positive_pole: "needs to be seen",
    description:
      "how much your sense of being alright depends on being noticed, invited, or acknowledged by others.",
  },
  {
    id: "authority_locus",
    label: "where your yes lives",
    negative_pole: "outer or heady",
    positive_pole: "inner or gut",
    description:
      "when a real decision comes, where the trustworthy signal comes from: an internal bodily knowing, or reasoning, rules, and other people.",
  },
  {
    id: "emotional_tempo",
    label: "emotional tempo",
    negative_pole: "steady in the moment",
    positive_pole: "moves in waves",
    description:
      "whether your feeling-state resolves quickly and cleanly, or swells and takes time before it is clear.",
  },
  {
    id: "structure",
    label: "structure and improvisation",
    negative_pole: "improvises",
    positive_pole: "builds structure",
    description:
      "do you reach for order, method, and a plan, or stay loose and let the shape emerge as you go.",
  },
  {
    id: "conflict",
    label: "conflict posture",
    negative_pole: "avoids and smooths",
    positive_pole: "meets it head on",
    description:
      "when tension is in the room, do you move toward it and press, or move around it and keep the peace.",
  },
  {
    id: "energy",
    label: "energy sustainability",
    negative_pole: "paces and conserves",
    positive_pole: "renewable engine",
    description:
      "whether you carry a deep renewable capacity for sustained work, or run on a limited store you must husband.",
  },
  {
    id: "sensitivity",
    label: "sensitivity to environment",
    negative_pole: "insulated",
    positive_pole: "porous",
    description:
      "how much the mood, energy, and pressure of a room passes through you rather than stopping at your skin.",
  },
  {
    id: "time_orientation",
    label: "time orientation",
    negative_pole: "present and immediate",
    positive_pole: "future and unfolding",
    description:
      "whether your attention rests in the concrete now, or runs ahead into how things will ripen and arrive.",
  },
  {
    id: "self_narrative",
    label: "the story you tell about yourself",
    negative_pole: "settled",
    positive_pole: "prone to distortion",
    description:
      "how strongly a fixed inner story bends what you see. everyone has one; this is how loud and load-bearing yours tends to run.",
  },
  {
    id: "head_heart",
    label: "head and heart",
    negative_pole: "leads with logic",
    positive_pole: "leads with feeling",
    description:
      "when you weigh something, which lands first and carries more: the logic of it, or the feeling of it.",
  },
  {
    id: "abstraction",
    label: "abstraction and the concrete",
    negative_pole: "grounded in the concrete",
    positive_pole: "drawn to the abstract",
    description:
      "whether your mind reaches first for what is tangible and actual, or for patterns, possibilities, and what could be.",
  },
];

export const AXIS_BY_ID: Record<string, Axis> = Object.fromEntries(
  AXES.map((a) => [a.id, a]),
);

export type Signal = {
  axis: string; // an AXES id
  value: number; // -1..1, clamped
  weight: number; // 0..1, how strongly this engine speaks to this axis
  evidence: string; // human-readable, house voice, always present
  source: SignalSource;
};

export type SignalSource =
  | "astro"
  | "human_design"
  | "gene_keys"
  | "enneagram"
  | "socionics";

// Guardrails used by every mapper so a bad payload can never emit a poisoned
// signal into the scorer.
export function clampValue(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(-1, Math.min(1, v));
}
export function clampWeight(w: number): number {
  if (!Number.isFinite(w)) return 0;
  return Math.max(0, Math.min(1, w));
}

// A mapper only ever returns well-formed signals for known axes with real
// weight. This is the last line of defense between a noisy engine payload and
// the deterministic scorer.
export function makeSignal(
  source: SignalSource,
  axis: string,
  value: number,
  weight: number,
  evidence: string,
): Signal | null {
  if (!AXIS_BY_ID[axis]) return null;
  const w = clampWeight(weight);
  if (w <= 0) return null;
  if (!evidence || !evidence.trim()) return null;
  return { axis, value: clampValue(value), weight: w, evidence: evidence.trim(), source };
}
