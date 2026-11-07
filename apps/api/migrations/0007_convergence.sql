-- 0007_convergence.sql
-- Convergence engine caches. The convergence result is a deterministic function
-- of the five source engine payloads (astro chart, HD, gene keys, enneagram,
-- socionics). We cache the scored payload per user, keyed additionally by an
-- inputs_hash so we can cheaply detect when any source engine changed and
-- recompute only then.
--
-- Idempotent (IF NOT EXISTS), matching the 0003/0004/0005/0006 style. Safe to
-- re-apply. Same caching intent as human_design_cache / socionics_results.

-- Per-user convergence result. inputs_hash = FNV-1a over the stable-stringified
-- source payloads; a mismatch on read means a source engine changed and the row
-- is stale, so we recompute and overwrite.
CREATE TABLE IF NOT EXISTS convergence_cache (
  user_id     TEXT PRIMARY KEY REFERENCES users(id),
  payload_json TEXT NOT NULL,        -- the full scored ConvergenceResult
  computed_at INTEGER NOT NULL,      -- unix seconds
  inputs_hash TEXT NOT NULL          -- hash of the source engine payloads
);

-- Pair-level convergence between two users who share a constellation. Ordering
-- (user_a_id, user_b_id) is canonicalized (a < b) by the API before write so
-- (a,b) and (b,a) collapse to one row, exactly like synastry_reports.
CREATE TABLE IF NOT EXISTS convergence_pair_cache (
  user_a_id   TEXT NOT NULL REFERENCES users(id),
  user_b_id   TEXT NOT NULL REFERENCES users(id),
  payload_json TEXT NOT NULL,
  computed_at INTEGER NOT NULL,
  inputs_hash TEXT NOT NULL,
  PRIMARY KEY (user_a_id, user_b_id)
);
CREATE INDEX IF NOT EXISTS idx_convergence_pair_a ON convergence_pair_cache(user_a_id);
CREATE INDEX IF NOT EXISTS idx_convergence_pair_b ON convergence_pair_cache(user_b_id);

-- The convergence LLM reading reuses the shared readings_cache table (created in
-- 0005) under kind='convergence'. No convergence-specific reading table needed;
-- a recompute of the convergence result deletes the stale reading row, same as
-- enneagram/socionics do.
