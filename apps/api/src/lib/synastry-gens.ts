// Synastry generations: every reading is a permanent, append-only row; an
// active pointer per pair decides which one the pair is currently viewing.
//
// Invariants (docs/SYNASTRY-GENERATIONS-SPEC.md):
// - Generations are NEVER updated or deleted. POST appends.
// - Degraded (fallback) generations are persisted + flagged, never active.
// - The romantic-privacy gate applies at read time AND switch time: if either
//   member's private preference opts out of romantic framing, romantic
//   generations vanish from the list, cannot be switched to, and the active
//   pointer falls back to the newest allowed generation.
//
// The gate here is about PREFERENCES, not the declared pair context. A pair
// that reads as roommates today may still revisit a romantic reading they cast
// last month; both readings are theirs. What must never happen is romantic
// prose surfacing after a member said "keep it platonic". effectiveLens()
// still decides the lens of the NEXT cast; this module decides what history
// is visible.

import type { Env } from "../types";
import { relationalPreferenceFor, romanticAllowed } from "./relationship";

export type GenerationRow = {
  id: string;
  user_a_id: string;
  user_b_id: string;
  lens: string;
  aspects_json: string;
  narrative: string;
  generated_at: number;
  generated_by: string | null;
  degraded: number;
  // Which sky this generation was cast under ('tropical' | 'sidereal').
  // Generations are permanent; the frame they were computed in is part of the
  // record and never changes after the fact. Pre-0012 rows backfill 'tropical'.
  zodiac_system: string;
};

// Public metadata shape for list responses + the `generation` block on GET.
export type GenerationMeta = {
  id: string;
  lens: string;
  zodiac_system: string;
  generated_at: number;
  generated_by: string | null;
  degraded: boolean;
  active: boolean;
  index: number; // 1-based position in pair history, oldest = 1, newest = total
};

// True when either member's private preference does NOT opt out of romantic
// framing. Reuses the existing romanticAllowed() logic; never forked.
export async function romanticHistoryAllowed(env: Env, a: string, b: string): Promise<boolean> {
  const [prefA, prefB] = await Promise.all([
    relationalPreferenceFor(env, a),
    relationalPreferenceFor(env, b),
  ]);
  return romanticAllowed("romantic", prefA, prefB);
}

// Is a generation with this lens visible/selectable right now?
export function genAllowed(lens: string, romanticOk: boolean): boolean {
  return lens !== "romantic" || romanticOk;
}

// Pure: filter a pair's generations (any order) down to the currently visible
// set, newest first. Degraded gens stay listed (they cost a call, they count);
// romantic gens vanish when the gate is closed.
export function visibleGenerations(gens: GenerationRow[], romanticOk: boolean): GenerationRow[] {
  return gens
    .filter((g) => genAllowed(g.lens, romanticOk))
    .sort((x, y) => y.generated_at - x.generated_at || (x.id < y.id ? 1 : -1));
}

// Same visibility rules, narrowed to one sky. Default active reads use this so
// flipping zodiac preference swaps the bookmark without changing history.
export function visibleGenerationsForZodiac(
  gens: GenerationRow[],
  romanticOk: boolean,
  zodiac: string,
): GenerationRow[] {
  return visibleGenerations(gens, romanticOk).filter((g) => g.zodiac_system === zodiac);
}

// Pure: resolve which generation is active. The stored pointer wins when it
// points at a visible, non-degraded generation; otherwise fall back to the
// newest visible non-degraded one. Degraded generations are NEVER active.
export function resolveActive(
  gens: GenerationRow[],
  pointerId: string | null,
  romanticOk: boolean,
): GenerationRow | null {
  const visible = visibleGenerations(gens, romanticOk);
  if (pointerId) {
    const target = visible.find((g) => g.id === pointerId);
    if (target && !target.degraded) return target;
  }
  return visible.find((g) => !g.degraded) ?? null;
}

export function resolveActiveForZodiac(
  gens: GenerationRow[],
  pointerId: string | null,
  romanticOk: boolean,
  zodiac: string,
): GenerationRow | null {
  return resolveActive(
    gens.filter((g) => g.zodiac_system === zodiac),
    pointerId,
    romanticOk,
  );
}

// Pure: metadata list for the drawer. Index is 1-based over the VISIBLE set,
// oldest = 1, newest = total, so "reading iii of vi" reads like a manuscript.
export function generationMetas(
  gens: GenerationRow[],
  activeId: string | null,
  romanticOk: boolean,
): GenerationMeta[] {
  const visible = visibleGenerations(gens, romanticOk); // newest first
  const total = visible.length;
  return visible.map((g, i) => ({
    id: g.id,
    lens: g.lens,
    zodiac_system: g.zodiac_system,
    generated_at: g.generated_at,
    generated_by: g.generated_by,
    degraded: g.degraded !== 0,
    active: g.id === activeId,
    index: total - i,
  }));
}

export function generationMetasForZodiac(
  gens: GenerationRow[],
  activeId: string | null,
  romanticOk: boolean,
  zodiac: string,
): GenerationMeta[] {
  return generationMetas(
    gens.filter((g) => g.zodiac_system === zodiac),
    activeId,
    romanticOk,
  );
}

// ---------------------------------------------------------------------------
// D1 access (canonical pair order enforced by callers; CHECK constraint backs
// them up at the schema level).
// ---------------------------------------------------------------------------

export async function listGenerations(env: Env, ua: string, ub: string): Promise<GenerationRow[]> {
  const rows = await env.DB.prepare(
    `SELECT id, user_a_id, user_b_id, lens, aspects_json, narrative, generated_at, generated_by, degraded, zodiac_system
     FROM synastry_generations WHERE user_a_id = ? AND user_b_id = ?
     ORDER BY generated_at DESC, id DESC`,
  )
    .bind(ua, ub)
    .all<GenerationRow>();
  return rows.results ?? [];
}

export async function activePointer(env: Env, ua: string, ub: string, zodiac: string): Promise<string | null> {
  const row = await env.DB.prepare(
    "SELECT generation_id FROM synastry_active WHERE user_a_id = ? AND user_b_id = ? AND zodiac_system = ?",
  )
    .bind(ua, ub, zodiac)
    .first<{ generation_id: string }>();
  return row?.generation_id ?? null;
}

// Append a generation. INSERT only: there is no UPDATE path to a generation
// row anywhere in the codebase, by design.
export async function insertGeneration(
  env: Env,
  gen: Omit<GenerationRow, "user_a_id" | "user_b_id"> & { user_a_id: string; user_b_id: string },
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO synastry_generations (id, user_a_id, user_b_id, lens, aspects_json, narrative, generated_at, generated_by, degraded, zodiac_system)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      gen.id,
      gen.user_a_id,
      gen.user_b_id,
      gen.lens,
      gen.aspects_json,
      gen.narrative,
      gen.generated_at,
      gen.generated_by,
      gen.degraded,
      gen.zodiac_system,
    )
    .run();
}

// Move the active pointer. The ONLY mutation in this feature; last-write-wins
// with updated_by so either member can switch.
export async function setActivePointer(
  env: Env,
  ua: string,
  ub: string,
  zodiac: string,
  generationId: string,
  by: string,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO synastry_active (user_a_id, user_b_id, zodiac_system, generation_id, updated_at, updated_by)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_a_id, user_b_id, zodiac_system) DO UPDATE SET
       generation_id = excluded.generation_id,
       updated_at = excluded.updated_at,
       updated_by = excluded.updated_by`,
  )
    .bind(ua, ub, zodiac, generationId, Math.floor(Date.now() / 1000), by)
    .run();
}
