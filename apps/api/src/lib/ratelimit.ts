// Durable, D1-backed fixed-window rate limiter.
//
// Workers isolates do not share memory, so an in-process Map under-counts under
// load (each isolate has its own). A tiny D1 table gives a consistent counter
// across isolates. Fixed-window is good enough for abuse protection here and
// avoids a Durable Object dependency (per the brief).

import type { Env } from "../types";
import { nowSec } from "./http";

export type RateRule = { bucket: string; limit: number; windowSec: number };

// Sensible defaults. Expensive routes (narrative/synastry/places) get tighter caps.
export const RULES = {
  auth: { bucket: "auth", limit: 30, windowSec: 60 },
  narrative: { bucket: "narrative", limit: 12, windowSec: 60 },
  synastry: { bucket: "synastry", limit: 10, windowSec: 60 },
  places: { bucket: "places", limit: 40, windowSec: 60 },
  write: { bucket: "write", limit: 60, windowSec: 60 },
} satisfies Record<string, RateRule>;

export type RateResult = { allowed: boolean; remaining: number; resetSec: number };

// Atomically increment the counter for (bucket, client) within the current window.
// Uses INSERT ... ON CONFLICT to fold "start new window" and "increment" into one
// statement so concurrent isolates do not race a read-then-write.
export async function rateLimit(env: Env, rule: RateRule, client: string): Promise<RateResult> {
  const t = nowSec();
  const windowStart = t - (t % rule.windowSec);
  try {
    const row = await env.DB.prepare(
      `INSERT INTO rate_limits (bucket, client, count, window_start)
       VALUES (?1, ?2, 1, ?3)
       ON CONFLICT(bucket, client) DO UPDATE SET
         count = CASE WHEN rate_limits.window_start = ?3 THEN rate_limits.count + 1 ELSE 1 END,
         window_start = ?3
       RETURNING count`,
    )
      .bind(rule.bucket, client, windowStart)
      .first<{ count: number }>();
    const count = row?.count ?? 1;
    const resetSec = windowStart + rule.windowSec;
    return { allowed: count <= rule.limit, remaining: Math.max(0, rule.limit - count), resetSec };
  } catch {
    // Fail open on limiter errors: never let the limiter take down the API.
    return { allowed: true, remaining: rule.limit, resetSec: t + rule.windowSec };
  }
}

// Best-effort sweep of stale windows. Cheap; called opportunistically.
export async function sweepRateLimits(env: Env): Promise<void> {
  const cutoff = nowSec() - 3600;
  try {
    await env.DB.prepare("DELETE FROM rate_limits WHERE window_start < ?").bind(cutoff).run();
  } catch {
    /* ignore */
  }
}
