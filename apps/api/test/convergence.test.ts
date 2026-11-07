// Unit tests for the convergence engine.
// Run: npx tsx apps/api/test/convergence.test.ts   (from repo root)
//
// Asserts the three things the lane spec demands:
//   1. DETERMINISM: same input twice -> byte-identical output.
//   2. A synthetic profile where three engines AGREE surfaces as a convergence.
//   3. A synthetic profile where two engines OPPOSE surfaces as a tension.
// Plus: thin-coverage honesty, and that the inputs_hash changes iff inputs change.

import { computeConvergence, computeSignals, convergenceInputsHash } from "../src/lib/convergence";
import { scoreConvergence } from "../src/lib/convergence/score";
import type { Signal } from "../src/lib/convergence/axes";

let failures = 0;
let checks = 0;
function ok(cond: boolean, msg: string) {
  checks++;
  if (!cond) {
    failures++;
    console.error("  FAIL:", msg);
  }
}

// ---------------------------------------------------------------------------
// Fixtures. Hand-built so we KNOW the expected agreements/oppositions.
// ---------------------------------------------------------------------------

// A generator with sacral authority + sacral defined, enneagram 9 (responsive),
// socionics introverted lead. THREE engines should agree that this person is
// RESPONSIVE (negative) on the initiation axis.
const AGREE_PROFILE = {
  human_design: {
    type: "Generator",
    authority: "Sacral",
    definition: "Single",
    centers: [
      { name: "Head", defined: false },
      { name: "Ajna", defined: true },
      { name: "Throat", defined: true },
      { name: "G", defined: true },
      { name: "Heart", defined: false },
      { name: "Sacral", defined: true },
      { name: "Solar Plexus", defined: false },
      { name: "Spleen", defined: true },
      { name: "Root", defined: true },
    ],
    open_centers: ["Head", "Heart", "Solar Plexus"],
    defined_count: 6,
    profile: { personality_line: 6, design_line: 2 },
  },
  enneagram: {
    primary: { type: 9, score: 0.8 },
    center: "Body",
    scores: [{ type: 9, score: 0.8 }],
  },
  socionics: {
    type: { code: "SEI" },
    confidence: 0.8,
    dichotomies: { extraversion: 0.2, intuition: 0.3, logic: 0.3, irrationality: 0.7 },
    model_a: [{ position: 1, element: "Si" }],
  },
};

// A profile engineered to OPPOSE on the conflict axis with TWO engines that both
// clear the tension weight floor: enneagram 9 (avoids/smooths, -0.8 @ 0.75) vs a
// human design with a defined will center (holds a line, +0.4 @ 0.45). Both are
// above TENSION_MIN_WEIGHT, so a real tension must surface on `conflict`.
const OPPOSE_PROFILE = {
  human_design: {
    type: "Manifestor",
    authority: "Ego",
    definition: "Single",
    centers: [
      { name: "Head", defined: true },
      { name: "Ajna", defined: true },
      { name: "Throat", defined: true },
      { name: "G", defined: true },
      { name: "Heart", defined: true },
      { name: "Sacral", defined: false },
      { name: "Solar Plexus", defined: false },
      { name: "Spleen", defined: true },
      { name: "Root", defined: true },
    ],
    open_centers: ["Sacral", "Solar Plexus"],
    defined_count: 7,
    profile: { personality_line: 1, design_line: 3 },
  },
  enneagram: {
    primary: { type: 9, score: 0.85 },
    center: "Body",
    scores: [{ type: 9, score: 0.85 }],
  },
};

// ---------------------------------------------------------------------------
// 1. determinism
// ---------------------------------------------------------------------------
console.log("determinism");
{
  const a = computeConvergence(AGREE_PROFILE, 1753400000);
  const b = computeConvergence(AGREE_PROFILE, 1753400000);
  ok(JSON.stringify(a) === JSON.stringify(b), "same input twice -> identical output");

  // order of signals must not matter: shuffle and re-score.
  const sig = computeSignals(AGREE_PROFILE);
  const shuffled = [...sig].reverse();
  const s1 = scoreConvergence(sig, 1753400000);
  const s2 = scoreConvergence(shuffled, 1753400000);
  ok(JSON.stringify(s1) === JSON.stringify(s2), "signal order does not change the scored result");
}

// ---------------------------------------------------------------------------
// 2. a known 3-way agreement surfaces as a convergence
// ---------------------------------------------------------------------------
console.log("convergence surfaces");
{
  const res = computeConvergence(AGREE_PROFILE, 1753400000);
  const init = res.convergences.find((c) => c.axis === "initiation");
  ok(!!init, "initiation convergence exists");
  if (init) {
    ok(init.sources.length >= 3, `>= 3 sources on initiation (got ${init.sources.length}: ${init.sources.join(",")})`);
    ok(init.value < 0, `direction is responsive/negative (value ${init.value})`);
    ok(init.evidence.every((e) => !!e.evidence), "every convergence evidence item has a receipt");
    ok(init.strength > 0 && init.strength <= 1, `strength in (0,1] (${init.strength})`);
  }
}

// ---------------------------------------------------------------------------
// 3. a known opposition surfaces as a tension
// ---------------------------------------------------------------------------
console.log("tension surfaces");
{
  const res = computeConvergence(OPPOSE_PROFILE, 1753400000);
  const conflict = res.tensions.find((t) => t.axis === "conflict");
  ok(!!conflict, "conflict tension exists");
  if (conflict) {
    ok(conflict.poles[0].value < 0 && conflict.poles[1].value > 0, "poles are genuinely opposed in sign");
    ok(!!conflict.question && conflict.question.length > 0, "tension carries a question, not a verdict");
    ok(conflict.poles.every((p) => !!p.evidence), "both poles carry evidence");
  }
}

// ---------------------------------------------------------------------------
// 4. thin coverage is reported honestly (not dressed as insight)
// ---------------------------------------------------------------------------
console.log("thin coverage honesty");
{
  const res = computeConvergence({ enneagram: AGREE_PROFILE.enneagram }, 1753400000);
  ok(res.coverage.enneagram === true, "coverage marks the one present engine");
  ok(res.coverage.human_design === false, "coverage marks the absent engines false");
  ok(res.convergences.length === 0, "a single engine cannot manufacture a convergence (needs >= 3 sources)");
}

// ---------------------------------------------------------------------------
// 5. inputs_hash invalidation
// ---------------------------------------------------------------------------
console.log("inputs hash");
{
  const h1 = convergenceInputsHash(AGREE_PROFILE);
  const h2 = convergenceInputsHash(AGREE_PROFILE);
  ok(h1 === h2, "hash is stable for identical inputs");
  const mutated = { ...AGREE_PROFILE, enneagram: { ...AGREE_PROFILE.enneagram, primary: { type: 3, score: 0.9 } } };
  ok(convergenceInputsHash(mutated) !== h1, "hash changes when a source payload changes");
}

// ---------------------------------------------------------------------------
console.log("");
if (failures === 0) {
  console.log(`PASS ${checks}/${checks} checks`);
  process.exit(0);
} else {
  console.error(`FAIL ${failures}/${checks} checks failed`);
  process.exit(1);
}
