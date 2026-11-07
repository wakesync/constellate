// Origin / RP configuration with transition support.
//
// During the migration to constellate.me we must accept BOTH the new origins
// (constellate.me + subdomains) AND the legacy origins (LEGACY_ORIGINS)
// so existing test passkeys keep working. WebAuthn RP_ID is the registrable domain
// and is a SINGLE value per environment (it cannot be a list), so the RP_ID env var
// is authoritative; the *origins* allowlist is what supports both during cutover.

import type { Env } from "../types";

// Static fallbacks so local dev + a misconfigured env never hard-crash CORS.
const LOCAL_ORIGINS = ["http://localhost:5173", "http://localhost:4173", "http://127.0.0.1:5173"];

// Legacy production origins (old subdomain layout). Kept for transition.
const LEGACY_ORIGINS: string[] = [];

// New production origins (constellate.me apex + subdomains).
const NEW_ORIGINS = [
  "https://constellate.me",
  "https://www.constellate.me",
  "https://app.constellate.me",
];

// Build the full allowlist for CORS + WebAuthn expectedOrigin.
// APP_ORIGIN (the primary app origin) is always included. ALLOWED_ORIGINS env
// (comma-separated) can extend this without a code change.
export function allowedOrigins(env: Env): Set<string> {
  const set = new Set<string>([...LOCAL_ORIGINS, ...LEGACY_ORIGINS, ...NEW_ORIGINS]);
  if (env.APP_ORIGIN) set.add(env.APP_ORIGIN.replace(/\/$/, ""));
  if (env.ALLOWED_ORIGINS) {
    for (const o of env.ALLOWED_ORIGINS.split(",")) {
      const trimmed = o.trim().replace(/\/$/, "");
      if (trimmed) set.add(trimmed);
    }
  }
  return set;
}

export function isAllowedOrigin(env: Env, origin: string | undefined | null): boolean {
  if (!origin) return false;
  return allowedOrigins(env).has(origin.replace(/\/$/, ""));
}

// WebAuthn verification accepts an array of expected origins. We pass the full
// allowlist so a passkey created on the apex still verifies if the request comes
// from www / app / legacy during the transition window.
export function expectedOrigins(env: Env): string[] {
  return Array.from(allowedOrigins(env)).filter((o) => o.startsWith("https://") || o.startsWith("http://localhost") || o.startsWith("http://127.0.0.1"));
}

// RP_ID must be the registrable domain shared by all app origins. For
// constellate.me that is "constellate.me" (covers apex + app./www. subdomains).
// During transition, RP_ID stays a single value; passkeys are scoped to it, so
// you cannot serve passkeys for BOTH constellate.me and a legacy domain
// from one RP_ID. Strategy: cut RP_ID over to constellate.me; legacy-origin
// users re-enroll a passkey once. This is documented in README.md.
export function rpId(env: Env): string {
  return env.RP_ID || "constellate.me";
}

export function rpName(env: Env): string {
  return env.RP_NAME || "Constellate";
}
