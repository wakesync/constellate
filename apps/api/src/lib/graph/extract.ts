// Circle graph extraction (docs/CIRCLE-GRAPH.md). PURE functions that project
// deterministic engine payloads into typed graph edges. No D1, no fetch, no LLM
// anywhere near this file: same payload in, byte-identical edges out (the tests
// assert this determinism directly).
//
// Invariants enforced here and asserted in test/graph-extract.test.ts:
//   - every edge carries source + inputs_hash tracing it to the exact payload
//     bytes it was derived from (no fact without a deterministic receipt)
//   - no birth data ever enters an edge: no dates, times, places, coordinates.
//     Extraction receives only computed payloads, and the tests scan every
//     produced row for birth-shaped content.
//   - pair edges (aspects) are CANONICAL ordered (subject_id < object_id), the
//     same pair() convention as synastry_reports. A non-canonical call throws
//     rather than silently writing a flipped edge. This is the synastry
//     orientation bug's fix carried forward, not re-learned.
//   - edge ids are content hashes: the same fact can never exist twice.

import { stableStringify, inputsHash } from "../convergence/score";

export type GraphEdge = {
  id: string;
  subject_id: string;
  predicate:
    | "has_gate"
    | "has_channel"
    | "defined_center"
    | "open_center"
    | "hd_type"
    | "hd_authority"
    | "hd_profile"
    | "placement"
    | "aspect";
  object_id: string;              // trait token, or a user id when object_is_member
  object_is_member: 0 | 1;
  qualifiers: Record<string, unknown> | null;
  source: "human_design" | "natal" | "synastry";
  inputs_hash: string;
  computed_at: number;
};

// Deterministic edge id: hash of everything that identifies the fact (but NOT
// computed_at or inputs_hash, so a rebuild of an unchanged payload yields the
// same ids and the sync layer can treat rebuilds as idempotent).
function edgeId(e: Omit<GraphEdge, "id" | "inputs_hash" | "computed_at">): string {
  return inputsHash({
    s: e.subject_id,
    p: e.predicate,
    o: e.object_id,
    m: e.object_is_member,
    q: e.qualifiers ? stableStringify(e.qualifiers) : null,
    src: e.source,
  });
}

function mk(
  partial: Omit<GraphEdge, "id" | "inputs_hash" | "computed_at">,
  hash: string,
  computedAt: number,
): GraphEdge {
  return { ...partial, id: edgeId(partial), inputs_hash: hash, computed_at: computedAt };
}

// ---- human design ---------------------------------------------------------
// Payload shape: services/astro/hd.py compute_human_design(). We read gates
// (personality + design activations), channels, centers, type, authority,
// profile. Anything absent is simply skipped: extraction never invents.

type HdActivation = { planet?: string; gate?: number; line?: number };
type HdPayload = {
  type?: string;
  authority?: string;
  profile?: { label?: string; name?: string };
  centers?: Array<{ name?: string; defined?: boolean }>;
  channels?: Array<{ key?: string; name?: string; gates?: number[]; centers?: string[] }>;
  gates?: { personality?: HdActivation[]; design?: HdActivation[] };
};

export function extractHumanDesign(userId: string, payload: unknown, computedAt: number): GraphEdge[] {
  const p = (payload ?? {}) as HdPayload;
  const hash = inputsHash({ human_design: payload ?? null });
  const edges: GraphEdge[] = [];
  const src = "human_design" as const;

  for (const side of ["personality", "design"] as const) {
    for (const a of p.gates?.[side] ?? []) {
      if (typeof a.gate !== "number") continue;
      edges.push(
        mk(
          {
            subject_id: userId,
            predicate: "has_gate",
            object_id: `gate:${a.gate}`,
            object_is_member: 0,
            qualifiers: { side, planet: a.planet ?? null, line: a.line ?? null },
            source: src,
          },
          hash,
          computedAt,
        ),
      );
    }
  }

  for (const ch of p.channels ?? []) {
    if (!ch.key) continue;
    edges.push(
      mk(
        {
          subject_id: userId,
          predicate: "has_channel",
          object_id: `channel:${ch.key}`,
          object_is_member: 0,
          qualifiers: { name: ch.name ?? null, centers: ch.centers ?? null },
          source: src,
        },
        hash,
        computedAt,
      ),
    );
  }

  for (const c of p.centers ?? []) {
    if (!c.name) continue;
    edges.push(
      mk(
        {
          subject_id: userId,
          predicate: c.defined ? "defined_center" : "open_center",
          object_id: `center:${c.name}`,
          object_is_member: 0,
          qualifiers: null,
          source: src,
        },
        hash,
        computedAt,
      ),
    );
  }

  if (p.type) {
    edges.push(
      mk(
        { subject_id: userId, predicate: "hd_type", object_id: `hdtype:${p.type}`, object_is_member: 0, qualifiers: null, source: src },
        hash,
        computedAt,
      ),
    );
  }
  if (p.authority) {
    edges.push(
      mk(
        { subject_id: userId, predicate: "hd_authority", object_id: `authority:${p.authority}`, object_is_member: 0, qualifiers: null, source: src },
        hash,
        computedAt,
      ),
    );
  }
  if (p.profile?.label) {
    edges.push(
      mk(
        {
          subject_id: userId,
          predicate: "hd_profile",
          object_id: `profile:${p.profile.label}`,
          object_is_member: 0,
          qualifiers: p.profile.name ? { name: p.profile.name } : null,
          source: src,
        },
        hash,
        computedAt,
      ),
    );
  }

  return edges;
}

// ---- natal placements -----------------------------------------------------
// Payload shape: services/astro/main.py compute_chart() (stored in
// birth_data.natal_chart_json). We take ONLY the derived symbolic facts:
// planet, sign, house, retrograde. Degrees are symbolic chart positions, fine;
// the input block (date/time/lat/lng/tz) is birth data and is NEVER read.

type NatalPayload = {
  planets?: Array<{ name?: string; sign?: string; house?: number; retrograde?: boolean; sign_degree?: number }>;
};

export function extractNatalPlacements(userId: string, payload: unknown, computedAt: number): GraphEdge[] {
  const p = (payload ?? {}) as NatalPayload;
  // Hash only the planets slice: the payload's `input` block contains birth
  // data, which must not influence (or ride along inside) any graph row.
  const hash = inputsHash({ natal_planets: p.planets ?? null });
  const edges: GraphEdge[] = [];

  for (const pl of p.planets ?? []) {
    if (!pl.name || !pl.sign) continue;
    edges.push(
      mk(
        {
          subject_id: userId,
          predicate: "placement",
          object_id: `planet_sign:${pl.name}:${pl.sign}`,
          object_is_member: 0,
          qualifiers: {
            house: typeof pl.house === "number" ? pl.house : null,
            retrograde: pl.retrograde === true,
            sign_degree: typeof pl.sign_degree === "number" ? pl.sign_degree : null,
          },
          source: "natal",
        },
        hash,
        computedAt,
      ),
    );
  }
  return edges;
}

// ---- synastry aspects -----------------------------------------------------
// Payload shape: services/astro/main.py synastry() aspects list. Pair edges are
// canonical: subject_id MUST sort before object_id. The caller passes members in
// canonical order (pair(a,b) as everywhere else); we throw on violation instead
// of silently flipping, so an orientation bug cannot creep back in.

type SynastryAspect = {
  person_a_planet?: string;
  person_b_planet?: string;
  aspect?: string;
  orb?: number;
  harmonious?: boolean;
  generational?: boolean;
  weight?: number;
  effective?: number;
};
type SynastryPayload = { aspects?: SynastryAspect[] };

export function extractSynastryAspects(
  userAId: string,
  userBId: string,
  payload: unknown,
  computedAt: number,
): GraphEdge[] {
  if (!(userAId < userBId)) {
    throw new Error(
      `synastry graph edges require canonical pair order (a < b); got a=${userAId} b=${userBId}`,
    );
  }
  const p = (payload ?? {}) as SynastryPayload;
  const hash = inputsHash({ synastry_aspects: p.aspects ?? null });
  const edges: GraphEdge[] = [];

  for (const a of p.aspects ?? []) {
    if (!a.person_a_planet || !a.person_b_planet || !a.aspect) continue;
    edges.push(
      mk(
        {
          subject_id: userAId,
          predicate: "aspect",
          object_id: userBId,
          object_is_member: 1,
          qualifiers: {
            a_planet: a.person_a_planet,
            b_planet: a.person_b_planet,
            aspect: a.aspect,
            orb: typeof a.orb === "number" ? a.orb : null,
            harmonious: a.harmonious === true,
            generational: a.generational === true,
            effective: typeof a.effective === "number" ? a.effective : null,
          },
          source: "synastry",
        },
        hash,
        computedAt,
      ),
    );
  }
  return edges;
}
