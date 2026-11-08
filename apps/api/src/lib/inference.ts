// ONE product model boundary. Reading, synastry and circle-agent calls enter
// here, then share the server's attested Tinfoil transport. No public fallback.
// The sensitivity router classifies every call here. Only private kinds exist on
// this hook, and they only ever reach the attested enclave.
import { createAttestedChat, providerConfigured, type ChatRequest, type AttestedChat } from "../../../../server/src/inference";
import { classify, tagPrivate, assertNoRawBirthKeys, PrivacyRouteError, type TaskKind } from "../../../../server/src/router";

export type ProductKind = Extract<TaskKind, "typology-reading" | "convergence-pair" | "synastry" | "sky-reflection" | "circle-agent">;
import type { Env } from "../types";

export function productInferenceConfigured(env: Env): boolean {
  return providerConfigured(() => ({ apiKey: env.TINFOIL_API_KEY, model: env.TINFOIL_MODEL }));
}

// Strip raw birth/identity metadata from structured evidence, including nested
// tool results. Free-form user chat is inherently private, not anonymized.
const OMIT = new Set(["input", "birth", "birth_data", "date_local", "date_utc", "birth_date", "birth_time", "latitude", "longitude", "lat", "lng", "timezone", "timeZone", "tz", "place_name", "email", "design_datetime_utc", "calculatedAt"]);
export function minimizeEvidence(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(minimizeEvidence);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => !OMIT.has(key)).map(([key, v]) => [key, minimizeEvidence(v)]));
  if (typeof value === "string" && /^[\[{]/.test(value.trim())) {
    try { return JSON.stringify(minimizeEvidence(JSON.parse(value))); } catch { /* prose is not JSON */ }
  }
  return value;
}

export async function productInference(env: Env, request: ChatRequest, testChat?: AttestedChat, kind: ProductKind = "typology-reading") {
  // Router: every product kind is private -> tinfoil-enclave. A kind that ever
  // resolved anywhere else is a programming error and never sends.
  const route = classify(kind);
  if (route.sensitivity !== "private" || route.route !== "tinfoil-enclave") throw new PrivacyRouteError(`product kind ${kind} is not private`);
  const minimized = {
    system: request.system,
    maxTokens: request.maxTokens,
    messages: request.messages.map(m => ({ role: m.role, content: minimizeEvidence(m.content) as string })),
  };
  // Minimization is asserted, not assumed: a new evidence shape that smuggles a
  // raw birth key past the omit list fails here, before the enclave.
  for (const m of minimized.messages) assertNoRawBirthKeys(m.content);
  // Tagged so the router's public-lane guard refuses this exact request forever.
  tagPrivate(request); tagPrivate(minimized);
  const chat = testChat ?? createAttestedChat({ config: () => ({ apiKey: env.TINFOIL_API_KEY, model: env.TINFOIL_MODEL }) });
  return chat(minimized);
}
