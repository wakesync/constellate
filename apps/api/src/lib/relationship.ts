// Relationship context: the stored, per-pair fact that decides which lens every
// pair narrative (synastry, convergence prose, eliza) is written through.
//
// The rule (P1): romantic framing ONLY when the declared pair context is
// 'romantic' AND both members' private preferences allow it. NEVER assumed.
// Everything else reads through a platonic lens. This is data threaded through
// code, not a prompt vibe: the lens is computed here, from D1 rows, and the
// prompt builders receive it as an argument.

import type { Env } from "../types";

export const RELATIONSHIP_KINDS = ["roommate", "collaborator", "friend", "romantic", "family"] as const;
export type RelationshipKind = (typeof RELATIONSHIP_KINDS)[number];

// The lens a narrative is actually written through. 'unspecified' = no declared
// context; treated as platonic, never romantic.
export type RelationshipLens = RelationshipKind | "unspecified";

export type PairContextRow = {
  relationship: RelationshipKind;
  set_by: string | null;
  updated_at: number;
};

// Canonical pair ordering, mirroring index.ts pair(). Kept here so the module
// is self-contained for tools that import it directly.
export function canonicalPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

export async function pairContextFor(env: Env, a: string, b: string): Promise<PairContextRow | null> {
  const [ua, ub] = canonicalPair(a, b);
  const row = await env.DB.prepare(
    "SELECT relationship, set_by, updated_at FROM pair_context WHERE user_a_id = ? AND user_b_id = ?",
  )
    .bind(ua, ub)
    .first<PairContextRow>();
  return row ?? null;
}

// Private preference fields for the romantic gate. The VALUES never enter a
// prompt; they only flip the boolean here.
export async function relationalPreferenceFor(env: Env, userId: string): Promise<string | null> {
  const row = await env.DB.prepare("SELECT relational_preference FROM users WHERE id = ?")
    .bind(userId)
    .first<{ relational_preference: string | null }>();
  return row?.relational_preference ?? null;
}

// A member opts out of romantic framing with free-form preference text. Broad
// on purpose: a false positive only makes a reading platonic, which is the safe
// direction (the P1 failure mode was the opposite).
const NO_ROMANCE_RE = /\b(platonic|aromantic|no\s+roman\w*|not\s+roman\w*|no\s+flirt\w*|keep\s+it\s+platonic)\b/i;

export function romanticAllowed(
  relationship: RelationshipKind | null,
  prefA: string | null,
  prefB: string | null,
): boolean {
  if (relationship !== "romantic") return false;
  if (prefA && NO_ROMANCE_RE.test(prefA)) return false;
  if (prefB && NO_ROMANCE_RE.test(prefB)) return false;
  return true;
}

// The effective lens for a pair: declared context, with 'romantic' demoted to
// 'friend' unless both members allow it, and no context at all reading as
// 'unspecified' (platonic, never assumed romantic).
export function lensFor(
  relationship: RelationshipKind | null,
  prefA: string | null,
  prefB: string | null,
): RelationshipLens {
  if (!relationship) return "unspecified";
  if (relationship === "romantic" && !romanticAllowed(relationship, prefA, prefB)) return "friend";
  return relationship;
}

// One call that does the whole dance for a pair narrative: read the declared
// context + both preferences, return the lens the prompt builder should use.
export async function effectiveLens(env: Env, a: string, b: string): Promise<RelationshipLens> {
  const ctx = await pairContextFor(env, a, b);
  if (!ctx) return "unspecified";
  if (ctx.relationship !== "romantic") return ctx.relationship;
  const [prefA, prefB] = await Promise.all([
    relationalPreferenceFor(env, a),
    relationalPreferenceFor(env, b),
  ]);
  return lensFor(ctx.relationship, prefA, prefB);
}
