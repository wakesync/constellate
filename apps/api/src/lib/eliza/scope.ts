// SECURITY CRITICAL. This file is the single source of truth for what eliza is
// allowed to read. Access control lives HERE, in code, never in a prompt. A
// prompt is not an access-control mechanism.
//
// The model:
//   - Every tool runs with an explicit actor (actor_user_id) and a
//     constellation context (constellation_id). Nothing is implicit.
//   - A member's typology data is readable only by someone who shares a
//     constellation with them. This mirrors, exactly, the membership check that
//     /synastry/:other_user_id already enforces (sharesConstellation).
//   - Personal journal entries are PRIVATE, full stop. Journal search may only
//     ever return entries written to the SHARED constellation journal
//     (constellation_id set), regardless of who is asking or whose entry it is.
//   - Eliza never reveals data about a non-member, and never carries data
//     between constellations. Every read is bounded to the active
//     constellation_id.
//
// If a rule below is unclear, deny. The tests in test/eliza-scope.test.ts assert
// each rule; do not weaken this file without updating them.

import type { Env } from "../../types";

export type ScopeCtx = {
  env: Env;
  // The person asking. All reads are performed on their behalf and denied if
  // they are not a member of the active constellation.
  actorUserId: string;
  // The active constellation. Every read is bounded to this circle. No tool may
  // read across constellations.
  constellationId: string;
};

export class ScopeError extends Error {
  constructor(
    public reason: string,
    public code:
      | "not_a_member"
      | "target_not_in_circle"
      | "actor_not_in_circle"
      | "personal_journal_forbidden" = "not_a_member",
  ) {
    super(reason);
    this.name = "ScopeError";
  }
}

// Is `userId` a member of `constellationId`? (mirrors index.ts isMember)
export async function isMember(env: Env, constellationId: string, userId: string): Promise<boolean> {
  const row = await env.DB.prepare(
    "SELECT 1 AS x FROM memberships WHERE constellation_id = ? AND user_id = ?",
  )
    .bind(constellationId, userId)
    .first<{ x: number }>();
  return !!row;
}

// The actor must be a member of the active constellation before ANY tool runs.
// Called once per turn by the tool runner, and defensively again inside each
// data-returning tool so a future refactor cannot bypass it.
export async function assertActorInCircle(ctx: ScopeCtx): Promise<void> {
  if (!(await isMember(ctx.env, ctx.constellationId, ctx.actorUserId))) {
    throw new ScopeError("actor is not a member of this constellation", "actor_not_in_circle");
  }
}

// A target user's typology data is readable only if the target is ALSO a member
// of the active constellation. This is the strict form of "shares a
// constellation": we bind to the ONE active circle, not any shared circle, so
// eliza can never carry data between constellations. Returns the target id if
// allowed, throws ScopeError otherwise.
export async function assertTargetReadable(ctx: ScopeCtx, targetUserId: string): Promise<string> {
  await assertActorInCircle(ctx);
  // The actor may always read their own data (they are a confirmed member).
  if (targetUserId === ctx.actorUserId) return targetUserId;
  if (!(await isMember(ctx.env, ctx.constellationId, targetUserId))) {
    throw new ScopeError(
      "target user is not a member of this constellation",
      "target_not_in_circle",
    );
  }
  return targetUserId;
}

// List the members of the active constellation (ids + display names + which data
// each has). Actor must be a member. Never leaks non-members.
export async function circleMembers(ctx: ScopeCtx): Promise<
  Array<{ id: string; display_name: string | null; role: string; has_birth_data: boolean }>
> {
  await assertActorInCircle(ctx);
  const rows = await ctx.env.DB.prepare(
    `SELECT users.id, users.display_name, memberships.role,
            (SELECT COUNT(*) FROM birth_data bd WHERE bd.user_id = users.id) AS has_birth
     FROM memberships
     JOIN users ON users.id = memberships.user_id
     WHERE memberships.constellation_id = ?
     ORDER BY memberships.joined_at ASC`,
  )
    .bind(ctx.constellationId)
    .all<{ id: string; display_name: string | null; role: string; has_birth: number }>();
  return (rows.results ?? []).map((m) => ({
    id: m.id,
    display_name: m.display_name,
    role: m.role,
    has_birth_data: m.has_birth > 0,
  }));
}

// Resolve a member reference (a user id, OR a display name / "rowan") to a member
// of the active circle. Returns null if it cannot be uniquely resolved to a
// member. Never resolves to a non-member. Case-insensitive name match.
export async function resolveMember(
  ctx: ScopeCtx,
  ref: string,
): Promise<{ id: string; display_name: string | null } | null> {
  const members = await circleMembers(ctx);
  const byId = members.find((m) => m.id === ref);
  if (byId) return { id: byId.id, display_name: byId.display_name };
  const needle = ref.trim().toLowerCase();
  const byName = members.filter(
    (m) => (m.display_name ?? "").trim().toLowerCase() === needle,
  );
  if (byName.length === 1) return { id: byName[0].id, display_name: byName[0].display_name };
  return null; // ambiguous or not present => not resolvable, never guess
}

// SHARED-JOURNAL-ONLY search. This function CANNOT return a personal entry: the
// WHERE clause pins constellation_id to the active circle AND requires it be
// non-null. There is no code path here that reads an entry with a NULL
// constellation_id. Actor must be a member. Optional author filter still only
// searches shared entries.
export async function searchSharedJournal(
  ctx: ScopeCtx,
  opts: { query?: string; authorUserId?: string; since?: number; until?: number; limit?: number },
): Promise<Array<{ id: string; user_id: string; user_name: string | null; body: string; written_at: number }>> {
  await assertActorInCircle(ctx);
  // If an author filter is given, they too must be a member of this circle.
  let authorClause = "";
  const binds: unknown[] = [ctx.constellationId];
  if (opts.authorUserId) {
    if (!(await isMember(ctx.env, ctx.constellationId, opts.authorUserId))) {
      throw new ScopeError("journal author is not a member of this constellation", "target_not_in_circle");
    }
    authorClause = " AND j.user_id = ?";
    binds.push(opts.authorUserId);
  }
  let queryClause = "";
  if (opts.query && opts.query.trim()) {
    queryClause = " AND j.body LIKE ?";
    binds.push(`%${opts.query.trim()}%`);
  }
  let sinceClause = "";
  if (typeof opts.since === "number") {
    sinceClause = " AND j.written_at >= ?";
    binds.push(opts.since);
  }
  let untilClause = "";
  if (typeof opts.until === "number") {
    untilClause = " AND j.written_at <= ?";
    binds.push(opts.until);
  }
  const limit = Math.min(Math.max(opts.limit ?? 8, 1), 25);
  // constellation_id = ? with a non-null bound value is itself the guarantee that
  // NULL (personal) rows are excluded, but we state IS NOT NULL explicitly as a
  // belt-and-suspenders invariant a reviewer can see at a glance.
  const rows = await ctx.env.DB.prepare(
    `SELECT j.id, j.user_id, j.body, j.written_at, u.display_name AS user_name
     FROM journal_entries j
     JOIN users u ON u.id = j.user_id
     WHERE j.constellation_id = ? AND j.constellation_id IS NOT NULL${authorClause}${queryClause}${sinceClause}${untilClause}
     ORDER BY j.written_at DESC
     LIMIT ${limit}`,
  )
    .bind(...binds)
    .all<{ id: string; user_id: string; body: string; written_at: number; user_name: string | null }>();
  return (rows.results ?? []).map((r) => ({
    id: r.id,
    user_id: r.user_id,
    user_name: r.user_name,
    body: r.body,
    written_at: r.written_at,
  }));
}
