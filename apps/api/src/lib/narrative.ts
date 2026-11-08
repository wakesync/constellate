import type { Env } from "../types";
import { productInference, type ProductKind } from "./inference";

type ChatArgs = {
  env: Env;
  // Sensitivity router kind. Required so every call site is classified.
  kind: ProductKind;
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

// The only model boundary is productInference -> createAttestedChat.
// Degradation is fixed local copy, never another provider or a claimed reading.
export async function generateNarrative(args: ChatArgs): Promise<{ text: string; degraded: boolean }> {
  try {
    const result = await productInference(args.env, {
      system: systemWithRelationshipGuard(args),
      messages: [{ role: "user", content: args.user }],
      maxTokens: args.maxTokens ?? 900,
    }, undefined, args.kind);
    return { text: result.text, degraded: false };
  } catch {
    return { text: args.fallback, degraded: true };
  }
}

// In-voice fallbacks (no AI). Apophatic, observational, lowercase, no em-dashes.
export const FALLBACK = {
  transitReflection:
    "the sky is doing what it does, quietly, whether or not anyone reads it. nothing to act on. just the day, in motion.",
  transitPrompt: "what did you notice today that no one else would have.",
  synastry:
    "two charts laid over each other, and for the moment the words for it are not here. the aspects are real; the reading can wait. the chart did not make this happen. it just remembers it happened.",
} as const;
