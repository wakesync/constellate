// Resilient narrative generation.
//
// The brief requires: timeout, retry-once, and graceful degradation to a non-AI
// fallback so a slow/down model never hard-fails the whole request. We call the
// account pool (Anthropic /v1/messages shape) via fetch so we control
// AbortController timeouts precisely on Workers, and we never throw to the
// route — we return a fallback.
//
// Provider: an Anthropic-compatible account pool (env POOL_URL) burns pooled subscription
// quota instead of per-token OpenRouter billing. OPENROUTER_API_KEY remains as
// a fallback path if POOL_API_KEY is unset.

import type { Env } from "../types";

const DEFAULT_POOL_ENDPOINT = "https://pool.example.com/v1/messages";
const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
// A ~900-token synastry reading regularly exceeds 12s; that was aborting the
// call and silently serving the canned fallback. Give it real room.
const TIMEOUT_MS = 45_000;

type ChatArgs = {
  env: Env;
  model: string;
  system: string;
  user: string;
  maxTokens?: number;
  // Pair narrative paths MUST pass their effective stored relationship lens.
  // The gateway injects a final hard guard into every provider call, so a new
  // pair call site cannot accidentally rely on prompt vibes alone.
  relationshipContext?: "roommate" | "collaborator" | "friend" | "romantic" | "family" | "unspecified";
  // Non-AI fallback used when the model is unavailable or times out.
  fallback: string;
};

function systemWithRelationshipGuard(args: ChatArgs): string {
  if (!args.relationshipContext) return args.system;
  const lens = args.relationshipContext;
  const romantic = lens === "romantic";
  return `${args.system}\n\nRELATIONSHIP CONTEXT GATE (server-resolved, highest priority)\nthe effective relationship context is: ${lens}. ${romantic
    ? "both members have explicitly allowed romantic framing, so it is permitted."
    : "romantic or sexual framing is forbidden. do not imply attraction, desire, courtship, partnership, or future romance. keep every relational observation platonic and true to this context."}`;
}

// pool speaks Anthropic model ids; strip the OpenRouter vendor prefix so call
// sites can keep one canonical name ("anthropic/claude-fable-5").
function poolModel(model: string): string {
  return model.replace(/^anthropic\//, "");
}

async function callPool(args: ChatArgs, signal: AbortSignal): Promise<string | null> {
  const res = await fetch(args.env.POOL_URL || DEFAULT_POOL_ENDPOINT, {
    method: "POST",
    signal,
    headers: {
      "content-type": "application/json",
      "x-api-key": args.env.POOL_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: poolModel(args.model),
      // fable-5 has mandatory reasoning; thinking tokens are billed inside
      // max_tokens, so give headroom so the budget goes to the reading.
      max_tokens: (args.maxTokens ?? 900) + 500,
      system: systemWithRelationshipGuard(args),
      messages: [{ role: "user", content: args.user }],
    }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { content?: Array<{ type?: string; text?: string }> };
  const text = (data.content || [])
    .filter((b) => b.type === "text" && b.text)
    .map((b) => b.text)
    .join("\n")
    .trim();
  return text || null;
}

async function callOpenRouter(args: ChatArgs, signal: AbortSignal): Promise<string | null> {
  const res = await fetch(OPENROUTER_ENDPOINT, {
    method: "POST",
    signal,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${args.env.OPENROUTER_API_KEY}`,
      "http-referer": args.env.APP_ORIGIN || "https://constellate.me",
      "x-title": "Constellate",
    },
    body: JSON.stringify({
      model: args.model,
      max_tokens: (args.maxTokens ?? 900) + 500,
      reasoning: { effort: "low" },
      messages: [
        { role: "system", content: systemWithRelationshipGuard(args) },
        { role: "user", content: args.user },
      ],
    }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content;
  return content && content.trim() ? content.trim() : null;
}

async function callOnce(args: ChatArgs, signal: AbortSignal): Promise<string | null> {
  if (args.env.POOL_API_KEY) return callPool(args, signal);
  if (args.env.OPENROUTER_API_KEY) return callOpenRouter(args, signal);
  return null;
}

// Returns { text, degraded }. degraded=true means we served the non-AI fallback.
export async function generateNarrative(args: ChatArgs): Promise<{ text: string; degraded: boolean }> {
  if (!args.env.POOL_API_KEY && !args.env.OPENROUTER_API_KEY) {
    return { text: args.fallback, degraded: true };
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const text = await callOnce(args, controller.signal);
      clearTimeout(timer);
      if (text) return { text, degraded: false };
      // null = non-ok or empty; retry once then fall back.
    } catch {
      clearTimeout(timer);
      // network / abort: retry once then fall back.
    }
  }
  return { text: args.fallback, degraded: true };
}

// In-voice fallbacks (no AI). Apophatic, observational, lowercase, no em-dashes.
export const FALLBACK = {
  transitReflection:
    "the sky is doing what it does, quietly, whether or not anyone reads it. nothing to act on. just the day, in motion.",
  transitPrompt: "what did you notice today that no one else would have.",
  synastry:
    "two charts laid over each other, and for the moment the words for it are not here. the aspects are real; the reading can wait. the chart did not make this happen. it just remembers it happened.",
} as const;
