// Shared HTTP helpers: typed error envelopes, json body parsing with zod, ids, time.
import type { Context } from "hono";
import { z } from "zod";

export const JSON_HEADERS = { "content-type": "application/json" } as const;

export function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

export function id(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

// Canonical error envelope: { error, code }. Status is set on the Response.
export function fail(c: Context, status: number, message: string, code: string): Response {
  return c.json({ error: message, code }, status as never);
}

// Stable error codes used across the API. Keep messages in voice, lowercase, no glaze.
export const ERR = {
  VALIDATION: { code: "VALIDATION_ERROR", message: "that did not look right. check the fields and try again." },
  UNAUTHORIZED: { code: "UNAUTHORIZED", message: "sign in to see this." },
  FORBIDDEN: { code: "FORBIDDEN", message: "this is not yours to read." },
  NOT_FOUND: { code: "NOT_FOUND", message: "nothing here by that name." },
  RATE_LIMITED: { code: "RATE_LIMITED", message: "too many requests in a short time. the sky asks for a pause." },
  CHALLENGE_EXPIRED: { code: "CHALLENGE_EXPIRED", message: "that took too long. begin again." },
  PASSKEY_FAILED: { code: "PASSKEY_FAILED", message: "that did not match. try again, or use another device." },
  PASSKEY_NOT_FOUND: { code: "PASSKEY_NOT_FOUND", message: "no passkey here. create one first." },
  BIRTH_DATA_NOT_FOUND: { code: "BIRTH_DATA_NOT_FOUND", message: "no birth data on file. begin there." },
  CONSTELLATION_NOT_FOUND: { code: "CONSTELLATION_NOT_FOUND", message: "nothing here by that name." },
  INVITE_NOT_FOUND: { code: "INVITE_NOT_FOUND", message: "that link does not lead anywhere we recognize." },
  JOURNAL_NOT_FOUND: { code: "JOURNAL_NOT_FOUND", message: "nothing here by that name." },
  SYNASTRY_NOT_FOUND: { code: "SYNASTRY_NOT_FOUND", message: "no reading yet. ask for one." },
  PLACES_FAILED: { code: "PLACES_FAILED", message: "could not reach the places service. try again shortly." },
  ASTRO_FAILED: { code: "ASTRO_FAILED", message: "the chart engine is unavailable right now. try again shortly." },
  UPSTREAM: { code: "UPSTREAM_ERROR", message: "something upstream did not answer. try again shortly." },
  INTERNAL: { code: "INTERNAL_ERROR", message: "something did not arrive. try again in a moment." },
} as const;

export function failKind(c: Context, status: number, kind: { code: string; message: string }): Response {
  return fail(c, status, kind.message, kind.code);
}

// Parse + validate a JSON body. Returns a discriminated result so callers can early-return.
export async function readBody<T>(
  c: Context,
  schema: z.ZodType<T>,
): Promise<{ ok: true; value: T } | { ok: false; response: Response }> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return { ok: false, response: failKind(c, 400, ERR.VALIDATION) };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, response: failKind(c, 400, ERR.VALIDATION) };
  }
  return { ok: true, value: parsed.data };
}
