-- ASTROCARTOGRAPHY CACHE
-- Astrocartography lines are deterministic for a fixed birth, so we cache the
-- computed JSON blob per user and serve from here on subsequent reads.
-- Idempotent so re-applying is safe.
CREATE TABLE IF NOT EXISTS astrocartography_cache (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  lines_json TEXT NOT NULL,
  computed_at INTEGER NOT NULL
);
