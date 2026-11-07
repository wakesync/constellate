-- 0008_eliza.sql
-- Eliza in the circle: a member of a constellation who can answer questions
-- ("why do rowan and i keep having the same fight") by calling deterministic
-- typology tools and citing real receipts. She never computes typology herself.
--
-- Idempotent (IF NOT EXISTS), matching 0003/0004/0005/0006 style. Safe to re-apply.
-- Additive only. Touches no other lane's tables.

-- Chat thread, one row per message, scoped to a constellation. user_id is NULL
-- for eliza's own messages (she is not a user row). tool_trace_json records the
-- tool calls she made to produce a reply, so a reply is always auditable against
-- the receipts it claims. This is part of the no-fact-without-a-tool guarantee.
CREATE TABLE IF NOT EXISTS eliza_messages (
  id              TEXT PRIMARY KEY,
  constellation_id TEXT NOT NULL REFERENCES constellations(id),
  user_id         TEXT REFERENCES users(id),   -- NULL => eliza spoke
  role            TEXT NOT NULL,                -- 'user' | 'eliza'
  body            TEXT NOT NULL,
  tool_trace_json TEXT,                         -- JSON array of {tool, args, ok, unavailable?}
  created_at      INTEGER NOT NULL              -- unix seconds
);

-- The primary read is "recent messages in this circle, oldest->newest for render,
-- newest-first for tailing". Index the scope+time key.
CREATE INDEX IF NOT EXISTS idx_eliza_messages_scope ON eliza_messages(constellation_id, created_at);

-- Per-constellation settings. Defaults chosen so eliza is present but quiet:
-- enabled on, daily prompt on, quiet hours empty (creator/admin can set).
CREATE TABLE IF NOT EXISTS eliza_settings (
  constellation_id     TEXT PRIMARY KEY REFERENCES constellations(id),
  enabled              INTEGER NOT NULL DEFAULT 1,
  daily_prompt_enabled INTEGER NOT NULL DEFAULT 1,
  quiet_hours_json     TEXT,   -- JSON e.g. {"start":22,"end":8,"tz":"America/Denver"} or NULL
  updated_at           INTEGER
);
