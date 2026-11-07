// Unit tests for the pair harmony scorer (lib/convergence/harmony.ts).
// Run: npx tsx apps/api/test/harmony.test.ts   (from repo root)
//
// Asserts:
//   1. DETERMINISM: same inputs twice -> byte-identical result.
//   2. SYMMETRY: harmony(a,b) score/band/confidence == harmony(b,a).
//   3. Aligned convergences -> high score with ranked agreements.
//   4. Opposed convergences -> low score with ranked tensions.
//   5. No shared axes -> null (never a fabricated number).
//   6. Thin shared evidence -> confidence < 1 pulls the score toward 50.
//   7. Band boundaries are exact.
//   8. Lens picks the framing word, never the number.

import { scoreHarmony, computePairHarmony, bandFor, harmonyFraming, verdictLine, axisNoun } from "../src/lib/convergence/harmony";
import { pairEvidence } from "../src/lib/pair";
import type { Convergence } from "../src/lib/convergence/score";

let failures = 0;
let checks = 0;
function ok(cond: boolean, msg: string) {
  checks++;
  if (!cond) {
    failures++;
    console.error("  FAIL:", msg);
  }
}

function conv(axis: string, label: string, value: number, strength: number, nSources: number, direction: string): Convergence {
  const SOURCES = ["human_design", "enneagram", "socionics", "astro", "gene_keys"] as const;
  return {
    axis,
    label,
    direction,
    value,
    strength,
    sources: SOURCES.slice(0, nSources) as unknown as Convergence["sources"],
    evidence: [],
  };
}

// Person A: responsive, porous, feeling-led. Person B: same leans, close values.
const A_ALIGNED: Convergence[] = [
  conv("initiation", "initiation and response", -0.7, 0.8, 4, "responsive"),
  conv("sensitivity", "sensitivity to environment", 0.6, 0.7, 3, "porous"),
  conv("head_heart", "head and heart", 0.5, 0.6, 3, "leads with feeling"),
];
const B_ALIGNED: Convergence[] = [
  conv("initiation", "initiation and response", -0.6, 0.75, 4, "responsive"),
  conv("sensitivity", "sensitivity to environment", 0.55, 0.65, 4, "porous"),
  conv("head_heart", "head and heart", 0.45, 0.55, 3, "leads with feeling"),
];

// Person C: opposed to A on every shared axis, decisively.
const C_OPPOSED: Convergence[] = [
  conv("initiation", "initiation and response", 0.8, 0.8, 4, "initiating"),
  conv("sensitivity", "sensitivity to environment", -0.6, 0.7, 4, "insulated"),
  conv("head_heart", "head and heart", -0.55, 0.65, 3, "leads with logic"),
];

// Person D: converges only on axes A does not touch.
const D_DISJOINT: Convergence[] = [
  conv("structure", "structure and improvisation", 0.5, 0.6, 3, "builds structure"),
  conv("energy", "energy sustainability", 0.7, 0.8, 3, "renewable engine"),
];

// Thin: one weak shared axis only.
const A_THIN: Convergence[] = [conv("conflict", "conflict posture", 0.3, 0.4, 3, "meets it head on")];
const B_THIN: Convergence[] = [conv("conflict", "conflict posture", 0.25, 0.4, 3, "meets it head on")];

console.log("determinism + symmetry");
{
  const r1 = scoreHarmony(A_ALIGNED, B_ALIGNED);
  const r2 = scoreHarmony(A_ALIGNED, B_ALIGNED);
  ok(JSON.stringify(r1) === JSON.stringify(r2), "same inputs twice -> byte-identical result");
  const fwd = scoreHarmony(A_ALIGNED, B_ALIGNED);
  const rev = scoreHarmony(B_ALIGNED, A_ALIGNED);
  ok(!!fwd && !!rev, "both orders produce a result");
  ok(fwd!.score === rev!.score, `symmetric score (${fwd!.score} vs ${rev!.score})`);
  ok(fwd!.band === rev!.band, "symmetric band");
  ok(fwd!.confidence === rev!.confidence, "symmetric confidence");
  ok(fwd!.shared_axes === rev!.shared_axes, "symmetric shared_axes");
}

console.log("aligned pair -> high harmony");
{
  const r = scoreHarmony(A_ALIGNED, B_ALIGNED);
  ok(!!r, "result exists");
  ok(r!.score >= 70, `aligned pair scores high (got ${r!.score})`);
  ok(r!.agreements.length === 3, `three agreements (got ${r!.agreements.length})`);
  ok(r!.tensions.length === 0, "no tensions");
  ok(r!.agreements[0].weight >= r!.agreements[1].weight, "agreements ranked by weight");
  ok(r!.agreements[0].axis === "initiation", "strongest agreement is the best-sourced, strongest axis");
  ok(r!.shared_axes === 3, "shared_axes counts every compared axis");
}

console.log("opposed pair -> neutral contrast, not invented incompatibility");
{
  const r = scoreHarmony(A_ALIGNED, C_OPPOSED);
  ok(!!r, "result exists");
  ok(r!.score === 50, `unsigned opposite-pole contrast stays exactly neutral (got ${r!.score})`);
  ok(r!.tensions.length === 3, `three tensions (got ${r!.tensions.length})`);
  ok(r!.agreements.length === 0, "no agreements");
  ok(r!.tensions[0].weight >= r!.tensions[1].weight, "tensions ranked by weight");
  const t = r!.tensions.find((x) => x.axis === "initiation");
  ok(!!t && t.a_direction === "responsive" && t.b_direction === "initiating", "tension carries both pole labels");
}

console.log("no shared axes -> null, never a fabricated number");
{
  ok(scoreHarmony(A_ALIGNED, D_DISJOINT) === null, "disjoint axes -> null");
  ok(scoreHarmony([], B_ALIGNED) === null, "empty side -> null");
  ok(scoreHarmony([], []) === null, "both empty -> null");
}

console.log("thin shared evidence -> shrinks toward 50");
{
  const r = scoreHarmony(A_THIN, B_THIN);
  ok(!!r, "thin result exists");
  ok(r!.confidence < 0.5, `thin evidence has low confidence (got ${r!.confidence})`);
  ok(Math.abs(r!.score - 50) < 25, `thin score stays near 50 (got ${r!.score})`);
  const strong = scoreHarmony(A_ALIGNED, B_ALIGNED)!;
  ok(strong.confidence > r!.confidence, "rich shared evidence -> higher confidence");
  ok(Math.abs(strong.score - 50) > Math.abs(r!.score - 50), "rich evidence moves further from 50");
}

console.log("canonical assembly: graph/pair equality + mechanics + birth tier");
{
  const hd = (gates: number[]) => ({ gates: { personality: gates.map((gate) => ({ gate })), design: [] } });
  const pa = { astro: {}, human_design: hd([34, 57, 18, 58]), gene_keys: {} };
  const pb = { astro: {}, human_design: hd([58]), gene_keys: {} };
  const ra = { convergences: A_THIN, engines_present: 3 };
  const rb = { convergences: B_THIN, engines_present: 3 };
  // These model the graph and pair surfaces: both must call the same helper.
  const graph = computePairHarmony(ra, rb, pa, pb);
  const endpoint = computePairHarmony(ra, rb, pa, pb);
  ok(JSON.stringify(graph) === JSON.stringify(endpoint), "graph and pair endpoint get byte-identical canonical output");
  ok((graph.harmony?.mech_tensions?.length ?? 0) === 1, "canonical helper includes HD compromise mechanics");
  ok(graph.harmony?.engines === 3, "provenance includes convergence and mechanical engines without double-counting");
  const manualBirth = scoreHarmony(A_THIN, B_THIN, {
    mech: pairEvidence(graph.mechanics), enginesA: 3, enginesB: 3,
  });
  ok(JSON.stringify(graph.harmony) === JSON.stringify(manualBirth), "canonical helper includes birth-tier engine counts");
  const fullTier = scoreHarmony(A_THIN, B_THIN, {
    mech: pairEvidence(graph.mechanics), enginesA: 5, enginesB: 5,
  });
  ok(graph.harmony!.confidence > fullTier!.confidence, "birth-tier source normalizer changes confidence when source count is reachable");
  const rev = computePairHarmony(rb, ra, pb, pa).harmony!;
  ok(graph.harmony!.score === rev.score && graph.harmony!.confidence === rev.confidence, "canonical result is symmetric");
}

console.log("fixtures span below / at / above 50");
{
  const below = scoreHarmony([], [], { agreements: [], tensions: [{ source: "socionics", label: "conflict", weight: 0.3 }] })!;
  const at = scoreHarmony(A_ALIGNED, C_OPPOSED)!;
  const above = scoreHarmony(A_ALIGNED, B_ALIGNED)!;
  ok(below.score < 50 && at.score === 50 && above.score > 50, `fixtures span midpoint (${below.score}/${at.score}/${above.score})`);
}

console.log("band boundaries");
{
  ok(bandFor(78) === "in step" && bandFor(100) === "in step", "78+ in step");
  ok(bandFor(62) === "fair weather" && bandFor(77) === "fair weather", "62-77 fair weather");
  ok(bandFor(48) === "mixed sky" && bandFor(61) === "mixed sky", "48-61 mixed sky");
  ok(bandFor(34) === "crosswinds" && bandFor(47) === "crosswinds", "34-47 crosswinds");
  ok(bandFor(0) === "charged" && bandFor(33) === "charged", "0-33 charged");
}

console.log("provenance + verdict line");
{
  const r = scoreHarmony(A_ALIGNED, B_ALIGNED)!;
  ok(r.engines >= 4, `engines counts distinct sources behind the comparison (got ${r.engines})`);
  const v = verdictLine(r);
  ok(v === "you agree on who moves first and on how much the room gets in. no real friction yet.", `all-agree verdict is blunt + specific (got: ${v})`);
  const mixed = scoreHarmony(A_ALIGNED, C_OPPOSED)!;
  const vm = verdictLine(mixed);
  ok(vm === "you differ on who moves first and on how much the room gets in.", `all-tension verdict names both axes (got: ${vm})`);
  ok(!/percent|%|compatib/i.test(v + vm), "verdicts never speak in compatibility-percent");
  ok(axisNoun("energy") === "pace" && axisNoun("conflict") === "how you fight", "axis nouns read like speech");
  // deterministic: same input, same sentence.
  ok(verdictLine(r) === verdictLine(scoreHarmony(A_ALIGNED, B_ALIGNED)!), "verdict is deterministic");
}

console.log("lens picks the word, never the number");
{
  ok(harmonyFraming("roommate") === "house harmony", "roommate -> house harmony");
  ok(harmonyFraming("collaborator") === "working harmony", "collaborator -> working harmony");
  ok(harmonyFraming("family") === "family harmony", "family -> family harmony");
  ok(harmonyFraming("friend") === "harmony", "friend -> plain harmony");
  ok(harmonyFraming("romantic") === "harmony", "romantic -> plain harmony (no compatibility percent)");
  ok(harmonyFraming("unspecified") === "harmony", "unspecified -> plain harmony");
}

if (failures > 0) {
  console.error(`\nFAIL ${failures}/${checks} checks failed`);
  process.exit(1);
}
console.log(`\nPASS ${checks}/${checks} checks`);
