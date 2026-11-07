// Pair-level HARMONY: one deterministic number over two members' already-scored
// convergence results. Pure function, no LLM, no fetch, no D1. Same inputs in,
// byte-identical result out (unit-tested, including symmetry).
//
// The formula (documented in docs/CONVERGENCE.md §9):
//
//   For every axis where BOTH members have a convergence (>= T sources each,
//   by construction of the scorer; T is the member's adaptive triangulation
//   threshold, see the birth-data tier in score.ts):
//     srcNorm   = 3 if min(engines_a, engines_b) <= 3 else 4   // birth-data tier
//     srcMult   = min(1, min(|sources_a|, |sources_b|) / srcNorm)
//     w         = sqrt(strength_a * strength_b) * srcMult      // symmetric evidence weight
//
//   BIRTH-DATA TIER (docs/CONVERGENCE.md §11): when either member only has the
//   three birth-derived engines (astro, human design, gene keys), srcNorm drops
//   from 4 to 3 so a well-triangulated birth-only pair is not structurally
//   penalized for quizzes that were never taken. absence is absence, not zero.
//   confidence math is untouched: thin evidence still shrinks toward 50, it
//   just is not double-punished by an unreachable source count.
//     same sign:  agreement contribution = w * (1 - |v_a - v_b| / 2)
//     opposite:   contrast mass = w * (|v_a - v_b| / 2), split equally
//                 across agreeW/tensionW (score-neutral, confidence-bearing)
//
//   agreeW   = sum of agreement contributions + half unsigned contrast
//   tensionW = sum of signed tension contributions + half unsigned contrast
//
//   MECHANICAL PAIR EVIDENCE (docs/CONVERGENCE.md §10, lib/pair/index.ts):
//   the pair layer contributes signed items computed by pure lookup/gate math
//   (HD connection channels, gene keys wheel geometry, socionics intertype).
//   each item's weight is fixed and small, deduplicated by evidence class at
//   the source, and added directly to agreeW or tensionW. mechanics therefore
//   raises confidence too: a pair with real connection channels is genuinely
//   better-evidenced than one without.
//
//   raw        = agreeW / (agreeW + tensionW)                  // 0..1 balance
//   confidence = min(1, (agreeW + tensionW) / 1.2)             // how much shared evidence exists
//   score      = round(100 * (0.5 + (raw - 0.5) * confidence)) // shrinks toward 50 when thin
//
// Design notes:
// - Only convergences feed the number: a convergence already requires >= 3
//   independent engines agreeing about a person, so harmony is triangulated
//   evidence about triangulated evidence, never one loud quiz answer.
// - Thin data cannot fake certainty: with little shared signal, confidence
//   pulls the score toward 50 ("mixed sky"), and zero shared axes returns null.
// - A "tension" here is CONTRAST, not incompatibility. Opposite leans can be
//   complementary (a responder and an initiator often fit well), so unsupported
//   axis contrast is score-neutral while still raising evidence confidence and
//   appearing in the receipt. The bands and
//   labels below are weather, deliberately not a compatibility verdict, and the
//   relationship lens picks the framing word (house harmony for roommates, not
//   a romance percent).

import { AXES } from "./axes";
import type { Convergence, ConvergenceResult } from "./score";
import type { EnginePayloads } from "./index";
import type { RelationshipLens } from "../relationship";
import {
  buildPairMechanics,
  pairEvidence,
  type PairMechanics,
  type PairMechEvidence,
  type MechEvidenceItem,
} from "../pair";

export type HarmonyBand = "in step" | "fair weather" | "mixed sky" | "crosswinds" | "charged";

export type HarmonyAgreement = {
  axis: string;
  label: string;
  direction: string; // shared pole label
  weight: number;    // contribution, 0..1
};

export type HarmonyTension = {
  axis: string;
  label: string;
  a_direction: string;
  b_direction: string;
  weight: number;    // contribution, 0..1
};

export type HarmonyResult = {
  score: number;        // 0..100
  band: HarmonyBand;
  confidence: number;   // 0..1, how much shared triangulated evidence exists
  shared_axes: number;  // axes where both members converged
  engines: number;      // distinct engines behind the compared convergences (provenance microcopy)
  agreements: HarmonyAgreement[]; // ranked, strongest first
  tensions: HarmonyTension[];     // ranked, strongest first
  // mechanical pair facts that moved the number (lib/pair), ranked. absent
  // when the pair layer had nothing to say (back-compat with older cached
  // payloads and axis-only calls).
  mech_agreements?: MechEvidenceItem[];
  mech_tensions?: MechEvidenceItem[];
};

// Normalizers. SRC_NORM_FULL: with full coverage, 3 shared-min sources -> 0.75,
// 4+ -> 1 (more independent engines behind both people's convergences push the
// pair's evidence up). SRC_NORM_BIRTH: for a birth-data-only member (3 engines),
// 3-of-3 sources -> 1 and 2-of-3 -> ~0.67; the ceiling adapts to what exists.
// CONF_NORM: total contribution mass at which we consider the picture "full";
// two well-sourced shared axes (~0.5-0.7 each) reach it.
const SRC_NORM_FULL = 4;
const SRC_NORM_BIRTH = 3;
const CONF_NORM = 1.2;

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function axisOrder(id: string): number {
  return AXES.findIndex((a) => a.id === id);
}

export function bandFor(score: number): HarmonyBand {
  if (score >= 78) return "in step";
  if (score >= 62) return "fair weather";
  if (score >= 48) return "mixed sky";
  if (score >= 34) return "crosswinds";
  return "charged";
}

// The lens decides the WORD, never the number. Roommates get house harmony,
// not a romance-compatibility percent.
export function harmonyFraming(lens: RelationshipLens): string {
  switch (lens) {
    case "roommate": return "house harmony";
    case "collaborator": return "working harmony";
    case "family": return "family harmony";
    default: return "harmony";
  }
}

export type HarmonyOpts = {
  mech?: PairMechEvidence | null;
  // engines that produced ANY data for each member (ConvergenceResult
  // .engines_present). when either member is at or below 3 (the birth-data
  // tier), the source normalizer drops to 3 so triangulation within the
  // engines that EXIST is scored fairly. omitted -> classic full norm.
  enginesA?: number;
  enginesB?: number;
};

export function scoreHarmony(
  a: Convergence[],
  b: Convergence[],
  mechOrOpts?: PairMechEvidence | HarmonyOpts | null,
): HarmonyResult | null {
  // back-compat: third arg may be the bare mech evidence (pre-tier call sites
  // and tests) or the opts object.
  const opts: HarmonyOpts =
    mechOrOpts && ("agreements" in mechOrOpts || "tensions" in mechOrOpts)
      ? { mech: mechOrOpts as PairMechEvidence }
      : ((mechOrOpts as HarmonyOpts | null | undefined) ?? {});
  const mech = opts.mech ?? null;
  const minEngines = Math.min(opts.enginesA ?? 5, opts.enginesB ?? 5);
  const srcNorm = minEngines <= SRC_NORM_BIRTH ? SRC_NORM_BIRTH : SRC_NORM_FULL;
  const byAxis = new Map(a.map((c) => [c.axis, c]));
  const agreements: HarmonyAgreement[] = [];
  const tensions: HarmonyTension[] = [];
  const enginesSeen = new Set<string>();
  let agreeW = 0;
  let tensionW = 0;

  // iterate in fixed axis order so the output is deterministic regardless of
  // how the caller's convergence lists happen to be ranked.
  const bSorted = [...b].sort((x, y) => axisOrder(x.axis) - axisOrder(y.axis));
  for (const cb of bSorted) {
    const ca = byAxis.get(cb.axis);
    if (!ca) continue;
    const srcMult = Math.min(1, Math.min(ca.sources.length, cb.sources.length) / srcNorm);
    const w = Math.sqrt(ca.strength * cb.strength) * srcMult;
    if (w <= 0) continue;
    for (const s of ca.sources) enginesSeen.add(s);
    for (const s of cb.sources) enginesSeen.add(s);
    const sameSign = (ca.value >= 0) === (cb.value >= 0);
    if (sameSign) {
      const closeness = 1 - Math.abs(ca.value - cb.value) / 2;
      const contrib = round(w * closeness);
      agreeW += contrib;
      agreements.push({ axis: ca.axis, label: ca.label, direction: ca.direction, weight: contrib });
    } else {
      const separation = Math.abs(ca.value - cb.value) / 2;
      const contrib = round(w * separation);
      // A bipolar axis describes style, not pair valence. Opposite poles are
      // real contrast, so they belong in the tension receipt and add evidence
      // mass, but without an external compatibility table we cannot honestly
      // call responder+initiator (etc.) bad. Split that mass evenly around the
      // midpoint: contrast raises confidence while remaining score-neutral.
      // Defensibly signed pair mechanics may still move the score either way.
      agreeW += contrib / 2;
      tensionW += contrib / 2;
      tensions.push({
        axis: ca.axis,
        label: ca.label,
        a_direction: ca.direction,
        b_direction: cb.direction,
        weight: contrib,
      });
    }
  }

  // fold in the mechanical pair evidence. weights were fixed and capped at the
  // source (lib/pair pairEvidence); here they are plain mass on either side.
  const mechAgree = mech?.agreements ?? [];
  const mechTension = mech?.tensions ?? [];
  for (const it of mechAgree) agreeW += it.weight;
  for (const it of mechTension) tensionW += it.weight;

  const total = agreeW + tensionW;
  const sharedAxes = agreements.length + tensions.length;
  // mechanical evidence alone can carry a score when no convergence axes are
  // shared yet (e.g. one member has thin engine coverage but both have HD).
  if (total <= 0 || (sharedAxes === 0 && mechAgree.length + mechTension.length === 0)) return null;

  const raw = agreeW / total;
  const confidence = round(Math.min(1, total / CONF_NORM));
  const score = Math.round(100 * (0.5 + (raw - 0.5) * confidence));

  agreements.sort((x, y) => y.weight - x.weight || axisOrder(x.axis) - axisOrder(y.axis));
  tensions.sort((x, y) => y.weight - x.weight || axisOrder(x.axis) - axisOrder(y.axis));
  const mechSort = (x: MechEvidenceItem, y: MechEvidenceItem) =>
    y.weight - x.weight || (x.label < y.label ? -1 : 1);
  for (const it of [...mechAgree, ...mechTension]) enginesSeen.add(it.source);

  return {
    score,
    band: bandFor(score),
    confidence,
    shared_axes: sharedAxes,
    engines: enginesSeen.size,
    agreements,
    tensions,
    ...(mechAgree.length ? { mech_agreements: [...mechAgree].sort(mechSort) } : {}),
    ...(mechTension.length ? { mech_tensions: [...mechTension].sort(mechSort) } : {}),
  };
}

// The one canonical assembly path for every production harmony surface. It is
// intentionally pure: callers load the same four inputs, then this helper owns
// both mechanics construction and adaptive engine counts. This prevents graph,
// endpoint, and narrative callers from silently omitting evidence tiers.
export type CanonicalPairHarmony = {
  harmony: HarmonyResult | null;
  mechanics: PairMechanics;
};

export function computePairHarmony(
  a: Pick<ConvergenceResult, "convergences" | "engines_present">,
  b: Pick<ConvergenceResult, "convergences" | "engines_present">,
  payloadsA: EnginePayloads,
  payloadsB: EnginePayloads,
): CanonicalPairHarmony {
  const mechanics = buildPairMechanics(payloadsA, payloadsB);
  const countEngines = (p: EnginePayloads) =>
    [p.astro, p.human_design, p.gene_keys, p.enneagram, p.socionics].filter(Boolean).length;
  return {
    harmony: scoreHarmony(a.convergences, b.convergences, {
      mech: pairEvidence(mechanics),
      enginesA: a.engines_present ?? countEngines(payloadsA),
      enginesB: b.engines_present ?? countEngines(payloadsB),
    }),
    mechanics,
  };
}

// -----------------------------------------------------------------------------
// The verdict line: blunt, declarative, screenshot-length (co-star register,
// docs/COSTAR-NOTES.md). Built verbatim from the ranked lists, no model. Axis
// ids map to plain household nouns so the sentence reads like a person said it,
// not like an instrument printed it.
// -----------------------------------------------------------------------------
const AXIS_NOUN: Record<string, string> = {
  initiation: "who moves first",
  recognition: "being seen",
  authority_locus: "where the yes comes from",
  emotional_tempo: "emotional weather",
  structure: "plans",
  conflict: "how you fight",
  energy: "pace",
  sensitivity: "how much the room gets in",
  time_orientation: "now versus later",
  self_narrative: "the story you each tell",
  head_heart: "head versus heart",
  abstraction: "ideas versus things",
};

export function axisNoun(axis: string): string {
  return AXIS_NOUN[axis] ?? axis.replace(/_/g, " ");
}

// Short human phrases for mechanical evidence sources, used when the score is
// carried by mechanics alone (common for birth-data-tier pairs with quiet
// axis overlap). Still verbatim-deterministic, no model.
function mechNoun(item: MechEvidenceItem): string {
  if (item.source === "human_design") {
    if (item.label.startsWith("companionship")) return "the channels you share";
    if (item.label.startsWith("compromise")) return "the wiring where one of you overrides the other";
    return "the wiring between your charts";
  }
  if (item.source === "gene_keys") return "the wheel geometry between you";
  return "the shape of your two types";
}

export function verdictLine(h: HarmonyResult): string {
  const agree = h.agreements[0];
  const tension = h.tensions[0];
  if (agree && tension) return `you agree on ${axisNoun(agree.axis)} and differ on ${axisNoun(tension.axis)}.`;
  if (agree && h.agreements[1]) return `you agree on ${axisNoun(agree.axis)} and on ${axisNoun(h.agreements[1].axis)}. no real friction yet.`;
  if (agree) return `you agree on ${axisNoun(agree.axis)}. that is the whole overlap so far.`;
  if (tension && h.tensions[1]) return `you differ on ${axisNoun(tension.axis)} and on ${axisNoun(h.tensions[1].axis)}.`;
  if (tension) return `you differ on ${axisNoun(tension.axis)}. that is the loudest thing between you.`;
  // no shared axes: the number is carried by mechanical pair evidence.
  const mAgree = h.mech_agreements?.[0];
  const mTension = h.mech_tensions?.[0];
  if (mAgree && mTension) return `${mechNoun(mAgree)} pulls you together; ${mechNoun(mTension)} pulls the other way.`;
  if (mAgree) return `what holds you is ${mechNoun(mAgree)}.`;
  if (mTension) return `the loudest thing between you is ${mechNoun(mTension)}.`;
  return "not enough shared ground to call it yet.";
}
