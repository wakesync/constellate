-- 0012_zodiac_system.sql
-- Sidereal/vedic lens, data layer (docs/SIDEREAL.md, P2).
--
-- A user carries a zodiac_system preference ('tropical' default | 'sidereal',
-- Lahiri implied). Every per-user engine cache that depends on the zodiac frame
-- becomes keyed by (user, zodiac_system) so tropical and sidereal rows coexist
-- and can NEVER cross-contaminate: flipping the preference reads/writes the
-- other row, flipping back hits the original untouched one.
--
-- D1/SQLite cannot ALTER a primary key, so keyed caches are rebuilt via the
-- create-copy-drop-rename pattern (each migration file applies exactly once
-- under d1_migrations bookkeeping, same as 0003's one-shot ALTERs). Existing
-- rows were all computed under the tropical sky, so they backfill as
-- 'tropical'.
--
-- TROPICAL CANON (plan §1): convergence, harmony, and the circle graph stay
-- tropical-only in v1. Their tables (convergence_cache, convergence_pair_cache,
-- graph_edges) deliberately get NO zodiac column; the API pins every read that
-- feeds them to zodiac_system = 'tropical'. birth_data.natal_chart_json also
-- stays what it always was: the canonical TROPICAL natal chart, written at
-- birth-data save time and read by the canon paths.

-- 1. the per-user preference. ---------------------------------------------
ALTER TABLE users ADD COLUMN zodiac_system TEXT NOT NULL DEFAULT 'tropical'
  CHECK (zodiac_system IN ('tropical', 'sidereal'));

-- 2. natal chart cache, keyed by zodiac. ----------------------------------
-- birth_data.natal_chart_json remains the tropical canon copy (canon paths
-- read it directly). This table serves the flippable /me/chart lens: the
-- tropical row mirrors canon, the sidereal row is computed on first flip.
CREATE TABLE IF NOT EXISTS natal_chart_cache (
  user_id       TEXT NOT NULL REFERENCES users(id),
  zodiac_system TEXT NOT NULL DEFAULT 'tropical' CHECK (zodiac_system IN ('tropical', 'sidereal')),
  chart_json    TEXT NOT NULL,
  computed_at   INTEGER NOT NULL,
  PRIMARY KEY (user_id, zodiac_system)
);

-- 3. astrocartography cache: PK (user_id) -> (user_id, zodiac_system). ----
CREATE TABLE IF NOT EXISTS astrocartography_cache_v2 (
  user_id       TEXT NOT NULL REFERENCES users(id),
  zodiac_system TEXT NOT NULL DEFAULT 'tropical' CHECK (zodiac_system IN ('tropical', 'sidereal')),
  lines_json    TEXT NOT NULL,
  computed_at   INTEGER NOT NULL,
  PRIMARY KEY (user_id, zodiac_system)
);
INSERT OR IGNORE INTO astrocartography_cache_v2 (user_id, zodiac_system, lines_json, computed_at)
  SELECT user_id, 'tropical', lines_json, computed_at FROM astrocartography_cache;
DROP TABLE astrocartography_cache;
ALTER TABLE astrocartography_cache_v2 RENAME TO astrocartography_cache;

-- 4. human design cache: PK (user_id) -> (user_id, zodiac_system). --------
CREATE TABLE IF NOT EXISTS human_design_cache_v2 (
  user_id       TEXT NOT NULL REFERENCES users(id),
  zodiac_system TEXT NOT NULL DEFAULT 'tropical' CHECK (zodiac_system IN ('tropical', 'sidereal')),
  payload_json  TEXT NOT NULL,
  computed_at   INTEGER NOT NULL,
  PRIMARY KEY (user_id, zodiac_system)
);
INSERT OR IGNORE INTO human_design_cache_v2 (user_id, zodiac_system, payload_json, computed_at)
  SELECT user_id, 'tropical', payload_json, computed_at FROM human_design_cache;
DROP TABLE human_design_cache;
ALTER TABLE human_design_cache_v2 RENAME TO human_design_cache;

-- 5. gene keys cache: same rebuild. ---------------------------------------
CREATE TABLE IF NOT EXISTS gene_keys_cache_v2 (
  user_id       TEXT NOT NULL REFERENCES users(id),
  zodiac_system TEXT NOT NULL DEFAULT 'tropical' CHECK (zodiac_system IN ('tropical', 'sidereal')),
  payload_json  TEXT NOT NULL,
  computed_at   INTEGER NOT NULL,
  PRIMARY KEY (user_id, zodiac_system)
);
INSERT OR IGNORE INTO gene_keys_cache_v2 (user_id, zodiac_system, payload_json, computed_at)
  SELECT user_id, 'tropical', payload_json, computed_at FROM gene_keys_cache;
DROP TABLE gene_keys_cache;
ALTER TABLE gene_keys_cache_v2 RENAME TO gene_keys_cache;

-- 6. narrative readings cache: PK (user_id, kind) -> (user_id, kind, zodiac).
-- HD/GK readings describe frame-dependent payloads (a tropical Projector can
-- be a sidereal Generator), so the prose must be keyed by the sky it was
-- written under. Frame-independent kinds (enneagram, socionics, convergence)
-- always read/write their 'tropical' row (convergence is tropical-canon).
CREATE TABLE IF NOT EXISTS readings_cache_v2 (
  user_id       TEXT NOT NULL REFERENCES users(id),
  kind          TEXT NOT NULL,
  zodiac_system TEXT NOT NULL DEFAULT 'tropical' CHECK (zodiac_system IN ('tropical', 'sidereal')),
  text          TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (user_id, kind, zodiac_system)
);
INSERT OR IGNORE INTO readings_cache_v2 (user_id, kind, zodiac_system, text, created_at)
  SELECT user_id, kind, 'tropical', text, created_at FROM readings_cache;
DROP TABLE readings_cache;
ALTER TABLE readings_cache_v2 RENAME TO readings_cache;
CREATE INDEX IF NOT EXISTS idx_readings_cache_user ON readings_cache(user_id);

-- 7. synastry generations permanently record which sky they were cast under.
-- Generations are append-only history; old readings never silently change,
-- so each row states its frame. Existing rows were all tropical casts.
ALTER TABLE synastry_generations ADD COLUMN zodiac_system TEXT NOT NULL DEFAULT 'tropical'
  CHECK (zodiac_system IN ('tropical', 'sidereal'));
