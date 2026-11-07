// Durable WebAuthn challenge store (D1-backed).
//
// register/begin issues a challenge; register/finish must verify it. Because
// these two requests can hit different Worker isolates, the challenge cannot live
// in memory. We persist it, consume it exactly once (delete on read), and expire it.

import type { Env } from "../types";
import { id, nowSec } from "./http";

export type ChallengeKind = "register" | "login";

export type StoredChallenge = {
  id: string;
  kind: ChallengeKind;
  email: string | null;
  userId: string | null;
  challenge: string;
  payload: string;
  expiresAt: number;
};

const TTL_SEC = 300; // 5 minutes is plenty for a passkey ceremony.

export async function putChallenge(
  env: Env,
  args: { kind: ChallengeKind; email: string | null; userId: string | null; challenge: string; payload: string },
): Promise<string> {
  const challengeId = id("chal");
  await env.DB.prepare(
    `INSERT INTO webauthn_challenges (id, kind, email, user_id, challenge, payload, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(challengeId, args.kind, args.email, args.userId, args.challenge, args.payload, nowSec() + TTL_SEC)
    .run();
  return challengeId;
}

// Consume a challenge: fetch, validate kind + expiry, then delete (single use).
// Returns null if missing / wrong kind / expired.
export async function consumeChallenge(
  env: Env,
  challengeId: string,
  expectKind: ChallengeKind,
): Promise<StoredChallenge | null> {
  const row = await env.DB.prepare(
    "SELECT id, kind, email, user_id, challenge, payload, expires_at FROM webauthn_challenges WHERE id = ?",
  )
    .bind(challengeId)
    .first<{ id: string; kind: string; email: string | null; user_id: string | null; challenge: string; payload: string; expires_at: number }>();
  // Always delete on attempt to prevent replay even on validation failure.
  if (row) {
    await env.DB.prepare("DELETE FROM webauthn_challenges WHERE id = ?").bind(challengeId).run();
  }
  if (!row) return null;
  if (row.kind !== expectKind) return null;
  if (row.expires_at <= nowSec()) return null;
  return {
    id: row.id,
    kind: row.kind as ChallengeKind,
    email: row.email,
    userId: row.user_id,
    challenge: row.challenge,
    payload: row.payload,
    expiresAt: row.expires_at,
  };
}

// Best-effort sweep of expired challenges.
export async function sweepChallenges(env: Env): Promise<void> {
  try {
    await env.DB.prepare("DELETE FROM webauthn_challenges WHERE expires_at < ?").bind(nowSec()).run();
  } catch {
    /* ignore */
  }
}
