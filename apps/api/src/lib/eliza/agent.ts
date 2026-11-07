// Eliza's agent loop. A bounded tool-calling turn: she may call up to a small
// number of tools, then must answer. She reuses the same OpenRouter endpoint the
// rest of the app uses (no second LLM client). Rate limiting is applied at the
// route layer (RULES.narrative), same as every other LLM path.
//
// Two guarantees are enforced HERE, not left to the model:
//   1. should_respond: an etiquette gate decides whether eliza speaks at all.
//      She is a member, not a bot that replies to every line.
//   2. no-fact-without-a-tool: if the final answer makes a typological claim but
//      no tool ran this turn, we do not ship it as fact. We hedge / defer.

import type { Env } from "../../types";
import { elizaSystemPrompt } from "../../prompts/eliza";
import { TOOLS, TOOL_BY_NAME, type ToolResult } from "./tools";
import type { ScopeCtx } from "./scope";

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "anthropic/claude-sonnet-4-5";
const TIMEOUT_MS = 45_000;
const MAX_TOOL_CALLS = 6;
const MAX_TURN_TOKENS = 4000; // rough budget across the loop

export type TraceEntry = { tool: string; args: unknown; result: "ok" | "unavailable" | "denied" };

export type AgentTurn = {
  spoke: boolean;
  reason?: string; // when spoke=false, why she stayed quiet
  reply?: string;
  trace: TraceEntry[];
  degraded?: boolean;
};

type Msg = { role: "system" | "user" | "assistant" | "tool"; content: string; tool_call_id?: string; name?: string; tool_calls?: unknown };

// ---- should_respond etiquette gate ---------------------------------------
// She speaks when: addressed, a scheduled reflection is due, or something
// genuinely notable is passed in. NOT on every message. This runs BEFORE the
// loop and short-circuits it.
export type RespondContext = {
  body: string;
  addressed?: boolean;       // the message names eliza or is a direct question to her
  scheduled?: boolean;       // a daily/weekly reflection tick
  notable?: boolean;         // a hard transit, a long silence, etc.
  memberCount?: number;
};

const NAME_RE = /\beliza\b/i;
const QUESTION_RE = /\?\s*$/;

export function shouldRespond(ctx: RespondContext): { respond: boolean; reason: string } {
  if (ctx.scheduled) return { respond: true, reason: "scheduled reflection" };
  if (ctx.notable) return { respond: true, reason: "notable event" };
  if (ctx.addressed || NAME_RE.test(ctx.body)) return { respond: true, reason: "addressed by name" };
  // A bare question in a 2-person circle is very likely for her; in a larger
  // circle, a question not naming her is probably between humans. Stay quiet.
  if (QUESTION_RE.test(ctx.body) && (ctx.memberCount ?? 99) <= 2) {
    return { respond: true, reason: "direct question in a pair" };
  }
  return { respond: false, reason: "not addressed; humans are talking" };
}

// A cheap heuristic for "did the model assert a typological fact". If the text
// name-drops a system's vocabulary, it is making a typological claim and MUST
// have a tool behind it this turn. This is deliberately broad; a false positive
// only makes her hedge, which is the safe direction.
const TYPO_TERMS = [
  "sacral", "manifestor", "generator", "projector", "reflector", "authority",
  "profile", "incarnation cross", "defined center", "open center", "channel",
  "polr", "vulnerable function", "leading function", "creative function", "quadra",
  "duality", "conflict relation", "mirror relation", "socionics", "enneagram",
  "type 1", "type 2", "type 3", "type 4", "type 5", "type 6", "type 7", "type 8", "type 9",
  "wing", "tritype", "gene key", "shadow", "gift", "siddhi", "ascendant", "your sun",
  "your moon", "your mars", "your venus", "conjunct", "square", "opposition", "trine",
];

function assertsTypology(text: string): boolean {
  const lc = text.toLowerCase();
  return TYPO_TERMS.some((t) => lc.includes(t));
}

// ---- OpenRouter tool-calling call ----------------------------------------

function toolSchemas() {
  return TOOLS.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: {
        type: "object",
        properties: Object.fromEntries(
          Object.entries(t.params).map(([k, v]) => [k, { type: v.type, description: v.description }]),
        ),
        required: Object.entries(t.params).filter(([, v]) => v.required).map(([k]) => k),
      },
    },
  }));
}

type ChatChoice = {
  message?: {
    content?: string | null;
    tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
  };
  finish_reason?: string;
};

// A seam for testing: the dry-run harness injects a deterministic chat function
// so the loop can be exercised without a live model or the other lanes built.
export type ChatFn = (env: Env, messages: Msg[], useTools: boolean) => Promise<ChatChoice | null>;

async function chat(env: Env, messages: Msg[], useTools: boolean): Promise<ChatChoice | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        "http-referer": env.APP_ORIGIN || "https://constellate.me",
        "x-title": "Constellate",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 900,
        messages,
        ...(useTools ? { tools: toolSchemas(), tool_choice: "auto" } : {}),
      }),
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = (await res.json()) as { choices?: ChatChoice[] };
    return data.choices?.[0] ?? null;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

const FALLBACK_QUIET =
  "i am here, but i do not have anything to add to that i could stand behind. ask me about a chart or a pairing in the circle and i will look.";

// Run one turn. `scope` binds the actor + constellation for every tool call.
export async function runTurn(
  env: Env,
  scope: ScopeCtx,
  respondCtx: RespondContext,
  priorMessages: Array<{ role: "user" | "eliza"; body: string }>,
  chatFn?: ChatFn,
): Promise<AgentTurn> {
  const chatImpl: ChatFn = chatFn ?? chat;
  const gate = shouldRespond(respondCtx);
  if (!gate.respond) return { spoke: false, reason: gate.reason, trace: [] };

  if (!chatFn && !env.OPENROUTER_API_KEY) {
    return { spoke: true, reply: FALLBACK_QUIET, trace: [], degraded: true };
  }

  const messages: Msg[] = [
    { role: "system", content: elizaSystemPrompt },
    // A compact recent history so she has conversational continuity.
    ...priorMessages.slice(-8).map((m) => ({
      role: (m.role === "eliza" ? "assistant" : "user") as "assistant" | "user",
      content: m.body,
    })),
    { role: "user", content: respondCtx.body },
  ];

  const trace: TraceEntry[] = [];
  let calledAnyTool = false;
  let approxTokens = 0;

  for (let step = 0; step < MAX_TOOL_CALLS + 1; step += 1) {
    const useTools = step < MAX_TOOL_CALLS && approxTokens < MAX_TURN_TOKENS;
    const choice = await chatImpl(env, messages, useTools);
    if (!choice || !choice.message) {
      return { spoke: true, reply: FALLBACK_QUIET, trace, degraded: true };
    }
    approxTokens += 700; // coarse budget accounting per round-trip

    const calls = choice.message.tool_calls ?? [];
    if (calls.length === 0) {
      // Final answer. Enforce no-fact-without-a-tool.
      let text = (choice.message.content ?? "").trim();
      if (!text) return { spoke: true, reply: FALLBACK_QUIET, trace, degraded: true };
      if (assertsTypology(text) && !calledAnyTool) {
        // She made a typological claim with no receipts. Do not ship it as fact.
        // One corrective pass: tell her to either call a tool or hedge.
        messages.push({ role: "assistant", content: text });
        messages.push({
          role: "user",
          content:
            "you stated a typological fact without calling a tool this turn. either call the tool that backs it, or answer without asserting any typology. do not guess.",
        });
        const retry = await chatImpl(env, messages, true);
        approxTokens += 700;
        if (retry?.message?.tool_calls?.length) {
          // She chose to fetch. Fall through by re-entering the loop logic:
          choice.message.tool_calls = retry.message.tool_calls;
          choice.message.content = retry.message.content ?? "";
        } else {
          const hedged = (retry?.message?.content ?? "").trim();
          const safe = hedged && !(assertsTypology(hedged) && !calledAnyTool)
            ? hedged
            : "i would be guessing if i answered that, and i do not guess about your chart. ask me to pull it and i will read only what is there.";
          return { spoke: true, reply: safe, trace, degraded: false };
        }
      } else {
        return { spoke: true, reply: text, trace, degraded: false };
      }
    }

    // Execute tool calls (bounded). Record every call in the trace and append the
    // results as tool messages for the next round.
    messages.push({
      role: "assistant",
      content: choice.message.content ?? "",
      tool_calls: calls,
    } as Msg);

    for (const call of calls.slice(0, MAX_TOOL_CALLS)) {
      const def = TOOL_BY_NAME[call.function.name];
      let args: Record<string, unknown> = {};
      try {
        args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
      } catch {
        args = {};
      }
      let result: ToolResult;
      if (!def) {
        result = { ok: false, unavailable: true, reason: `no such tool: ${call.function.name}` };
      } else {
        calledAnyTool = true;
        try {
          result = await def.handler(scope, args);
        } catch {
          result = { ok: false, unavailable: true, reason: "that tool failed to run" };
        }
      }
      trace.push({
        tool: call.function.name,
        args,
        result: result.ok ? "ok" : "denied" in result ? "denied" : "unavailable",
      });
      // Denials and unavailability are surfaced to the model as plain text so she
      // can speak to them; data is passed through as JSON.
      const payload = result.ok
        ? JSON.stringify(result.data)
        : "denied" in result
          ? JSON.stringify({ denied: true, reason: result.reason })
          : JSON.stringify({ unavailable: true, reason: result.reason });
      messages.push({ role: "tool", tool_call_id: call.id, name: call.function.name, content: payload });
    }
  }

  // Exhausted the tool budget without a final text answer. Ask once for a wrap-up.
  const wrap = await chatImpl(env, [...messages, { role: "user", content: "answer now, using only what the tools returned. one short message." }], false);
  const text = (wrap?.message?.content ?? "").trim();
  if (!text) return { spoke: true, reply: FALLBACK_QUIET, trace, degraded: true };
  if (assertsTypology(text) && !calledAnyTool) {
    return { spoke: true, reply: FALLBACK_QUIET, trace, degraded: false };
  }
  return { spoke: true, reply: text, trace, degraded: false };
}
