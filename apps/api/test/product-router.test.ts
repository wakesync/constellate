// Sensitivity router wired into the full product (apps/api).
// Run: server/node_modules/.bin/tsx apps/api/test/product-router.test.ts   (from repo root)
//
// Drives the REAL Hono app over node:sqlite with every migration, the astro
// sidecar stubbed at fetch, the Tinfoil SDK stubbed at its prototype (same
// technique as product-inference.test.ts) and Darkbloom stubbed at fetch.
// Asserts:
//   1. every product model call (typology reading, convergence pair, sky
//      reflection, synastry, circle agent) reaches only the attested SDK, and
//      Darkbloom sees none of them, even when the enclave is down;
//   2. raw birth fields (date, time, zone, coordinates, place) never reach the
//      enclave wire, and a smuggled raw key is refused before sending;
//   3. GET /public/sky/today needs no session, reads no member data, goes to
//      Darkbloom only with zero personal data, and is keyless-safe.
// Synthetic birth data only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { TinfoilAI } from "../../../server/node_modules/tinfoil/dist/index.js";
import { productInference, type ProductKind } from "../src/lib/inference";
import { findBirthFields, assertRoutable, assertNoRawBirthKeys, PrivacyRouteError, classify } from "../../../server/src/router";
import { chat as agentChat } from "../src/lib/eliza/agent";
import type { Env } from "../src/types";

const here = dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(":memory:");
for (const f of readdirSync(join(here, "..", "migrations")).sort()) if (f.endsWith(".sql")) db.exec(readFileSync(join(here, "..", "migrations", f), "utf8"));
function makeD1() {
  const prepare = (sql: string) => {
    let binds: unknown[] = [];
    const stmt = {
      bind(...a: unknown[]) { binds = a; return stmt; },
      async first<T>() { return (db.prepare(sql).get(...(binds as never[])) ?? null) as T | null; },
      async all<T>() { return { results: db.prepare(sql).all(...(binds as never[])) as T[] }; },
      async run() { db.prepare(sql).run(...(binds as never[])); return { success: true }; },
      _exec() { db.prepare(sql).run(...(binds as never[])); },
    };
    return stmt;
  };
  return { prepare, async batch(s: Array<{ _exec(): void }>) { for (const x of s) x._exec(); return []; } };
}

// Synthetic birth, deliberately distinctive so any leak is greppable.
const BIRTH = { date_local: "1983-05-27T03:51", timezone: "Asia/Kathmandu", place_name: "Synthetic Hamlet", latitude: 27.7172, longitude: 85.324 };
const NEEDLES = ["1983", "05-27", "03:51", "Asia/Kathmandu", "Kathmandu", "Synthetic Hamlet", "27.7172", "85.324", "@test.local"];

const ASTRO_URL = "http://astro.test";
function fakeChart(extra: Record<string, unknown> = {}) {
  return {
    engine: "fake", generated_at: "now",
    // The sidecar echoes raw input; the minimizer must strip it.
    input: { date: "1983-05-27", time: "03:51", lat: 27.7172, lng: 85.324, tz: "Asia/Kathmandu" },
    planets: [
      { name: "Sun", sign: "Gemini", sign_degree: 5, absolute_degree: 65, house: 3, retrograde: false },
      { name: "Moon", sign: "Pisces", sign_degree: 12, absolute_degree: 342, house: 12, retrograde: false },
    ],
    ascendant: { sign: "Aries", sign_degree: 2, absolute_degree: 2 }, midheaven: { absolute_degree: 280 },
    ...extra,
  };
}
const darkbloomCalls: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.startsWith(ASTRO_URL)) {
    const path = url.slice(ASTRO_URL.length);
    if (path === "/healthz") return Response.json({ ok: true });
    let payload: unknown;
    if (path === "/natal") payload = fakeChart();
    else if (path === "/transits") payload = { generated_at: "now", date: "2026-11-07", lat: 27.7172, lng: 85.324, tz: "Asia/Kathmandu", positions: fakeChart().planets, aspects: [] };
    else if (path === "/humandesign") payload = { type: "Projector", authority: "Splenic", design_datetime_utc: "1983-02-26T01:00:00Z", centers: [], channels: [], gates: { personality: [], design: [] } };
    else if (path === "/genekeys") payload = { spheres: { lifes_work: { gene_key: 20 } } };
    else if (path === "/synastry") payload = { aspects: [{ person_a_planet: "Sun", person_b_planet: "Moon", aspect: "trine", orb: 1.2, harmonious: true }], person_a_chart: fakeChart(), person_b_chart: fakeChart() };
    else return new Response("nf", { status: 404 });
    return Response.json(payload);
  }
  if (url.startsWith("https://api.darkbloom.dev/")) {
    darkbloomCalls.push(String(init?.body ?? ""));
    return Response.json({ choices: [{ message: { content: "A calm general note about the sky today, for everyone." }, finish_reason: "stop" }] });
  }
  return realFetch(input as never, init as never);
}) as typeof fetch;
Math.random = () => 0.5;

const now = Math.floor(Date.now() / 1000);
db.exec(`
  INSERT INTO users (id, email, display_name, created_at) VALUES ('usr_ada','ada@test.local','ada',${now}),('usr_teo','teo@test.local','teo',${now});
  INSERT INTO sessions (id, user_id, expires_at) VALUES ('ses_ada','usr_ada',${now + 86400}),('ses_teo','usr_teo',${now + 86400});
  INSERT INTO constellations (id, name, creator_id, invite_token, created_at) VALUES ('con_t','test circle','usr_ada','tok_router_invite_1234',${now});
  INSERT INTO memberships (constellation_id, user_id, role, joined_at) VALUES ('con_t','usr_ada','creator',${now}),('con_t','usr_teo','member',${now});
`);
const baseEnv = { DB: makeD1(), RP_ID: "test.local", RP_NAME: "t", APP_ORIGIN: "http://test.local", ASTRO_URL, ASTRO_BEARER: "b", TINFOIL_API_KEY: "synthetic-inference-key", TINFOIL_MODEL: "synthetic-model" };
const execCtx = { waitUntil() {}, passThroughOnException() {} };

test("sensitivity router in the full product", async t => {
  const { default: app } = await import("../src/index");
  const proto = TinfoilAI.prototype;
  const saved = (["ready", "getVerificationDocument", "chat"] as const).map(k => [k, Object.getOwnPropertyDescriptor(proto, k)!] as const);
  let verified = true;
  const enclave: { system: string; user: string }[] = [];
  let reply = "An invented reflective paragraph, grounded only in the synthetic evidence given.";
  Object.defineProperty(proto, "ready", { configurable: true, value: async () => {} });
  Object.defineProperty(proto, "getVerificationDocument", { configurable: true, value: async () => ({ securityVerified: verified }) });
  Object.defineProperty(proto, "chat", { configurable: true, get: () => ({ completions: { create: async (b: any) => {
    enclave.push({ system: b.messages[0].content, user: b.messages[1].content });
    return { choices: [{ message: { content: reply }, finish_reason: "stop" }] };
  } } }) });
  t.after(() => { for (const [k, d] of saved) Object.defineProperty(proto, k, d); globalThis.fetch = realFetch; });

  const req = async (method: string, path: string, session?: string, body?: unknown, env: object = baseEnv) => {
    const res = await app.request(path, { method, headers: { ...(session ? { authorization: `Bearer ${session}` } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }, env as never, execCtx as never);
    let json: any = null; try { json = await res.json(); } catch { /* */ }
    return { status: res.status, json, headers: res.headers };
  };
  for (const s of ["ses_ada", "ses_teo"]) assert.equal((await req("POST", "/me/birth-data", s, BIRTH)).status, 200);

  await t.test("every product model call goes to the enclave and never to darkbloom", async () => {
    const start = enclave.length;
    assert.equal((await req("GET", "/me/chart/reading", "ses_ada")).json?.degraded, false);          // typology-reading (dual sky)
    assert.equal((await req("GET", "/me/humandesign/reading", "ses_ada")).json?.degraded, false);    // typology-reading
    assert.equal((await req("GET", "/sky/today", "ses_ada")).json?.degraded, false);                 // sky-reflection (private)
    const syn = await req("POST", "/synastry/usr_teo", "ses_ada");                                   // synastry
    assert.equal(syn.status, 200);
    reply = JSON.stringify({ reply: "A final reflective answer with no invented claims." });
    const eliza = await req("POST", "/constellations/con_t/eliza", "ses_ada", { body: "eliza, what is the mood here?" }); // circle-agent
    assert.equal(eliza.status, 200);
    reply = "An invented reflective paragraph, grounded only in the synthetic evidence given.";
    assert.ok(enclave.length - start >= 5, `enclave calls ${enclave.length - start}`);
    assert.equal(darkbloomCalls.length, 0, "no private call reached the public lane");
  });

  await t.test("raw birth fields never reach the enclave wire", () => {
    assert.ok(enclave.length > 0);
    for (const call of enclave) for (const n of NEEDLES) assert.ok(!call.user.includes(n) && !call.system.includes(n), `leaked ${n}`);
  });

  await t.test("enclave down: degraded fixed copy, still no darkbloom, nothing sent", async () => {
    verified = false;
    const sent = enclave.length;
    db.exec("DELETE FROM readings_cache");
    const r = await req("GET", "/me/humandesign/reading", "ses_ada");
    assert.equal(r.json?.degraded, true);
    assert.equal((await req("GET", "/sky/today", "ses_ada")).json?.degraded, true);
    assert.equal(enclave.length, sent, "unverified enclave received no prompt");
    assert.equal(darkbloomCalls.length, 0, "no failover to the public lane");
    // Even with a Darkbloom key configured, private kinds never fail over.
    const keyed = { ...baseEnv, DARKBLOOM_API_KEY: "synthetic-public-key", DARKBLOOM_MODEL: "synthetic/public" };
    assert.equal((await req("GET", "/sky/today", "ses_ada", undefined, keyed)).json?.degraded, true);
    assert.equal(darkbloomCalls.length, 0);
    verified = true;
  });

  await t.test("every product kind classifies private; a smuggled raw key is refused before the SDK", async () => {
    for (const k of ["typology-reading", "convergence-pair", "synastry", "sky-reflection", "circle-agent"] satisfies ProductKind[]) assert.equal(classify(k).route, "tinfoil-enclave");
    const sent = enclave.length;
    // The minimizer strips nested raw keys (including JSON-in-string tool output)...
    await productInference(baseEnv as unknown as Env, { system: "s", messages: [{ role: "user", content: JSON.stringify({ evidence: { date_utc: "1983-05-26T22:06:00Z", tool: JSON.stringify({ birth: { tz: "Asia/Kathmandu" } }) } }) }] }, undefined, "typology-reading");
    assert.ok(!enclave.at(-1)!.user.includes("1983") && !enclave.at(-1)!.user.includes("Kathmandu"));
    // ...and the router asserts it independently, so a minimizer regression fails closed.
    assert.throws(() => assertNoRawBirthKeys({ a: [{ b: JSON.stringify({ c: { latitude: 1 } }) }] }), PrivacyRouteError);
    assert.doesNotThrow(() => assertNoRawBirthKeys({ planets: [{ name: "Sun", sign: "Gemini" }] }));
    const req2 = { system: "s", messages: [{ role: "user" as const, content: "{}" }] };
    await productInference(baseEnv as unknown as Env, req2, undefined, "sky-reflection");
    assert.throws(() => assertRoutable("darkbloom", req2), PrivacyRouteError, "product request is tagged private");
    assert.equal(enclave.length, sent + 2);
    await assert.rejects(productInference(baseEnv as unknown as Env, req2, undefined, "daily-transits" as never), PrivacyRouteError);
    assert.equal(enclave.length, sent + 2, "a non-private kind never sends");
  });

  await t.test("circle agent tool transcripts are minimized too", async () => {
    reply = JSON.stringify({ reply: "ok, a short synthetic answer." });
    const before = enclave.length;
    await agentChat(baseEnv as unknown as Env, [{ role: "system", content: "s" }, { role: "user", content: "read it" }, { role: "tool", name: "get_chart", tool_call_id: "c1", content: JSON.stringify(fakeChart()) }], false);
    assert.equal(enclave.length, before + 1);
    for (const n of NEEDLES) assert.ok(!enclave.at(-1)!.user.includes(n), `tool transcript leaked ${n}`);
    reply = "An invented reflective paragraph, grounded only in the synthetic evidence given.";
  });

  await t.test("GET /public/sky/today: no session, keyless template, zero personal data", async () => {
    const anon = await req("GET", "/public/sky/today");
    assert.equal(anon.status, 200);
    assert.equal(anon.json.transits.copy.sensitivity, "public");
    assert.equal(anon.json.transits.copy.source, "template");
    assert.equal(anon.json.transits.copy.reason, "unconfigured");
    assert.match(anon.headers.get("cache-control") ?? "", /public/);
    assert.equal(darkbloomCalls.length, 0);
    const blob = JSON.stringify(anon.json);
    for (const n of NEEDLES) assert.ok(!blob.includes(n), n);
  });

  await t.test("GET /public/sky/today with a key: darkbloom gets sign names and whole degrees only", async () => {
    const keyed = { ...baseEnv, DARKBLOOM_API_KEY: "synthetic-public-key", DARKBLOOM_MODEL: "synthetic/public" };
    const sentToEnclave = enclave.length;
    const r = await req("GET", "/public/sky/today", "ses_ada", undefined, keyed); // a session must not change anything
    assert.equal(r.status, 200);
    assert.equal(r.json.transits.copy.source, "darkbloom");
    assert.equal(darkbloomCalls.length, 1);
    const body = JSON.parse(darkbloomCalls[0]!);
    const text = body.messages.map((m: { content: string }) => m.content).join("\n");
    assert.deepEqual(findBirthFields(text), []);
    for (const n of [...NEEDLES, "ada", "teo", "usr_", "ses_", "con_t"]) assert.ok(!darkbloomCalls[0]!.includes(n), `public body leaked ${n}`);
    assert.equal(enclave.length, sentToEnclave, "public copy never uses enclave capacity");
    await req("GET", "/public/sky/today", undefined, undefined, keyed);
    assert.equal(darkbloomCalls.length, 1, "cached per UTC day");
  });
});
