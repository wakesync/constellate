-- 0003_hardening.sql
-- Production hardening: durable WebAuthn challenges, durable rate-limit + place
-- cache, and indexes on foreign keys + hot lookup columns.
--
-- Workers run as many short-lived isolates; in-memory Maps do NOT survive between
-- requests (a register/begin and its register/finish can land on different isolates),
-- so challenge state MUST live in D1 or passkey enrollment is flaky in production.
--
-- All statements are idempotent (IF NOT EXISTS) so re-applying is safe.

-- WebAuthn challenges (begin -> finish handshake). Short-lived rows, swept on read.
CREATE TABLE IF NOT EXISTS webauthn_challenges (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,                 -- 'register' | 'login'
  email TEXT,                         -- nullable (login can be usernameless)
  user_id TEXT,                       -- pending user id for register, null for login
  challenge TEXT NOT NULL,            -- base64url challenge issued to the authenticator
  payload TEXT NOT NULL DEFAULT '{}', -- json: display_name, device_label
  expires_at INTEGER NOT NULL         -- unix seconds
);
CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_expires ON webauthn_challenges(expires_at);

-- Durable rate-limit counters keyed by (bucket, client). Fixed-window.
CREATE TABLE IF NOT EXISTS rate_limits (
  bucket TEXT NOT NULL,               -- logical route group e.g. 'auth', 'narrative'
  client TEXT NOT NULL,               -- ip or user id
  count INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL,      -- unix seconds, start of current window
  PRIMARY KEY (bucket, client)
);
CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON rate_limits(window_start);

-- Durable place-lookup cache (Nominatim is rate-limited + slow; cache results).
CREATE TABLE IF NOT EXISTS place_cache (
  q TEXT PRIMARY KEY,                 -- normalized (trimmed, lowercased) query
  result_json TEXT NOT NULL,
  cached_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_place_cache_cached_at ON place_cache(cached_at);

-- birth_data gains an explicit "exact time unknown" flag so the UI can show the
-- rising-sign caveat and the engine can be told not to trust house cusps.
-- SQLite has no ADD COLUMN IF NOT EXISTS; guard via a one-shot that ignores the
-- "duplicate column" error on re-apply (wrangler treats each migration file as
-- applied-once, so this only runs a single time in practice).
ALTER TABLE birth_data ADD COLUMN exact_time_unknown INTEGER NOT NULL DEFAULT 0;

-- Indexes for foreign keys + hot lookups (D1/SQLite does not auto-index FKs).
CREATE INDEX IF NOT EXISTS idx_passkeys_user_id ON passkeys(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_constellations_invite_token ON constellations(invite_token);
CREATE INDEX IF NOT EXISTS idx_constellations_creator_id ON constellations(creator_id);
CREATE INDEX IF NOT EXISTS idx_memberships_user_id ON memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_memberships_constellation_id ON memberships(constellation_id);
CREATE INDEX IF NOT EXISTS idx_journal_user_id ON journal_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_journal_constellation_id ON journal_entries(constellation_id);
CREATE INDEX IF NOT EXISTS idx_journal_written_at ON journal_entries(written_at);
CREATE INDEX IF NOT EXISTS idx_synastry_pair ON synastry_reports(user_a_id, user_b_id);
