// P1 relationship context tests. Run: npx tsx apps/api/test/relationship-context.test.ts
// These are prompt-layer invariants; deterministic engines are intentionally not touched.

import { lensFor, romanticAllowed } from "../src/lib/relationship";
import { synastrySystemPrompt } from "../src/prompts/synastry";
import { convergencePairSystemPrompt } from "../src/prompts/convergence";

let failures = 0;
let checks = 0;
function ok(value: boolean, message: string) {
  checks += 1;
  if (!value) { failures += 1; console.error("FAIL:", message); }
}

ok(lensFor(null, null, null) === "unspecified", "undeclared pairs are unspecified, not romantic");
ok(lensFor("roommate", null, null) === "roommate", "roommate context survives");
ok(romanticAllowed("friend", null, null) === false, "friend never allows romantic framing");
ok(romanticAllowed("romantic", "", "") === true, "declared romantic can be allowed");
ok(lensFor("romantic", "platonic only", null) === "friend", "either member can opt out");
ok(lensFor("romantic", null, "aromantic") === "friend", "aromantic preference demotes romantic lens");

const roommateSynastry = synastrySystemPrompt("roommate");
ok(roommateSynastry.includes("share a home"), "roommate prompt names shared home");
ok(roommateSynastry.includes("romantic, sexual, or courtship framing"), "roommate prompt forbids romance");
ok(roommateSynastry.includes('"sharing a roof"'), "roommate replaces how-you-love section");
ok(!roommateSynastry.includes('{ "title": "how you love"'), "roommate has no how-you-love section");

const romanticSynastry = synastrySystemPrompt("romantic");
ok(romanticSynastry.includes('"title": "how you love"'), "romantic lens may use romantic section");

const roommateConvergence = convergencePairSystemPrompt("roommate");
ok(roommateConvergence.includes("shared space"), "roommate convergence uses house dynamics");
ok(roommateConvergence.includes("no romance"), "roommate convergence forbids romance");

if (failures) {
  console.error(`${failures}/${checks} relationship-context checks failed`);
  process.exit(1);
}
console.log(`${checks} relationship-context checks passed`);
