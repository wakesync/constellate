// The birth-data-only tier (docs/CONVERGENCE.md §11): a member with only the
// three birth-derived engines (astro, human design, gene keys) must get a
// complete, honest convergence + pair + harmony path with zero quiz data.
// Run: npx tsx apps/api/test/birth-tier.test.ts   (from repo root)
//
// Asserts:
//   1. threshold adapts: 3 engines present -> 2-of-3 triangulates; 4+ engines
//      present -> the classic 3-source rule still holds.
//   2. absence is absence: absent engines never appear in coverage/sources,
//      and adding a quiz engine can only add information, not flip signs.
//   3. harmony: birth-tier source normalizer (3 instead of 4) lifts an
//      otherwise-identical birth-only pair vs the full norm, while confidence
//      still shrinks thin evidence toward 50.
//   4. end-to-end: a realistic birth-only person (real payload shapes through
//      the real mappers) produces convergences, pair comparison, harmony with
//      mech evidence, and a digest that never mentions quiz engines.

import { computeConvergence, computeSignals, type EnginePayloads } from "../src/lib/convergence";
import { scoreConvergence } from "../src/lib/convergence/score";
import { scoreHarmony, verdictLine } from "../src/lib/convergence/harmony";
import type { Signal } from "../src/lib/convergence/axes";
import { buildPairMechanics, pairEvidence, mechanicsDigest } from "../src/lib/pair";

let failures = 0;
let checks = 0;
function ok(cond: boolean, msg: string) {
  checks++;
  if (!cond) {
    failures++;
    console.error("  FAIL:", msg);
  }
}

const sig = (source: Signal["source"], axis: string, value: number, weight = 0.7): Signal => ({
  axis, value, weight, evidence: `${source} says ${axis} ${value}`, source,
});

// ---------------------------------------------------------------------------
console.log("threshold adapts to engines present");
{
  // 3 engines (birth tier), 2 agree on initiation: triangulated.
  const birthSignals = [
    sig("astro", "initiation", 0.4),
    sig("human_design", "initiation", 0.6),
    sig("gene_keys", "self_narrative", 0.3),
  ];
  const r = scoreConvergence(birthSignals, 1753400000);
  ok(r.engines_present === 3 && r.triangulation_threshold === 2, `3 engines -> threshold 2 (got ${r.engines_present}/${r.triangulation_threshold})`);
  const init = r.convergences.find((c) => c.axis === "initiation");
  ok(!!init && init.sources.length === 2, "2-of-3 counts as a convergence in the birth tier");

  // same signals PLUS a quiet fourth engine present on another axis: the
  // threshold goes back to 3 and the 2-source agreement no longer converges.
  const withQuiz = [...birthSignals, sig("enneagram", "structure", 0.5)];
  const r4 = scoreConvergence(withQuiz, 1753400000);
  ok(r4.engines_present === 4 && r4.triangulation_threshold === 3, "4 engines -> classic threshold 3");
  ok(!r4.convergences.find((c) => c.axis === "initiation"), "2 sources do not converge under the full rule");

  // 4 engines where 3 agree still converges (unchanged behavior).
  const threeAgree = [...withQuiz, sig("enneagram", "initiation", 0.5)];
  const r5 = scoreConvergence(threeAgree, 1753400000);
  ok(!!r5.convergences.find((c) => c.axis === "initiation" && c.sources.length === 3), "3-of-4 converges as before");
}

console.log("birth-tier tension floor: astro can stand as a pole");
{
  // astro's cautious weights (~0.25) vs HD: under the full floor (0.35) this
  // is invisible; in the birth tier it is the reading's most interesting fact.
  const s = [
    sig("astro", "initiation", 0.35, 0.25),
    sig("human_design", "initiation", -0.7, 0.85),
    sig("gene_keys", "self_narrative", 0.3, 0.3),
  ];
  const r = scoreConvergence(s, 1753400000);
  ok(r.tensions.some((t) => t.axis === "initiation"), "astro-vs-hd opposition registers as a tension in the birth tier");
  // same signals with a 4th engine present: the full floor applies again.
  const r4 = scoreConvergence([...s, sig("enneagram", "structure", 0.5, 0.6)], 1753400000);
  ok(!r4.tensions.some((t) => t.axis === "initiation"), "under full coverage the 0.35 floor still filters whisper-weight poles");
}

console.log("absence is absence, never zero");
{
  const birthSignals = [
    sig("astro", "initiation", 0.4),
    sig("human_design", "initiation", 0.6),
    sig("gene_keys", "initiation", 0.5),
  ];
  const r = scoreConvergence(birthSignals, 1753400000);
  ok(r.coverage.enneagram === false && r.coverage.socionics === false, "quiz engines report absent in coverage");
  const init = r.convergences.find((c) => c.axis === "initiation")!;
  ok(!init.sources.includes("enneagram" as never) && !init.sources.includes("socionics" as never), "absent engines never appear as sources");
  // no penalty axes: every axis in the result was actually spoken to.
  ok(r.convergences.every((c) => c.evidence.length === c.sources.length), "every convergence source has real evidence");
  // determinism.
  ok(JSON.stringify(scoreConvergence(birthSignals, 1753400000)) === JSON.stringify(r), "birth-tier scoring is deterministic");
}

console.log("harmony: birth-tier normalizer + honest confidence");
{
  const conv = (axis: string, value: number, nSources: number) => ({
    axis, label: axis, direction: "x", value, strength: 0.6,
    sources: (["astro", "human_design", "gene_keys", "enneagram", "socionics"] as const).slice(0, nSources) as never[],
    evidence: [],
  });
  // identical 3-source agreement, scored under the full norm vs the birth norm.
  const A = [conv("initiation", 0.5, 3), conv("structure", 0.4, 3)];
  const B = [conv("initiation", 0.6, 3), conv("structure", 0.5, 3)];
  const full = scoreHarmony(A, B, { enginesA: 5, enginesB: 5 })!;
  const birth = scoreHarmony(A, B, { enginesA: 3, enginesB: 3 })!;
  ok(birth.confidence > full.confidence, `birth norm lifts confidence for the same 3-source evidence (${full.confidence} -> ${birth.confidence})`);
  // pure-agreement fixture: raw balance = 1 both ways, so any score shift is
  // confidence expressing itself, and the verdict direction cannot flip.
  ok(birth.band === full.band && Math.sign(birth.score - 50) === Math.sign(full.score - 50), "score shift is a confidence effect, the verdict direction never flips");
  // asymmetric: one full member + one birth-only member -> birth norm applies
  // (the thinner member sets the ceiling).
  const mixed = scoreHarmony(A, B, { enginesA: 5, enginesB: 3 })!;
  ok(mixed.confidence === birth.confidence, "min(enginesA, enginesB) drives the normalizer");
  // 2-source convergences (birth-tier output) still register under the birth norm.
  const A2 = [conv("initiation", 0.5, 2)];
  const B2 = [conv("initiation", 0.6, 2)];
  const thin = scoreHarmony(A2, B2, { enginesA: 3, enginesB: 3 })!;
  ok(thin !== null && thin.score > 50, "a 2-source birth-tier agreement produces a usable score");
  ok(thin.confidence < birth.confidence, "thinner evidence still means lower confidence (shrinks toward 50)");
  // back-compat: bare mech third arg still works.
  const bareMech = scoreHarmony(A, B, { agreements: [{ source: "socionics", label: "x", weight: 0.1 }], tensions: [] });
  ok(bareMech !== null && (bareMech.mech_agreements?.length ?? 0) === 1, "legacy mech-evidence call shape still accepted");
  // determinism + symmetry under the new opts.
  ok(JSON.stringify(scoreHarmony(A, B, { enginesA: 3, enginesB: 3 })) === JSON.stringify(scoreHarmony(A, B, { enginesA: 3, enginesB: 3 })), "deterministic");
  const sym = scoreHarmony(B, A, { enginesA: 3, enginesB: 3 })!;
  ok(sym.score === birth.score && sym.confidence === birth.confidence, "symmetric under the birth norm");

  // verdict for a mechanics-only pair (zero shared axes): concrete, not the
  // "not enough shared ground" shrug, and still deterministic.
  const mechOnly = scoreHarmony([], [], {
    mech: {
      agreements: [{ source: "human_design" as const, label: "companionship channel 34-57 (power): both carry it, shared ground", weight: 0.1 }],
      tensions: [{ source: "human_design" as const, label: "compromise channel 13-33 (the prodigal): one side's full channel overrides the other's half", weight: 0.12 }],
    },
    enginesA: 3,
    enginesB: 3,
  })!;
  const v = verdictLine(mechOnly);
  ok(v.includes("channels you share") && v.includes("overrides"), `mech-only verdict is concrete (got: ${v})`);
  ok(v === verdictLine(mechOnly), "mech-only verdict deterministic");
}

// ---------------------------------------------------------------------------
console.log("end-to-end: a birth-only person through the real mappers");
{
  // realistic payload shapes (mirroring stored cache rows) for someone who has
  // ONLY entered birth data: natal chart + HD + GK, zero quiz rows.
  const birthOnly: EnginePayloads = {
    astro: {
      planets: [
        { name: "Sun", sign: "Aries" },
        { name: "Mars", sign: "Leo" },
        { name: "Moon", sign: "Taurus" },
      ],
    },
    human_design: {
      type: "Manifestor",
      authority: "Splenic",
      definition: "Single",
      centers: [
        { name: "Throat", defined: true },
        { name: "Spleen", defined: true },
        { name: "G", defined: true },
        { name: "Head", defined: false },
        { name: "Ajna", defined: false },
        { name: "Heart", defined: false },
        { name: "Sacral", defined: false },
        { name: "Solar Plexus", defined: false },
        { name: "Root", defined: false },
      ],
      open_centers: ["Head", "Ajna", "Heart", "Sacral", "Solar Plexus", "Root"],
      gates: { personality: [{ gate: 20 }, { gate: 57 }, { gate: 10 }], design: [{ gate: 34 }] },
    },
    gene_keys: {
      activation: {
        lifes_work: { gate: 20, line: 3 },
        evolution: { gate: 34, line: 3 },
        radiance: { gate: 10, line: 2 },
        purpose: { gate: 57, line: 2 },
      },
      keys: [
        { gate: 20, shadow: "Superficiality", gift: "Self Assurance", siddhi: "Presence" },
        { gate: 34, shadow: "Force", gift: "Strength", siddhi: "Majesty" },
        { gate: 10, shadow: "Self-Obsession", gift: "Naturalness", siddhi: "Being" },
        { gate: 57, shadow: "Unease", gift: "Intuition", siddhi: "Clarity" },
      ],
    },
    enneagram: null,
    socionics: null,
  };

  const signals = computeSignals(birthOnly);
  ok(signals.length > 0 && signals.every((s) => s.source !== "enneagram" && s.source !== "socionics"), "no quiz-engine signals exist for a birth-only person");
  const solo = computeConvergence(birthOnly, 1753400000);
  ok(solo.engines_present === 3 && solo.triangulation_threshold === 2, "solo result reports the birth tier");
  ok(solo.convergences.length > 0, `a birth-only person gets real convergences (got ${solo.convergences.length})`);
  ok(solo.convergences.every((c) => c.sources.every((s) => s === "astro" || s === "human_design" || s === "gene_keys")), "solo convergences cite only birth engines");

  // pair: two birth-only people, full pipeline.
  const other: EnginePayloads = {
    ...birthOnly,
    human_design: {
      ...(birthOnly.human_design as object),
      type: "Generator",
      authority: "Sacral",
      gates: { personality: [{ gate: 34 }, { gate: 10 }], design: [{ gate: 20 }] },
    } as never,
  };
  const soloB = computeConvergence(other, 1753400000);
  const mech = buildPairMechanics(birthOnly, other);
  ok(mech.socionics === null && mech.enneagram === null, "pair mechanics quiz blocks are null, not fabricated");
  ok(!!mech.connection && mech.connection.channels.length > 0, "birth-only pair still yields a connection chart");
  const harmony = scoreHarmony(solo.convergences, soloB.convergences, {
    mech: pairEvidence(mech),
    enginesA: solo.engines_present,
    enginesB: soloB.engines_present,
  });
  ok(harmony !== null, "birth-only pair gets a harmony score");
  ok(harmony!.confidence <= 1 && harmony!.confidence > 0, "confidence stays in range");

  // digest: nothing about quiz engines, no nagging.
  const digest = mechanicsDigest(mech, "ana", "ben");
  const digestStr = JSON.stringify(digest);
  ok(!digestStr.includes("socionics") && !digestStr.includes("enneagram"), "digest omits quiz engines entirely");
  ok(!/quiz|missing|absent|take the/.test(digestStr), "digest never nags about quizzes");
}

if (failures > 0) {
  console.error(`\nFAIL ${failures}/${checks} checks failed`);
  process.exit(1);
}
console.log(`\nPASS ${checks}/${checks} checks`);
