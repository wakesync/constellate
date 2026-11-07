// Circle graph read model (docs/CIRCLE-GRAPH.md, P4 surfacing).
//
// This module turns the graph_edges table into the scoped slice the web's
// constellation graph renders: which members share which traits, and which
// synastry aspects join each pair. It is a READ projection with one honest
// write path: a lazy, hash-guarded sync from the engine caches, so the edge
// table can never drift stale (the same inputs_hash discipline as
// convergence_cache; an unchanged payload is a single SELECT no-op).
//
// Access control is the CALLER's job (membership-gated route in index.ts, the
// same isMember gate as /constellations/:id/members). Everything returned here
// is derived typology tokens; no birth data, no journal text, ever (extract.ts
// guarantees the rows, tests assert it).

import type { Env } from "../../types";
import {
  extractHumanDesign,
  extractNatalPlacements,
  extractSynastryAspects,
  type GraphEdge,
} from "./extract";
import { nowSeconds } from "./sync";

export type SharedTrait = {
  kind: "channel" | "gate" | "defined_center" | "open_center" | "placement" | "hd_type" | "hd_authority" | "hd_profile";
  token: string;
  label: string;
  weight: number;
};

export type PairAspect = { label: string; harmonious: boolean };

export type CirclePairTraits = {
  a: string; // canonical order, a < b
  b: string;
  shared: SharedTrait[];
  aspects: PairAspect[];
};

type EdgeRow = {
  subject_id: string;
  predicate: string;
  object_id: string;
  object_is_member: number;
  qualifiers_json: string | null;
};

// ---------------------------------------------------------------------------
// lazy sync: rebuild any stale (member, source) slice from the engine caches.
// BATCHED for the circle read path: three IN-queries fetch every payload, one
// query fetches every stored slice hash, and writes happen only for slices
// whose payload hash changed. Steady state (nothing changed) = 4 reads total
// regardless of circle size; the per-slice hash discipline is identical to
// sync.ts (same extract functions, same inputs_hash), just amortized.
// ---------------------------------------------------------------------------
type SliceState = { key: string; freshEdges: GraphEdge[]; where: { sql: string; binds: string[] } };

export async function syncCircleEdges(env: Env, memberIds: string[]): Promise<void> {
  if (memberIds.length === 0) return;
  const placeholders = memberIds.map(() => "?").join(",");
  const sorted = [...memberIds].sort();

  // TROPICAL-CANON: the circle graph is scored under the tropical sky
  // regardless of any member's zodiac preference (docs/SIDEREAL.md
  // §1). HD reads pin zodiac_system = 'tropical'; birth_data.natal_chart_json
  // is the canonical tropical chart by construction.
  const [hdRows, natalRows, synRows, storedRows] = await Promise.all([
    env.DB.prepare(`SELECT user_id, payload_json FROM human_design_cache WHERE zodiac_system = 'tropical' AND user_id IN (${placeholders})`)
      .bind(...memberIds)
      .all<{ user_id: string; payload_json: string }>(),
    env.DB.prepare(`SELECT user_id, natal_chart_json FROM birth_data WHERE user_id IN (${placeholders})`)
      .bind(...memberIds)
      .all<{ user_id: string; natal_chart_json: string | null }>(),
    env.DB.prepare(
      `SELECT user_a_id, user_b_id, aspects_json FROM synastry_reports
       WHERE user_a_id IN (${placeholders}) AND user_b_id IN (${placeholders})`,
    )
      .bind(...memberIds, ...memberIds)
      .all<{ user_a_id: string; user_b_id: string; aspects_json: string }>(),
    env.DB.prepare(
      `SELECT subject_id, source, object_id, object_is_member, inputs_hash FROM graph_edges
       WHERE subject_id IN (${placeholders}) GROUP BY subject_id, source, object_id, object_is_member`,
    )
      .bind(...memberIds)
      .all<{ subject_id: string; source: string; object_id: string; object_is_member: number; inputs_hash: string }>(),
  ]);

  const hdBy = new Map((hdRows.results ?? []).map((r) => [r.user_id, safeParse(r.payload_json)]));
  const natalBy = new Map((natalRows.results ?? []).map((r) => [r.user_id, r.natal_chart_json ? safeParse(r.natal_chart_json) : null]));
  const synBy = new Map((synRows.results ?? []).map((r) => [`${r.user_a_id}|${r.user_b_id}`, safeParse(r.aspects_json)]));

  // Stored hash per slice. Per-member slices key on (subject, source); pair
  // slices on (subject, source, object). A GROUP BY row per (source, object)
  // collapses to the slice level here (all rows in a slice share one hash).
  const storedHash = new Map<string, string>();
  for (const r of storedRows.results ?? []) {
    const key = r.source === "synastry" && r.object_is_member === 1
      ? `${r.subject_id}|synastry|${r.object_id}`
      : `${r.subject_id}|${r.source}`;
    if (!storedHash.has(key)) storedHash.set(key, r.inputs_hash);
  }

  const now = nowSeconds();
  const stale: SliceState[] = [];

  const consider = (key: string, freshEdges: GraphEdge[], where: { sql: string; binds: string[] }) => {
    const fresh = freshEdges[0]?.inputs_hash ?? null;
    const stored = storedHash.get(key) ?? null;
    if (fresh === stored) return;               // includes both-null (nothing to do)
    if (fresh === null && stored === null) return;
    stale.push({ key, freshEdges, where });
  };

  for (const uid of memberIds) {
    consider(
      `${uid}|human_design`,
      extractHumanDesign(uid, hdBy.get(uid) ?? null, now),
      { sql: "subject_id = ? AND source = ?", binds: [uid, "human_design"] },
    );
    consider(
      `${uid}|natal`,
      extractNatalPlacements(uid, natalBy.get(uid) ?? null, now),
      { sql: "subject_id = ? AND source = ?", binds: [uid, "natal"] },
    );
  }
  // Empty HD/natal payloads hash differently from "no edges stored": the
  // extract functions return [] for absent payloads, so `fresh` is null and the
  // slice only rewrites if something WAS stored (a clear).
  for (let i = 0; i < sorted.length; i += 1) {
    for (let j = i + 1; j < sorted.length; j += 1) {
      const a = sorted[i];
      const b = sorted[j];
      consider(
        `${a}|synastry|${b}`,
        extractSynastryAspects(a, b, synBy.get(`${a}|${b}`) ?? null, now),
        { sql: "subject_id = ? AND source = ? AND object_id = ?", binds: [a, "synastry", b] },
      );
    }
  }

  if (stale.length === 0) return;
  const stmts = stale.flatMap((s) => [
    env.DB.prepare(`DELETE FROM graph_edges WHERE ${s.where.sql}`).bind(...s.where.binds),
    ...s.freshEdges.map((e) =>
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
  ]);
  await env.DB.batch(stmts);
}

function safeParse(s: string): unknown {
  try { return JSON.parse(s); } catch { return null; }
}

// ---------------------------------------------------------------------------
// shared-trait intersection + pair aspects, computed over the synced edges.
// ---------------------------------------------------------------------------

// Same-sign outer-planet placements are generational noise, not a shared trait.
const GENERATIONAL_PLANETS = new Set(["Uranus", "Neptune", "Pluto"]);
// Personal placements say the most; social planets whisper.
const PERSONAL_PLANETS = new Set(["Sun", "Moon", "Mercury", "Venus", "Mars"]);

const MAX_SHARED_PER_PAIR = 6;
const MAX_ASPECTS_PER_PAIR = 3;

function traitWeight(predicate: string, objectId: string): number {
  switch (predicate) {
    case "has_channel": return 3;      // a full shared channel is rare and loud
    case "hd_profile": return 1.6;
    case "hd_type": return 1.4;
    case "hd_authority": return 1.2;
    case "has_gate": return 1.1;
    case "defined_center": return 1.0;
    case "open_center": return 0.8;
    case "placement": {
      const planet = objectId.split(":")[1] ?? "";
      if (GENERATIONAL_PLANETS.has(planet)) return 0;
      return PERSONAL_PLANETS.has(planet) ? 1.6 : 0.6;
    }
    default: return 0;
  }
}

function traitLabel(predicate: string, objectId: string, qualifiers: Record<string, unknown> | null): string {
  const tail = objectId.slice(objectId.indexOf(":") + 1);
  switch (predicate) {
    case "has_channel": {
      const name = typeof qualifiers?.name === "string" ? qualifiers.name : null;
      return name ? `the ${tail} channel · ${name.toLowerCase()}` : `the ${tail} channel`;
    }
    case "has_gate": return `gate ${tail}`;
    case "defined_center": return `defined ${tail.toLowerCase()}`;
    case "open_center": return `open ${tail.toLowerCase()}`;
    case "hd_type": return `both ${tail.toLowerCase()}s`;
    case "hd_authority": return `${tail.toLowerCase()} authority, both of you`;
    case "hd_profile": return `the ${tail} profile, both of you`;
    case "placement": {
      const [planet, sign] = tail.split(":");
      return `${planet?.toLowerCase()} in ${sign?.toLowerCase()}`;
    }
    default: return tail;
  }
}

function traitKind(predicate: string): SharedTrait["kind"] {
  switch (predicate) {
    case "has_channel": return "channel";
    case "has_gate": return "gate";
    case "defined_center": return "defined_center";
    case "open_center": return "open_center";
    case "placement": return "placement";
    case "hd_type": return "hd_type";
    case "hd_authority": return "hd_authority";
    case "hd_profile": return "hd_profile";
    default: return "gate";
  }
}

// Per-member highlight tokens for the graph's "tap a star" panel: the loudest
// derived facts only (type, authority, profile, sun/moon). All from graph_edges
// rows, so the no-birth-data invariant holds by construction.
export type MemberHighlight = { label: string; kind: "hd" | "placement" };

export async function memberHighlights(env: Env, memberIds: string[]): Promise<Record<string, MemberHighlight[]>> {
  const out: Record<string, MemberHighlight[]> = {};
  if (memberIds.length === 0) return out;
  const placeholders = memberIds.map(() => "?").join(",");
  const rows = await env.DB.prepare(
    `SELECT subject_id, predicate, object_id FROM graph_edges
     WHERE subject_id IN (${placeholders})
       AND predicate IN ('hd_type', 'hd_authority', 'hd_profile', 'placement')
       AND object_is_member = 0`,
  )
    .bind(...memberIds)
    .all<{ subject_id: string; predicate: string; object_id: string }>();
  for (const uid of memberIds) out[uid] = [];
  for (const r of rows.results ?? []) {
    const list = out[r.subject_id];
    if (!list) continue;
    const tail = r.object_id.slice(r.object_id.indexOf(":") + 1);
    if (r.predicate === "hd_type") list.push({ label: tail.toLowerCase(), kind: "hd" });
    else if (r.predicate === "hd_authority") list.push({ label: `${tail.toLowerCase()} authority`, kind: "hd" });
    else if (r.predicate === "hd_profile") list.push({ label: `profile ${tail}`, kind: "hd" });
    else if (r.predicate === "placement") {
      const [planet, sign] = tail.split(":");
      if (planet === "Sun" || planet === "Moon") {
        list.push({ label: `${planet.toLowerCase()} in ${sign?.toLowerCase()}`, kind: "placement" });
      }
    }
  }
  // stable presentation order: hd facts first, then placements.
  for (const uid of memberIds) {
    out[uid].sort((a, b) => (a.kind === b.kind ? a.label.localeCompare(b.label) : a.kind === "hd" ? -1 : 1));
    out[uid] = out[uid].slice(0, 5);
  }
  return out;
}

export async function circlePairTraits(env: Env, memberIds: string[]): Promise<CirclePairTraits[]> {
  if (memberIds.length < 2) return [];
  const placeholders = memberIds.map(() => "?").join(",");
  const rows = await env.DB.prepare(
    `SELECT subject_id, predicate, object_id, object_is_member, qualifiers_json
     FROM graph_edges
     WHERE subject_id IN (${placeholders})`,
  )
    .bind(...memberIds)
    .all<EdgeRow>();
  const edges = rows.results ?? [];
  const memberSet = new Set(memberIds);

  // trait sets per member: predicate|object -> qualifiers (first seen)
  const traits = new Map<string, Map<string, Record<string, unknown> | null>>();
  for (const uid of memberIds) traits.set(uid, new Map());
  // pair aspect rows keyed "a|b" (canonical)
  const pairAspects = new Map<string, Array<Record<string, unknown>>>();

  for (const e of edges) {
    if (e.object_is_member === 1) {
      if (e.predicate !== "aspect" || !memberSet.has(e.object_id)) continue;
      const key = `${e.subject_id}|${e.object_id}`;
      const q = e.qualifiers_json ? (safeParse(e.qualifiers_json) as Record<string, unknown> | null) : null;
      if (!q) continue;
      const list = pairAspects.get(key) ?? [];
      list.push(q);
      pairAspects.set(key, list);
      continue;
    }
    const t = traits.get(e.subject_id);
    if (!t) continue;
    const key = `${e.predicate}|${e.object_id}`;
    if (!t.has(key)) {
      t.set(key, e.qualifiers_json ? (safeParse(e.qualifiers_json) as Record<string, unknown> | null) : null);
    }
  }

  const sorted = [...memberIds].sort();
  const out: CirclePairTraits[] = [];
  for (let i = 0; i < sorted.length; i += 1) {
    for (let j = i + 1; j < sorted.length; j += 1) {
      const a = sorted[i];
      const b = sorted[j];
      const ta = traits.get(a)!;
      const tb = traits.get(b)!;
      const shared: SharedTrait[] = [];
      for (const [key, quals] of ta) {
        if (!tb.has(key)) continue;
        const sep = key.indexOf("|");
        const predicate = key.slice(0, sep);
        const objectId = key.slice(sep + 1);
        const weight = traitWeight(predicate, objectId);
        if (weight <= 0) continue;
        shared.push({
          kind: traitKind(predicate),
          token: objectId,
          label: traitLabel(predicate, objectId, quals),
          weight,
        });
      }
      shared.sort((x, y) => y.weight - x.weight || x.token.localeCompare(y.token));

      const aspectsRaw = pairAspects.get(`${a}|${b}`) ?? [];
      const aspects: PairAspect[] = aspectsRaw
        .filter((q) => q.generational !== true)
        .sort((x, y) => {
          const ex = typeof x.effective === "number" ? x.effective : 0;
          const ey = typeof y.effective === "number" ? y.effective : 0;
          if (ey !== ex) return ey - ex;
          const ox = typeof x.orb === "number" ? x.orb : 99;
          const oy = typeof y.orb === "number" ? y.orb : 99;
          return ox - oy;
        })
        .slice(0, MAX_ASPECTS_PER_PAIR)
        .map((q) => ({
          label: `${String(q.a_planet ?? "").toLowerCase()} ${String(q.aspect ?? "")} ${String(q.b_planet ?? "").toLowerCase()}`,
          harmonious: q.harmonious === true,
        }));

      out.push({ a, b, shared: shared.slice(0, MAX_SHARED_PER_PAIR), aspects });
    }
  }
  return out;
}
