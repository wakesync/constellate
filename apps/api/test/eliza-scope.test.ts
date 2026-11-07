// SECURITY tests for eliza's scope layer. These are the ones that matter.
// Run: npx tsx apps/api/test/eliza-scope.test.ts   (from repo root)
//
// Asserts, against an in-memory D1 fake seeded with two constellations:
//   1. Personal journal entries are NEVER returned by search (only shared).
//   2. A non-member's typology is NEVER readable.
//   3. Cross-constellation leakage is impossible (a member of circle A cannot
//      read circle B data through eliza, and journal search is bound to the
//      active circle only).
//   4. The actor themselves must be a member of the active circle.
//   5. resolveMember never resolves to a non-member.

import {
  assertActorInCircle,
  assertTargetReadable,
  searchSharedJournal,
  resolveMember,
  circleMembers,
  ScopeError,
  type ScopeCtx,
} from "../src/lib/eliza/scope";
import type { Env } from "../src/types";

let failures = 0;
let checks = 0;
function ok(cond: boolean, msg: string) {
  checks++;
  if (!cond) {
    failures++;
    console.error("  FAIL:", msg);
  }
}
async function throwsScope(fn: () => Promise<unknown>, msg: string) {
  checks++;
  try {
    await fn();
    failures++;
    console.error("  FAIL (did not throw):", msg);
  } catch (e) {
    if (!(e instanceof ScopeError)) {
      failures++;
      console.error("  FAIL (wrong error):", msg, e);
    }
  }
}

// ---------------------------------------------------------------------------
// Minimal in-memory D1 fake. Supports only the SQL shapes scope.ts uses:
// memberships lookups, member listing, and shared-journal search. It is a
// deliberate, dumb table store so the tests exercise the REAL scope.ts logic.
// ---------------------------------------------------------------------------
type Row = Record<string, unknown>;
type DB = {
  users: Row[];
  memberships: Row[];
  journal_entries: Row[];
};

function makeEnv(db: DB): Env {
  const prepare = (sql: string) => {
    const s = sql.replace(/\s+/g, " ").trim();
    let binds: unknown[] = [];
    const stmt = {
      bind(...args: unknown[]) {
        binds = args;
        return stmt;
      },
      async first<T>(): Promise<T | null> {
        // membership existence: SELECT 1 AS x FROM memberships WHERE constellation_id = ? AND user_id = ?
        if (s.startsWith("SELECT 1 AS x FROM memberships")) {
          const [cid, uid] = binds;
          const hit = db.memberships.find((m) => m.constellation_id === cid && m.user_id === uid);
          return (hit ? { x: 1 } : null) as T | null;
        }
        return null;
      },
      async all<T>(): Promise<{ results: T[] }> {
        // circle members
        if (s.includes("FROM memberships JOIN users")) {
          const [cid] = binds;
          const members = db.memberships
            .filter((m) => m.constellation_id === cid)
            .map((m) => {
              const u = db.users.find((x) => x.id === m.user_id)!;
              return {
                id: u.id,
                display_name: u.display_name,
                role: m.role,
                has_birth: 0,
              };
            });
          return { results: members as T[] };
        }
        // shared journal search: WHERE j.constellation_id = ? AND j.constellation_id IS NOT NULL ...
        if (s.includes("FROM journal_entries j")) {
          const cid = binds[0];
          // Enforce the exact predicate the SQL enforces: constellation_id equals
          // the bound (non-null) value. A NULL (personal) entry can never match a
          // non-null bind, which is the whole security guarantee.
          let rows = db.journal_entries.filter(
            (j) => j.constellation_id != null && j.constellation_id === cid,
          );
          // author / query / range binds follow in order; we only need author for
          // the tests, applied positionally after cid.
          let bi = 1;
          if (s.includes("AND j.user_id = ?")) {
            const author = binds[bi++];
            rows = rows.filter((j) => j.user_id === author);
          }
          if (s.includes("AND j.body LIKE ?")) {
            const like = String(binds[bi++]).replace(/%/g, "");
            rows = rows.filter((j) => String(j.body).includes(like));
          }
          const mapped = rows.map((j) => ({
            id: j.id,
            user_id: j.user_id,
            body: j.body,
            written_at: j.written_at,
            user_name: db.users.find((u) => u.id === j.user_id)?.display_name ?? null,
          }));
          return { results: mapped as T[] };
        }
        return { results: [] as T[] };
      },
    };
    return stmt;
  };
  return { DB: { prepare } } as unknown as Env;
}

// ---- fixtures -------------------------------------------------------------
// Circle A: alice + rowan.  Circle B: bob + carol.  Alice is NOT in B.
const db: DB = {
  users: [
    { id: "u_alice", display_name: "alice" },
    { id: "u_rowan", display_name: "rowan" },
    { id: "u_bob", display_name: "bob" },
    { id: "u_carol", display_name: "carol" },
  ],
  memberships: [
    { constellation_id: "c_A", user_id: "u_alice", role: "creator" },
    { constellation_id: "c_A", user_id: "u_rowan", role: "member" },
    { constellation_id: "c_B", user_id: "u_bob", role: "creator" },
    { constellation_id: "c_B", user_id: "u_carol", role: "member" },
  ],
  journal_entries: [
    // shared entries in circle A
    { id: "j1", user_id: "u_alice", constellation_id: "c_A", body: "shared: we had the same fight again", written_at: 100 },
    { id: "j2", user_id: "u_rowan", constellation_id: "c_A", body: "shared: i felt unheard", written_at: 101 },
    // PERSONAL entries (constellation_id NULL) — must NEVER surface
    { id: "j3", user_id: "u_alice", constellation_id: null, body: "PERSONAL SECRET do not leak", written_at: 102 },
    { id: "j4", user_id: "u_rowan", constellation_id: null, body: "PERSONAL rowan diary", written_at: 103 },
    // shared entry in circle B — must never appear when actor is in A
    { id: "j5", user_id: "u_bob", constellation_id: "c_B", body: "shared B only", written_at: 104 },
  ],
};

const env = makeEnv(db);

async function run() {
  const ctxA: ScopeCtx = { env, actorUserId: "u_alice", constellationId: "c_A" };

  // Rule 1: personal entries never returned.
  const shared = await searchSharedJournal(ctxA, { limit: 25 });
  ok(shared.length === 2, `only 2 shared entries in A, got ${shared.length}`);
  ok(!shared.some((e) => String(e.body).includes("PERSONAL")), "no PERSONAL entry ever returned");
  ok(shared.every((e) => ["j1", "j2"].includes(e.id)), "only the shared A entries returned");

  // Rule 3a: journal search is bound to the active circle; B entries never leak.
  ok(!shared.some((e) => e.id === "j5"), "circle B shared entry never leaks into A");

  // Rule 1 again with author filter: a personal entry by rowan still never shows.
  const byRowan = await searchSharedJournal(ctxA, { authorUserId: "u_rowan", limit: 25 });
  ok(byRowan.length === 1 && byRowan[0].id === "j2", "author filter still shared-only");
  ok(!byRowan.some((e) => e.body.includes("PERSONAL")), "rowan personal diary never returned");

  // Rule 2: a non-member's typology is not readable. Alice cannot read bob.
  await throwsScope(() => assertTargetReadable(ctxA, "u_bob"), "alice cannot read non-member bob");

  // Rule 2b: alice CAN read rowan (co-member) and herself.
  ok((await assertTargetReadable(ctxA, "u_rowan")) === "u_rowan", "alice can read co-member rowan");
  ok((await assertTargetReadable(ctxA, "u_alice")) === "u_alice", "alice can read herself");

  // Rule 3b: cross-constellation. Bob is only in B; if alice tries to act in B she is denied.
  const ctxAliceInB: ScopeCtx = { env, actorUserId: "u_alice", constellationId: "c_B" };
  await throwsScope(() => assertActorInCircle(ctxAliceInB), "alice is not a member of circle B");
  await throwsScope(() => assertTargetReadable(ctxAliceInB, "u_bob"), "alice cannot read B members via B context");
  await throwsScope(() => searchSharedJournal(ctxAliceInB, {}), "alice cannot search B journal");

  // Rule 4: actor must be a member (already covered), affirmatively true for A.
  await assertActorInCircle(ctxA); // should not throw
  ok(true, "member actor passes the gate");

  // Rule 5: resolveMember never resolves to a non-member. "bob" is not in A.
  ok((await resolveMember(ctxA, "bob")) === null, "cannot resolve bob (non-member) from circle A");
  ok((await resolveMember(ctxA, "u_bob")) === null, "cannot resolve bob by id from circle A");
  const r = await resolveMember(ctxA, "rowan");
  ok(r?.id === "u_rowan", "resolves co-member rowan by name");

  // members listing only shows this circle's members.
  const members = await circleMembers(ctxA);
  ok(members.length === 2 && members.every((m) => ["u_alice", "u_rowan"].includes(m.id)), "circle A members only");

  console.log(`\neliza-scope: ${checks - failures}/${checks} checks passed`);
  if (failures > 0) {
    console.error(`${failures} FAILURES`);
    process.exit(1);
  }
}

run();
