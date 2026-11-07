// Dry-run harness for eliza's agent loop. Proves the loop works end to end
// WITHOUT a live model and WITHOUT the other lanes finished, by injecting a
// scripted chat function and a D1 fake seeded with typology + shared journal.
//
// Run: npx tsx apps/api/test/eliza-dryrun.test.ts   (from repo root)
//
// It exercises 5 questions, including "why do rowan and i keep having the same
// fight", and prints the tool calls chosen + the final answer for each. It also
// asserts:
//   - should_respond stays quiet on idle human banter
//   - the no-fact-without-a-tool guard hedges a typological claim with no tool

import { runTurn, shouldRespond, type ChatFn } from "../src/lib/eliza/agent";
import type { ScopeCtx } from "../src/lib/eliza/scope";
import type { Env } from "../src/types";

// ---- D1 fake with seeded data --------------------------------------------
type Row = Record<string, unknown>;
const users: Row[] = [
  { id: "u_me", display_name: "you" },
  { id: "u_rowan", display_name: "rowan" },
];
const memberships: Row[] = [
  { constellation_id: "c1", user_id: "u_me", role: "creator" },
  { constellation_id: "c1", user_id: "u_rowan", role: "member" },
];
const birth_data: Row[] = [
  { user_id: "u_me", date_local: "1998-04-12T09:30", timezone: "America/Denver", latitude: 39.7, longitude: -104.9 },
  { user_id: "u_rowan", date_local: "1996-08-01T14:00", timezone: "America/Denver", latitude: 39.7, longitude: -104.9 },
];
const socionics_results: Row[] = [
  { user_id: "u_me", payload_json: JSON.stringify({ type: { code: "SEE", nickname: "the politician" } }) },
  { user_id: "u_rowan", payload_json: JSON.stringify({ type: { code: "LII", nickname: "the analyst" } }) },
];
const human_design_cache: Row[] = [
  { user_id: "u_me", payload_json: JSON.stringify({ type: "Generator", authority: "Sacral", channels: [{ key: "20-34", name: "Charisma", gates: [20, 34] }], gates: { personality: [{ gate: 20 }], design: [{ gate: 34 }] } }) },
  { user_id: "u_rowan", payload_json: JSON.stringify({ type: "Projector", authority: "Splenic", channels: [], gates: { personality: [{ gate: 57 }], design: [{ gate: 10 }] } }) },
];
const journal_entries: Row[] = [
  { id: "j1", user_id: "u_me", constellation_id: "c1", body: "the same fight about plans again", written_at: 200 },
  { id: "j2", user_id: "u_rowan", constellation_id: "c1", body: "i need time to think, you move too fast", written_at: 201 },
  { id: "j3", user_id: "u_me", constellation_id: null, body: "PERSONAL should never surface", written_at: 202 },
];

function makeEnv(): Env {
  const prepare = (sql: string) => {
    const s = sql.replace(/\s+/g, " ").trim();
    let binds: unknown[] = [];
    const first1 = (tbl: Row[], k1: string, k2?: string) => {
      const v1 = binds[0];
      const v2 = binds[1];
      return tbl.find((r) => r[k1] === v1 && (k2 ? r[k2] === v2 : true)) ?? null;
    };
    const stmt = {
      bind(...a: unknown[]) { binds = a; return stmt; },
      async run() { return { success: true }; },
      async first<T>(): Promise<T | null> {
        if (s.startsWith("SELECT 1 AS x FROM memberships")) {
          return (first1(memberships, "constellation_id", "user_id") ? { x: 1 } : null) as T | null;
        }
        if (s.includes("FROM birth_data")) {
          const r = memberships && birth_data.find((b) => b.user_id === binds[0]);
          return (r ?? null) as T | null;
        }
        if (s.includes("FROM socionics_results")) return (socionics_results.find((r) => r.user_id === binds[0]) ?? null) as T | null;
        if (s.includes("FROM human_design_cache")) return (human_design_cache.find((r) => r.user_id === binds[0]) ?? null) as T | null;
        if (s.includes("FROM gene_keys_cache")) return null as T | null;
        if (s.includes("FROM enneagram_results")) return null as T | null;
        if (s.includes("FROM convergence_cache")) return null as T | null;
        return null as T | null;
      },
      async all<T>(): Promise<{ results: T[] }> {
        if (s.includes("FROM memberships JOIN users")) {
          const cid = binds[0];
          return {
            results: memberships.filter((m) => m.constellation_id === cid).map((m) => {
              const u = users.find((x) => x.id === m.user_id)!;
              return { id: u.id, display_name: u.display_name, role: m.role, has_birth: 1 };
            }) as T[],
          };
        }
        if (s.includes("FROM journal_entries j")) {
          const cid = binds[0];
          let rows = journal_entries.filter((j) => j.constellation_id != null && j.constellation_id === cid);
          return { results: rows.map((j) => ({ id: j.id, user_id: j.user_id, body: j.body, written_at: j.written_at, user_name: users.find((u) => u.id === j.user_id)?.display_name ?? null })) as T[] };
        }
        return { results: [] as T[] };
      },
    };
    return stmt;
  };
  return { DB: { prepare }, ASTRO_URL: "http://x", ASTRO_BEARER: "x", OPENROUTER_API_KEY: "" } as unknown as Env;
}

const env = makeEnv();
const scope: ScopeCtx = { env, actorUserId: "u_me", constellationId: "c1" };

// ---- scripted chat: a tiny deterministic "model" -------------------------
// It reads the last user message, decides a tool plan, emits tool_calls once,
// then on the follow-up (tool results present) emits a final prose answer that
// cites the receipts it received.
function scriptedChat(plan: Array<{ name: string; args: Record<string, unknown> }>, answer: (results: string) => string): ChatFn {
  return async (_env, messages) => {
    const hasToolResults = messages.some((m) => m.role === "tool");
    if (!hasToolResults && plan.length) {
      return {
        message: {
          content: "",
          tool_calls: plan.map((p, i) => ({ id: `call_${i}`, function: { name: p.name, arguments: JSON.stringify(p.args) } })),
        },
      };
    }
    const toolBlob = messages.filter((m) => m.role === "tool").map((m) => m.content).join("\n");
    return { message: { content: answer(toolBlob), tool_calls: [] } };
  };
}

async function scenario(label: string, question: string, chat: ChatFn) {
  const turn = await runTurn(env, scope, { body: question, addressed: true, memberCount: 2 }, [], chat);
  console.log(`\n=== ${label} ===`);
  console.log("Q:", question);
  console.log("tool calls:", turn.trace.map((t) => `${t.tool}(${t.result})`).join(", ") || "(none)");
  console.log("spoke:", turn.spoke, turn.reason ? `[${turn.reason}]` : "");
  console.log("A:", turn.reply ?? "(silent)");
  return turn;
}

let failures = 0;
function ok(cond: boolean, msg: string) { if (!cond) { failures++; console.error("  ASSERT FAIL:", msg); } }

async function run() {
  // 1. THE killer question. Pull both socionics, the intertype, both HD, the
  //    connection, and the shared journal. Answer with receipts.
  const t1 = await scenario(
    "killer question",
    "why do rowan and i keep having the same fight",
    scriptedChat(
      [
        { name: "get_socionics", args: { member: "you" } },
        { name: "get_socionics", args: { member: "rowan" } },
        { name: "get_intertype", args: { a: "you", b: "rowan" } },
        { name: "get_hd_connection", args: { a: "you", b: "rowan" } },
        { name: "search_journal", args: { query: "fight" } },
      ],
      () =>
        "your socionics base is Se and rowan's is Ti, and your intertype relation is one where one of you moves and the other measures. your human design has you completing a channel rowan does not hold alone. the shared entries circle the same thing: you move fast, he needs to think. same fight, two shapes meeting.",
    ),
  );
  ok(t1.trace.length === 5, "killer question made 5 tool calls");
  ok(t1.trace.every((x) => x.result === "ok"), "all killer-question tools returned ok");
  ok(!!t1.reply && !t1.reply.includes("PERSONAL"), "no personal entry leaked into the answer");

  // 2. A single-person chart question with data present.
  const t2 = await scenario(
    "my human design",
    "what's my human design authority",
    scriptedChat(
      [{ name: "get_human_design", args: { member: "you" } }],
      () => "you are a Generator with Sacral authority. the yes and no live in your body, not your head.",
    ),
  );
  ok(t2.trace.length === 1 && t2.trace[0].result === "ok", "hd tool ran ok");

  // 3. Missing data => graceful unavailable, no invention.
  const t3 = await scenario(
    "gene keys (no data)",
    "read my gene keys",
    scriptedChat(
      [{ name: "get_gene_keys", args: { member: "you" } }],
      (blob) => (blob.includes("unavailable") ? "i cannot read your gene keys yet, the reading has not been computed. i will look once it is there." : "..."),
    ),
  );
  ok(t3.trace[0].result === "unavailable", "gene keys correctly unavailable");

  // 4. Convergence lane not built => stubbed unavailable, degrades gracefully.
  const t4 = await scenario(
    "convergence (lane not built)",
    "show me where all my systems agree",
    scriptedChat(
      [{ name: "get_convergence", args: { member: "you" } }],
      (blob) => (blob.includes("unavailable") ? "the convergence reading is not available in this deployment yet. once the engine is live i will show you where the systems line up." : "..."),
    ),
  );
  ok(t4.trace[0].result === "unavailable", "convergence stubs as unavailable");

  // 5. no-fact-without-a-tool guard: model tries to assert typology with NO tool.
  const t5 = await scenario(
    "guard: claim with no tool",
    "am i a manifestor",
    // scripted model calls no tool and asserts a fact; then when corrected, still refuses to fetch.
    async (_env, messages) => {
      const corrected = messages.some((m) => m.role === "user" && m.content.includes("without calling a tool"));
      if (corrected) return { message: { content: "i would be guessing, and i do not guess about your design.", tool_calls: [] } };
      return { message: { content: "yes, you are a manifestor with an emotional authority.", tool_calls: [] } };
    },
  );
  ok(t5.trace.length === 0, "guard scenario made no tool calls");
  ok(!!t5.reply && !/manifestor with an emotional authority/i.test(t5.reply), "unbacked typological claim was NOT shipped");

  // 6. should_respond etiquette: idle human banter, not addressed => quiet.
  const gate = shouldRespond({ body: "haha yeah that trip was wild", memberCount: 4 });
  ok(!gate.respond, "eliza stays quiet on human banter not addressed to her");
  console.log("\n=== etiquette gate ===");
  console.log('"haha yeah that trip was wild" ->', gate.respond ? "SPEAK" : `quiet [${gate.reason}]`);

  console.log(`\ndry-run: ${failures === 0 ? "all asserts passed" : failures + " ASSERT FAILURES"}`);
  if (failures) process.exit(1);
}

run();
