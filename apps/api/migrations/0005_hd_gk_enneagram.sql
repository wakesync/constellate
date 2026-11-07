-- 0005_hd_gk_enneagram.sql
-- Human Design + Gene Keys result caches, the Enneagram questionnaire store,
-- and a general per-user readings cache for the LLM narratives.
--
-- All statements are idempotent (IF NOT EXISTS) so re-applying is safe, matching
-- the style of 0003/0004. HD + GK payloads are deterministic for a fixed birth,
-- so we cache the computed JSON blob per user and serve from here on re-reads
-- (same pattern as birth_data.natal_chart_json / astrocartography_cache).

CREATE TABLE IF NOT EXISTS human_design_cache (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  payload_json TEXT NOT NULL,
  computed_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS gene_keys_cache (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  payload_json TEXT NOT NULL,
  computed_at INTEGER NOT NULL
);

-- Enneagram is a questionnaire, not birth-derived. We store each answer so a
-- user can resume a partial quiz. (user_id, question_id) is the natural key.
CREATE TABLE IF NOT EXISTS enneagram_answers (
  user_id TEXT NOT NULL REFERENCES users(id),
  question_id TEXT NOT NULL,
  value INTEGER NOT NULL,            -- 1..5 agreement
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, question_id)
);
CREATE INDEX IF NOT EXISTS idx_enneagram_answers_user ON enneagram_answers(user_id);

-- The scored result, once a quiz is completed (or scored on demand).
CREATE TABLE IF NOT EXISTS enneagram_results (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  payload_json TEXT NOT NULL,
  completed_at INTEGER NOT NULL
);

-- General per-user narrative cache keyed by "kind" (humandesign|genekeys|
-- enneagram). Keeps generated readings so we do not re-hit the model on every
-- view, same intent as synastry_reports.narrative.
CREATE TABLE IF NOT EXISTS readings_cache (
  user_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL,                -- 'humandesign' | 'genekeys' | 'enneagram'
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, kind)
);
CREATE INDEX IF NOT EXISTS idx_readings_cache_user ON readings_cache(user_id);
