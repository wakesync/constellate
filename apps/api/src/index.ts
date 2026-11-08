import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { z } from "zod";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import { natalChart, synastryGrid, transitChart, astrocartographyLines, humanDesign, geneKeys, astroHealthy, AstroError, type BirthLike, type Zodiac } from "./astro";
import { synastrySystemPrompt } from "./prompts/synastry";
import { transitSystemPrompt } from "./prompts/transit";
import { dualSkyChartContext, dualSkyTypologyContext, dualSkyNatalSystemPrompt, dualSkyTypologySystemPrompt } from "./prompts/dual-sky";
import { enneagramSystemPrompt } from "./prompts/enneagram";
import { publicQuestions, score as scoreEnneagram, TOTAL_QUESTIONS, TYPE_NAMES } from "./lib/enneagram";
import { socionicsSystemPrompt } from "./prompts/socionics";
import { questionsPublic as socionicsQuestions, score as scoreSocionics, QUIZ_TOTAL } from "./lib/socionics-quiz";
import { relationBetween, TYPE_BY_CODE } from "./lib/socionics";
import { computeConvergence, convergenceInputsHash, type EnginePayloads, type ConvergenceResult } from "./lib/convergence";
import { computePairHarmony, harmonyFraming, verdictLine, type HarmonyResult } from "./lib/convergence/harmony";
import { syncCircleEdges, circlePairTraits, memberHighlights } from "./lib/graph/circle";
import { convergenceReadingSystemPrompt, convergencePairSystemPrompt } from "./prompts/convergence";
import { isAllowedOrigin, expectedOrigins, rpId, rpName } from "./lib/config";
import { ERR, failKind, id, nowSec, readBody } from "./lib/http";
import { RULES, rateLimit, sweepRateLimits } from "./lib/ratelimit";
import { putChallenge, consumeChallenge, sweepChallenges } from "./lib/challenges";
import { generateNarrative, FALLBACK } from "./lib/narrative";
import { normalizeSynastryNarrative } from "./lib/synastry-format";
import { RELATIONSHIP_KINDS, effectiveLens, pairContextFor, canonicalPair } from "./lib/relationship";
import {
  listGenerations,
  activePointer,
  insertGeneration,
  setActivePointer,
  resolveActiveForZodiac,
  generationMetas,
  generationMetasForZodiac,
  romanticHistoryAllowed,
  genAllowed,
  type GenerationRow,
} from "./lib/synastry-gens";
import { runTurn, type RespondContext } from "./lib/eliza/agent";
import { buildPairMechanics, mechanicsDigest, type PairMechanics } from "./lib/pair";
import { normalizeChart } from "./lib/chart";
import tzLookup from "tz-lookup";
import type { Env } from "./types";

type Vars = { userId: string };
const app = new Hono<{ Bindings: Env; Variables: Vars }>();

// ---------------------------------------------------------------------------
// logging: structured, NO PII. never log birth data, emails, coords, bodies.
// ---------------------------------------------------------------------------
function log(event: string, fields: Record<string, string | number | boolean | undefined> = {}): void {
  try {
    console.log(JSON.stringify({ event, ...fields }));
  } catch {
    console.log(event);
  }
}

// ---------------------------------------------------------------------------
// base64url helpers (kept for completeness; SimpleWebAuthn handles most encoding)
// ---------------------------------------------------------------------------
function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

// ---------------------------------------------------------------------------
// sessions
// ---------------------------------------------------------------------------
const SESSION_TTL_SEC = 60 * 60 * 24 * 30; // 30 days
const SESSION_COOKIE = "constellate_session";

async function createSession(env: Env, userId: string): Promise<string> {
  const sessionId = id("ses");
  await env.DB.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(sessionId, userId, nowSec() + SESSION_TTL_SEC)
    .run();
  return sessionId;
}

function setSessionCookie(c: { header: (k: string, v: string) => void } & object, sessionId: string): void {
  setCookie(c as never, SESSION_COOKIE, sessionId, {
    httpOnly: true,
    secure: true,
    sameSite: "None", // cross-site app -> api on different subdomains
    path: "/",
    maxAge: SESSION_TTL_SEC,
  });
}

async function sessionIdFrom(c: { req: { header: (n: string) => string | undefined } } & object): Promise<string | undefined> {
  const cookie = getCookie(c as never, SESSION_COOKIE);
  const auth = c.req.header("authorization");
  return cookie ?? (auth?.startsWith("Bearer ") ? auth.slice(7) : undefined);
}

async function currentUser(c: { req: { header: (n: string) => string | undefined }; env: Env } & object): Promise<string | null> {
  const sessionId = await sessionIdFrom(c);
  if (!sessionId) return null;
  const row = await c.env.DB.prepare("SELECT user_id, expires_at FROM sessions WHERE id = ?")
    .bind(sessionId)
    .first<{ user_id: string; expires_at: number }>();
  if (!row) return null;
  if (row.expires_at <= nowSec()) {
    // expired: clean up lazily.
    await c.env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(sessionId).run();
    return null;
  }
  // Sliding-window refresh: if the session has less than ~25 days left, push its
  // expiry back to a full 30 days so active users stay signed in. Bounded write:
  // only fires once the window has decayed past a day, not on every request.
  if (row.expires_at < nowSec() + SESSION_TTL_SEC - 86400) {
    const ctx = (c as { executionCtx?: { waitUntil?: (p: Promise<unknown>) => void } }).executionCtx;
    if (ctx?.waitUntil) ctx.waitUntil(touchSession(c.env, sessionId));
    else await touchSession(c.env, sessionId);
  }
  return row.user_id;
}

// Sliding-window session refresh: if a session is more than a day old, rotate
// its expiry forward so active users stay signed in without re-auth.
async function touchSession(env: Env, sessionId: string): Promise<void> {
  try {
    await env.DB.prepare("UPDATE sessions SET expires_at = ? WHERE id = ?")
      .bind(nowSec() + SESSION_TTL_SEC, sessionId)
      .run();
  } catch {
    /* ignore */
  }
}

const requireUser = async (
  c: { req: { header: (n: string) => string | undefined }; env: Env; set: (k: "userId", v: string) => void; json: Parameters<typeof failKind>[0]["json"] } & object,
  next: () => Promise<void>,
): Promise<Response | void> => {
  const userId = await currentUser(c as never);
  if (!userId) return failKind(c as never, 401, ERR.UNAUTHORIZED);
  c.set("userId", userId);
  await next();
};

// ---------------------------------------------------------------------------
// rate-limit middleware factory
// ---------------------------------------------------------------------------
function limiter(rule: (typeof RULES)[keyof typeof RULES]) {
  return async (c: { req: { header: (n: string) => string | undefined }; env: Env; get: (k: "userId") => string | undefined; header: (k: string, v: string) => void; json: Parameters<typeof failKind>[0]["json"] } & object, next: () => Promise<void>) => {
    const client = (c.get("userId") as string | undefined) ?? c.req.header("cf-connecting-ip") ?? "local";
    const result = await rateLimit(c.env, rule, `${rule.bucket}:${client}`);
    if (!result.allowed) {
      c.header("retry-after", String(Math.max(1, result.resetSec - nowSec())));
      return failKind(c as never, 429, ERR.RATE_LIMITED);
    }
    await next();
  };
}

// ---------------------------------------------------------------------------
// schemas
// ---------------------------------------------------------------------------
const emailSchema = z.string().email().max(254);
const registerBeginSchema = z.object({
  email: emailSchema,
  display_name: z.string().trim().min(1).max(80).optional(),
  device_label: z.string().trim().max(80).optional(),
});
const finishSchema = z.object({ challenge_id: z.string().min(1).max(120), response: z.unknown() });
const loginBeginSchema = z.object({ email: emailSchema.optional() });

// ISO-8601 local datetime "YYYY-MM-DDTHH:MM[:SS]". We also accept a date-only
// fallback for "unknown time" handling.
const localDateTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/, "bad date_local");
const ianaTz = z.string().min(1).max(64).regex(/^[A-Za-z0-9_+\-/]+$/, "bad timezone");

const birthSchema = z.object({
  date_local: localDateTime,
  timezone: ianaTz,
  place_name: z.string().trim().min(1).max(200),
  latitude: z.number().gte(-90).lte(90),
  longitude: z.number().gte(-180).lte(180),
  exact_time_unknown: z.boolean().optional(),
  // date_utc is derived server-side; accept but ignore client-supplied value.
  date_utc: z.string().optional(),
});
const constellationSchema = z.object({ name: z.string().trim().min(1).max(120) });
const joinSchema = z.object({ invite_token: z.string().trim().min(8).max(64) });
const journalSchema = z.object({
  body: z.string().trim().min(1).max(12000),
  constellation_id: z.string().trim().min(1).max(120).nullish(),
});
const placesSchema = z.object({ q: z.string().trim().min(2).max(200) });
// Enneagram: a map of questionId -> 1..5 agreement. Cap the batch size so a
// single request cannot smuggle an unbounded object.
const enneagramSubmitSchema = z.object({
  answers: z.record(z.string().min(1).max(16), z.number().int().min(1).max(5)).refine(
    (a) => Object.keys(a).length >= 1 && Object.keys(a).length <= 200,
    { message: "answers out of range" },
  ),
});
// Socionics: same shape as enneagram (questionId -> 1..5 agreement), bounded.
const socionicsSubmitSchema = z.object({
  answers: z.record(z.string().min(1).max(16), z.number().int().min(1).max(5)).refine(
    (a) => Object.keys(a).length >= 1 && Object.keys(a).length <= 200,
    { message: "answers out of range" },
  ),
});
const idParam = z.string().trim().min(1).max(120);

// Ad-hoc astrocartography (non-members / previews). date + optional time + place.
const acgBirthSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "bad date"),
  time: z.string().regex(/^(\d{2}:\d{2})?$/, "bad time").optional().default(""),
  lat: z.number().gte(-90).lte(90),
  lng: z.number().gte(-180).lte(180),
  tz: ianaTz,
});

// ---------------------------------------------------------------------------
// timezone resolution. validate that the supplied tz is a real IANA zone the
// runtime understands; the astro engine also re-validates. If it is not valid,
// reject rather than silently drift to UTC (birth charts are time-sensitive).
// ---------------------------------------------------------------------------
function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// Compute a UTC instant string from a local datetime + IANA tz, for storage.
function toUtcIso(dateLocal: string, tz: string): string {
  // Derive the zone offset at that local wall-time, then subtract it.
  const hasTime = dateLocal.includes("T");
  const base = hasTime ? dateLocal : `${dateLocal}T12:00:00`;
  const [datePart, timePartRaw] = base.split("T");
  const [y, mo, d] = datePart.split("-").map(Number);
  const [hh, mm] = timePartRaw.split(":").map(Number);
  // Use Intl to find the offset of tz at this wall time.
  const asUTC = Date.UTC(y, mo - 1, d, hh, mm, 0);
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = dtf.formatToParts(new Date(asUTC));
  const map: Record<string, number> = {};
  for (const p of parts) if (p.type !== "literal") map[p.type] = Number(p.value);
  const tzAsUTC = Date.UTC(map.year, map.month - 1, map.day, map.hour === 24 ? 0 : map.hour, map.minute, map.second);
  const offset = tzAsUTC - asUTC;
  return new Date(asUTC - offset).toISOString();
}

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------
app.use("*", async (c, next) => {
  const mw = cors({
    origin: (origin) => (isAllowedOrigin(c.env, origin) ? origin : ""),
    credentials: true,
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["content-type", "authorization"],
    maxAge: 86400,
  });
  return mw(c, next);
});

// Opportunistic sweep of expired challenge + rate-limit rows (cheap, ~1% of reqs).
app.use("*", async (c, next) => {
  await next();
  if (Math.random() < 0.01) {
    c.executionCtx?.waitUntil?.(Promise.all([sweepChallenges(c.env), sweepRateLimits(c.env)]).then(() => undefined));
  }
});

// ---------------------------------------------------------------------------
// health
// ---------------------------------------------------------------------------
app.get("/healthz", async (c) => {
  const checks: { db: boolean; astro: boolean } = { db: false, astro: false };
  try {
    const row = await c.env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();
    checks.db = row?.ok === 1;
  } catch {
    checks.db = false;
  }
  checks.astro = await astroHealthy(c.env);
  const ok = checks.db; // astro is a soft dependency; DB is hard.
  return c.json({ ok, service: "constellate-api", checks }, ok ? 200 : (503 as never));
});

// ---------------------------------------------------------------------------
// auth: passkey register
// ---------------------------------------------------------------------------
app.post("/auth/passkey/register/begin", limiter(RULES.auth), async (c) => {
  const parsed = await readBody(c, registerBeginSchema);
  if (!parsed.ok) return parsed.response;
  const { email, display_name, device_label } = parsed.value;
  const existing = await c.env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first<{ id: string }>();
  const userId = existing?.id ?? id("usr");

  // Exclude already-registered credentials so the platform UI prevents dup enroll.
  const existingCreds = existing
    ? (await c.env.DB.prepare("SELECT id FROM passkeys WHERE user_id = ?").bind(userId).all<{ id: string }>()).results
    : [];

  const options = await generateRegistrationOptions({
    rpName: rpName(c.env),
    rpID: rpId(c.env),
    userID: new TextEncoder().encode(userId) as Uint8Array<ArrayBuffer>,
    userName: email,
    userDisplayName: display_name ?? email,
    attestationType: "none",
    excludeCredentials: existingCreds.map((cred) => ({ id: cred.id, type: "public-key" as const })),
    authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
  });

  const challengeId = await putChallenge(c.env, {
    kind: "register",
    email,
    userId,
    challenge: options.challenge,
    payload: JSON.stringify({ display_name: display_name ?? null, device_label: device_label ?? null }),
  });
  log("register.begin", { hasExisting: !!existing });
  return c.json({ challenge_id: challengeId, options });
});

app.post("/auth/passkey/register/finish", limiter(RULES.auth), async (c) => {
  const parsed = await readBody(c, finishSchema);
  if (!parsed.ok) return parsed.response;
  const challenge = await consumeChallenge(c.env, parsed.value.challenge_id, "register");
  if (!challenge || !challenge.email || !challenge.userId) return failKind(c, 400, ERR.CHALLENGE_EXPIRED);

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: parsed.value.response as never,
      expectedChallenge: challenge.challenge,
      expectedOrigin: expectedOrigins(c.env),
      expectedRPID: rpId(c.env),
      requireUserVerification: false,
    });
  } catch {
    return failKind(c, 400, ERR.PASSKEY_FAILED);
  }
  if (!verification.verified || !verification.registrationInfo) return failKind(c, 400, ERR.PASSKEY_FAILED);

  const payload = JSON.parse(challenge.payload) as { display_name: string | null; device_label: string | null };
  const cred = verification.registrationInfo.credential;

  await c.env.DB.prepare("INSERT OR IGNORE INTO users (id, email, display_name, created_at) VALUES (?, ?, ?, ?)")
    .bind(challenge.userId, challenge.email, payload.display_name, nowSec())
    .run();
  // Idempotent on credential id (PK) so a double-tap finish does not error.
  await c.env.DB.prepare(
    "INSERT OR IGNORE INTO passkeys (id, user_id, public_key, counter, device_label, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(cred.id, challenge.userId, cred.publicKey.buffer, cred.counter, payload.device_label, nowSec())
    .run();

  const sessionId = await createSession(c.env, challenge.userId);
  setSessionCookie(c, sessionId);
  log("register.finish.ok");
  return c.json({ ok: true, session_id: sessionId, user: await userView(c.env, challenge.userId) });
});

// ---------------------------------------------------------------------------
// auth: passkey login
// ---------------------------------------------------------------------------
app.post("/auth/passkey/login/begin", limiter(RULES.auth), async (c) => {
  const parsed = await readBody(c, loginBeginSchema);
  if (!parsed.ok) return parsed.response;
  // If an email is supplied, scope allowCredentials to that user (no enumeration
  // of all passkeys). If not supplied, return an EMPTY allowCredentials list and
  // rely on the platform's resident-key discovery (discoverable credentials) so
  // we never leak the full credential set to anonymous callers.
  let allowCredentials: Array<{ id: string; type: "public-key" }> = [];
  if (parsed.value.email) {
    const rows = await c.env.DB.prepare(
      "SELECT passkeys.id FROM passkeys JOIN users ON users.id = passkeys.user_id WHERE users.email = ?",
    )
      .bind(parsed.value.email)
      .all<{ id: string }>();
    allowCredentials = rows.results.map((row) => ({ id: row.id, type: "public-key" as const }));
  }
  const options = await generateAuthenticationOptions({
    rpID: rpId(c.env),
    allowCredentials: parsed.value.email ? allowCredentials : undefined,
    userVerification: "preferred",
  });
  const challengeId = await putChallenge(c.env, {
    kind: "login",
    email: parsed.value.email ?? null,
    userId: null,
    challenge: options.challenge,
    payload: "{}",
  });
  log("login.begin", { scoped: !!parsed.value.email });
  return c.json({ challenge_id: challengeId, options });
});

app.post("/auth/passkey/login/finish", limiter(RULES.auth), async (c) => {
  const parsed = await readBody(c, finishSchema);
  if (!parsed.ok) return parsed.response;
  const response = parsed.value.response as { id?: string };
  if (!response || typeof response.id !== "string") return failKind(c, 400, ERR.PASSKEY_FAILED);
  const challenge = await consumeChallenge(c.env, parsed.value.challenge_id, "login");
  if (!challenge) return failKind(c, 400, ERR.CHALLENGE_EXPIRED);

  const passkey = await c.env.DB.prepare("SELECT id, user_id, public_key, counter FROM passkeys WHERE id = ?")
    .bind(response.id)
    .first<{ id: string; user_id: string; public_key: ArrayBuffer; counter: number }>();
  if (!passkey) return failKind(c, 404, ERR.PASSKEY_NOT_FOUND);

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: response as never,
      expectedChallenge: challenge.challenge,
      expectedOrigin: expectedOrigins(c.env),
      expectedRPID: rpId(c.env),
      requireUserVerification: false,
      credential: { id: passkey.id, publicKey: new Uint8Array(passkey.public_key), counter: passkey.counter },
    });
  } catch {
    return failKind(c, 400, ERR.PASSKEY_FAILED);
  }
  if (!verification.verified) return failKind(c, 400, ERR.PASSKEY_FAILED);

  // Replay / cloned-authenticator guard: the signature counter must advance
  // (unless the authenticator reports 0, which means it does not use a counter).
  const newCounter = verification.authenticationInfo.newCounter;
  if (newCounter > 0 && newCounter <= passkey.counter) {
    log("login.finish.counter_regression");
    return failKind(c, 400, ERR.PASSKEY_FAILED);
  }
  await c.env.DB.prepare("UPDATE passkeys SET counter = ? WHERE id = ?").bind(newCounter, passkey.id).run();

  const sessionId = await createSession(c.env, passkey.user_id);
  setSessionCookie(c, sessionId);
  log("login.finish.ok");
  return c.json({ ok: true, session_id: sessionId, user: await userView(c.env, passkey.user_id) });
});

app.post("/auth/logout", async (c) => {
  const sessionId = await sessionIdFrom(c);
  if (sessionId) await c.env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(sessionId).run();
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// authed routes
// ---------------------------------------------------------------------------
app.use("/me", requireUser);
app.use("/me/*", requireUser);
app.use("/constellations", requireUser);
app.use("/constellations/*", requireUser);
app.use("/journal", requireUser);
app.use("/journal/*", requireUser);
app.use("/sky/*", requireUser);
app.use("/synastry/*", requireUser);
app.use("/pairs/*", requireUser);
app.use("/enneagram/*", requireUser);
// Socionics: /me/socionics* is covered by /me/*. The relation lookup needs the
// caller's identity (and a shared-constellation check), so gate it here. The
// public question bank at /socionics/questions stays open (no weights leak).
app.use("/socionics/relations/*", requireUser);
app.use("/convergence/pair/*", requireUser);
app.use("/harmony/*", requireUser);
// Question banks are text-only (no weights), but you must be signed in to take a
// quiz at all (answers are stored per user), so gate them consistently with
// /enneagram/*. Keeps the two instruments symmetric.
app.use("/socionics/questions", requireUser);

// ---------------------------------------------------------------------------
// zodiac lens . The per-user preference picks
// which sky the flippable engines (chart, astrocartography, HD, GK, synastry
// casts) are computed under. TROPICAL CANON: convergence, harmony, and the
// circle graph always read tropical rows regardless of this preference; the
// lens changes what you read, never how the circle scores.
// ---------------------------------------------------------------------------
const ZODIAC_SYSTEMS = ["tropical", "sidereal"] as const;

async function zodiacFor(env: Env, userId: string): Promise<Zodiac> {
  const row = await env.DB.prepare("SELECT zodiac_system FROM users WHERE id = ?")
    .bind(userId)
    .first<{ zodiac_system: string | null }>();
  return row?.zodiac_system === "sidereal" ? "sidereal" : "tropical";
}

// shape a User row the way the web client expects (with has_birth_data).
// sexual_orientation / relational_preference are PRIVATE fields: they are only
// ever returned here, to the authenticated owner (/me and auth finish). They
// never appear in member lists, synastry views, or Eliza tools.
async function userView(env: Env, userId: string): Promise<{ id: string; email: string; display_name: string | null; has_birth_data: boolean; sexual_orientation: string | null; relational_preference: string | null; zodiac_system: Zodiac }> {
  const user = await env.DB.prepare("SELECT id, email, display_name, sexual_orientation, relational_preference, zodiac_system FROM users WHERE id = ?")
    .bind(userId)
    .first<{ id: string; email: string; display_name: string | null; sexual_orientation: string | null; relational_preference: string | null; zodiac_system: string | null }>();
  const birth = await env.DB.prepare("SELECT 1 AS x FROM birth_data WHERE user_id = ?").bind(userId).first<{ x: number }>();
  return {
    id: user?.id ?? userId,
    email: user?.email ?? "",
    display_name: user?.display_name ?? null,
    has_birth_data: !!birth,
    sexual_orientation: user?.sexual_orientation ?? null,
    relational_preference: user?.relational_preference ?? null,
    zodiac_system: user?.zodiac_system === "sidereal" ? "sidereal" : "tropical",
  };
}

app.get("/me", async (c) => {
  return c.json(await userView(c.env, c.get("userId")));
});

// Update the caller's profile. display_name is public-in-circle; the two
// preference fields are PRIVATE (see userView note) and only gate romantic
// framing server-side, their values never enter a prompt or leave /me.
const profileSchema = z.object({
  display_name: z.string().trim().min(1).max(80).optional(),
  sexual_orientation: z.string().trim().max(120).nullable().optional(),
  relational_preference: z.string().trim().max(240).nullable().optional(),
  // zodiac lens preference. STRICT enum: anything else is a validation error.
  zodiac_system: z.enum(ZODIAC_SYSTEMS).optional(),
});
app.post("/me/profile", limiter(RULES.write), async (c) => {
  const parsed = await readBody(c, profileSchema);
  if (!parsed.ok) return parsed.response;
  const v = parsed.value;
  const sets: string[] = [];
  const binds: (string | null)[] = [];
  if (v.display_name !== undefined) { sets.push("display_name = ?"); binds.push(v.display_name); }
  if (v.sexual_orientation !== undefined) { sets.push("sexual_orientation = ?"); binds.push(v.sexual_orientation || null); }
  if (v.relational_preference !== undefined) { sets.push("relational_preference = ?"); binds.push(v.relational_preference || null); }
  // Flipping the zodiac lens NEVER deletes anything: tropical and sidereal
  // cache rows coexist (keyed by zodiac_system), so flipping back serves the
  // original rows untouched.
  if (v.zodiac_system !== undefined) { sets.push("zodiac_system = ?"); binds.push(v.zodiac_system); }
  if (sets.length > 0) {
    await c.env.DB.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`)
      .bind(...binds, c.get("userId"))
      .run();
  }
  return c.json(await userView(c.env, c.get("userId")));
});

app.post("/me/birth-data", limiter(RULES.write), async (c) => {
  const parsed = await readBody(c, birthSchema);
  if (!parsed.ok) return parsed.response;
  const b = parsed.value;
  if (!isValidTimeZone(b.timezone)) return failKind(c, 400, ERR.VALIDATION);

  // "unknown time" degrades gracefully: noon assumed, rising/houses unreliable.
  const hasTime = b.date_local.includes("T") && !b.exact_time_unknown;
  const time = hasTime ? b.date_local.slice(11, 16) || "12:00" : "12:00";
  const dateLocal = b.date_local.length === 10 ? `${b.date_local}T${time}:00` : b.date_local;
  const dateUtc = (() => {
    try {
      return toUtcIso(dateLocal, b.timezone);
    } catch {
      return dateLocal;
    }
  })();

  const body: BirthLike = { date: dateLocal.slice(0, 10), time, lat: b.latitude, lng: b.longitude, tz: b.timezone };
  let chart: unknown;
  try {
    chart = await natalChart(c.env, body);
  } catch (err) {
    if (err instanceof AstroError) {
      log("birth.astro_fail", { status: err.status });
      return failKind(c, 502, ERR.ASTRO_FAILED);
    }
    throw err;
  }

  await c.env.DB.prepare(
    `INSERT OR REPLACE INTO birth_data
      (user_id, date_utc, date_local, timezone, place_name, latitude, longitude, natal_chart_json, cached_at, exact_time_unknown)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      c.get("userId"),
      dateUtc,
      dateLocal,
      b.timezone,
      b.place_name,
      b.latitude,
      b.longitude,
      JSON.stringify(chart),
      nowSec(),
      b.exact_time_unknown ? 1 : 0,
    )
    .run();
  // New birth data invalidates every zodiac-keyed natal row (both frames):
  // the canon tropical chart above was just recomputed; sidereal recomputes
  // lazily on next read.
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM natal_chart_cache WHERE user_id = ?").bind(c.get("userId")),
    c.env.DB.prepare("DELETE FROM human_design_cache WHERE user_id = ?").bind(c.get("userId")),
    c.env.DB.prepare("DELETE FROM gene_keys_cache WHERE user_id = ?").bind(c.get("userId")),
    c.env.DB.prepare("DELETE FROM readings_cache WHERE user_id = ? AND kind IN ('humandesign_dual','genekeys_dual','dual_sky')").bind(c.get("userId")),
  ]);
  // Legacy lens-specific reading rows are deliberately not bulk-invalidated by
  // rollout. They remain permanent historical generations; only new dual-sky
  // namespaces are used by current production callers.
  // No PII in logs.
  log("birth.saved", { unknownTime: !hasTime });
  return c.json({ ok: true, chart: normalizeChart(chart) });
});

app.get("/me/chart", async (c) => {
  const userId = c.get("userId");
  const row = await c.env.DB.prepare(
    "SELECT natal_chart_json, date_local, timezone, place_name, latitude, longitude, cached_at, exact_time_unknown FROM birth_data WHERE user_id = ?",
  )
    .bind(userId)
    .first<{
      natal_chart_json: string | null;
      date_local: string;
      timezone: string;
      place_name: string;
      latitude: number;
      longitude: number;
      cached_at: number | null;
      exact_time_unknown: number | null;
    }>();
  if (!row || !row.natal_chart_json) return failKind(c, 404, ERR.BIRTH_DATA_NOT_FOUND);
  const birth = {
    date_local: row.date_local,
    timezone: row.timezone,
    place_name: row.place_name,
    latitude: row.latitude,
    longitude: row.longitude,
    exact_time_unknown: !!row.exact_time_unknown,
  };
  const zodiac = await zodiacFor(c.env, userId);
  // Tropical = the canon copy stored beside the birth data, untouched by the
  // lens. Sidereal = a separate zodiac-keyed cache row, computed on first flip.
  if (zodiac === "tropical") {
    return c.json({
      chart: normalizeChart(JSON.parse(row.natal_chart_json)),
      birth,
      cached_at: row.cached_at,
      zodiac_system: zodiac,
    });
  }
  const cached = await c.env.DB.prepare("SELECT chart_json, computed_at FROM natal_chart_cache WHERE user_id = ? AND zodiac_system = ?")
    .bind(userId, zodiac)
    .first<{ chart_json: string; computed_at: number }>();
  if (cached) {
    return c.json({ chart: normalizeChart(JSON.parse(cached.chart_json)), birth, cached_at: cached.computed_at, zodiac_system: zodiac });
  }
  const body: BirthLike = { date: row.date_local.slice(0, 10), time: row.date_local.slice(11, 16) || "12:00", lat: row.latitude, lng: row.longitude, tz: row.timezone };
  let chart: unknown;
  try {
    chart = await natalChart(c.env, body, zodiac);
  } catch (err) {
    if (err instanceof AstroError) return failKind(c, 502, ERR.ASTRO_FAILED);
    throw err;
  }
  const computedAt = nowSec();
  await c.env.DB.prepare("INSERT OR REPLACE INTO natal_chart_cache (user_id, zodiac_system, chart_json, computed_at) VALUES (?, ?, ?, ?)")
    .bind(userId, zodiac, JSON.stringify(chart), computedAt)
    .run();
  return c.json({ chart: normalizeChart(chart), birth, cached_at: computedAt, zodiac_system: zodiac });
});

// Exact production source for dual-sky natal narratives. Tropical comes from
// the canonical birth_data copy; sidereal comes from its isolated cache or the
// same sidecar call used by GET /me/chart. Neither frame is inferred from the
// other, and the user's view preference does not fork the reading's truth.
async function natalForFrame(env: Env, userId: string, zodiac: Zodiac): Promise<unknown | "no_birth" | "astro_failed"> {
  const row = await env.DB.prepare("SELECT natal_chart_json FROM birth_data WHERE user_id = ?")
    .bind(userId).first<{ natal_chart_json: string | null }>();
  if (!row?.natal_chart_json) return "no_birth";
  if (zodiac === "tropical") return JSON.parse(row.natal_chart_json);
  const cached = await env.DB.prepare("SELECT chart_json FROM natal_chart_cache WHERE user_id = ? AND zodiac_system = 'sidereal'")
    .bind(userId).first<{ chart_json: string }>();
  if (cached) return JSON.parse(cached.chart_json);
  const birth = await birthFor(env, userId);
  if (!birth) return "no_birth";
  try {
    const chart = await natalChart(env, birth, "sidereal");
    await env.DB.prepare("INSERT OR REPLACE INTO natal_chart_cache (user_id, zodiac_system, chart_json, computed_at) VALUES (?, 'sidereal', ?, ?)")
      .bind(userId, JSON.stringify(chart), nowSec()).run();
    return chart;
  } catch (err) {
    if (err instanceof AstroError) return "astro_failed";
    throw err;
  }
}

app.get("/me/chart/reading", limiter(RULES.narrative), async (c) => {
  const userId = c.get("userId");
  const [tropical, sidereal] = await Promise.all([
    natalForFrame(c.env, userId, "tropical"),
    natalForFrame(c.env, userId, "sidereal"),
  ]);
  if (tropical === "no_birth" || sidereal === "no_birth") return failKind(c, 404, ERR.BIRTH_DATA_NOT_FOUND);
  if (tropical === "astro_failed" || sidereal === "astro_failed") return failKind(c, 502, ERR.ASTRO_FAILED);
  return cachedReading(c, "dual_sky", dualSkyNatalSystemPrompt, dualSkyChartContext(tropical, sidereal), READING_FALLBACK);
});

// astrocartography lines for the logged-in user. Deterministic for a fixed
// birth, so we cache the computed JSON blob in D1 and serve from cache.
app.get("/me/astrocartography", async (c) => {
  const userId = c.get("userId");
  const zodiac = await zodiacFor(c.env, userId);
  const cached = await c.env.DB.prepare("SELECT lines_json, computed_at FROM astrocartography_cache WHERE user_id = ? AND zodiac_system = ?")
    .bind(userId, zodiac)
    .first<{ lines_json: string; computed_at: number }>();
  if (cached) {
    return c.json({ ...JSON.parse(cached.lines_json), cached_at: cached.computed_at, zodiac_system: zodiac });
  }
  const birth = await birthFor(c.env, userId);
  if (!birth) return failKind(c, 404, ERR.BIRTH_DATA_NOT_FOUND);
  let result: unknown;
  try {
    result = await astrocartographyLines(c.env, birth, zodiac);
  } catch (err) {
    if (err instanceof AstroError) return failKind(c, 502, ERR.ASTRO_FAILED);
    throw err;
  }
  const computedAt = nowSec();
  await c.env.DB.prepare("INSERT OR REPLACE INTO astrocartography_cache (user_id, zodiac_system, lines_json, computed_at) VALUES (?, ?, ?, ?)")
    .bind(userId, zodiac, JSON.stringify(result), computedAt)
    .run();
  return c.json({ ...(result as object), cached_at: computedAt, zodiac_system: zodiac });
});

// ---------------------------------------------------------------------------
// human design + gene keys
//
// Both are deterministic for a fixed birth, so we cache the computed sidecar
// payload per user in D1 (same pattern as astrocartography_cache) and serve
// from cache on re-reads. 404 with the shared empty-state code when no birth
// data, mirroring /me/chart.
// ---------------------------------------------------------------------------
async function birthMeta(env: Env, userId: string): Promise<{
  date_local: string; timezone: string; place_name: string; latitude: number; longitude: number; exact_time_unknown: boolean;
} | null> {
  const row = await env.DB.prepare(
    "SELECT date_local, timezone, place_name, latitude, longitude, exact_time_unknown FROM birth_data WHERE user_id = ?",
  )
    .bind(userId)
    .first<{ date_local: string; timezone: string; place_name: string; latitude: number; longitude: number; exact_time_unknown: number | null }>();
  if (!row) return null;
  return {
    date_local: row.date_local,
    timezone: row.timezone,
    place_name: row.place_name,
    latitude: row.latitude,
    longitude: row.longitude,
    exact_time_unknown: !!row.exact_time_unknown,
  };
}

// Zodiac-keyed cached-or-fresh HD/GK payload. The cache row AND the sidecar
// call both carry the zodiac: a row computed under one sky is NEVER served for
// the other (PK includes zodiac_system, WHERE clause pins it). The TROPICAL
// row is the canon copy the convergence/harmony/graph paths read.
async function typologyFor(
  env: Env,
  userId: string,
  table: "human_design_cache" | "gene_keys_cache",
  compute: (env: Env, b: BirthLike, z: Zodiac) => Promise<unknown>,
  zodiac: Zodiac,
): Promise<{ payload: unknown; computed_at: number } | "no_birth" | "astro_failed"> {
  const cached = await env.DB.prepare(`SELECT payload_json, computed_at FROM ${table} WHERE user_id = ? AND zodiac_system = ?`)
    .bind(userId, zodiac)
    .first<{ payload_json: string; computed_at: number }>();
  if (cached) return { payload: JSON.parse(cached.payload_json), computed_at: cached.computed_at };
  const birth = await birthFor(env, userId);
  if (!birth) return "no_birth";
  let payload: unknown;
  try {
    payload = await compute(env, birth, zodiac);
  } catch (err) {
    if (err instanceof AstroError) return "astro_failed";
    throw err;
  }
  const computedAt = nowSec();
  await env.DB.prepare(`INSERT OR REPLACE INTO ${table} (user_id, zodiac_system, payload_json, computed_at) VALUES (?, ?, ?, ?)`)
    .bind(userId, zodiac, JSON.stringify(payload), computedAt)
    .run();
  return { payload, computed_at: computedAt };
}

app.get("/me/humandesign", async (c) => {
  const userId = c.get("userId");
  const meta = await birthMeta(c.env, userId);
  if (!meta) return failKind(c, 404, ERR.BIRTH_DATA_NOT_FOUND);
  const zodiac = await zodiacFor(c.env, userId);
  const r = await typologyFor(c.env, userId, "human_design_cache", humanDesign, zodiac);
  if (r === "no_birth") return failKind(c, 404, ERR.BIRTH_DATA_NOT_FOUND);
  if (r === "astro_failed") return failKind(c, 502, ERR.ASTRO_FAILED);
  return c.json({ hd: r.payload, birth: meta, cached_at: r.computed_at, zodiac_system: zodiac });
});

app.get("/me/genekeys", async (c) => {
  const userId = c.get("userId");
  const meta = await birthMeta(c.env, userId);
  if (!meta) return failKind(c, 404, ERR.BIRTH_DATA_NOT_FOUND);
  const zodiac = await zodiacFor(c.env, userId);
  const r = await typologyFor(c.env, userId, "gene_keys_cache", geneKeys, zodiac);
  if (r === "no_birth") return failKind(c, 404, ERR.BIRTH_DATA_NOT_FOUND);
  if (r === "astro_failed") return failKind(c, 502, ERR.ASTRO_FAILED);
  return c.json({ gk: r.payload, birth: meta, cached_at: r.computed_at, zodiac_system: zodiac });
});

// generic per-user narrative reading, cached in readings_cache by kind.
// Frame-dependent kinds (humandesign, genekeys) pass the user's zodiac so the
// prose is keyed by the sky it describes; frame-independent kinds (enneagram,
// socionics, convergence) stay on the 'tropical' row (convergence is
// tropical-canon; the questionnaire engines have no zodiac at all).
async function cachedReading(
  c: Context<{ Bindings: Env; Variables: Vars }>,
  kind: "humandesign" | "genekeys" | "humandesign_dual" | "genekeys_dual" | "dual_sky" | "enneagram" | "socionics" | "convergence",
  system: string,
  userPayload: unknown,
  fallback: string,
  zodiac: Zodiac = "tropical",
): Promise<Response> {
  const userId = c.get("userId");
  const existing = await c.env.DB.prepare("SELECT text, created_at FROM readings_cache WHERE user_id = ? AND kind = ? AND zodiac_system = ?")
    .bind(userId, kind, zodiac)
    .first<{ text: string; created_at: number }>();
  if (existing && existing.text) {
    return c.json({ text: existing.text, created_at: existing.created_at, degraded: false, reading_mode: kind.endsWith("_dual") || kind === "dual_sky" ? "dual_sky" : "single_system" });
  }
  const gen = await generateNarrative({
    env: c.env,
    system,
    user: JSON.stringify(userPayload),
    maxTokens: 700,
    fallback,
  });
  // Never persist the canned fallback as if it were a real reading.
  if (!gen.degraded) {
    await c.env.DB.prepare("INSERT OR REPLACE INTO readings_cache (user_id, kind, zodiac_system, text, created_at) VALUES (?, ?, ?, ?, ?)")
      .bind(userId, kind, zodiac, gen.text, nowSec())
      .run();
  }
  return c.json({ text: gen.text, created_at: nowSec(), degraded: gen.degraded, reading_mode: kind.endsWith("_dual") || kind === "dual_sky" ? "dual_sky" : "single_system" });
}

const READING_FALLBACK =
  "the reading can wait. the mechanics are here on the page, plainly. nothing is missing but the words, and those will come.";

app.get("/me/humandesign/reading", limiter(RULES.narrative), async (c) => {
  const userId = c.get("userId");
  const [t, s] = await Promise.all([
    typologyFor(c.env, userId, "human_design_cache", humanDesign, "tropical"),
    typologyFor(c.env, userId, "human_design_cache", humanDesign, "sidereal"),
  ]);
  if (t === "no_birth" || s === "no_birth") return failKind(c, 404, ERR.BIRTH_DATA_NOT_FOUND);
  if (t === "astro_failed" || s === "astro_failed") return failKind(c, 502, ERR.ASTRO_FAILED);
  return cachedReading(c, "humandesign_dual", dualSkyTypologySystemPrompt("human_design"), dualSkyTypologyContext("human_design", t.payload, s.payload), READING_FALLBACK);
});

app.get("/me/genekeys/reading", limiter(RULES.narrative), async (c) => {
  const userId = c.get("userId");
  const [t, s] = await Promise.all([
    typologyFor(c.env, userId, "gene_keys_cache", geneKeys, "tropical"),
    typologyFor(c.env, userId, "gene_keys_cache", geneKeys, "sidereal"),
  ]);
  if (t === "no_birth" || s === "no_birth") return failKind(c, 404, ERR.BIRTH_DATA_NOT_FOUND);
  if (t === "astro_failed" || s === "astro_failed") return failKind(c, 502, ERR.ASTRO_FAILED);
  return cachedReading(c, "genekeys_dual", dualSkyTypologySystemPrompt("gene_keys"), dualSkyTypologyContext("gene_keys", t.payload, s.payload), READING_FALLBACK);
});

// ---------------------------------------------------------------------------
// enneagram (questionnaire, no birth data)
// ---------------------------------------------------------------------------
// text-only question bank. scoring weights NEVER leave the server.
app.get("/enneagram/questions", async (c) => {
  return c.json({ questions: publicQuestions() });
});

app.get("/me/enneagram", async (c) => {
  const userId = c.get("userId");
  const answersRows = await c.env.DB.prepare("SELECT question_id, value FROM enneagram_answers WHERE user_id = ?")
    .bind(userId)
    .all<{ question_id: string; value: number }>();
  const answered = answersRows.results?.length ?? 0;
  const resultRow = await c.env.DB.prepare("SELECT payload_json FROM enneagram_results WHERE user_id = ?")
    .bind(userId)
    .first<{ payload_json: string }>();
  return c.json({
    result: resultRow ? JSON.parse(resultRow.payload_json) : null,
    answered,
    total: TOTAL_QUESTIONS,
  });
});

app.post("/me/enneagram", limiter(RULES.write), async (c) => {
  const userId = c.get("userId");
  const parsed = await readBody(c, enneagramSubmitSchema);
  if (!parsed.ok) return parsed.response;
  const answers = parsed.value.answers;

  // upsert each answer so a partial quiz resumes cleanly.
  const now = nowSec();
  const stmts = Object.entries(answers).map(([qid, val]) =>
    c.env.DB.prepare(
      "INSERT INTO enneagram_answers (user_id, question_id, value, updated_at) VALUES (?, ?, ?, ?) " +
        "ON CONFLICT(user_id, question_id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    ).bind(userId, qid, Math.max(1, Math.min(5, Math.round(val))), now),
  );
  if (stmts.length) await c.env.DB.batch(stmts);

  // score against the FULL stored answer set (merged old + new).
  const allRows = await c.env.DB.prepare("SELECT question_id, value FROM enneagram_answers WHERE user_id = ?")
    .bind(userId)
    .all<{ question_id: string; value: number }>();
  const merged: Record<string, number> = {};
  for (const r of allRows.results ?? []) merged[r.question_id] = r.value;

  const result = scoreEnneagram(merged, now);
  await c.env.DB.prepare("INSERT OR REPLACE INTO enneagram_results (user_id, payload_json, completed_at) VALUES (?, ?, ?)")
    .bind(userId, JSON.stringify(result), now)
    .run();
  // a fresh scoring invalidates any stale reading.
  await c.env.DB.prepare("DELETE FROM readings_cache WHERE user_id = ? AND kind = 'enneagram'").bind(userId).run();
  return c.json({ result, answered: Object.keys(merged).length, total: TOTAL_QUESTIONS });
});

app.delete("/me/enneagram", async (c) => {
  const userId = c.get("userId");
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM enneagram_answers WHERE user_id = ?").bind(userId),
    c.env.DB.prepare("DELETE FROM enneagram_results WHERE user_id = ?").bind(userId),
    c.env.DB.prepare("DELETE FROM readings_cache WHERE user_id = ? AND kind = 'enneagram'").bind(userId),
  ]);
  return c.json({ ok: true });
});

app.get("/me/enneagram/reading", limiter(RULES.narrative), async (c) => {
  const userId = c.get("userId");
  const resultRow = await c.env.DB.prepare("SELECT payload_json FROM enneagram_results WHERE user_id = ?")
    .bind(userId)
    .first<{ payload_json: string }>();
  if (!resultRow) return failKind(c, 404, ERR.NOT_FOUND);
  return cachedReading(c, "enneagram", enneagramSystemPrompt, JSON.parse(resultRow.payload_json), READING_FALLBACK);
});

// ---------------------------------------------------------------------------
// socionics (questionnaire + Model A + intertype relations, no birth data)
// ---------------------------------------------------------------------------
// text-only question bank. scoring weights NEVER leave the server.
app.get("/socionics/questions", async (c) => {
  return c.json({ questions: socionicsQuestions() });
});

app.get("/me/socionics", async (c) => {
  const userId = c.get("userId");
  const answersRows = await c.env.DB.prepare("SELECT question_id FROM socionics_answers WHERE user_id = ?")
    .bind(userId)
    .all<{ question_id: string }>();
  const answered = (answersRows.results ?? []).length;
  const resultRow = await c.env.DB.prepare("SELECT payload_json FROM socionics_results WHERE user_id = ?")
    .bind(userId)
    .first<{ payload_json: string }>();
  return c.json({
    result: resultRow ? JSON.parse(resultRow.payload_json) : null,
    answered,
    total: QUIZ_TOTAL,
  });
});

app.post("/me/socionics", limiter(RULES.write), async (c) => {
  const userId = c.get("userId");
  const parsed = await readBody(c, socionicsSubmitSchema);
  if (!parsed.ok) return parsed.response;
  const answers = parsed.value.answers;

  // upsert each answer so a partial quiz resumes cleanly.
  const now = nowSec();
  const stmts = Object.entries(answers).map(([qid, val]) =>
    c.env.DB.prepare(
      "INSERT INTO socionics_answers (user_id, question_id, value, updated_at) VALUES (?, ?, ?, ?) " +
        "ON CONFLICT(user_id, question_id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    ).bind(userId, qid, Math.max(1, Math.min(5, Math.round(val))), now),
  );
  if (stmts.length) await c.env.DB.batch(stmts);

  // score against the FULL stored answer set (merged old + new).
  const allRows = await c.env.DB.prepare("SELECT question_id, value FROM socionics_answers WHERE user_id = ?")
    .bind(userId)
    .all<{ question_id: string; value: number }>();
  const merged: Record<string, number> = {};
  for (const r of allRows.results ?? []) merged[r.question_id] = r.value;

  // Only produce a scored result once the quiz is complete; before that, return
  // null so the UI keeps showing the quiz (matches enneagram's completeness gate,
  // though enneagram scores partials; socionics is a weaker instrument, so we hold
  // for the full set to avoid a wildly unstable early type).
  const complete = Object.keys(merged).length >= QUIZ_TOTAL;
  if (!complete) {
    return c.json({ result: null, answered: Object.keys(merged).length, total: QUIZ_TOTAL });
  }
  const result = scoreSocionics(merged, now);
  await c.env.DB.prepare("INSERT OR REPLACE INTO socionics_results (user_id, payload_json, completed_at) VALUES (?, ?, ?)")
    .bind(userId, JSON.stringify(result), now)
    .run();
  // a fresh scoring invalidates any stale reading.
  await c.env.DB.prepare("DELETE FROM readings_cache WHERE user_id = ? AND kind = 'socionics'").bind(userId).run();
  return c.json({ result, answered: Object.keys(merged).length, total: QUIZ_TOTAL });
});

app.delete("/me/socionics", async (c) => {
  const userId = c.get("userId");
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM socionics_answers WHERE user_id = ?").bind(userId),
    c.env.DB.prepare("DELETE FROM socionics_results WHERE user_id = ?").bind(userId),
    c.env.DB.prepare("DELETE FROM readings_cache WHERE user_id = ? AND kind = 'socionics'").bind(userId),
  ]);
  return c.json({ ok: true });
});

app.get("/me/socionics/reading", limiter(RULES.narrative), async (c) => {
  const userId = c.get("userId");
  const resultRow = await c.env.DB.prepare("SELECT payload_json FROM socionics_results WHERE user_id = ?")
    .bind(userId)
    .first<{ payload_json: string }>();
  if (!resultRow) return failKind(c, 404, ERR.NOT_FOUND);
  return cachedReading(c, "socionics", socionicsSystemPrompt, JSON.parse(resultRow.payload_json), READING_FALLBACK);
});

// Intertype relation between the caller and another user, both of whom must have
// completed the quiz AND share a constellation. Mirrors the synastry authz gate.
app.get("/socionics/relations/:other_user_id", limiter(RULES.synastry), async (c) => {
  const otherId = idParam.safeParse(c.req.param("other_user_id"));
  if (!otherId.success) return failKind(c, 400, ERR.VALIDATION);
  const me = c.get("userId");
  const other = otherId.data;
  if (other === me) return failKind(c, 400, ERR.VALIDATION);
  // same authz gate as synastry: only compare with people you share a group with.
  if (!(await sharesConstellation(c.env, me, other))) return failKind(c, 404, ERR.NOT_FOUND);

  const meRow = await c.env.DB.prepare("SELECT payload_json FROM socionics_results WHERE user_id = ?")
    .bind(me)
    .first<{ payload_json: string }>();
  const otherRow = await c.env.DB.prepare("SELECT payload_json FROM socionics_results WHERE user_id = ?")
    .bind(other)
    .first<{ payload_json: string }>();
  if (!meRow || !otherRow) return failKind(c, 404, ERR.NOT_FOUND);

  const meType = (JSON.parse(meRow.payload_json) as { type: { code: string } }).type.code;
  const otherType = (JSON.parse(otherRow.payload_json) as { type: { code: string } }).type.code;
  const relation = relationBetween(meType, otherType);
  const otherName = await publicName(c.env, other);
  const meInfo = TYPE_BY_CODE[meType];
  const otherInfo = TYPE_BY_CODE[otherType];
  return c.json({
    me: { id: me, type: meType, nickname: meInfo?.nickname ?? null },
    other: { id: other, display_name: otherName?.display_name ?? null, type: otherType, nickname: otherInfo?.nickname ?? null },
    relation,
  });
});

// ---------------------------------------------------------------------------
// convergence: the shared trait space across all five engines.
// ---------------------------------------------------------------------------
// Gather whatever engine payloads a user has. Each is optional; the scorer is
// honest about thin coverage. astro = the stored + normalized natal chart, so
// the mapper reads the same {planets:[...]} shape the web does.
// TROPICAL-CANON (docs/SIDEREAL.md): convergence, harmony, and
// everything derived from these payloads (pair mechanics, the circle graph's
// harmony edges) score under the tropical sky REGARDLESS of the user's zodiac
// preference. birth_data.natal_chart_json is the canonical tropical chart, and
// the HD/GK reads below explicitly pin zodiac_system = 'tropical'. A sidereal
// cache row must never leak into pair scoring.
async function convergencePayloadsFor(env: Env, userId: string): Promise<EnginePayloads> {
  const [chartRow, hdRow, gkRow, ennRow, socRow] = await Promise.all([
    env.DB.prepare("SELECT natal_chart_json FROM birth_data WHERE user_id = ?").bind(userId).first<{ natal_chart_json: string | null }>(),
    env.DB.prepare("SELECT payload_json FROM human_design_cache WHERE user_id = ? AND zodiac_system = 'tropical'").bind(userId).first<{ payload_json: string }>(),
    env.DB.prepare("SELECT payload_json FROM gene_keys_cache WHERE user_id = ? AND zodiac_system = 'tropical'").bind(userId).first<{ payload_json: string }>(),
    env.DB.prepare("SELECT payload_json FROM enneagram_results WHERE user_id = ?").bind(userId).first<{ payload_json: string }>(),
    env.DB.prepare("SELECT payload_json FROM socionics_results WHERE user_id = ?").bind(userId).first<{ payload_json: string }>(),
  ]);
  const parse = (r: { payload_json: string } | null): unknown | null => {
    if (!r?.payload_json) return null;
    try { return JSON.parse(r.payload_json); } catch { return null; }
  };
  return {
    astro: chartRow?.natal_chart_json ? normalizeChart(JSON.parse(chartRow.natal_chart_json)) : null,
    human_design: parse(hdRow),
    gene_keys: parse(gkRow),
    enneagram: parse(ennRow),
    socionics: parse(socRow),
  };
}

// Cached-or-fresh scored convergence for a user. Cached in convergence_cache,
// keyed by an inputs_hash of the source payloads so it recomputes iff any source
// engine changed. This is the invalidation contract: cheap to check, correct by
// construction, no silent rot. Shared by /me/convergence, the reading, the pair
// view, and the harmony endpoints so every consumer sees the same result.
async function convergenceFor(env: Env, userId: string): Promise<ConvergenceResult> {
  const payloads = await convergencePayloadsFor(env, userId);
  const hash = convergenceInputsHash(payloads);
  const cached = await env.DB.prepare("SELECT payload_json, inputs_hash FROM convergence_cache WHERE user_id = ?")
    .bind(userId)
    .first<{ payload_json: string; inputs_hash: string }>();
  if (cached && cached.inputs_hash === hash) {
    return JSON.parse(cached.payload_json) as ConvergenceResult;
  }
  const result = computeConvergence(payloads, nowSec());
  await env.DB.prepare("INSERT OR REPLACE INTO convergence_cache (user_id, payload_json, computed_at, inputs_hash) VALUES (?, ?, ?, ?)")
    .bind(userId, JSON.stringify(result), result.computed_at, hash)
    .run();
  // a fresh scoring invalidates the stale reading, same as the other engines.
  await env.DB.prepare("DELETE FROM readings_cache WHERE user_id = ? AND kind = 'convergence'").bind(userId).run();
  return result;
}

app.get("/me/convergence", async (c) => {
  return c.json(await convergenceFor(c.env, c.get("userId")));
});

// ---------------------------------------------------------------------------
// harmony: ONE deterministic number per pair, derived from both members'
// already-scored convergences (lib/convergence/harmony.ts, formula in
// docs/CONVERGENCE.md §9). No LLM anywhere near the number. The relationship
// lens decides the framing WORD only (house harmony for roommates, never a
// romance-compatibility percent).
// ---------------------------------------------------------------------------
async function harmonyForPair(env: Env, a: string, b: string): Promise<{ harmony: HarmonyResult | null; framing: string; lens: Awaited<ReturnType<typeof effectiveLens>>; mechanics: PairMechanics }> {
  const [ua, ub] = pair(a, b);
  const [ra, rb, lens, pa, pb] = await Promise.all([
    convergenceFor(env, ua),
    convergenceFor(env, ub),
    effectiveLens(env, ua, ub),
    convergencePayloadsFor(env, ua),
    convergencePayloadsFor(env, ub),
  ]);
  // One canonical assembly path owns mechanics + adaptive birth-tier counts.
  const { harmony, mechanics } = computePairHarmony(ra, rb, pa, pb);
  return { harmony, framing: harmonyFraming(lens), lens, mechanics };
}

app.get("/harmony/pair/:other_user_id", async (c) => {
  const otherId = idParam.safeParse(c.req.param("other_user_id"));
  if (!otherId.success) return failKind(c, 400, ERR.VALIDATION);
  const me = c.get("userId");
  const other = otherId.data;
  if (other === me) return failKind(c, 400, ERR.VALIDATION);
  // Same authz gate as synastry: shared constellation or an unprobeable 404.
  if (!(await sharesConstellation(c.env, me, other))) return failKind(c, 404, ERR.NOT_FOUND);
  const { harmony, framing, lens, mechanics } = await harmonyForPair(c.env, me, other);
  // Mechanics are keyed "a"/"b" in canonical pair order; tell the client which
  // side the requester is so dominance/conditioning render with the right names.
  const [ua, ub] = pair(me, other);
  const [nameA, nameB] = await Promise.all([publicName(c.env, ua), publicName(c.env, ub)]);
  // verdict: the blunt one-liner, deterministic, built from the ranked lists.
  return c.json({
    harmony,
    framing,
    verdict: harmony ? verdictLine(harmony) : null,
    relationship_context: lens,
    mechanics,
    mechanics_sides: {
      a: { id: ua, display_name: nameA?.display_name ?? null },
      b: { id: ub, display_name: nameB?.display_name ?? null },
    },
  });
});

// LLM narrative OVER the scored result (never over raw engine payloads).
app.get("/me/convergence/reading", limiter(RULES.narrative), async (c) => {
  // ensure a fresh scored result exists (and reading cache is coherent with it).
  const result = await convergenceFor(c.env, c.get("userId"));
  return cachedReading(c, "convergence", convergenceReadingSystemPrompt, result, READING_FALLBACK);
});

// Pair-level convergence + narrative. The deterministic comparison is unchanged;
// prose is written over it with the stored relationship lens. GET lazily fills a
// missing/stale narrative, POST forces regeneration. Both are symmetric and use
// canonical pair order, so one report is shared by both people.
async function convergencePairResponse(
  c: Context<{ Bindings: Env; Variables: Vars }>,
  forceNarrative: boolean,
): Promise<Response> {
  const otherId = idParam.safeParse(c.req.param("other_user_id"));
  if (!otherId.success) return failKind(c, 400, ERR.VALIDATION);
  const me = c.get("userId");
  const other = otherId.data;
  if (other === me) return failKind(c, 400, ERR.VALIDATION);
  if (!(await sharesConstellation(c.env, me, other))) return failKind(c, 404, ERR.NOT_FOUND);

  const [userA, userB] = pair(me, other);
  const [pa, pb, nameA, nameB, lens] = await Promise.all([
    convergencePayloadsFor(c.env, userA),
    convergencePayloadsFor(c.env, userB),
    publicName(c.env, userA),
    publicName(c.env, userB),
    effectiveLens(c.env, userA, userB),
  ]);
  const hash = convergenceInputsHash(pa).slice(0, 8) + convergenceInputsHash(pb).slice(0, 8);
  const cached = await c.env.DB.prepare(
    `SELECT payload_json, inputs_hash, narrative, narrative_generated_at, narrative_lens
     FROM convergence_pair_cache WHERE user_a_id = ? AND user_b_id = ?`,
  )
    .bind(userA, userB)
    .first<{ payload_json: string; inputs_hash: string; narrative: string | null; narrative_generated_at: number | null; narrative_lens: string | null }>();

  let payload: {
    user_a: { id: string; display_name: string | null; convergences: ReturnType<typeof computeConvergence>["convergences"]; coverage: ReturnType<typeof computeConvergence>["coverage"] };
    user_b: { id: string; display_name: string | null; convergences: ReturnType<typeof computeConvergence>["convergences"]; coverage: ReturnType<typeof computeConvergence>["coverage"] };
    shared: ReturnType<typeof sharedConvergence>;
    computed_at: number;
  };
  const parsedCached = cached ? JSON.parse(cached.payload_json) as Partial<typeof payload> : null;
  // Pre-P1 pair rows used requester-relative {me,other}; reject that shape so
  // the first read rewrites it canonically and one symmetric report serves both.
  const deterministicFresh = !!(cached && cached.inputs_hash === hash && parsedCached?.user_a && parsedCached?.user_b);
  if (deterministicFresh) {
    payload = parsedCached as typeof payload;
  } else {
    const aRes = computeConvergence(pa, nowSec());
    const bRes = computeConvergence(pb, nowSec());
    payload = {
      user_a: { id: userA, display_name: nameA?.display_name ?? null, convergences: aRes.convergences, coverage: aRes.coverage },
      user_b: { id: userB, display_name: nameB?.display_name ?? null, convergences: bRes.convergences, coverage: bRes.coverage },
      shared: sharedConvergence(aRes, bRes),
      computed_at: nowSec(),
    };
  }

  // Harmony rides along on every pair response: deterministic, derived from the
  // same two convergence lists the payload already carries plus the mechanical
  // pair layer (lib/pair). The lens picks the framing word only, never the number.
  const canonical = computePairHarmony(payload.user_a, payload.user_b, pa, pb);
  const { harmony, mechanics } = canonical;
  const harmonyFramingWord = harmonyFraming(lens);

  const narrativeFresh = deterministicFresh && cached?.narrative && cached.narrative_lens === lens;
  if (narrativeFresh && !forceNarrative) {
    return c.json({ ...payload, relationship_context: lens, harmony, harmony_framing: harmonyFramingWord, harmony_verdict: harmony ? verdictLine(harmony) : null, mechanics, narrative: cached.narrative, narrative_generated_at: cached.narrative_generated_at, degraded: false });
  }

  // The narrative prompt receives a compact digest of the mechanical pair facts
  // (names attached, note fields explaining each fact class). The prompt forbids
  // extending them; the model only puts words to what is in the digest.
  const aName = (payload.user_a.display_name || "person a").toLowerCase();
  const bName = (payload.user_b.display_name || "person b").toLowerCase();
  const mechDigest = mechanicsDigest(mechanics, aName, bName);
  const gen = await generateNarrative({
    env: c.env,
    system: convergencePairSystemPrompt(lens),
    relationshipContext: lens,
    user: JSON.stringify({ relationship_context: lens, ...payload, ...(mechDigest ? { pair_mechanics: mechDigest } : {}) }),
    maxTokens: 900,
    fallback: READING_FALLBACK,
  });
  // Never replace a valid same-lens narrative with degraded copy.
  const keepExisting = gen.degraded && deterministicFresh && cached?.narrative && cached.narrative_lens === lens;
  const narrative = keepExisting ? cached.narrative : gen.text;
  const generatedAt = keepExisting ? cached.narrative_generated_at : nowSec();

  if (!gen.degraded || keepExisting) {
    await c.env.DB.prepare(
      `INSERT INTO convergence_pair_cache
       (user_a_id, user_b_id, payload_json, computed_at, inputs_hash, narrative, narrative_generated_at, narrative_lens)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_a_id, user_b_id) DO UPDATE SET
         payload_json = excluded.payload_json, computed_at = excluded.computed_at,
         inputs_hash = excluded.inputs_hash, narrative = excluded.narrative,
         narrative_generated_at = excluded.narrative_generated_at,
         narrative_lens = excluded.narrative_lens`,
    )
      .bind(userA, userB, JSON.stringify(payload), payload.computed_at, hash, narrative, generatedAt, lens)
      .run();
  }
  return c.json({ ...payload, relationship_context: lens, harmony, harmony_framing: harmonyFramingWord, harmony_verdict: harmony ? verdictLine(harmony) : null, mechanics, narrative, narrative_generated_at: generatedAt, degraded: gen.degraded && !keepExisting });
}

app.get("/convergence/pair/:other_user_id", limiter(RULES.narrative), (c) => convergencePairResponse(c, false));
app.post("/convergence/pair/:other_user_id", limiter(RULES.narrative), (c) => convergencePairResponse(c, true));

// Where two people's convergences agree on an axis (same direction) vs pull
// apart (opposite direction). Deterministic, evidence carried through.
function sharedConvergence(
  a: ReturnType<typeof computeConvergence>,
  b: ReturnType<typeof computeConvergence>,
): { agree: Array<{ axis: string; label: string; direction: string }>; diverge: Array<{ axis: string; label: string }> } {
  const byAxisA = new Map(a.convergences.map((c) => [c.axis, c]));
  const agree: Array<{ axis: string; label: string; direction: string }> = [];
  const diverge: Array<{ axis: string; label: string }> = [];
  for (const cb of b.convergences) {
    const ca = byAxisA.get(cb.axis);
    if (!ca) continue;
    if (Math.sign(ca.value) === Math.sign(cb.value)) {
      agree.push({ axis: ca.axis, label: ca.label, direction: ca.direction });
    } else {
      diverge.push({ axis: ca.axis, label: ca.label });
    }
  }
  return { agree, diverge };
}

// list my constellations (with member_count) -> matches web Constellation[]
app.get("/me/constellations", async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT c.id, c.name, c.creator_id, c.invite_token, c.created_at,
            (SELECT COUNT(*) FROM memberships mm WHERE mm.constellation_id = c.id) AS member_count
     FROM constellations c
     JOIN memberships m ON m.constellation_id = c.id
     WHERE m.user_id = ?
     ORDER BY c.created_at DESC`,
  )
    .bind(c.get("userId"))
    .all();
  return c.json(rows.results ?? []);
});

app.post("/constellations", limiter(RULES.write), async (c) => {
  const parsed = await readBody(c, constellationSchema);
  if (!parsed.ok) return parsed.response;
  const constellationId = id("con");
  const inviteToken = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(24)));
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO constellations (id, name, creator_id, invite_token, created_at) VALUES (?, ?, ?, ?, ?)")
      .bind(constellationId, parsed.value.name, c.get("userId"), inviteToken, nowSec()),
    c.env.DB.prepare("INSERT OR IGNORE INTO memberships (constellation_id, user_id, role, joined_at) VALUES (?, ?, 'creator', ?)")
      .bind(constellationId, c.get("userId"), nowSec()),
  ]);
  return c.json({ id: constellationId, name: parsed.value.name, creator_id: c.get("userId"), invite_token: inviteToken, member_count: 1, created_at: nowSec() });
});

app.post("/constellations/join", limiter(RULES.write), async (c) => {
  const parsed = await readBody(c, joinSchema);
  if (!parsed.ok) return parsed.response;
  const con = await c.env.DB.prepare("SELECT id, name, creator_id, invite_token, created_at FROM constellations WHERE invite_token = ?")
    .bind(parsed.value.invite_token)
    .first<{ id: string; name: string; creator_id: string; invite_token: string; created_at: number }>();
  if (!con) return failKind(c, 404, ERR.INVITE_NOT_FOUND);
  // Idempotent: double-tap join does not create a duplicate membership.
  await c.env.DB.prepare("INSERT OR IGNORE INTO memberships (constellation_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)")
    .bind(con.id, c.get("userId"), nowSec())
    .run();
  const count = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM memberships WHERE constellation_id = ?").bind(con.id).first<{ n: number }>();
  return c.json({ id: con.id, name: con.name, creator_id: con.creator_id, invite_token: con.invite_token, member_count: count?.n ?? 1, created_at: con.created_at });
});

// ---------------------------------------------------------------------------
// eliza in the circle (additive; lane 0008)
// A member of the constellation who answers with real receipts by calling
// deterministic typology tools. Membership is required on every route. Scope is
// enforced in the tools (lib/eliza/scope.ts), never in the prompt.
// ---------------------------------------------------------------------------
const elizaPostSchema = z.object({ body: z.string().trim().min(1).max(2000) });
const elizaSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  daily_prompt_enabled: z.boolean().optional(),
  quiet_hours: z.object({ start: z.number().int().min(0).max(23), end: z.number().int().min(0).max(23), tz: z.string().max(64) }).nullable().optional(),
});

// GET recent messages in the circle thread (membership required).
app.get("/constellations/:id/eliza", async (c) => {
  const cid = idParam.safeParse(c.req.param("id"));
  if (!cid.success) return failKind(c, 400, ERR.VALIDATION);
  if (!(await isMember(c.env, cid.data, c.get("userId")))) return failKind(c, 404, ERR.CONSTELLATION_NOT_FOUND);
  const rows = await c.env.DB.prepare(
    `SELECT id, user_id, role, body, created_at FROM eliza_messages
     WHERE constellation_id = ? ORDER BY created_at DESC LIMIT 50`,
  )
    .bind(cid.data)
    .all<{ id: string; user_id: string | null; role: string; body: string; created_at: number }>();
  const messages = (rows.results ?? []).reverse();
  return c.json({ messages });
});

// POST a message to eliza; she may reply (membership required, rate limited).
app.post("/constellations/:id/eliza", limiter(RULES.narrative), async (c) => {
  const cid = idParam.safeParse(c.req.param("id"));
  if (!cid.success) return failKind(c, 400, ERR.VALIDATION);
  const me = c.get("userId");
  if (!(await isMember(c.env, cid.data, me))) return failKind(c, 404, ERR.CONSTELLATION_NOT_FOUND);
  const parsed = await readBody(c, elizaPostSchema);
  if (!parsed.ok) return parsed.response;

  const memberCountRow = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM memberships WHERE constellation_id = ?")
    .bind(cid.data)
    .first<{ n: number }>();

  // Persist the user's message.
  const userMsgId = id("elz");
  const now = nowSec();
  await c.env.DB.prepare(
    "INSERT INTO eliza_messages (id, constellation_id, user_id, role, body, created_at) VALUES (?, ?, ?, 'user', ?, ?)",
  )
    .bind(userMsgId, cid.data, me, parsed.value.body, now)
    .run();

  // Recent thread for continuity.
  const priorRows = await c.env.DB.prepare(
    "SELECT role, body FROM eliza_messages WHERE constellation_id = ? ORDER BY created_at DESC LIMIT 12",
  )
    .bind(cid.data)
    .all<{ role: string; body: string }>();
  const prior = (priorRows.results ?? []).reverse().map((r) => ({ role: r.role === "eliza" ? ("eliza" as const) : ("user" as const), body: r.body }));

  const respondCtx: RespondContext = {
    body: parsed.value.body,
    addressed: true, // a direct POST to her endpoint is an address by construction
    memberCount: memberCountRow?.n ?? undefined,
  };

  const turn = await runTurn(c.env, { env: c.env, actorUserId: me, constellationId: cid.data }, respondCtx, prior);

  if (!turn.spoke || !turn.reply) {
    return c.json({ user_message: { id: userMsgId, created_at: now }, eliza: null, quiet_reason: turn.reason ?? "she stayed quiet" });
  }

  const elizaMsgId = id("elz");
  const elizaAt = nowSec();
  await c.env.DB.prepare(
    "INSERT INTO eliza_messages (id, constellation_id, user_id, role, body, tool_trace_json, created_at) VALUES (?, ?, NULL, 'eliza', ?, ?, ?)",
  )
    .bind(elizaMsgId, cid.data, turn.reply, JSON.stringify(turn.trace), elizaAt)
    .run();
  log("eliza.replied", { tools: turn.trace.length, degraded: !!turn.degraded });
  return c.json({
    user_message: { id: userMsgId, created_at: now },
    eliza: { id: elizaMsgId, role: "eliza", body: turn.reply, created_at: elizaAt },
    degraded: !!turn.degraded,
  });
});

// PATCH settings (creator/admin only, matching existing role checks).
app.patch("/constellations/:id/eliza/settings", async (c) => {
  const cid = idParam.safeParse(c.req.param("id"));
  if (!cid.success) return failKind(c, 400, ERR.VALIDATION);
  const me = c.get("userId");
  const role = await c.env.DB.prepare("SELECT role FROM memberships WHERE constellation_id = ? AND user_id = ?")
    .bind(cid.data, me)
    .first<{ role: string }>();
  if (!role) return failKind(c, 404, ERR.CONSTELLATION_NOT_FOUND);
  if (role.role !== "creator" && role.role !== "admin") return failKind(c, 403, ERR.FORBIDDEN);
  const parsed = await readBody(c, elizaSettingsSchema);
  if (!parsed.ok) return parsed.response;
  const existing = await c.env.DB.prepare("SELECT enabled, daily_prompt_enabled, quiet_hours_json FROM eliza_settings WHERE constellation_id = ?")
    .bind(cid.data)
    .first<{ enabled: number; daily_prompt_enabled: number; quiet_hours_json: string | null }>();
  const enabled = parsed.value.enabled ?? (existing ? !!existing.enabled : true);
  const dailyPrompt = parsed.value.daily_prompt_enabled ?? (existing ? !!existing.daily_prompt_enabled : true);
  const quietHours = parsed.value.quiet_hours === undefined ? (existing?.quiet_hours_json ?? null) : parsed.value.quiet_hours ? JSON.stringify(parsed.value.quiet_hours) : null;
  await c.env.DB.prepare(
    "INSERT OR REPLACE INTO eliza_settings (constellation_id, enabled, daily_prompt_enabled, quiet_hours_json, updated_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(cid.data, enabled ? 1 : 0, dailyPrompt ? 1 : 0, quietHours, nowSec())
    .run();
  return c.json({ enabled, daily_prompt_enabled: dailyPrompt, quiet_hours: quietHours ? JSON.parse(quietHours) : null });
});

// helper: is `userId` a member of `constellationId`?
async function isMember(env: Env, constellationId: string, userId: string): Promise<boolean> {
  const row = await env.DB.prepare("SELECT 1 AS x FROM memberships WHERE constellation_id = ? AND user_id = ?")
    .bind(constellationId, userId)
    .first<{ x: number }>();
  return !!row;
}

// helper: do two users share at least one constellation?
async function sharesConstellation(env: Env, a: string, b: string): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT 1 AS x FROM memberships m1
     JOIN memberships m2 ON m1.constellation_id = m2.constellation_id
     WHERE m1.user_id = ? AND m2.user_id = ? LIMIT 1`,
  )
    .bind(a, b)
    .first<{ x: number }>();
  return !!row;
}

app.get("/constellations/:id", async (c) => {
  const cid = idParam.safeParse(c.req.param("id"));
  if (!cid.success) return failKind(c, 400, ERR.VALIDATION);
  // IDOR guard: only members can read a constellation; non-members get 404 (not 403)
  // so ids are not confirmable by probing.
  const con = await c.env.DB.prepare(
    `SELECT c.id, c.name, c.creator_id, c.invite_token, c.created_at,
            (SELECT COUNT(*) FROM memberships mm WHERE mm.constellation_id = c.id) AS member_count
     FROM constellations c
     JOIN memberships m ON m.constellation_id = c.id
     WHERE c.id = ? AND m.user_id = ?`,
  )
    .bind(cid.data, c.get("userId"))
    .first();
  if (!con) return failKind(c, 404, ERR.CONSTELLATION_NOT_FOUND);
  return c.json(con);
});

app.get("/constellations/:id/members", async (c) => {
  const cid = idParam.safeParse(c.req.param("id"));
  if (!cid.success) return failKind(c, 400, ERR.VALIDATION);
  if (!(await isMember(c.env, cid.data, c.get("userId")))) return failKind(c, 404, ERR.CONSTELLATION_NOT_FOUND);
  // Note: we expose display_name + role + whether the member has birth data
  // (a boolean, for the synastry affordance) but NEVER raw birth data here.
  const rows = await c.env.DB.prepare(
    `SELECT users.id, users.display_name, memberships.role, memberships.joined_at,
            (SELECT COUNT(*) FROM birth_data bd WHERE bd.user_id = users.id) AS has_birth
     FROM memberships
     JOIN users ON users.id = memberships.user_id
     WHERE memberships.constellation_id = ?
     ORDER BY memberships.joined_at ASC`,
  )
    .bind(cid.data)
    .all<{ id: string; display_name: string | null; role: string; joined_at: number; has_birth: number }>();
  const members = (rows.results ?? []).map((m) => ({
    id: m.id,
    display_name: m.display_name,
    role: m.role,
    joined_at: m.joined_at,
    has_birth_data: m.has_birth > 0,
  }));
  return c.json(members);
});

// ---------------------------------------------------------------------------
// the circle graph, scoped (docs/CIRCLE-GRAPH.md, P4 surfacing).
// Members as nodes; shared deterministic traits + synastry aspects + pair
// harmony as edges. Membership-gated exactly like /constellations/:id/members:
// only members of the constellation ever see its graph, non-members get an
// unprobeable 404. Every trait comes from graph_edges rows, which carry
// provenance and never contain birth data (extract.ts invariants).
// ---------------------------------------------------------------------------
app.get("/constellations/:id/graph", async (c) => {
  const cid = idParam.safeParse(c.req.param("id"));
  if (!cid.success) return failKind(c, 400, ERR.VALIDATION);
  if (!(await isMember(c.env, cid.data, c.get("userId")))) return failKind(c, 404, ERR.CONSTELLATION_NOT_FOUND);

  const memberRows = await c.env.DB.prepare(
    `SELECT users.id, users.display_name,
            (SELECT COUNT(*) FROM birth_data bd WHERE bd.user_id = users.id) AS has_birth
     FROM memberships JOIN users ON users.id = memberships.user_id
     WHERE memberships.constellation_id = ?
     ORDER BY memberships.joined_at ASC`,
  )
    .bind(cid.data)
    .all<{ id: string; display_name: string | null; has_birth: number }>();
  const baseMembers = (memberRows.results ?? []).map((m) => ({
    id: m.id,
    display_name: m.display_name,
    has_birth_data: m.has_birth > 0,
  }));
  const memberIds = baseMembers.map((m) => m.id);

  // Lazy, hash-guarded edge sync from the engine caches (no-op when unchanged),
  // then the pairwise trait intersection over the synced edges.
  await syncCircleEdges(c.env, memberIds);
  const [pairs, highlights] = await Promise.all([
    circlePairTraits(c.env, memberIds),
    memberHighlights(c.env, memberIds),
  ]);

  // Harmony per pair. Load convergence + source payloads once per member, then
  // use the same canonical assembly helper as both pair endpoints/narratives.
  const convByMember = new Map<string, ConvergenceResult>();
  const payloadsByMember = new Map<string, EnginePayloads>();
  await Promise.all(memberIds.map(async (uid) => {
    const [convergence, payloads] = await Promise.all([
      convergenceFor(c.env, uid),
      convergencePayloadsFor(c.env, uid),
    ]);
    convByMember.set(uid, convergence);
    payloadsByMember.set(uid, payloads);
  }));
  const edges = await Promise.all(
    pairs.map(async (p) => {
      const lens = await effectiveLens(c.env, p.a, p.b);
      const { harmony: h } = computePairHarmony(
        convByMember.get(p.a)!,
        convByMember.get(p.b)!,
        payloadsByMember.get(p.a)!,
        payloadsByMember.get(p.b)!,
      );
      return {
        a: p.a,
        b: p.b,
        shared: p.shared,
        aspects: p.aspects,
        harmony: h ? {
          score: h.score,
          band: h.band,
          confidence: h.confidence,
          engines: h.engines,
          shared_axes: h.shared_axes,
        } : null,
        harmony_framing: harmonyFraming(lens),
        verdict: h ? verdictLine(h) : null,
      };
    }),
  );

  const members = baseMembers.map((m) => ({ ...m, highlights: highlights[m.id] ?? [] }));
  return c.json({ members, edges, computed_at: nowSec() });
});

// ---------------------------------------------------------------------------
// journal
// ---------------------------------------------------------------------------
app.post("/journal", limiter(RULES.write), async (c) => {
  const parsed = await readBody(c, journalSchema);
  if (!parsed.ok) return parsed.response;
  const constellationId = parsed.value.constellation_id ?? null;
  if (constellationId) {
    if (!(await isMember(c.env, constellationId, c.get("userId")))) return failKind(c, 403, ERR.FORBIDDEN);
  }
  // Attach a transit snapshot if the author has birth data; failure here must not
  // block saving the entry (graceful degradation).
  const b = await c.env.DB.prepare("SELECT timezone, latitude, longitude FROM birth_data WHERE user_id = ?")
    .bind(c.get("userId"))
    .first<{ timezone: string; latitude: number; longitude: number }>();
  let snapshot: unknown = null;
  if (b) {
    try {
      snapshot = await transitChart(c.env, { date: new Date().toISOString().slice(0, 10), lat: b.latitude, lng: b.longitude, tz: b.timezone });
    } catch {
      snapshot = null; // soft-fail
    }
  }
  const journalId = id("jou");
  const writtenAt = nowSec();
  await c.env.DB.prepare(
    "INSERT INTO journal_entries (id, user_id, constellation_id, body, written_at, transit_snapshot_json) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(journalId, c.get("userId"), constellationId, parsed.value.body, writtenAt, snapshot ? JSON.stringify(snapshot) : null)
    .run();
  log("journal.created", { shared: !!constellationId });
  return c.json({
    id: journalId,
    user_id: c.get("userId"),
    constellation_id: constellationId,
    body: parsed.value.body,
    written_at: writtenAt,
  });
});

app.get("/journal", async (c) => {
  const constellationId = c.req.query("constellation_id");
  if (constellationId) {
    const cid = idParam.safeParse(constellationId);
    if (!cid.success) return failKind(c, 400, ERR.VALIDATION);
    if (!(await isMember(c.env, cid.data, c.get("userId")))) return failKind(c, 403, ERR.FORBIDDEN);
    const rows = await c.env.DB.prepare(
      `SELECT j.id, j.user_id, j.constellation_id, j.body, j.written_at, j.transit_snapshot_json,
              u.display_name AS user_name, c.name AS constellation_name
       FROM journal_entries j
       JOIN users u ON u.id = j.user_id
       LEFT JOIN constellations c ON c.id = j.constellation_id
       WHERE j.constellation_id = ?
       ORDER BY j.written_at DESC LIMIT 100`,
    )
      .bind(cid.data)
      .all();
    return c.json((rows.results ?? []).map(shapeEntry));
  }
  // Private view: the user's own entries (private + shared they authored).
  const rows = await c.env.DB.prepare(
    `SELECT j.id, j.user_id, j.constellation_id, j.body, j.written_at, j.transit_snapshot_json,
            u.display_name AS user_name, c.name AS constellation_name
     FROM journal_entries j
     JOIN users u ON u.id = j.user_id
     LEFT JOIN constellations c ON c.id = j.constellation_id
     WHERE j.user_id = ?
     ORDER BY j.written_at DESC LIMIT 100`,
  )
    .bind(c.get("userId"))
    .all();
  return c.json((rows.results ?? []).map(shapeEntry));
});

function shapeEntry(r: unknown): unknown {
  const e = r as {
    id: string;
    user_id: string;
    constellation_id: string | null;
    body: string;
    written_at: number;
    transit_snapshot_json: string | null;
    user_name: string | null;
    constellation_name: string | null;
  };
  let snapshot: { line: string } | null = null;
  if (e.transit_snapshot_json) {
    try {
      const parsed = JSON.parse(e.transit_snapshot_json) as { line?: string };
      if (parsed && typeof parsed.line === "string") snapshot = { line: parsed.line };
    } catch {
      snapshot = null;
    }
  }
  return {
    id: e.id,
    user_id: e.user_id,
    user_name: e.user_name,
    constellation_id: e.constellation_id,
    constellation_name: e.constellation_name,
    body: e.body,
    written_at: e.written_at,
    transit_snapshot: snapshot,
  };
}

app.get("/journal/:id", async (c) => {
  const jid = idParam.safeParse(c.req.param("id"));
  if (!jid.success) return failKind(c, 400, ERR.VALIDATION);
  const entry = await c.env.DB.prepare(
    "SELECT id, user_id, constellation_id, body, written_at, transit_snapshot_json FROM journal_entries WHERE id = ?",
  )
    .bind(jid.data)
    .first<{ id: string; user_id: string; constellation_id: string | null; body: string; written_at: number; transit_snapshot_json: string | null }>();
  if (!entry) return failKind(c, 404, ERR.JOURNAL_NOT_FOUND);
  // IDOR guard: own entry OR a shared entry in a constellation I belong to.
  if (entry.user_id !== c.get("userId")) {
    if (!entry.constellation_id) return failKind(c, 404, ERR.JOURNAL_NOT_FOUND);
    if (!(await isMember(c.env, entry.constellation_id, c.get("userId")))) return failKind(c, 404, ERR.JOURNAL_NOT_FOUND);
  }
  return c.json(shapeEntry({ ...entry, user_name: null, constellation_name: null }));
});

// ---------------------------------------------------------------------------
// sky / today
// ---------------------------------------------------------------------------
app.get("/sky/today", limiter(RULES.narrative), async (c) => {
  // IDOR fix: previously a ?user_id= param let any caller read another user's
  // birth coords + timezone via the transit. We now ALWAYS use the caller's own
  // birth data. There is no legitimate reason to compute "today's sky" for
  // someone else's birthplace from this endpoint.
  const userId = c.get("userId");
  const b = await c.env.DB.prepare("SELECT timezone, latitude, longitude FROM birth_data WHERE user_id = ?")
    .bind(userId)
    .first<{ timezone: string; latitude: number; longitude: number }>();
  if (!b) return failKind(c, 404, ERR.BIRTH_DATA_NOT_FOUND);

  let sky: unknown;
  try {
    sky = await transitChart(c.env, { date: new Date().toISOString().slice(0, 10), lat: b.latitude, lng: b.longitude, tz: b.timezone });
  } catch (err) {
    if (err instanceof AstroError) return failKind(c, 502, ERR.ASTRO_FAILED);
    throw err;
  }

  const { text: reflection, degraded } = await generateNarrative({
    env: c.env,
    system: transitSystemPrompt,
    user: JSON.stringify(sky),
    maxTokens: 320,
    fallback: FALLBACK.transitReflection,
  });

  // Split the reflection into "lines" + a "prompt" the web expects. The model is
  // asked for a short reflection; we derive a prompt from a stable fallback if the
  // model is degraded so the UI always has both.
  const lines = reflection
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 3);
  return c.json({
    date: new Date().toISOString().slice(0, 10),
    chart: normalizeChart(sky),
    lines: lines.length ? lines : [FALLBACK.transitReflection],
    prompt: FALLBACK.transitPrompt,
    reflection,
    degraded,
  });
});

// ---------------------------------------------------------------------------
// synastry
// ---------------------------------------------------------------------------
async function birthFor(env: Env, userId: string): Promise<BirthLike | null> {
  const row = await env.DB.prepare("SELECT date_local, timezone, latitude, longitude FROM birth_data WHERE user_id = ?")
    .bind(userId)
    .first<{ date_local: string; timezone: string; latitude: number; longitude: number }>();
  if (!row) return null;
  return { date: row.date_local.slice(0, 10), time: row.date_local.slice(11, 16) || "12:00", lat: row.latitude, lng: row.longitude, tz: row.timezone };
}

// Canonical pair ordering so (a,b) and (b,a) map to the same cached row.
function pair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

// The structured synastry prompt returns a JSON object. If the model wrapped it
// in prose or markdown fences, extract the outermost {...} and verify it parses.
// If it doesn't look like our structured object, return the text unchanged so the
// old prose format and the canned fallback still pass through cleanly.
function sanitizeStructured(text: string): string {
  const t = text.trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end <= start) return text;
  const candidate = t.slice(start, end + 1);
  try {
    const obj = JSON.parse(candidate) as { sections?: unknown; opening?: unknown; verdict?: unknown };
    if (obj && (Array.isArray(obj.sections) || obj.opening || obj.verdict)) {
      return JSON.stringify(obj);
    }
    return text;
  } catch {
    return text;
  }
}

function publicName(env: Env, userId: string): Promise<{ id: string; display_name: string | null } | null> {
  return env.DB.prepare("SELECT id, display_name FROM users WHERE id = ?").bind(userId).first<{ id: string; display_name: string | null }>();
}

// ---------------------------------------------------------------------------
// pair relationship context (P1). The declared relationship between two members
// decides the lens every pair narrative is written through. Either member can
// set it; last-write-wins. Same authz gate as synastry: shared constellation
// required, 404 otherwise (ids stay unprobeable).
// ---------------------------------------------------------------------------
const pairContextSchema = z.object({
  relationship: z.enum(RELATIONSHIP_KINDS),
});

app.get("/pairs/:other_user_id/context", async (c) => {
  const otherId = idParam.safeParse(c.req.param("other_user_id"));
  if (!otherId.success) return failKind(c, 400, ERR.VALIDATION);
  const me = c.get("userId");
  const other = otherId.data;
  if (other === me) return failKind(c, 400, ERR.VALIDATION);
  if (!(await sharesConstellation(c.env, me, other))) return failKind(c, 404, ERR.NOT_FOUND);
  const row = await pairContextFor(c.env, me, other);
  return c.json({
    relationship: row?.relationship ?? null,
    set_by: row?.set_by ?? null,
    updated_at: row?.updated_at ?? null,
  });
});

app.put("/pairs/:other_user_id/context", limiter(RULES.write), async (c) => {
  const otherId = idParam.safeParse(c.req.param("other_user_id"));
  if (!otherId.success) return failKind(c, 400, ERR.VALIDATION);
  const me = c.get("userId");
  const other = otherId.data;
  if (other === me) return failKind(c, 400, ERR.VALIDATION);
  if (!(await sharesConstellation(c.env, me, other))) return failKind(c, 404, ERR.NOT_FOUND);
  const parsed = await readBody(c, pairContextSchema);
  if (!parsed.ok) return parsed.response;
  const [ua, ub] = canonicalPair(me, other);
  const now = nowSec();
  await c.env.DB.prepare(
    `INSERT INTO pair_context (user_a_id, user_b_id, relationship, set_by, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_a_id, user_b_id) DO UPDATE SET
       relationship = excluded.relationship,
       set_by = excluded.set_by,
       updated_at = excluded.updated_at`,
  )
    .bind(ua, ub, parsed.value.relationship, me, now)
    .run();
  log("pair_context.set", { relationship: parsed.value.relationship });
  return c.json({ relationship: parsed.value.relationship, set_by: me, updated_at: now });
});

app.post("/synastry/:other_user_id", limiter(RULES.synastry), async (c) => {
  const otherId = idParam.safeParse(c.req.param("other_user_id"));
  if (!otherId.success) return failKind(c, 400, ERR.VALIDATION);
  const me = c.get("userId");
  const other = otherId.data;
  if (other === me) return failKind(c, 400, ERR.VALIDATION);
  // IDOR fix: you may only run synastry against someone who shares a constellation
  // with you. Without this, any user could read any other user's chart via aspects.
  if (!(await sharesConstellation(c.env, me, other))) return failKind(c, 404, ERR.NOT_FOUND);

  // Canonical pair order FIRST. The aspect grid, the narrative, and the cached
  // row must all use the same orientation, otherwise the reading's "person a"
  // flips depending on who generated it (the your-sun-is-actually-their-sun bug).
  const [userA, userB] = pair(me, other);

  const a = await birthFor(c.env, userA);
  const b = await birthFor(c.env, userB);
  if (!a || !b) return failKind(c, 404, ERR.BIRTH_DATA_NOT_FOUND);

  // The cast is made under the CASTER's zodiac lens, and the generation row
  // permanently records which sky it was cast under. Old readings never
  // silently change frame.
  const zodiac = await zodiacFor(c.env, me);
  let aspects: unknown;
  try {
    aspects = await synastryGrid(c.env, a, b, zodiac);
  } catch (err) {
    if (err instanceof AstroError) return failKind(c, 502, ERR.ASTRO_FAILED);
    throw err;
  }

  // Names go into the prompt so the reading refers to people by name, never
  // "your/their". One shared reading must read correctly from both sides.
  const nameRowA = await publicName(c.env, userA);
  const nameRowB = await publicName(c.env, userB);
  const personAName = (nameRowA?.display_name || "person a").toLowerCase();
  const personBName = (nameRowB?.display_name || "person b").toLowerCase();

  // Relationship lens (P1): the declared pair context decides the framing.
  // Romantic only when declared AND both members' preferences allow it;
  // undeclared pairs read platonic. Resolved from stored data, never guessed.
  const lens = await effectiveLens(c.env, userA, userB);

  // Mechanical pair facts from the non-astro engines (lib/pair): the HD
  // connection chart, gene keys wheel geometry, socionics intertype, enneagram
  // contrast. Computed here, digested with names attached, and handed to the
  // prompt as evidence the model may describe but never extend. This keeps the
  // product ONE reading per pair with all five engines as sources.
  const [mpa, mpb] = await Promise.all([
    convergencePayloadsFor(c.env, userA),
    convergencePayloadsFor(c.env, userB),
  ]);
  const mechDigest = mechanicsDigest(buildPairMechanics(mpa, mpb), personAName, personBName);

  const gen = await generateNarrative({
    env: c.env,
    system: synastrySystemPrompt(lens, !!mechDigest, zodiac),
    relationshipContext: lens,
    user: JSON.stringify({ person_a_name: personAName, person_b_name: personBName, relationship_context: lens, cast_provenance: { zodiac_system: zodiac, sky: zodiac === "sidereal" ? "fixed-star Lahiri" : "seasonal tropical" }, grid: aspects, ...(mechDigest ? { pair_mechanics: mechDigest } : {}) }),
    maxTokens: 2000,
    fallback: FALLBACK.synastry,
  });
  const degraded = gen.degraded;
  // The structured prompt returns a JSON object. Models sometimes add stray prose
  // or markdown fences around it; extract the outermost {...} so what we store is
  // clean, parseable JSON. Non-JSON (old prose / fallback) passes through as-is.
  const narrative = sanitizeStructured(gen.text);

  // Append-only: EVERY generation is persisted forever, degraded ones flagged.
  // Nothing is upserted, nothing is deleted. This is also the future credits
  // hook: one POST = one generation row = one credit.
  const generatedAt = nowSec();
  const genId = id("syng");
  await insertGeneration(c.env, {
    id: genId,
    user_a_id: userA,
    user_b_id: userB,
    lens,
    aspects_json: JSON.stringify(aspects),
    narrative,
    generated_at: generatedAt,
    generated_by: me,
    degraded: degraded ? 1 : 0,
    zodiac_system: zodiac,
  });

  // Only good generations become active. A degraded cast is returned to the
  // caller (they asked, they see the partial reading) but the pair's active
  // pointer stays on the last good one.
  if (!degraded) {
    await setActivePointer(c.env, userA, userB, zodiac, genId, me);
  }

  const gens = await listGenerations(c.env, userA, userB);
  const romanticOk = await romanticHistoryAllowed(c.env, userA, userB);
  const pointer = await activePointer(c.env, userA, userB, zodiac);
  const metas = generationMetasForZodiac(gens, degraded ? null : genId, romanticOk, zodiac);
  const meName = await publicName(c.env, me);
  const otherName = await publicName(c.env, other);
  log("synastry.generated", { degraded, zodiac });
  const mine = metas.find((m) => m.id === genId);
  return c.json({
    ...(await synastryView(c.env, me, other, aspects, narrative, generatedAt, meName, otherName, zodiac) as Record<string, unknown>),
    degraded,
    current_lens: lens,
    generation: {
      id: genId,
      lens,
      zodiac_system: zodiac,
      generated_at: generatedAt,
      degraded,
      index: mine?.index ?? metas.length,
      total: metas.length,
      active: !degraded && pointer === genId,
    },
  });
});

// List a pair's reading history for the drawer. Metadata only, narratives are
// fetched one at a time via GET /synastry/:other?generation=<id>. Romantic
// generations vanish from the list while either member's preference forbids
// romantic framing.
// Cheap metadata read, hit once per pair card on multi-pair surfaces; the
// tight synastry bucket (10/min, sized for LLM casts) would false-positive on
// a normal home render, so it rides the wider write bucket instead.
app.get("/synastry/:other_user_id/generations", limiter(RULES.write), async (c) => {
  const otherId = idParam.safeParse(c.req.param("other_user_id"));
  if (!otherId.success) return failKind(c, 400, ERR.VALIDATION);
  const me = c.get("userId");
  const other = otherId.data;
  if (other === me) return failKind(c, 400, ERR.VALIDATION);
  if (!(await sharesConstellation(c.env, me, other))) return failKind(c, 404, ERR.NOT_FOUND);

  const [userA, userB] = pair(me, other);
  const zodiac = await zodiacFor(c.env, me);
  const gens = await listGenerations(c.env, userA, userB);
  const romanticOk = await romanticHistoryAllowed(c.env, userA, userB);
  const [tropicalPointer, siderealPointer] = await Promise.all([
    activePointer(c.env, userA, userB, "tropical"),
    activePointer(c.env, userA, userB, "sidereal"),
  ]);
  const activeIds = new Set(
    [
      resolveActiveForZodiac(gens, tropicalPointer, romanticOk, "tropical")?.id,
      resolveActiveForZodiac(gens, siderealPointer, romanticOk, "sidereal")?.id,
    ].filter((x): x is string => !!x),
  );
  const metas = generationMetas(gens, null, romanticOk).map((m) => ({ ...m, active: activeIds.has(m.id) }));
  const lens = await effectiveLens(c.env, userA, userB);
  return c.json({ generations: metas, total: metas.length, current_lens: lens, active_zodiac: zodiac });
});

// Switch which generation the pair is viewing. Either member can switch;
// last-write-wins with updated_by. The romantic gate applies at switch time:
// a romantic generation cannot become active while either member's preference
// forbids romantic framing (unprobeable 404, same as a nonexistent id).
app.put("/synastry/:other_user_id/active", limiter(RULES.write), async (c) => {
  const otherId = idParam.safeParse(c.req.param("other_user_id"));
  if (!otherId.success) return failKind(c, 400, ERR.VALIDATION);
  const me = c.get("userId");
  const other = otherId.data;
  if (other === me) return failKind(c, 400, ERR.VALIDATION);
  if (!(await sharesConstellation(c.env, me, other))) return failKind(c, 404, ERR.NOT_FOUND);
  const parsed = await readBody(c, z.object({ generation_id: idParam }));
  if (!parsed.ok) return parsed.response;

  const [userA, userB] = pair(me, other);
  const gens = await listGenerations(c.env, userA, userB);
  const target = gens.find((g) => g.id === parsed.value.generation_id);
  // Belongs-to-pair check: an id from another pair reads as not found, never
  // as forbidden (ids stay unprobeable).
  if (!target) return failKind(c, 404, ERR.SYNASTRY_NOT_FOUND);
  // Degraded generations are never active: the partial reading is viewable in
  // history but the pair's shared pointer only rests on complete readings.
  if (target.degraded) return failKind(c, 404, ERR.SYNASTRY_NOT_FOUND);
  const romanticOk = await romanticHistoryAllowed(c.env, userA, userB);
  if (!genAllowed(target.lens, romanticOk)) return failKind(c, 404, ERR.SYNASTRY_NOT_FOUND);

  await setActivePointer(c.env, userA, userB, target.zodiac_system, target.id, me);
  log("synastry.active_switched", { zodiac: target.zodiac_system });
  const metas = generationMetasForZodiac(gens, target.id, romanticOk, target.zodiac_system);
  const mine = metas.find((m) => m.id === target.id);
  return c.json({
    generation: {
      id: target.id,
      lens: target.lens,
      zodiac_system: target.zodiac_system,
      generated_at: target.generated_at,
      degraded: false,
      index: mine?.index ?? 0,
      total: metas.length,
      active: true,
    },
  });
});

// GET returns the ACTIVE generation for the pair (or a specific one via
// ?generation=<id>). It NEVER regenerates and never 404s on lens mismatch;
// instead the response carries current_lens vs generation.lens so the client
// can render a "read under the {lens} lens" tag. Romantic generations are
// hidden while the gate is closed; active falls back to the newest allowed.
app.get("/synastry/:other_user_id", limiter(RULES.synastry), async (c) => {
  const otherId = idParam.safeParse(c.req.param("other_user_id"));
  if (!otherId.success) return failKind(c, 400, ERR.VALIDATION);
  const me = c.get("userId");
  const other = otherId.data;
  if (other === me) return failKind(c, 400, ERR.VALIDATION);
  // Same authz gate as POST.
  if (!(await sharesConstellation(c.env, me, other))) return failKind(c, 404, ERR.NOT_FOUND);

  const [userA, userB] = pair(me, other);
  const zodiac = await zodiacFor(c.env, me);
  const gens = await listGenerations(c.env, userA, userB);
  const romanticOk = await romanticHistoryAllowed(c.env, userA, userB);
  const pointer = await activePointer(c.env, userA, userB, zodiac);
  const active = resolveActiveForZodiac(gens, pointer, romanticOk, zodiac);

  // Optional explicit generation fetch (drawer preview). Gated identically:
  // hidden or degraded generations read like the active one is requested.
  let row: GenerationRow | null = active;
  const requested = c.req.query("generation");
  if (requested) {
    const target = gens.find((g) => g.id === requested);
    if (!target || !genAllowed(target.lens, romanticOk)) return failKind(c, 404, ERR.SYNASTRY_NOT_FOUND);
    row = target;
  }
  if (!row) return failKind(c, 404, ERR.SYNASTRY_NOT_FOUND);

  const metas = requested
    ? generationMetas(gens, active?.id ?? null, romanticOk)
    : generationMetasForZodiac(gens, active?.id ?? null, romanticOk, zodiac);
  const mine = metas.find((m) => m.id === row.id);
  const lens = await effectiveLens(c.env, userA, userB);
  const meName = await publicName(c.env, me);
  const otherName = await publicName(c.env, other);
  const rowZodiac: Zodiac = row.zodiac_system === "sidereal" ? "sidereal" : "tropical";
  return c.json({
    ...(await synastryView(c.env, me, other, JSON.parse(row.aspects_json), row.narrative, row.generated_at, meName, otherName, rowZodiac) as Record<string, unknown>),
    degraded: row.degraded !== 0,
    current_lens: lens,
    generation: {
      id: row.id,
      lens: row.lens,
      zodiac_system: row.zodiac_system,
      generated_at: row.generated_at,
      degraded: row.degraded !== 0,
      index: mine?.index ?? 0,
      total: metas.length,
      active: row.id === (active?.id ?? null),
    },
  });
});

// Shape synastry the way the web client expects: user_a/user_b with charts,
// aspects[], narrative, generated_at. Charts must come from the generation's
// permanent sky, not the requester's current preference. This also keeps a
// cross-sky history preview internally consistent after the preference flips.
async function synastryView(
  env: Env,
  meId: string,
  otherId: string,
  rawAspects: unknown,
  narrative: string,
  generatedAt: number,
  meName: { id: string; display_name: string | null } | null,
  otherName: { id: string; display_name: string | null } | null,
  zodiac: Zodiac,
): Promise<unknown> {
  const [meFrame, otherFrame] = await Promise.all([
    natalForFrame(env, meId, zodiac),
    natalForFrame(env, otherId, zodiac),
  ]);
  const meChart = meFrame === "no_birth" || meFrame === "astro_failed" ? null : normalizeChart(meFrame);
  const otherChart = otherFrame === "no_birth" || otherFrame === "astro_failed" ? null : normalizeChart(otherFrame);
  // Normalize the astro aspects payload (which is keyed person_a/person_b) into
  // the flat {a,b,type,orb,harmonic} the web expects. The stored grid is in
  // canonical pair order; the web renders side a as "you" (the requester), so
  // flip the columns when the requester is the canonical second member.
  const swapped = pair(meId, otherId)[0] !== meId;
  const aspects = normalizeAspects(rawAspects, swapped);
  return {
    user_a: { id: meId, display_name: meName?.display_name ?? null, chart: meChart },
    user_b: { id: otherId, display_name: otherName?.display_name ?? null, chart: otherChart },
    aspects,
    narrative: normalizeSynastryNarrative(narrative),
    generated_at: generatedAt,
  };
}

function normalizeAspects(raw: unknown, swapped = false): Array<{ a: string; b: string; type: string; orb: number; harmonic: string }> {
  const grid = raw as { aspects?: Array<{ person_a_planet?: string; person_b_planet?: string; aspect?: string; orb?: number; harmonious?: boolean; generational?: boolean }> };
  const list = Array.isArray(grid?.aspects) ? grid.aspects : [];
  return list
    .filter((x) => !x.generational) // drop generational noise from the displayed list
    .map((x) => ({
      a: (swapped ? x.person_b_planet : x.person_a_planet) ?? "",
      b: (swapped ? x.person_a_planet : x.person_b_planet) ?? "",
      type: x.aspect ?? "",
      orb: typeof x.orb === "number" ? x.orb : 0,
      harmonic: x.harmonious ? "harmonious" : "harsh",
    }));
}

// ---------------------------------------------------------------------------
// astrocartography (ad-hoc, unauthenticated preview)
// ---------------------------------------------------------------------------
// Lines for a supplied birth, for non-members / previews. Rate-limited with the
// astro-engine bucket; not cached (no user to key on).
app.post("/astrocartography", limiter(RULES.synastry), async (c) => {
  const parsed = await readBody(c, acgBirthSchema);
  if (!parsed.ok) return parsed.response;
  const b = parsed.value;
  const body: BirthLike = { date: b.date, time: b.time || "12:00", lat: b.lat, lng: b.lng, tz: b.tz };
  try {
    return c.json(await astrocartographyLines(c.env, body));
  } catch (err) {
    if (err instanceof AstroError) return failKind(c, 502, ERR.ASTRO_FAILED);
    throw err;
  }
});

// ---------------------------------------------------------------------------
// places
// ---------------------------------------------------------------------------
app.post("/places/lookup", limiter(RULES.places), async (c) => {
  const parsed = await readBody(c, placesSchema);
  if (!parsed.ok) return parsed.response;
  const q = parsed.value.q.trim().toLowerCase();

  const cached = await c.env.DB.prepare("SELECT result_json, cached_at FROM place_cache WHERE q = ?")
    .bind(q)
    .first<{ result_json: string; cached_at: number }>();
  if (cached && cached.cached_at > nowSec() - 60 * 60 * 24 * 30) {
    return c.json(JSON.parse(cached.result_json));
  }

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", parsed.value.q);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "5");
  url.searchParams.set("addressdetails", "0");

  let response: Response;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    response = await fetch(url.toString(), {
      signal: controller.signal,
      headers: { "user-agent": "Constellate/1.0 (place lookup; constellate.me)" },
    });
  } catch {
    clearTimeout(timer);
    return failKind(c, 502, ERR.PLACES_FAILED);
  }
  clearTimeout(timer);
  if (!response.ok) return failKind(c, 502, ERR.PLACES_FAILED);

  const raw = await response.json<Array<{ display_name: string; lat: string; lon: string }>>();
  const results = raw
    .map((item) => ({
      place_name: item.display_name,
      latitude: Number(item.lat),
      longitude: Number(item.lon),
      timezone: approximateTimezone(Number(item.lat), Number(item.lon)),
    }))
    .filter((r) => Number.isFinite(r.latitude) && Number.isFinite(r.longitude));

  await c.env.DB.prepare("INSERT OR REPLACE INTO place_cache (q, result_json, cached_at) VALUES (?, ?, ?)")
    .bind(q, JSON.stringify(results), nowSec())
    .run();
  return c.json(results);
});

// Real coordinate -> IANA timezone lookup (offline, worldwide, no API key).
// Replaces the old hardcoded approximation that only knew US/UK/FR/JP and
// silently returned "UTC" for everywhere else (e.g. India), which corrupted
// birth charts for anyone born outside those regions.
function approximateTimezone(lat: number, lng: number): string {
  try {
    return tzLookup(lat, lng);
  } catch {
    return "UTC"; // only if coords are invalid/out of range
  }
}

// ---------------------------------------------------------------------------
// fallthrough
// ---------------------------------------------------------------------------
app.notFound((c) => failKind(c, 404, ERR.NOT_FOUND));
app.onError((err, c) => {
  // Never leak stack traces. Log a stable message only (no PII, no body).
  log("unhandled_error", { message: err instanceof Error ? err.message.slice(0, 200) : "unknown" });
  return failKind(c, 500, ERR.INTERNAL);
});

export default app;
