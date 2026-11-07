// The scorer: turn a pile of per-engine signals into convergences and tensions.
//
// This is pure, deterministic code. Same signals in, byte-identical result out
// (see the determinism unit test). No LLM anywhere near this file. The LLM only
// ever writes prose OVER the object this produces.
//
// Definitions:
//   convergence = >= T DISTINCT sources land on one axis in the same direction,
//     within a tight band, where T adapts to how many engines produced data at
//     all (the BIRTH-DATA TIER, docs/CONVERGENCE.md §11):
//       T = 3 when 4+ engines are present (the full-coverage rule, unchanged)
//       T = 2 when 3 or fewer engines are present (quiz engines are quiz-gated;
//           a member with only birth data has at most astro + human design +
//           gene keys, and demanding 3-of-3 there would make triangulation
//           nearly unreachable. 2-of-3 among present engines counts, and the
//           strength formula already scores 2-source convergences lower.)
//     Absent engines are ABSENT, never zero: they cannot vote against an axis,
//     they simply do not appear in coverage.
//     Ranked by (weighted agreement x number of independent sources) so four
//     systems agreeing outranks two agreeing hard.
//   tension = >= 2 DISTINCT sources materially OPPOSED on one axis (opposite
//     signs, both carrying real weight). Ranked by (weight product x separation).
//
// We never fabricate. If only 1-2 engines produced data at all, `coverage`
// reports it and the caller can be honest instead of dressing thin data as
// insight.

import { AXES, AXIS_BY_ID, type Signal, type SignalSource } from "./axes";

export type EvidenceItem = { source: SignalSource; evidence: string; value: number; weight: number };

export type Convergence = {
  axis: string;
  label: string;
  direction: string; // the pole label the sources point toward
  value: number;     // signed centroid, -1..1
  strength: number;  // 0..1 composite
  sources: SignalSource[];
  evidence: EvidenceItem[];
};

export type Tension = {
  axis: string;
  label: string;
  strength: number; // 0..1
  poles: [EvidenceItem, EvidenceItem]; // negative-leaning first, positive second
  question: string;
};

export type Coverage = Record<SignalSource, boolean>;

export type ConvergenceResult = {
  convergences: Convergence[];
  tensions: Tension[];
  coverage: Coverage;
  axes_touched: number;
  computed_at: number;
  // transparency for the birth-data tier: how many engines produced any data,
  // and the triangulation threshold that was therefore applied. optional for
  // back-compat with cached results scored before 2026-07-30.
  engines_present?: number;
  triangulation_threshold?: number;
};

const ALL_SOURCES: SignalSource[] = ["astro", "human_design", "gene_keys", "enneagram", "socionics"];

// A signal "leans" positive/negative only if it clears a small deadzone; a
// near-zero value is genuinely neutral and should not count toward agreement or
// opposition on either side.
const DEADZONE = 0.12;
// Two signals are "in the same band" (agreeing) when their values are within
// this distance. Tight enough that vague half-agreement does not qualify.
const AGREE_BAND = 0.6;
// A pole must carry at least this weight to be allowed to create a tension. Two
// features whispering in opposite directions are not a real tension. In the
// birth-data tier (<= 3 engines present) the floor drops so that astro's
// deliberately cautious weights (<= ~0.3) can still stand as one pole against
// human design: for a birth-only member, "the sky says you start, the body
// graph says you wait" IS the most interesting available content, and hiding
// it would leave the whole reading empty. See docs/CONVERGENCE.md §11.
const TENSION_MIN_WEIGHT_FULL = 0.35;
const TENSION_MIN_WEIGHT_BIRTH = 0.2;

function lean(v: number): -1 | 0 | 1 {
  if (v > DEADZONE) return 1;
  if (v < -DEADZONE) return -1;
  return 0;
}

// stable source ordering so output is deterministic regardless of input order.
function sortSources(a: SignalSource, b: SignalSource): number {
  return ALL_SOURCES.indexOf(a) - ALL_SOURCES.indexOf(b);
}

// For one axis, collapse each source to a single representative signal (its
// highest-weight one) so a chatty mapper cannot outvote a quiet one by volume.
function collapsePerSource(signals: Signal[]): Signal[] {
  const best = new Map<SignalSource, Signal>();
  for (const s of signals) {
    const cur = best.get(s.source);
    if (!cur || s.weight > cur.weight || (s.weight === cur.weight && s.evidence < cur.evidence)) {
      best.set(s.source, s);
    }
  }
  return [...best.values()].sort((a, b) => sortSources(a.source, b.source));
}

function poleLabel(axisId: string, value: number): string {
  const ax = AXIS_BY_ID[axisId];
  if (!ax) return "";
  return value >= 0 ? ax.positive_pole : ax.negative_pole;
}

function evItem(s: Signal): EvidenceItem {
  return { source: s.source, evidence: s.evidence, value: round(s.value), weight: round(s.weight) };
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

// tension questions: templated per axis, deliberately a little uncomfortable and
// unanswerable-glibly. The reading prompt is allowed to sharpen these; the
// deterministic default lives here so the API is complete without the LLM.
const TENSION_QUESTIONS: Record<string, string> = {
  initiation: "which one is true when you are tired: do you move first, or do you wait to be moved.",
  recognition: "when no one is watching, does the work still feel worth it.",
  authority_locus: "when your gut and your reasoning disagree, which one has actually been right.",
  emotional_tempo: "do you decide in the feeling, or after it passes. and which choices do you regret.",
  structure: "does the plan free you or trap you. be honest about the last time each was true.",
  conflict: "when it matters most, do you press or do you smooth. and who taught you that.",
  energy: "are you conserving, or are you hiding. how would you tell the difference.",
  sensitivity: "how much of what you feel in a room is actually yours.",
  time_orientation: "are you here right now, or already somewhere later.",
  self_narrative: "what is the story you keep telling about yourself that you have never once tested.",
  head_heart: "when they disagree, do you trust the reason or the feeling. which has cost you more.",
  abstraction: "do you reach for the idea to avoid the thing in front of you, or the reverse.",
};

function questionFor(axisId: string): string {
  return TENSION_QUESTIONS[axisId] ?? "which of these is true when it costs you something.";
}

export function scoreConvergence(signals: Signal[], computedAt: number): ConvergenceResult {
  // coverage: which sources produced ANY signal at all.
  const coverage = Object.fromEntries(ALL_SOURCES.map((s) => [s, false])) as Coverage;
  for (const s of signals) coverage[s.source] = true;

  // The birth-data tier: adapt the triangulation threshold to the engines that
  // actually have data. 4+ engines -> classic 3-source rule. 3 or fewer (the
  // birth-only member: astro + hd + gene keys, quizzes not taken) -> 2-of-
  // present counts as triangulated. Documented in docs/CONVERGENCE.md §11.
  const enginesPresent = Object.values(coverage).filter(Boolean).length;
  const threshold = enginesPresent >= 4 ? 3 : 2;
  const tensionMinWeight = enginesPresent >= 4 ? TENSION_MIN_WEIGHT_FULL : TENSION_MIN_WEIGHT_BIRTH;

  const convergences: Convergence[] = [];
  const tensions: Tension[] = [];
  const axesTouched = new Set<string>();

  // process axes in a fixed order for deterministic output.
  for (const ax of AXES) {
    const axisSignals = signals.filter((s) => s.axis === ax.id);
    if (axisSignals.length === 0) continue;
    axesTouched.add(ax.id);
    const perSource = collapsePerSource(axisSignals);

    // --- convergence ------------------------------------------------------
    // group the leaning signals by sign, require >= threshold distinct sources
    // within the agreement band around their weighted centroid.
    for (const sign of [1, -1] as const) {
      const group = perSource.filter((s) => lean(s.value) === sign);
      if (group.length < threshold) continue;
      // weighted centroid of the group
      const wsum = group.reduce((a, s) => a + s.weight, 0);
      const centroid = wsum > 0 ? group.reduce((a, s) => a + s.value * s.weight, 0) / wsum : 0;
      // keep only members within the band of the centroid (drop stragglers that
      // technically share a sign but disagree in magnitude).
      const band = group.filter((s) => Math.abs(s.value - centroid) <= AGREE_BAND);
      if (band.length < threshold) continue;

      const nSources = band.length;
      const bandWsum = band.reduce((a, s) => a + s.weight, 0);
      const meanWeight = bandWsum / nSources;
      const bandCentroid = band.reduce((a, s) => a + s.value * s.weight, 0) / bandWsum;
      // strength: weighted agreement x independent-source bonus. More sources
      // and higher weight both push it up. Normalized into 0..1 with a soft cap.
      const sourceBonus = Math.min(1, (nSources - 2) / 3); // 3 src ->0.33, 5 src ->1
      const strength = round(Math.min(1, meanWeight * (0.6 + 0.4 * sourceBonus) + 0.15 * sourceBonus));

      convergences.push({
        axis: ax.id,
        label: ax.label,
        direction: poleLabel(ax.id, bandCentroid),
        value: round(bandCentroid),
        strength,
        sources: band.map((s) => s.source).sort(sortSources),
        evidence: band.map(evItem),
      });
    }

    // --- tension ----------------------------------------------------------
    // strongest positive-leaning vs strongest negative-leaning, both above the
    // weight floor. One tension per axis (the sharpest opposition).
    const pos = perSource
      .filter((s) => lean(s.value) === 1 && s.weight >= tensionMinWeight)
      .sort((a, b) => b.weight - a.weight || sortSources(a.source, b.source))[0];
    const neg = perSource
      .filter((s) => lean(s.value) === -1 && s.weight >= tensionMinWeight)
      .sort((a, b) => b.weight - a.weight || sortSources(a.source, b.source))[0];
    if (pos && neg) {
      const separation = Math.abs(pos.value - neg.value); // 0..2
      const strength = round(Math.min(1, pos.weight * neg.weight * (separation / 2) * 2.2));
      tensions.push({
        axis: ax.id,
        label: ax.label,
        strength,
        poles: [evItem(neg), evItem(pos)],
        question: questionFor(ax.id),
      });
    }
  }

  // rank. convergence: strength desc, then more sources, then axis order for
  // determinism. tension: strength desc, then axis order.
  const axisOrder = (id: string) => AXES.findIndex((a) => a.id === id);
  convergences.sort(
    (a, b) => b.strength - a.strength || b.sources.length - a.sources.length || axisOrder(a.axis) - axisOrder(b.axis),
  );
  tensions.sort((a, b) => b.strength - a.strength || axisOrder(a.axis) - axisOrder(b.axis));

  return {
    convergences,
    tensions,
    coverage,
    axes_touched: axesTouched.size,
    computed_at: computedAt,
    engines_present: enginesPresent,
    triangulation_threshold: threshold,
  };
}

// A stable string of the source payloads, used both for the inputs_hash (cache
// invalidation) and to guarantee scoring is a pure function of its inputs.
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}
function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return Object.keys(o)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = sortKeys(o[k]);
        return acc;
      }, {});
  }
  return v;
}

// FNV-1a 32-bit hash over the stable-stringified inputs. Cheap, dependency-free,
// good enough to detect "did any source engine's payload change".
export function inputsHash(payloads: Record<string, unknown>): string {
  const s = stableStringify(payloads);
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
