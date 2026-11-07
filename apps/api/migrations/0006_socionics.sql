-- 0006_socionics.sql
-- Socionics: quiz answers, scored results, and a cached LLM reading.
-- Additive to the group-journaling app so people can compare their intertype
-- relations with others in a shared constellation. Needs NO birth data.
--
-- Idempotent (IF NOT EXISTS), matching 0003/0004 style. Safe to re-apply.

-- Per-answer store so the quiz is resumable and partial saves survive a reload.
CREATE TABLE IF NOT EXISTS socionics_answers (
  user_id     TEXT NOT NULL REFERENCES users(id),
  question_id TEXT NOT NULL,
  value       INTEGER NOT NULL,        -- 1..5 agreement
  updated_at  INTEGER NOT NULL,        -- unix seconds
  PRIMARY KEY (user_id, question_id)
);
CREATE INDEX IF NOT EXISTS idx_socionics_answers_user ON socionics_answers(user_id);

-- Scored result, one row per user. payload_json is the full SocionicsResult.
CREATE TABLE IF NOT EXISTS socionics_results (
  user_id      TEXT PRIMARY KEY REFERENCES users(id),
  payload_json TEXT NOT NULL,
  completed_at INTEGER NOT NULL
);

-- The LLM reading for the user's socionics type is cached in the shared
-- readings_cache table (created in 0005) under kind='socionics', so there is no
-- socionics-specific reading table here. A fresh scoring deletes the stale
-- reading row, same as enneagram does.
