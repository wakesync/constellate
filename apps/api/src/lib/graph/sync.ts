// Circle graph sync: write extracted edges into D1 (docs/CIRCLE-GRAPH.md).
// The extraction functions in extract.ts are pure; this file owns the only
// write path into graph_edges.
//
// Staleness follows the convergence_cache pattern: every edge stores the
// inputs_hash of the payload it came from. syncSlice() compares the fresh hash
// against what is stored for the slice and rewrites the slice only when they
// differ. Delete-then-insert runs in one batch so readers never observe a
// half-written slice. Rebuilding an unchanged payload is a no-op (and the
// content-hash edge ids make even a forced rewrite idempotent).
//
// Slice identity:
//   - per-member sources (human_design, natal): (subject_id, source)
//   - pair sources (synastry): (subject_id, source, object_id), where subject
//     is the canonical FIRST member. A member with three synastry partners has
//     three independent pair slices; rebuilding one never touches the others.
//
// NOTHING here is reachable by the model. Graph writes happen on the engine
// cache write paths (phase 2 wires those hooks); reads go through scoped tools.

import type { Env } from "../../types";
import {
  extractHumanDesign,
  extractNatalPlacements,
  extractSynastryAspects,
  type GraphEdge,
} from "./extract";

type SliceKey = { subjectId: string; source: string; objectId?: string };

function sliceWhere(key: SliceKey): { sql: string; binds: string[] } {
  if (key.objectId !== undefined) {
    return {
      sql: "subject_id = ? AND source = ? AND object_id = ?",
      binds: [key.subjectId, key.source, key.objectId],
    };
  }
  return { sql: "subject_id = ? AND source = ?", binds: [key.subjectId, key.source] };
}

async function storedSliceHash(env: Env, key: SliceKey): Promise<string | null> {
  const w = sliceWhere(key);
  const row = await env.DB.prepare(`SELECT inputs_hash FROM graph_edges WHERE ${w.sql} LIMIT 1`)
    .bind(...w.binds)
    .first<{ inputs_hash: string }>();
  return row?.inputs_hash ?? null;
}

async function writeSlice(env: Env, key: SliceKey, edges: GraphEdge[]): Promise<void> {
  const w = sliceWhere(key);
  const stmts = [
    env.DB.prepare(`DELETE FROM graph_edges WHERE ${w.sql}`).bind(...w.binds),
    ...edges.map((e) =>
      env.DB.prepare(
        `INSERT OR REPLACE INTO graph_edges
           (id, subject_id, predicate, object_id, object_is_member, qualifiers_json, source, inputs_hash, computed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        e.id,
        e.subject_id,
        e.predicate,
        e.object_id,
        e.object_is_member,
        e.qualifiers ? JSON.stringify(e.qualifiers) : null,
        e.source,
        e.inputs_hash,
        e.computed_at,
      ),
    ),
  ];
  await env.DB.batch(stmts);
}

// Rebuild one slice iff the payload changed. Returns what happened, for tests
// and for a future admin/receipt surface.
export type SyncOutcome = "unchanged" | "rebuilt" | "cleared";

async function syncSlice(env: Env, key: SliceKey, edges: GraphEdge[]): Promise<SyncOutcome> {
  const freshHash = edges[0]?.inputs_hash ?? null;
  const stored = await storedSliceHash(env, key);
  if (freshHash === null) {
    // Payload produced no edges (absent/empty). Clear any stale slice.
    if (stored === null) return "unchanged";
    await writeSlice(env, key, []);
    return "cleared";
  }
  if (stored === freshHash) return "unchanged";
  await writeSlice(env, key, edges);
  return "rebuilt";
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export async function syncHumanDesignEdges(env: Env, userId: string, payload: unknown): Promise<SyncOutcome> {
  return syncSlice(
    env,
    { subjectId: userId, source: "human_design" },
    extractHumanDesign(userId, payload, nowSeconds()),
  );
}

export async function syncNatalEdges(env: Env, userId: string, payload: unknown): Promise<SyncOutcome> {
  return syncSlice(
    env,
    { subjectId: userId, source: "natal" },
    extractNatalPlacements(userId, payload, nowSeconds()),
  );
}

// Canonical order is the CALLER's contract (same pair() as synastry_reports);
// extractSynastryAspects throws on violation rather than flipping silently.
export async function syncSynastryEdges(
  env: Env,
  userAId: string,
  userBId: string,
  payload: unknown,
): Promise<SyncOutcome> {
  return syncSlice(
    env,
    { subjectId: userAId, source: "synastry", objectId: userBId },
    extractSynastryAspects(userAId, userBId, payload, nowSeconds()),
  );
}
