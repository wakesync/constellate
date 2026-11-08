// Circle graph extraction + sync tests (docs/CIRCLE-GRAPH.md).
// Run: npx tsx apps/api/test/graph-extract.test.ts   (from repo root)
//
// Asserts:
//   1. HD extraction produces exactly the right edges (gates with side/planet/
//      line, channels, defined/open centers, type/authority/profile) and
//      nothing else.
//   2. Natal extraction projects placements only, and NO birth data (date,
//      time, place, coordinates) ever appears in any edge row, even when the
//      payload contains an `input` block with all of it.
//   3. Synastry extraction is canonical-pair-only: non-canonical order THROWS
//      (the orientation bug cannot creep back in), aspects carry their
//      qualifiers, and edges are member-to-member.
//   4. Determinism: same payload in, byte-identical edges out. Edge ids are
//      content hashes, so the same fact can never exist twice.
//   5. Sync: rebuilt / unchanged / cleared transitions against an in-memory D1
//      fake, and pair slices are isolated (rebuilding a-b never touches a-c).

import {
  extractHumanDesign,
  extractNatalPlacements,
  extractSynastryAspects,
  type GraphEdge,
} from "../src/lib/graph/extract";
import { syncHumanDesignEdges, syncSynastryEdges } from "../src/lib/graph/sync";
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

// ---- fixtures: realistic payload shapes (mirroring hd.py / main.py) --------

const HD_PAYLOAD = {
  type: "Generator",
  strategy: "To Respond",
  authority: "Sacral",
  profile: { personality_line: 5, design_line: 1, label: "5/1", name: "Heretic / Investigator" },
  definition: "Single",
  centers: [
    { name: "Head", defined: false },
    { name: "Ajna", defined: false },
    { name: "Throat", defined: true },
    { name: "Sacral", defined: true },
  ],
  channels: [{ key: "20-34", name: "Charisma", gates: [20, 34], centers: ["Throat", "Sacral"] }],
  gates: {
    personality: [
      { planet: "Sun", lon: 123.4, gate: 34, line: 2, color: 1, tone: 3, base: 5 },
      { planet: "Moon", lon: 200.1, gate: 20, line: 4, color: 2, tone: 1, base: 2 },
    ],
    design: [{ planet: "Sun", lon: 35.6, gate: 27, line: 6, color: 4, tone: 2, base: 1 }],
  },
  open_centers: ["Head", "Ajna"],
  design_datetime_utc: "1999-10-01T00:00:00Z",
};

// Natal payload INCLUDING the input block with birth data. The extraction must
// project placements and let none of these strings survive into any row.
const BIRTH_DATE = "2001-01-01";
const BIRTH_TIME = "12:00";
const BIRTH_LAT = 12.3456;
const BIRTH_LNG = -65.4321;
const NATAL_PAYLOAD = {
  engine: "swiss-ephemeris (moshier)",
  input: { date: BIRTH_DATE, time: BIRTH_TIME, lat: BIRTH_LAT, lng: BIRTH_LNG, tz: "UTC" },
  ascendant: { sign: "Scorpio", sign_degree: 14.2, absolute_degree: 224.2 },
  planets: [
    { name: "Sun", sign: "Capricorn", sign_degree: 24.6, absolute_degree: 294.6, house: 3, retrograde: false },
    { name: "Mercury", sign: "Capricorn", sign_degree: 8.9, absolute_degree: 278.9, house: 2, retrograde: true },
  ],
  houses: [{ house: 1, sign: "Scorpio", degree: 14.2, absolute_degree: 224.2 }],
};

const SYNASTRY_PAYLOAD = {
  aspects: [
    {
      person_a_planet: "Sun",
      person_b_planet: "Moon",
      aspect: "trine",
      orb: 1.234,
      harmonious: true,
      weight: 1.0,
      generational: false,
      effective: 0.9,
    },
    {
      person_a_planet: "Mars",
      person_b_planet: "Saturn",
      aspect: "square",
      orb: 3.1,
      harmonious: false,
      weight: 0.6,
      generational: false,
      effective: 0.45,
    },
  ],
  score: 62,
};

const T = 1_753_000_000;

// ---- 1. human design extraction -------------------------------------------

{
  const edges = extractHumanDesign("u_a", HD_PAYLOAD, T);
  const by = (p: string) => edges.filter((e) => e.predicate === p);

  ok(by("has_gate").length === 3, `3 gate activations, got ${by("has_gate").length}`);
  const sunGate = by("has_gate").find((e) => (e.qualifiers as any)?.planet === "Sun" && (e.qualifiers as any)?.side === "personality");
  ok(sunGate?.object_id === "gate:34", "personality Sun gate is gate:34");
  ok((sunGate?.qualifiers as any)?.line === 2, "gate edge carries its line");
  const designGate = by("has_gate").find((e) => (e.qualifiers as any)?.side === "design");
  ok(designGate?.object_id === "gate:27", "design side gate extracted with side qualifier");

  ok(by("has_channel").length === 1 && by("has_channel")[0].object_id === "channel:20-34", "channel edge 20-34");
  ok((by("has_channel")[0].qualifiers as any)?.name === "Charisma", "channel edge carries its name");

  ok(by("defined_center").length === 2, "2 defined centers");
  ok(by("open_center").length === 2, "2 open centers");
  ok(by("defined_center").some((e) => e.object_id === "center:Sacral"), "Sacral defined");
  ok(by("open_center").some((e) => e.object_id === "center:Head"), "Head open");

  ok(by("hd_type")[0]?.object_id === "hdtype:Generator", "type edge");
  ok(by("hd_authority")[0]?.object_id === "authority:Sacral", "authority edge");
  ok(by("hd_profile")[0]?.object_id === "profile:5/1", "profile edge");
  ok(edges.length === 3 + 1 + 2 + 2 + 3, `no extra edges invented (got ${edges.length})`);
  ok(edges.every((e) => e.source === "human_design" && e.object_is_member === 0), "all HD edges trait-typed + sourced");
  ok(new Set(edges.map((e) => e.inputs_hash)).size === 1, "one inputs_hash per payload slice");
}

// ---- 2. natal extraction + crown-jewels non-leakage ------------------------

{
  const edges = extractNatalPlacements("u_a", NATAL_PAYLOAD, T);
  ok(edges.length === 2, `2 placements, got ${edges.length}`);
  const sun = edges.find((e) => e.object_id === "planet_sign:Sun:Capricorn");
  ok(!!sun, "Sun in Capricorn placement edge");
  ok((sun?.qualifiers as any)?.house === 3, "placement carries house");
  const merc = edges.find((e) => e.object_id === "planet_sign:Mercury:Capricorn");
  ok((merc?.qualifiers as any)?.retrograde === true, "placement carries retrograde");

  // The non-negotiable check: serialize EVERY row and scan for birth data.
  const all = JSON.stringify(edges);
  ok(!all.includes(BIRTH_DATE), "birth date never appears in any edge");
  ok(!all.includes(BIRTH_TIME), "birth time never appears in any edge");
  ok(!all.includes(String(BIRTH_LAT)), "birth latitude never appears in any edge");
  ok(!all.includes(String(BIRTH_LNG)), "birth longitude never appears in any edge");
  ok(!all.includes("UTC"), "birth timezone never appears in any edge");

  // The hash must be over the planets slice only, so two people born at
  // different places/times with identical placements produce identical hashes
  // (i.e. birth data does not even influence the provenance hash).
  const otherBirth = { ...NATAL_PAYLOAD, input: { date: "1985-06-06", time: "23:59", lat: 0, lng: 0, tz: "UTC" } };
  const edges2 = extractNatalPlacements("u_a", otherBirth, T);
  ok(edges[0].inputs_hash === edges2[0].inputs_hash, "inputs_hash depends only on placements, not birth input");
}

// ---- 3. synastry extraction: canonical order or throw ----------------------

{
  let threw = false;
  try {
    extractSynastryAspects("u_b", "u_a", SYNASTRY_PAYLOAD, T); // b > a: NOT canonical
  } catch {
    threw = true;
  }
  ok(threw, "non-canonical pair order throws instead of writing flipped edges");

  const edges = extractSynastryAspects("u_a", "u_b", SYNASTRY_PAYLOAD, T);
  ok(edges.length === 2, `2 aspect edges, got ${edges.length}`);
  ok(edges.every((e) => e.subject_id === "u_a" && e.object_id === "u_b" && e.object_is_member === 1), "aspect edges are member-to-member, canonical");
  const trine = edges.find((e) => (e.qualifiers as any)?.aspect === "trine");
  ok((trine?.qualifiers as any)?.a_planet === "Sun" && (trine?.qualifiers as any)?.b_planet === "Moon", "aspect qualifiers keep planet ownership");
  ok((trine?.qualifiers as any)?.harmonious === true && (trine?.qualifiers as any)?.orb === 1.234, "aspect qualifiers carry orb + harmony");
}

// ---- 4. determinism + content-hash ids -------------------------------------

{
  const a = extractHumanDesign("u_a", HD_PAYLOAD, T);
  const b = extractHumanDesign("u_a", HD_PAYLOAD, T);
  ok(JSON.stringify(a) === JSON.stringify(b), "extraction is deterministic (byte-identical)");
  ok(new Set(a.map((e) => e.id)).size === a.length, "edge ids are unique within a slice");
  // same fact => same id even across rebuild timestamps
  const c = extractHumanDesign("u_a", HD_PAYLOAD, T + 999);
  ok(a[0].id === c[0].id, "edge id is stable across rebuilds (content hash, not timestamp)");
  // different subject => different ids
  const d = extractHumanDesign("u_x", HD_PAYLOAD, T);
  ok(a[0].id !== d[0].id, "edge id binds the subject");
}

// ---- 5. sync layer against an in-memory D1 fake ----------------------------

type Row = Record<string, unknown>;

function makeEnv(store: { rows: Row[] }): Env {
  const prepare = (sql: string) => {
    const s = sql.replace(/\s+/g, " ").trim();
    let binds: unknown[] = [];
    const stmt: any = {
      bind(...args: unknown[]) {
        binds = args;
        return stmt;
      },
      _run() {
        if (s.startsWith("DELETE FROM graph_edges")) {
          const [subj, src, obj] = binds;
          store.rows = store.rows.filter((r) => {
            const match =
              r.subject_id === subj && r.source === src && (obj === undefined || r.object_id === obj);
            return !match;
          });
          return null;
        }
        if (s.startsWith("INSERT OR REPLACE INTO graph_edges")) {
          const [id, subject_id, predicate, object_id, object_is_member, qualifiers_json, source, inputs_hash, computed_at] = binds;
          store.rows = store.rows.filter((r) => r.id !== id);
          store.rows.push({ id, subject_id, predicate, object_id, object_is_member, qualifiers_json, source, inputs_hash, computed_at });
          return null;
        }
        return null;
      },
      async first<TT>(): Promise<TT | null> {
        if (s.startsWith("SELECT inputs_hash FROM graph_edges")) {
          const [subj, src, obj] = binds;
          const hit = store.rows.find(
            (r) => r.subject_id === subj && r.source === src && (obj === undefined || r.object_id === obj),
          );
          return (hit ? { inputs_hash: hit.inputs_hash } : null) as TT | null;
        }
        return null;
      },
      async run() {
        return stmt._run();
      },
    };
    return stmt;
  };
  const batch = async (stmts: any[]) => {
    for (const st of stmts) st._run();
    return [];
  };
  return { DB: { prepare, batch } } as unknown as Env;
}

await (async () => {
  const store: { rows: Row[] } = { rows: [] };
  const env = makeEnv(store);

  // first sync: rebuilt
  const r1 = await syncHumanDesignEdges(env, "u_a", HD_PAYLOAD);
  ok(r1 === "rebuilt", `first HD sync rebuilds (got ${r1})`);
  const hdCount = store.rows.length;
  ok(hdCount === 11, `11 HD edges written, got ${hdCount}`);

  // same payload again: unchanged, rows untouched
  const r2 = await syncHumanDesignEdges(env, "u_a", HD_PAYLOAD);
  ok(r2 === "unchanged", `re-sync of unchanged payload is a no-op (got ${r2})`);
  ok(store.rows.length === hdCount, "row count stable on unchanged sync");

  // changed payload: rebuilt, old slice replaced not appended
  const changed = { ...HD_PAYLOAD, authority: "Emotional" };
  const r3 = await syncHumanDesignEdges(env, "u_a", changed);
  ok(r3 === "rebuilt", "changed payload rebuilds the slice");
  ok(store.rows.length === hdCount, "rebuild replaces the slice (no row leak)");
  ok(store.rows.some((r) => r.object_id === "authority:Emotional"), "new authority edge present");
  ok(!store.rows.some((r) => r.object_id === "authority:Sacral"), "stale authority edge gone");

  // pair slices are isolated: a-b and a-c coexist, rebuilding a-b leaves a-c
  await syncSynastryEdges(env, "u_a", "u_b", SYNASTRY_PAYLOAD);
  await syncSynastryEdges(env, "u_a", "u_c", SYNASTRY_PAYLOAD);
  const pairRows = () => store.rows.filter((r) => r.source === "synastry");
  ok(pairRows().length === 4, `two pair slices of 2 edges each, got ${pairRows().length}`);
  const changedSyn = { aspects: [SYNASTRY_PAYLOAD.aspects[0]] };
  const r4 = await syncSynastryEdges(env, "u_a", "u_b", changedSyn);
  ok(r4 === "rebuilt", "changed synastry payload rebuilds its pair slice");
  ok(pairRows().filter((r) => r.object_id === "u_b").length === 1, "a-b slice rebuilt to 1 edge");
  ok(pairRows().filter((r) => r.object_id === "u_c").length === 2, "a-c slice untouched by a-b rebuild");

  // empty payload clears the slice
  const r5 = await syncSynastryEdges(env, "u_a", "u_b", { aspects: [] });
  ok(r5 === "cleared", "empty payload clears the slice");
  ok(pairRows().filter((r) => r.object_id === "u_b").length === 0, "a-b slice cleared");
  const r6 = await syncSynastryEdges(env, "u_a", "u_b", { aspects: [] });
  ok(r6 === "unchanged", "clearing an already-empty slice is a no-op");
})();

console.log(`\ngraph-extract: ${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error(`${failures} FAILURES`);
  process.exit(1);
}
