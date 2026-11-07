-- 0013_synastry_active_zodiac.sql
--
-- Active synastry pointers are per zodiac sky. Existing pair-wide pointers
-- were cast before the dual-active model and are preserved as tropical.

CREATE TABLE IF NOT EXISTS synastry_active_v2 (
  user_a_id      TEXT NOT NULL,
  user_b_id      TEXT NOT NULL,
  zodiac_system  TEXT NOT NULL DEFAULT 'tropical' CHECK (zodiac_system IN ('tropical', 'sidereal')),
  generation_id  TEXT NOT NULL REFERENCES synastry_generations(id),
  updated_at     INTEGER NOT NULL,
  updated_by     TEXT REFERENCES users(id),
  PRIMARY KEY (user_a_id, user_b_id, zodiac_system),
  CHECK (user_a_id < user_b_id)
);

INSERT OR IGNORE INTO synastry_active_v2 (user_a_id, user_b_id, zodiac_system, generation_id, updated_at, updated_by)
SELECT user_a_id, user_b_id, 'tropical', generation_id, updated_at, updated_by
FROM synastry_active;

DROP TABLE synastry_active;
ALTER TABLE synastry_active_v2 RENAME TO synastry_active;
