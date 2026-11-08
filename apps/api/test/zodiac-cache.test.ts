// Zodiac lens data-layer invariants .
// Run: npx tsx apps/api/test/zodiac-cache.test.ts   (from repo root)
//
// This exercises the REAL production surface: the actual Hono app from
// src/index.ts, over a real SQLite database with migrations 0001..0012
// applied, with the astro sidecar + attested SDK stubbed at the fetch boundary.
// Every request below travels the same code path prod executes.
//
// Asserts:
//   1. PREFERENCE: POST /me/profile validates zodiac_system strictly
//      ('tropical'|'sidereal', anything else 400); GET /me returns it.
//   2. CACHE ISOLATION: flipping the preference produces DISTINCT cache rows
//      (HD, GK, chart, astrocartography, readings); flipping back serves the
//      ORIGINAL rows byte-identical, with no recompute and no cross-serve.
//   3. TROPICAL CANON: convergence/harmony/circle-graph inputs stay tropical
//      even when the user preference is sidereal. A poisoned sidereal HD row
//      must never surface in the graph, and no canon-path sidecar call may
//      carry zodiac=sidereal.
//   4. GENERATION TAGGING: synastry casts record the zodiac they were cast
//      under; the generations list returns it; pre-0012 rows read 'tropical'.
//
// These tests FAIL on the pre-change tree: migration 0012 does not exist
// there, users.zodiac_system does not exist, and the sidecar contract carries
// no zodiac field. NO REAL BIRTH DATA: every birth below is synthetic.

import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

let failures = 0;
let checks = 0;
function ok(cond: boolean, msg: string) {
  checks++;
  if (!cond) {
    failures++;
    console.error("  FAIL:", msg);
  }
}

// ---------------------------------------------------------------------------
// D1 shim over node:sqlite. Supports the shapes the API uses: prepare/bind/
// first/all/run + batch. Numbered (?1) and anonymous (?) params both work
// natively in SQLite.
// ---------------------------------------------------------------------------
const db = new DatabaseSync(":memory:");

function makeD1() {
  const prepare = (sql: string) => {
    let binds: unknown[] = [];
    const stmt = {
      bind(...args: unknown[]) {
        binds = args;
        return stmt;
      },
      async first<T>(): Promise<T | null> {
        const row = db.prepare(sql).get(...(binds as never[]));
        return (row ?? null) as T | null;
      },
      async all<T>(): Promise<{ results: T[] }> {
        return { results: db.prepare(sql).all(...(binds as never[])) as T[] };
      },
      async run(): Promise<{ success: boolean }> {
        db.prepare(sql).run(...(binds as never[]));
        return { success: true };
      },
      _exec(): void {
        db.prepare(sql).run(...(binds as never[]));
      },
    };
    return stmt;
  };
  return {
    prepare,
    async batch(stmts: Array<{ _exec: () => void }>): Promise<unknown[]> {
      for (const s of stmts) s._exec();
      return [];
    },
  };
}

// Apply ALL migrations in order, exactly like wrangler does.
const migrationsDir = join(here, "..", "migrations");
for (const f of readdirSync(migrationsDir).sort()) {
  if (!f.endsWith(".sql")) continue;
  db.exec(readFileSync(join(migrationsDir, f), "utf8"));
}

// ---------------------------------------------------------------------------
// fetch stub: fake astro sidecar + fake attested SDK. Every sidecar call is
// logged with its path + zodiac so the tests can assert exactly which sky
// each computation was requested under.
// ---------------------------------------------------------------------------
const ASTRO_URL = "http://astro.test";
type AstroCall = { path: string; zodiac: unknown };
const astroCalls: AstroCall[] = [];
const llmCalls: Array<{ system: string; user: string }> = [];

function fakeChart(zodiac: string) {
  // Same synthetic birth, visibly different frame. NOT real data.
  return {
    planets: [
      { name: "Sun", sign: zodiac === "sidereal" ? "Sagittarius" : "Capricorn", sign_degree: 10, absolute_degree: 280, house: 1, retrograde: false },
      { name: "Moon", sign: zodiac === "sidereal" ? "Cancer" : "Leo", sign_degree: 5, absolute_degree: 125, house: 7, retrograde: false, ...(zodiac === "sidereal" ? { nakshatra: { name: "Pushya", index: 8, pada: 2, degree_in_nakshatra: 5 } } : {}) },
    ],
    ascendant: { absolute_degree: 100 },
    midheaven: { absolute_degree: 10 },
    zodiac,
  };
}

function fakeHd(zodiac: string) {
  return {
    type: zodiac === "sidereal" ? "Generator" : "Projector",
    authority: zodiac === "sidereal" ? "Sacral" : "Splenic",
    profile: { label: "3/5", name: "martyr heretic" },
    centers: [{ name: "Sacral", defined: zodiac === "sidereal" }],
    channels: [],
    gates: { personality: [{ planet: "Sun", gate: zodiac === "sidereal" ? 34 : 20, line: 1 }], design: [] },
    marker: `computed-under-${zodiac}`,
  };
}

function fakeGk(zodiac: string) {
  return { spheres: { lifes_work: { gene_key: zodiac === "sidereal" ? 34 : 20 } }, marker: `computed-under-${zodiac}` };
}

import { TinfoilAI } from "../../../server/node_modules/tinfoil/dist/index.js";
TinfoilAI.prototype.ready = async function () {};
TinfoilAI.prototype.getVerificationDocument = async function () { return { securityVerified: true } as any; };
Object.defineProperty(TinfoilAI.prototype, "chat", { get() { return { completions: { create: async (body: any) => {
  const blob = body.messages[1].content;
  llmCalls.push({ system: body.messages[0].content, user: blob });
  const marker = blob.includes("FRAME_TAGGED_V1") ? "dual-sky" : blob.includes("computed-under-sidereal") ? "sidereal-sky" : "tropical-sky";
  return { choices: [{ message: { content: `a reading written under the ${marker}` }, finish_reason: "stop" }] };
} } }; } });
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.startsWith(ASTRO_URL)) {
    const path = url.slice(ASTRO_URL.length);
    if (path === "/healthz") return new Response(JSON.stringify({ ok: true }), { status: 200 });
    const body = JSON.parse(String(init?.body ?? "{}")) as { zodiac?: string };
    const zodiac = body.zodiac ?? "(absent)";
    astroCalls.push({ path, zodiac });
    const z = zodiac === "sidereal" ? "sidereal" : "tropical";
    let payload: unknown;
    if (path === "/natal" || path === "/transits") payload = fakeChart(z);
    else if (path === "/humandesign") payload = fakeHd(z);
    else if (path === "/genekeys") payload = fakeGk(z);
    else if (path === "/synastry") payload = { aspects: [{ person_a_planet: "Sun", person_b_planet: "Moon", aspect: "trine", orb: 1.2, harmonious: true }], marker: `computed-under-${z}` };
    else if (path === "/astrocartography") payload = { engine: "fake", generated_at: "now", lines: [], interpretations: {}, marker: `computed-under-${z}` };
    else return new Response("not found", { status: 404 });
    return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
  }
  return realFetch(input as never, init as never);
}) as typeof fetch;

// The 1%-random sweep middleware touches c.executionCtx; pin random above the
// threshold so tests are deterministic.
Math.random = () => 0.5;

// ---------------------------------------------------------------------------
// seed: two users in one constellation, sessions, SYNTHETIC birth data.
// ---------------------------------------------------------------------------
const now = Math.floor(Date.now() / 1000);
db.exec(`
  INSERT INTO users (id, email, display_name, created_at) VALUES
    ('usr_alice', 'alice@test.local', 'alice', ${now}),
    ('usr_bob',   'bob@test.local',   'bob',   ${now});
  INSERT INTO sessions (id, user_id, expires_at) VALUES
    ('ses_alice', 'usr_alice', ${now + 60 * 60 * 24 * 30}),
    ('ses_bob',   'usr_bob',   ${now + 60 * 60 * 24 * 30});
  INSERT INTO constellations (id, name, creator_id, invite_token, created_at) VALUES
    ('con_test', 'test circle', 'usr_alice', 'tok_test_invite_1234', ${now});
  INSERT INTO memberships (constellation_id, user_id, role, joined_at) VALUES
    ('con_test', 'usr_alice', 'creator', ${now}),
    ('con_test', 'usr_bob', 'member', ${now});
`);

const env = {
  DB: makeD1(),
  RP_ID: "test.local",
  RP_NAME: "test",
  APP_ORIGIN: "http://test.local",
  ASTRO_URL,
  ASTRO_BEARER: "test-bearer",
  TINFOIL_API_KEY: "synthetic-inference-key",
  TINFOIL_MODEL: "synthetic-model",
} as const;

const execCtx = { waitUntil(_p: Promise<unknown>) {}, passThroughOnException() {} };

async function main() {
  const { default: app } = await import("../src/index");

  const req = async (method: string, path: string, session: string, body?: unknown) => {
    const res = await app.request(
      path,
      {
        method,
        headers: {
          authorization: `Bearer ${session}`,
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      },
      env as never,
      execCtx as never,
    );
    let json: any = null;
    try { json = await res.json(); } catch { /* non-json */ }
    return { status: res.status, json };
  };

  // Save synthetic birth data through the REAL endpoint (writes canon tropical
  // chart into birth_data, clears natal_chart_cache).
  for (const [ses, tz] of [["ses_alice", "Europe/London"], ["ses_bob", "Europe/London"]] as const) {
    const r = await req("POST", "/me/birth-data", ses, {
      date_local: "1990-01-01T12:00",
      timezone: tz,
      place_name: "Test City",
      latitude: 51.5,
      longitude: 0,
    });
    ok(r.status === 200 && r.json?.ok === true, `birth-data saved (${ses})`);
  }
  ok(astroCalls.filter((c) => c.path === "/natal").every((c) => c.zodiac === "tropical"),
    "canon natal chart at birth-save time is computed tropical");

  // ---- 1. preference endpoint + validation --------------------------------
  console.log("preference endpoint");
  {
    const bad = await req("POST", "/me/profile", "ses_alice", { zodiac_system: "vedic" });
    ok(bad.status === 400, "zodiac_system 'vedic' rejected with 400");
    const bad2 = await req("POST", "/me/profile", "ses_alice", { zodiac_system: "SIDEREAL" });
    ok(bad2.status === 400, "zodiac_system 'SIDEREAL' (wrong case) rejected");
    const me0 = await req("GET", "/me", "ses_alice");
    ok(me0.json?.zodiac_system === "tropical", "GET /me defaults to tropical");
    const set = await req("POST", "/me/profile", "ses_alice", { zodiac_system: "sidereal" });
    ok(set.status === 200 && set.json?.zodiac_system === "sidereal", "POST accepts 'sidereal' and echoes it");
    const me1 = await req("GET", "/me", "ses_alice");
    ok(me1.json?.zodiac_system === "sidereal", "GET /me returns the flipped preference");
    // back to tropical for the isolation walk-through below
    await req("POST", "/me/profile", "ses_alice", { zodiac_system: "tropical" });
  }

  // ---- 2. cache isolation: HD --------------------------------------------
  console.log("cache isolation: human design");
  {
    const t1 = await req("GET", "/me/humandesign", "ses_alice");
    ok(t1.status === 200 && t1.json?.hd?.marker === "computed-under-tropical", "tropical read computes a tropical payload");
    ok(t1.json?.zodiac_system === "tropical", "response labels its zodiac");

    await req("POST", "/me/profile", "ses_alice", { zodiac_system: "sidereal" });
    const callsBefore = astroCalls.length;
    const s1 = await req("GET", "/me/humandesign", "ses_alice");
    ok(s1.json?.hd?.marker === "computed-under-sidereal", "flip -> sidereal payload, never the cached tropical row");
    ok(astroCalls.slice(callsBefore).some((c) => c.path === "/humandesign" && c.zodiac === "sidereal"),
      "sidecar was asked for the sidereal sky");

    const rows = db.prepare("SELECT zodiac_system, payload_json FROM human_design_cache WHERE user_id = 'usr_alice' ORDER BY zodiac_system").all() as Array<{ zodiac_system: string; payload_json: string }>;
    ok(rows.length === 2, `flip produced a DISTINCT cache row (2 rows, got ${rows.length})`);
    ok(rows.map((r) => r.zodiac_system).join(",") === "sidereal,tropical", "rows keyed by zodiac_system");
    const tropicalRowBytes = rows.find((r) => r.zodiac_system === "tropical")!.payload_json;

    await req("POST", "/me/profile", "ses_alice", { zodiac_system: "tropical" });
    const callsBefore2 = astroCalls.length;
    const t2 = await req("GET", "/me/humandesign", "ses_alice");
    ok(t2.json?.hd?.marker === "computed-under-tropical", "flip back -> original tropical payload");
    ok(astroCalls.length === callsBefore2, "flip back hits the cache, no recompute");
    const tropicalRowAfter = (db.prepare("SELECT payload_json FROM human_design_cache WHERE user_id = 'usr_alice' AND zodiac_system = 'tropical'").get() as { payload_json: string }).payload_json;
    ok(tropicalRowAfter === tropicalRowBytes, "original tropical row is byte-identical (untouched by the flip)");
  }

  // ---- 2b. cache isolation: GK, chart, astrocartography -------------------
  console.log("cache isolation: gene keys, chart, astrocartography");
  {
    const t = await req("GET", "/me/genekeys", "ses_alice");
    ok(t.json?.gk?.marker === "computed-under-tropical", "gk tropical");
    await req("POST", "/me/profile", "ses_alice", { zodiac_system: "sidereal" });
    const s = await req("GET", "/me/genekeys", "ses_alice");
    ok(s.json?.gk?.marker === "computed-under-sidereal", "gk sidereal after flip");
    const gkRows = db.prepare("SELECT COUNT(*) AS n FROM gene_keys_cache WHERE user_id = 'usr_alice'").get() as { n: number };
    ok(gkRows.n === 2, "gk: two coexisting rows");

    const sc = await req("GET", "/me/chart", "ses_alice");
    ok(sc.json?.zodiac_system === "sidereal", "chart labels sidereal");
    ok(sc.json?.chart?.planets?.[0]?.sign === "Sagittarius", "sidereal chart has shifted sun sign");
    const canonBefore = (db.prepare("SELECT natal_chart_json FROM birth_data WHERE user_id = 'usr_alice'").get() as { natal_chart_json: string }).natal_chart_json;
    await req("POST", "/me/profile", "ses_alice", { zodiac_system: "tropical" });
    const tc = await req("GET", "/me/chart", "ses_alice");
    ok(tc.json?.chart?.planets?.[0]?.sign === "Capricorn", "flip back -> canon tropical chart served");
    const canonAfter = (db.prepare("SELECT natal_chart_json FROM birth_data WHERE user_id = 'usr_alice'").get() as { natal_chart_json: string }).natal_chart_json;
    ok(canonAfter === canonBefore, "canon tropical chart in birth_data untouched by the sidereal flip");

    const acgT = await req("GET", "/me/astrocartography", "ses_alice");
    ok(acgT.json?.marker === "computed-under-tropical", "acg tropical");
    await req("POST", "/me/profile", "ses_alice", { zodiac_system: "sidereal" });
    const acgS = await req("GET", "/me/astrocartography", "ses_alice");
    ok(acgS.json?.marker === "computed-under-sidereal", "acg sidereal after flip");
    const acgRows = db.prepare("SELECT COUNT(*) AS n FROM astrocartography_cache WHERE user_id = 'usr_alice'").get() as { n: number };
    ok(acgRows.n === 2, "acg: two coexisting rows");
    await req("POST", "/me/profile", "ses_alice", { zodiac_system: "tropical" });
  }

  // ---- 2c. dual-sky readings, frame-tagged and preference-independent -----
  console.log("dual-sky personal reading prompts");
  {
    const before = llmCalls.length;
    const natal = await req("GET", "/me/chart/reading", "ses_alice");
    ok(natal.status === 200 && natal.json?.reading_mode === "dual_sky", "natal reading uses dual-sky mode");
    const natalCall = llmCalls[before];
    const natalCtx = JSON.parse(natalCall.user);
    ok(natalCtx.frames.tropical_seasonal.frame === "tropical", "seasonal placements carry explicit tropical frame tag");
    ok(natalCtx.frames.sidereal_fixed_star.frame === "sidereal", "fixed-star placements carry explicit sidereal frame tag");
    const tropMoon = natalCtx.frames.tropical_seasonal.placements.find((p: any) => p.body === "Moon");
    const sidMoon = natalCtx.frames.sidereal_fixed_star.placements.find((p: any) => p.body === "Moon");
    ok(tropMoon.sign === "Leo" && !tropMoon.nakshatra, "tropical Moon remains Leo and never inherits sidereal nakshatra");
    ok(sidMoon.sign === "Cancer" && sidMoon.nakshatra.name === "Pushya" && sidMoon.nakshatra.voice.includes("nourishment"), "sidereal Moon remains Cancer with its own Pushya voice");
    ok(natalCall.system.includes("lead with CONVERGENCE") && natalCall.system.includes("seasonal self beside fixed-star self"), "prompt requires convergence first and interprets divergence");

    const h1 = await req("GET", "/me/humandesign/reading", "ses_alice");
    ok(h1.json?.text?.includes("dual-sky") && h1.json?.reading_mode === "dual_sky", "HD reading synthesizes both skies");
    const hdCall = llmCalls.find((x) => x.user.includes('"system":"human_design"'))!;
    const hdCtx = JSON.parse(hdCall.user);
    ok(hdCtx.frames.tropical_canon.payload.type === "Projector", "HD tropical canon stays tagged Projector");
    ok(hdCtx.frames.sidereal_alternate.payload.type === "Generator", "HD fixed-star alternate stays tagged Generator");
    ok(hdCall.system.includes("through the fixed-star lens your design shifts to X"), "HD prompt mandates honest alternate-lens wording");

    await req("POST", "/me/profile", "ses_alice", { zodiac_system: "sidereal" });
    const calls = llmCalls.length;
    const h2 = await req("GET", "/me/humandesign/reading", "ses_alice");
    ok(h2.json?.text === h1.json?.text && llmCalls.length === calls, "view preference does not fork or regenerate the dual-sky reading");
    await req("POST", "/me/profile", "ses_alice", { zodiac_system: "tropical" });
    const legacyRows = db.prepare("SELECT COUNT(*) AS n FROM readings_cache WHERE user_id='usr_alice' AND kind IN ('humandesign','genekeys')").get() as { n: number };
    ok(legacyRows.n === 0, "legacy lens-specific cache namespace remains untouched, new reads use distinct kinds");
  }

  // ---- 3. tropical canon: convergence/harmony/graph -----------------------
  console.log("tropical canon: convergence + harmony + circle graph");
  {
    // Alice prefers sidereal. Her sidereal HD row says Generator; her tropical
    // row says Projector. The canon paths must see PROJECTOR only.
    await req("POST", "/me/profile", "ses_alice", { zodiac_system: "sidereal" });

    const canonStart = astroCalls.length;
    const conv = await req("GET", "/me/convergence", "ses_alice");
    ok(conv.status === 200, "convergence computes for a sidereal-preference user");
    ok(astroCalls.slice(canonStart).every((c) => c.zodiac !== "sidereal"),
      "no sidereal sidecar call on the convergence path");

    const harm = await req("GET", "/harmony/pair/usr_bob", "ses_alice");
    ok(harm.status === 200, "harmony computes for a sidereal-preference user");
    ok(astroCalls.slice(canonStart).every((c) => c.zodiac !== "sidereal"),
      "no sidereal sidecar call on the harmony path");

    const graph = await req("GET", "/constellations/con_test/graph", "ses_alice");
    ok(graph.status === 200, "graph renders");
    const graphBlob = JSON.stringify(graph.json);
    ok(graphBlob.includes("projector"), "graph highlights carry alice's TROPICAL hd type (projector)");
    ok(!graphBlob.toLowerCase().includes("generator"), "the poisoned sidereal row (generator) NEVER surfaces in the graph");
    ok(astroCalls.slice(canonStart).every((c) => c.zodiac !== "sidereal"),
      "no sidereal sidecar call on the graph path");

    // And the graph edge table itself: every hd edge for alice derives from
    // the tropical payload (gate 20, not the sidereal gate 34).
    const gateEdges = db.prepare("SELECT object_id FROM graph_edges WHERE subject_id = 'usr_alice' AND predicate = 'has_gate'").all() as Array<{ object_id: string }>;
    ok(gateEdges.some((e) => e.object_id === "gate:20") && !gateEdges.some((e) => e.object_id === "gate:34"),
      "graph_edges derive from the tropical HD payload only");
  }

  // ---- 4. synastry generations record their sky ---------------------------
  console.log("synastry generation zodiac tagging");
  {
    // Pre-0012 rows (no zodiac written) must read as tropical: simulate a
    // legacy row via the migration default.
    db.exec(`INSERT INTO synastry_generations (id, user_a_id, user_b_id, lens, aspects_json, narrative, generated_at, degraded)
             VALUES ('syng_legacy', 'usr_alice', 'usr_bob', 'friend', '{}', 'old reading', ${now - 1000}, 0)`);
    const legacy = db.prepare("SELECT zodiac_system FROM synastry_generations WHERE id = 'syng_legacy'").get() as { zodiac_system: string };
    ok(legacy.zodiac_system === "tropical", "legacy generations backfill as tropical");

    // Alice (sidereal preference) casts: the generation records sidereal.
    const cast = await req("POST", "/synastry/usr_bob", "ses_alice");
    ok(cast.status === 200, "synastry cast succeeds");
    ok(cast.json?.generation?.zodiac_system === "sidereal", "fresh cast tagged with the caster's sky (sidereal)");
    ok(cast.json?.user_a?.chart?.planets?.[0]?.sign === "Sagittarius"
      && cast.json?.user_b?.chart?.planets?.[0]?.sign === "Sagittarius",
      "sidereal cast returns both mini charts under the generation's sidereal sky");
    const sidCastPrompt = llmCalls.at(-1)!;
    ok(sidCastPrompt.system.includes("sidereal fixed-star sky (Lahiri)") && sidCastPrompt.user.includes('"zodiac_system":"sidereal"'), "synastry narrative prompt states its single-sky sidereal provenance");
    ok(astroCalls.some((c) => c.path === "/synastry" && c.zodiac === "sidereal"), "synastry grid computed under the sidereal sky");

    const gens = await req("GET", "/synastry/usr_bob/generations", "ses_alice");
    const metas = gens.json?.generations as Array<{ id: string; zodiac_system: string }>;
    ok(Array.isArray(metas) && metas.length >= 2, "generations list has legacy + fresh");
    ok(metas.every((m) => typeof m.zodiac_system === "string"), "every generation meta carries zodiac_system");
    ok(metas.find((m) => m.id === "syng_legacy")?.zodiac_system === "tropical", "legacy meta reads tropical");
    ok(metas.find((m) => m.id !== "syng_legacy")?.zodiac_system === "sidereal", "fresh meta reads sidereal");

    // Flip back to tropical and cast again: tagged tropical; the sidereal
    // generation is untouched history.
    await req("POST", "/me/profile", "ses_alice", { zodiac_system: "tropical" });
    const cast2 = await req("POST", "/synastry/usr_bob", "ses_alice");
    ok(cast2.json?.generation?.zodiac_system === "tropical", "next cast under tropical is tagged tropical");
    const tropId = cast2.json?.generation?.id as string;
    const sidId = cast.json?.generation?.id as string;
    const activeTrop = await req("GET", "/synastry/usr_bob", "ses_alice");
    ok(activeTrop.json?.generation?.id === tropId && activeTrop.json?.generation?.zodiac_system === "tropical",
      "GET active resolves under caller's current tropical sky");
    ok(activeTrop.json?.user_a?.chart?.planets?.[0]?.sign === "Capricorn"
      && activeTrop.json?.user_b?.chart?.planets?.[0]?.sign === "Capricorn",
      "tropical active reading returns both mini charts under its tropical sky");
    await req("POST", "/me/profile", "ses_alice", { zodiac_system: "sidereal" });
    const activeSid = await req("GET", "/synastry/usr_bob", "ses_alice");
    ok(activeSid.json?.generation?.id === sidId && activeSid.json?.generation?.zodiac_system === "sidereal",
      "flipping preference swaps to the sidereal active reading without regeneration");
    ok(activeSid.json?.user_a?.chart?.planets?.[0]?.sign === "Sagittarius"
      && activeSid.json?.user_b?.chart?.planets?.[0]?.sign === "Sagittarius",
      "sidereal active reading returns both mini charts under its sidereal sky");
    const previewTrop = await req("GET", `/synastry/usr_bob?generation=${encodeURIComponent(tropId)}`, "ses_alice");
    ok(previewTrop.json?.generation?.id === tropId && previewTrop.json?.generation?.zodiac_system === "tropical",
      "explicit ?generation remains a cross-sky history preview");
    ok(previewTrop.json?.user_a?.chart?.planets?.[0]?.sign === "Capricorn"
      && previewTrop.json?.user_b?.chart?.planets?.[0]?.sign === "Capricorn",
      "cross-sky history preview follows the generation sky, not the current preference");
    const switched = await req("PUT", "/synastry/usr_bob/active", "ses_alice", { generation_id: "syng_legacy" });
    ok(switched.status === 200 && switched.json?.generation?.zodiac_system === "tropical",
      "PUT writes the pointer for the target generation's sky");
    const listAfterSwitch = await req("GET", "/synastry/usr_bob/generations", "ses_alice");
    ok(listAfterSwitch.json?.active_zodiac === "sidereal", "generations list returns caller active_zodiac");
    const activeMetas = (listAfterSwitch.json?.generations ?? []).filter((m: { active?: boolean }) => m.active);
    ok(activeMetas.length === 2
      && activeMetas.some((m: { id: string }) => m.id === sidId)
      && activeMetas.some((m: { id: string }) => m.id === "syng_legacy"),
      "generations list marks one active reading per sky");
    const stillSid = await req("GET", "/synastry/usr_bob", "ses_alice");
    ok(stillSid.json?.generation?.id === sidId, "switching the tropical pointer does not disturb sidereal active");
    await req("POST", "/me/profile", "ses_alice", { zodiac_system: "tropical" });
    const nowLegacy = await req("GET", "/synastry/usr_bob", "ses_alice");
    ok(nowLegacy.json?.generation?.id === "syng_legacy", "tropical active pointer moved to the selected tropical generation");
    const all = db.prepare("SELECT zodiac_system, COUNT(*) AS n FROM synastry_generations WHERE user_a_id='usr_alice' GROUP BY zodiac_system ORDER BY zodiac_system").all() as Array<{ zodiac_system: string; n: number }>;
    ok(all.length === 2, "history holds generations from both skies, permanently");
  }

  // ---- users constraint ----------------------------------------------------
  {
    let threw = false;
    try {
      db.exec("UPDATE users SET zodiac_system = 'draconic' WHERE id = 'usr_alice'");
    } catch {
      threw = true;
    }
    ok(threw, "schema CHECK rejects unknown zodiac_system values");
  }

  console.log(`\n${checks} checks, ${failures} failures`);
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
