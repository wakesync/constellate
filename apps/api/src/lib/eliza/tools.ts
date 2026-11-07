// Eliza's tool registry. Each tool is deterministic: she calls it, she never
// computes the typology herself. Every tool that touches a person's data goes
// through scope.ts, so access control cannot be bypassed by the model.
//
// Tools whose backing endpoint is not built yet (other lanes are mid-flight)
// return { unavailable: true, reason } rather than throwing. Graceful
// degradation is a FIRST-CLASS behavior: eliza tells the person what is missing
// and what they could do about it, she does not error.

import type { Env } from "../../types";
import { humanDesign, geneKeys, natalChart, synastryGrid, transitChart, astrocartographyLines, AstroError, type BirthLike } from "../../astro";
import { relationBetween, TYPE_BY_CODE } from "../socionics";
import { canonicalPair, effectiveLens } from "../relationship";
import {
  type ScopeCtx,
  ScopeError,
  assertTargetReadable,
  circleMembers,
  resolveMember,
  searchSharedJournal,
} from "./scope";

// A tool result is either data, or an explicit unavailability, or a scope
// denial. Scope denials are NOT leaked as data; they are surfaced to the loop as
// a refusal the model must respect.
export type ToolResult =
  | { ok: true; data: unknown }
  | { ok: false; unavailable: true; reason: string }
  | { ok: false; denied: true; reason: string };

export type ToolDef = {
  name: string;
  description: string;
  // JSON-schema-ish params for the model.
  params: Record<string, { type: string; description: string; required?: boolean }>;
  // Handler runs with the scope context bound for this turn.
  handler: (ctx: ScopeCtx, args: Record<string, unknown>) => Promise<ToolResult>;
};

const unavailable = (reason: string): ToolResult => ({ ok: false, unavailable: true, reason });
const denied = (reason: string): ToolResult => ({ ok: false, denied: true, reason });
const ok = (data: unknown): ToolResult => ({ ok: true, data });

// ---- shared helpers -------------------------------------------------------

async function birthFor(env: Env, userId: string): Promise<BirthLike | null> {
  const row = await env.DB.prepare(
    "SELECT date_local, timezone, latitude, longitude FROM birth_data WHERE user_id = ?",
  )
    .bind(userId)
    .first<{ date_local: string; timezone: string; latitude: number; longitude: number }>();
  if (!row) return null;
  // date_local is "YYYY-MM-DDTHH:MM[:SS]" or a date-only string (unknown time).
  const [date, time = ""] = row.date_local.split("T");
  return { date, time, lat: row.latitude, lng: row.longitude, tz: row.timezone };
}

// Read a cached typology payload, computing + caching if absent. This mirrors the
// /me/humandesign and /me/genekeys routes exactly, but for an arbitrary (already
// scope-checked) member id.
//
// TROPICAL-CANON: eliza's typology tools read/compute the tropical rows only.
// Her answers compare members inside one circle, and cross-member comparison
// under mixed frames would be incoherent; tropical is the canon frame for
// HD/GK per the plan (docs/SIDEREAL.md §0). The zodiac lens is a
// per-user VIEW preference, not a different person.
async function cachedBirthTypology(
  env: Env,
  userId: string,
  table: "human_design_cache" | "gene_keys_cache",
  compute: (env: Env, b: BirthLike) => Promise<unknown>,
): Promise<ToolResult> {
  const cached = await env.DB.prepare(`SELECT payload_json FROM ${table} WHERE user_id = ? AND zodiac_system = 'tropical'`)
    .bind(userId)
    .first<{ payload_json: string }>();
  if (cached) return ok(JSON.parse(cached.payload_json));
  const birth = await birthFor(env, userId);
  if (!birth) return unavailable("this person has not added their birth data yet");
  try {
    const payload = await compute(env, birth);
    await env.DB.prepare(`INSERT OR REPLACE INTO ${table} (user_id, zodiac_system, payload_json, computed_at) VALUES (?, 'tropical', ?, ?)`)
      .bind(userId, JSON.stringify(payload), Math.floor(Date.now() / 1000))
      .run();
    return ok(payload);
  } catch (err) {
    if (err instanceof AstroError) return unavailable("the astro service is unreachable right now");
    throw err;
  }
}

async function readSocionics(env: Env, userId: string): Promise<ToolResult> {
  const row = await env.DB.prepare("SELECT payload_json FROM socionics_results WHERE user_id = ?")
    .bind(userId)
    .first<{ payload_json: string }>();
  if (!row) return unavailable("this person has not taken the socionics questionnaire yet");
  return ok(JSON.parse(row.payload_json));
}

async function readEnneagram(env: Env, userId: string): Promise<ToolResult> {
  const row = await env.DB.prepare("SELECT payload_json FROM enneagram_results WHERE user_id = ?")
    .bind(userId)
    .first<{ payload_json: string }>();
  if (!row) return unavailable("this person has not taken the enneagram questionnaire yet");
  return ok(JSON.parse(row.payload_json));
}

// Convergence tables (lane 0007) may not exist yet. Detect and degrade.
async function readConvergence(env: Env, userId: string): Promise<ToolResult> {
  try {
    const row = await env.DB.prepare("SELECT payload_json FROM convergence_cache WHERE user_id = ?")
      .bind(userId)
      .first<{ payload_json: string }>();
    if (!row) return unavailable("no convergence reading has been computed for this person yet");
    return ok(JSON.parse(row.payload_json));
  } catch {
    // Table absent => the convergence lane has not landed. Stub, do not crash.
    return unavailable("the convergence engine is not available in this deployment yet");
  }
}

// ---- the registry ---------------------------------------------------------

export const TOOLS: ToolDef[] = [
  {
    name: "get_circle",
    description: "list the members of this constellation and which typology data each has provided",
    params: {},
    handler: async (ctx) => {
      const members = await circleMembers(ctx);
      return ok({ members });
    },
  },
  {
    name: "get_chart",
    description: "a member's western natal chart. member is a user id or a display name in this circle.",
    params: { member: { type: "string", description: "user id or display name", required: true } },
    handler: async (ctx, args) => withMember(ctx, args.member, async (id) => {
      const birth = await birthFor(ctx.env, id);
      if (!birth) return unavailable("this person has not added their birth data yet");
      try {
        return ok(await natalChart(ctx.env, birth));
      } catch (e) {
        return e instanceof AstroError ? unavailable("the astro service is unreachable right now") : Promise.reject(e);
      }
    }),
  },
  {
    name: "get_transits",
    description: "current sky against a member's natal chart. date optional (defaults to today).",
    params: {
      member: { type: "string", description: "user id or display name", required: true },
      date: { type: "string", description: "YYYY-MM-DD, defaults to today" },
    },
    handler: async (ctx, args) => withMember(ctx, args.member, async (id) => {
      const birth = await birthFor(ctx.env, id);
      if (!birth) return unavailable("this person has not added their birth data yet");
      const date = typeof args.date === "string" && args.date ? args.date : new Date().toISOString().slice(0, 10);
      try {
        return ok(await transitChart(ctx.env, { date, lat: birth.lat, lng: birth.lng, tz: birth.tz }));
      } catch (e) {
        return e instanceof AstroError ? unavailable("the astro service is unreachable right now") : Promise.reject(e);
      }
    }),
  },
  {
    name: "get_synastry",
    description: "the aspect grid between two members' charts",
    params: {
      a: { type: "string", description: "user id or display name", required: true },
      b: { type: "string", description: "user id or display name", required: true },
    },
    handler: async (ctx, args) => withPair(ctx, args.a, args.b, async (ida, idb) => {
      const [ba, bb] = await Promise.all([birthFor(ctx.env, ida), birthFor(ctx.env, idb)]);
      if (!ba || !bb) return unavailable("both people need birth data for a synastry read; at least one is missing");
      try {
        const [grid, relationship_context] = await Promise.all([
          synastryGrid(ctx.env, ba, bb),
          effectiveLens(ctx.env, ida, idb),
        ]);
        return ok({ relationship_context, grid });
      } catch (e) {
        return e instanceof AstroError ? unavailable("the astro service is unreachable right now") : Promise.reject(e);
      }
    }),
  },
  {
    name: "get_astrocartography",
    description: "a member's astrocartography lines",
    params: { member: { type: "string", description: "user id or display name", required: true } },
    handler: async (ctx, args) => withMember(ctx, args.member, async (id) => {
      const birth = await birthFor(ctx.env, id);
      if (!birth) return unavailable("this person has not added their birth data yet");
      try {
        return ok(await astrocartographyLines(ctx.env, birth));
      } catch (e) {
        return e instanceof AstroError ? unavailable("the astro service is unreachable right now") : Promise.reject(e);
      }
    }),
  },
  {
    name: "get_human_design",
    description: "a member's human design bodygraph (type, authority, profile, centers, channels)",
    params: { member: { type: "string", description: "user id or display name", required: true } },
    handler: async (ctx, args) => withMember(ctx, args.member, (id) =>
      cachedBirthTypology(ctx.env, id, "human_design_cache", humanDesign),
    ),
  },
  {
    name: "get_gene_keys",
    description: "a member's gene keys activation sequence",
    params: { member: { type: "string", description: "user id or display name", required: true } },
    handler: async (ctx, args) => withMember(ctx, args.member, (id) =>
      cachedBirthTypology(ctx.env, id, "gene_keys_cache", geneKeys),
    ),
  },
  {
    name: "get_enneagram",
    description: "a member's enneagram result (type, wing, center, instinct)",
    params: { member: { type: "string", description: "user id or display name", required: true } },
    handler: async (ctx, args) => withMember(ctx, args.member, (id) => readEnneagram(ctx.env, id)),
  },
  {
    name: "get_socionics",
    description: "a member's socionics type and Model A stack",
    params: { member: { type: "string", description: "user id or display name", required: true } },
    handler: async (ctx, args) => withMember(ctx, args.member, (id) => readSocionics(ctx.env, id)),
  },
  {
    name: "get_intertype",
    description: "the socionics intertype relation between two members (e.g. duality, conflict, mirror)",
    params: {
      a: { type: "string", description: "user id or display name", required: true },
      b: { type: "string", description: "user id or display name", required: true },
    },
    handler: async (ctx, args) => withPair(ctx, args.a, args.b, async (ida, idb) => {
      const [ra, rb] = await Promise.all([readSocionics(ctx.env, ida), readSocionics(ctx.env, idb)]);
      if (!ra.ok) return ra;
      if (!rb.ok) return rb;
      const codeA = (ra.data as { type?: { code?: string } })?.type?.code;
      const codeB = (rb.data as { type?: { code?: string } })?.type?.code;
      if (!codeA || !codeB || !TYPE_BY_CODE[codeA] || !TYPE_BY_CODE[codeB]) {
        return unavailable("one of the socionics results is missing a type code");
      }
      const relation = relationBetween(codeA, codeB);
      return ok({ a: codeA, b: codeB, relation });
    }),
  },
  {
    name: "get_hd_connection",
    description: "human design electromagnetics: which channels each person completes in the other",
    params: {
      a: { type: "string", description: "user id or display name", required: true },
      b: { type: "string", description: "user id or display name", required: true },
    },
    handler: async (ctx, args) => withPair(ctx, args.a, args.b, async (ida, idb) => {
      const [ra, rb] = await Promise.all([
        cachedBirthTypology(ctx.env, ida, "human_design_cache", humanDesign),
        cachedBirthTypology(ctx.env, idb, "human_design_cache", humanDesign),
      ]);
      if (!ra.ok) return ra;
      if (!rb.ok) return rb;
      const conn = hdElectromagnetics(ra.data, rb.data);
      return ok(conn);
    }),
  },
  {
    name: "get_convergence",
    description: "a member's cross-system convergence + tension reading (where the five engines agree and disagree)",
    params: { member: { type: "string", description: "user id or display name", required: true } },
    handler: async (ctx, args) => withMember(ctx, args.member, (id) => readConvergence(ctx.env, id)),
  },
  {
    name: "get_convergence_pair",
    description: "the pair convergence + tension between two members",
    params: {
      a: { type: "string", description: "user id or display name", required: true },
      b: { type: "string", description: "user id or display name", required: true },
    },
    handler: async (ctx, args) => withPair(ctx, args.a, args.b, async (ida, idb) => {
      const [userA, userB] = canonicalPair(ida, idb);
      try {
        const [row, relationship_context] = await Promise.all([
          ctx.env.DB.prepare("SELECT payload_json FROM convergence_pair_cache WHERE user_a_id = ? AND user_b_id = ?")
            .bind(userA, userB)
            .first<{ payload_json: string }>(),
          effectiveLens(ctx.env, userA, userB),
        ]);
        if (!row) return unavailable("no pair convergence has been computed for these people yet");
        return ok({ relationship_context, convergence: JSON.parse(row.payload_json) });
      } catch {
        return unavailable("pair convergence is not available in this deployment yet");
      }
    }),
  },
  {
    name: "search_journal",
    description:
      "search the SHARED constellation journal only. personal entries are never searchable. filter by optional author (a member), text query, and time range.",
    params: {
      query: { type: "string", description: "text to look for in shared entries" },
      author: { type: "string", description: "optional member id or display name to filter by" },
      since: { type: "string", description: "optional unix seconds lower bound" },
      until: { type: "string", description: "optional unix seconds upper bound" },
      limit: { type: "string", description: "optional max entries (1-25, default 8)" },
    },
    handler: async (ctx, args) => {
      let authorUserId: string | undefined;
      if (typeof args.author === "string" && args.author.trim()) {
        const m = await resolveMember(ctx, args.author);
        if (!m) return unavailable(`i cannot find "${String(args.author)}" in this circle`);
        authorUserId = m.id;
      }
      try {
        const entries = await searchSharedJournal(ctx, {
          query: typeof args.query === "string" ? args.query : undefined,
          authorUserId,
          since: numOrUndef(args.since),
          until: numOrUndef(args.until),
          limit: numOrUndef(args.limit),
        });
        return ok({ entries, note: "shared-journal entries only; personal entries are never returned" });
      } catch (e) {
        if (e instanceof ScopeError) return denied(e.reason);
        throw e;
      }
    },
  },
];

export const TOOL_BY_NAME: Record<string, ToolDef> = Object.fromEntries(TOOLS.map((t) => [t.name, t]));

// ---- helpers used by handlers --------------------------------------------

function numOrUndef(v: unknown): number | undefined {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() && !Number.isNaN(Number(v))) return Number(v);
  return undefined;
}

// Resolve a single member ref, enforce scope, run fn. Any scope failure becomes
// a `denied` result (never leaked as data). Unresolvable ref => unavailable.
async function withMember(
  ctx: ScopeCtx,
  ref: unknown,
  fn: (id: string) => Promise<ToolResult>,
): Promise<ToolResult> {
  if (typeof ref !== "string" || !ref.trim()) return unavailable("no member was specified");
  try {
    const m = await resolveMember(ctx, ref);
    if (!m) return unavailable(`i cannot find "${ref}" in this circle`);
    await assertTargetReadable(ctx, m.id); // defense in depth; resolveMember already scoped
    return await fn(m.id);
  } catch (e) {
    if (e instanceof ScopeError) return denied(e.reason);
    throw e;
  }
}

async function withPair(
  ctx: ScopeCtx,
  refA: unknown,
  refB: unknown,
  fn: (idA: string, idB: string) => Promise<ToolResult>,
): Promise<ToolResult> {
  if (typeof refA !== "string" || typeof refB !== "string" || !refA.trim() || !refB.trim()) {
    return unavailable("two members are needed for this");
  }
  try {
    const [ma, mb] = await Promise.all([resolveMember(ctx, refA), resolveMember(ctx, refB)]);
    if (!ma) return unavailable(`i cannot find "${refA}" in this circle`);
    if (!mb) return unavailable(`i cannot find "${refB}" in this circle`);
    await assertTargetReadable(ctx, ma.id);
    await assertTargetReadable(ctx, mb.id);
    return await fn(ma.id, mb.id);
  } catch (e) {
    if (e instanceof ScopeError) return denied(e.reason);
    throw e;
  }
}

// Deterministic HD electromagnetics: a channel is a pair of gates. An
// electromagnetic connection exists where person A has ONE gate of a channel and
// person B has the OTHER, completing it between them. We compute this from the
// activated gates present in each bodygraph, using the standard 36-channel map.
type HdPayload = {
  channels?: Array<{ key: string; name?: string; gates?: [number, number] }>;
  gates?: { personality?: Array<{ gate: number }>; design?: Array<{ gate: number }> };
};

function activeGateSet(hd: unknown): Set<number> {
  const p = hd as HdPayload;
  const s = new Set<number>();
  for (const g of p.gates?.personality ?? []) s.add(g.gate);
  for (const g of p.gates?.design ?? []) s.add(g.gate);
  return s;
}

function definedChannelKeys(hd: unknown): Set<string> {
  const p = hd as HdPayload;
  return new Set((p.channels ?? []).map((c) => normalizeChannelKey(c.key)));
}

function normalizeChannelKey(key: string): string {
  const parts = key.split("-").map((n) => Number(n)).filter((n) => !Number.isNaN(n));
  parts.sort((x, y) => x - y);
  return parts.join("-");
}

function channelName(hd: unknown, key: string): string | undefined {
  const p = hd as HdPayload;
  return (p.channels ?? []).find((c) => normalizeChannelKey(c.key) === key)?.name;
}

// Standard 36 HD channels (gate pairs). Used to detect electromagnetic
// completion from each person's activated gates.
const HD_CHANNELS: Array<[number, number]> = [
  [1, 8], [2, 14], [3, 60], [4, 63], [5, 15], [6, 59], [7, 31], [9, 52], [10, 20], [10, 34],
  [10, 57], [11, 56], [12, 22], [13, 33], [16, 48], [17, 62], [18, 58], [19, 49], [20, 34],
  [20, 57], [21, 45], [23, 43], [24, 61], [25, 51], [26, 44], [27, 50], [28, 38], [29, 46],
  [30, 41], [32, 54], [34, 57], [35, 36], [37, 40], [39, 55], [42, 53], [47, 64],
];

function hdElectromagnetics(hdA: unknown, hdB: unknown): {
  a_completes_for_b: Array<{ channel: string; name?: string; a_gate: number; b_gate: number }>;
  b_completes_for_a: Array<{ channel: string; name?: string; a_gate: number; b_gate: number }>;
  note: string;
} {
  const gatesA = activeGateSet(hdA);
  const gatesB = activeGateSet(hdB);
  const definedA = definedChannelKeys(hdA);
  const definedB = definedChannelKeys(hdB);
  const aForB: Array<{ channel: string; name?: string; a_gate: number; b_gate: number }> = [];
  const bForA: Array<{ channel: string; name?: string; a_gate: number; b_gate: number }> = [];
  for (const [g1, g2] of HD_CHANNELS) {
    const key = normalizeChannelKey(`${g1}-${g2}`);
    // Electromagnetic = A has one gate, B has the other, and neither already has
    // the whole channel defined alone (that would be a companionship/dominance,
    // not a bridge). We report the bridge: who supplies the completing gate.
    const aHas1 = gatesA.has(g1);
    const aHas2 = gatesA.has(g2);
    const bHas1 = gatesB.has(g1);
    const bHas2 = gatesB.has(g2);
    const soloA = definedA.has(key);
    const soloB = definedB.has(key);
    if (soloA || soloB) continue;
    if (aHas1 && bHas2 && !aHas2) {
      bForA.push({ channel: key, name: channelName(hdA, key) ?? channelName(hdB, key), a_gate: g1, b_gate: g2 });
    } else if (aHas2 && bHas1 && !aHas1) {
      bForA.push({ channel: key, name: channelName(hdA, key) ?? channelName(hdB, key), a_gate: g2, b_gate: g1 });
    }
  }
  // The relation is symmetric in construction; we present the same bridges as
  // "completed between you". a_completes_for_b and b_completes_for_a mirror the
  // gate ownership so the model can speak to either direction.
  for (const bridge of bForA) {
    aForB.push({ channel: bridge.channel, name: bridge.name, a_gate: bridge.a_gate, b_gate: bridge.b_gate });
  }
  return {
    a_completes_for_b: aForB,
    b_completes_for_a: bForA,
    note: "electromagnetic connection: a channel neither has alone that the two of you complete together",
  };
}
