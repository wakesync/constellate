-- 0011_synastry_generations.sql
--
-- Every synastry reading is a permanent generation. The old synastry_reports
-- table was UNIQUE(pair) + ON CONFLICT DO UPDATE: each regen destroyed the
-- previous narrative (six readings lost on 07-30, recovered from LLM traces).
-- This makes that failure mode structurally impossible: generations are
-- append-only, an active pointer decides which one the pair is viewing.
--
-- Additive + idempotent: CREATE IF NOT EXISTS + INSERT OR IGNORE. The old
-- synastry_reports table is kept (read-compat during cutover); the API stops
-- writing to it after this migration ships.

CREATE TABLE IF NOT EXISTS synastry_generations (
  id            TEXT PRIMARY KEY,             -- id("syng")
  user_a_id     TEXT NOT NULL REFERENCES users(id),
  user_b_id     TEXT NOT NULL REFERENCES users(id),
  lens          TEXT NOT NULL,                -- relationship lens at generation time
  aspects_json  TEXT NOT NULL,                -- grid snapshot used for this narrative
  narrative     TEXT NOT NULL,                -- sanitized structured JSON
  generated_at  INTEGER NOT NULL,
  generated_by  TEXT REFERENCES users(id),    -- who pressed the button
  degraded      INTEGER NOT NULL DEFAULT 0,   -- fallback/degraded gens flagged, never active
  CHECK (user_a_id < user_b_id)
);
CREATE INDEX IF NOT EXISTS idx_syng_pair ON synastry_generations(user_a_id, user_b_id, generated_at DESC);

-- Active pointer per pair (which generation is the pair currently viewing).
CREATE TABLE IF NOT EXISTS synastry_active (
  user_a_id     TEXT NOT NULL,
  user_b_id     TEXT NOT NULL,
  generation_id TEXT NOT NULL REFERENCES synastry_generations(id),
  updated_at    INTEGER NOT NULL,
  updated_by    TEXT REFERENCES users(id),
  PRIMARY KEY (user_a_id, user_b_id),
  CHECK (user_a_id < user_b_id)
);

-- Backfill: existing synastry_reports rows become generation #1 for their pair
-- and are set active. Keep synastry_reports for now (read-compat), stop
-- writing to it after cutover.
INSERT OR IGNORE INTO synastry_generations (id, user_a_id, user_b_id, lens, aspects_json, narrative, generated_at, degraded)
SELECT 'syng_bf_' || id, user_a_id, user_b_id, COALESCE(narrative_lens,'friend'), aspects_json, narrative, generated_at, 0
FROM synastry_reports;
INSERT OR IGNORE INTO synastry_active (user_a_id, user_b_id, generation_id, updated_at)
SELECT user_a_id, user_b_id, 'syng_bf_' || id, unixepoch() FROM synastry_reports;
