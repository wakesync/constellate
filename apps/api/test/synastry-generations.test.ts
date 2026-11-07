// Synastry generations invariants. Run: npx tsx apps/api/test/synastry-generations.test.ts
//
// These exercise the pure resolution logic that backs the endpoints:
// - append-only history (no overwrite semantics)
// - active-pointer resolution + fallback
// - romantic gate hiding generations at read AND switch time
// - degraded generations never active
// - backfill id/ordering correctness

import {
  visibleGenerations,
  visibleGenerationsForZodiac,
  resolveActive,
  resolveActiveForZodiac,
  generationMetas,
  generationMetasForZodiac,
  genAllowed,
  type GenerationRow,
} from "../src/lib/synastry-gens";
import { romanticAllowed } from "../src/lib/relationship";

let failures = 0;
let checks = 0;
function ok(value: boolean, message: string) {
  checks += 1;
  if (!value) { failures += 1; console.error("FAIL:", message); }
}

// --- dual-sky active pointers ----------------------------------------------
{
  const tropicalOld = gen({ id: "syng_t1", generated_at: 100, zodiac_system: "tropical" });
  const tropicalNew = gen({ id: "syng_t2", generated_at: 300, zodiac_system: "tropical" });
  const sidereal = gen({ id: "syng_s1", generated_at: 200, zodiac_system: "sidereal" });

  ok(visibleGenerationsForZodiac([tropicalOld, sidereal, tropicalNew], true, "tropical").map((g) => g.id).join(",") === "syng_t2,syng_t1",
    "zodiac-aware visible list narrows to one sky");
  ok(resolveActiveForZodiac([tropicalOld, sidereal, tropicalNew], "syng_s1", true, "tropical")?.id === "syng_t2",
    "tropical active resolution ignores a sidereal pointer and falls back inside tropical");
  ok(resolveActiveForZodiac([tropicalOld, sidereal, tropicalNew], "syng_s1", true, "sidereal")?.id === "syng_s1",
    "sidereal active resolution uses the sidereal pointer");
  const metas = generationMetasForZodiac([tropicalOld, sidereal, tropicalNew], "syng_t1", true, "tropical");
  ok(metas.length === 2 && metas.every((m) => m.zodiac_system === "tropical") && metas.find((m) => m.id === "syng_t1")?.active === true,
    "zodiac-aware metadata counts and marks active within the requested sky");
}

function gen(partial: Partial<GenerationRow> & { id: string; generated_at: number }): GenerationRow {
  return {
    user_a_id: "usr_a",
    user_b_id: "usr_b",
    lens: "friend",
    aspects_json: "{}",
    narrative: "{}",
    generated_by: "usr_a",
    degraded: 0,
    zodiac_system: "tropical",
    ...partial,
  };
}

// --- no-overwrite semantics -------------------------------------------------
// A second cast APPENDS: both generations remain retrievable, newest becomes
// active. (The DB layer is INSERT-only; here we assert the resolution layer
// treats history as a set, not a slot.)
{
  const g1 = gen({ id: "syng_1", generated_at: 100 });
  const g2 = gen({ id: "syng_2", generated_at: 200 });
  const both = visibleGenerations([g1, g2], true);
  ok(both.length === 2, "two casts -> two visible generations, nothing lost");
  ok(both[0].id === "syng_2" && both[1].id === "syng_1", "history is newest-first");
  ok(resolveActive([g1, g2], "syng_2", true)?.id === "syng_2", "newest cast is active after POST");
  ok(resolveActive([g1, g2], "syng_1", true)?.id === "syng_1", "older generation stays retrievable as active");
}

// --- active-pointer switch by either member ---------------------------------
// The pointer is pair-scoped, not per-member: whichever member last set it,
// resolution returns the same generation for both. updated_by is metadata only.
{
  const g1 = gen({ id: "syng_1", generated_at: 100 });
  const g2 = gen({ id: "syng_2", generated_at: 200 });
  // member A switched to the old reading; member B's GET resolves identically
  // because resolution depends only on (gens, pointer, gate), never on caller.
  const forA = resolveActive([g1, g2], "syng_1", true);
  const forB = resolveActive([g2, g1], "syng_1", true);
  ok(forA?.id === "syng_1" && forB?.id === "syng_1", "switched pointer resolves the same for both members");
}

// --- romantic gate ----------------------------------------------------------
{
  const friendly = gen({ id: "syng_f", generated_at: 100, lens: "roommate" });
  const romantic = gen({ id: "syng_r", generated_at: 200, lens: "romantic" });

  // gate open: romantic visible and can be active
  ok(visibleGenerations([friendly, romantic], true).length === 2, "gate open -> romantic listed");
  ok(resolveActive([friendly, romantic], "syng_r", true)?.id === "syng_r", "gate open -> romantic can be active");

  // gate closed: romantic vanishes from list, active falls back
  const visibleClosed = visibleGenerations([friendly, romantic], false);
  ok(visibleClosed.length === 1 && visibleClosed[0].id === "syng_f", "gate closed -> romantic hidden from list");
  ok(resolveActive([friendly, romantic], "syng_r", false)?.id === "syng_f", "gate closed -> active falls back to newest allowed");
  ok(!genAllowed("romantic", false), "gate closed -> PUT to a romantic gen is refused (404 path)");
  ok(genAllowed("romantic", true), "gate open -> romantic gen switchable");
  ok(genAllowed("roommate", false), "non-romantic lenses unaffected by the gate");

  // the gate itself reuses romanticAllowed, not a fork
  ok(romanticAllowed("romantic", "keep it platonic", null) === false, "preference text closes the gate");
  ok(romanticAllowed("romantic", null, null) === true, "no opt-out -> gate open");
}

// --- degraded never active --------------------------------------------------
{
  const good = gen({ id: "syng_good", generated_at: 100 });
  const bad = gen({ id: "syng_bad", generated_at: 200, degraded: 1 });

  ok(resolveActive([good, bad], "syng_bad", true)?.id === "syng_good", "pointer at degraded gen falls back to newest good one");
  ok(resolveActive([good, bad], null, true)?.id === "syng_good", "no pointer -> newest NON-degraded wins even if older");
  ok(resolveActive([bad], null, true) === null, "only degraded gens -> no active (404, cast-first CTA)");

  // degraded gens still count and still list (they cost a call)
  const metas = generationMetas([good, bad], "syng_good", true);
  ok(metas.length === 2, "degraded gens are listed");
  ok(metas.find((m) => m.id === "syng_bad")?.degraded === true, "degraded flag surfaces in metadata");
  ok(metas.find((m) => m.id === "syng_bad")?.active === false, "degraded gen never marked active");
}

// --- metadata indexing (the drawer's 'reading iii' numerals) -----------------
{
  const a = gen({ id: "syng_a", generated_at: 100 });
  const b = gen({ id: "syng_b", generated_at: 200 });
  const c = gen({ id: "syng_c", generated_at: 300 });
  const metas = generationMetas([b, a, c], "syng_c", true);
  ok(metas[0].id === "syng_c" && metas[0].index === 3, "newest listed first, index = total");
  ok(metas[2].id === "syng_a" && metas[2].index === 1, "oldest is reading number 1");
  ok(metas[0].active === true && metas[1].active === false, "exactly the active one is flagged");
}

// --- backfill correctness ---------------------------------------------------
// Migration 0011 maps each synastry_reports row to 'syng_bf_' || id with its
// lens (COALESCE to friend) and sets it active. Simulate the mapped shape.
{
  const backfilled = gen({ id: "syng_bf_syn_abc123", generated_at: 1785315753, lens: "roommate" });
  ok(backfilled.id.startsWith("syng_bf_"), "backfill ids are namespaced, collision-free with id('syng')");
  ok(resolveActive([backfilled], "syng_bf_syn_abc123", true)?.id === backfilled.id, "backfilled generation #1 is active");
  const metas = generationMetas([backfilled], backfilled.id, true);
  ok(metas.length === 1 && metas[0].index === 1 && metas[0].active, "backfilled row reads as reading number 1, active");
}

if (failures) {
  console.error(`${failures}/${checks} synastry-generations checks failed`);
  process.exit(1);
}
console.log(`${checks} synastry-generations checks passed`);
