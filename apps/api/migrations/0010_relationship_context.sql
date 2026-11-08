-- 0010_relationship_context.sql
-- Relationship context (P1, de-romanticization). Synastry/convergence prose was
-- assuming a romantic lens for every pair; circles can be platonic households. The fix is structural: the relationship between two members is stored
-- data on the canonical pair key, threaded through every pair-narrative prompt.
-- Romantic framing becomes opt-in (pair context = romantic AND both members'
-- preferences allow it), never assumed.
--
-- Additive only. pair_context is idempotent (IF NOT EXISTS); the users ALTERs
-- run once under d1_migrations bookkeeping, same as 0003's ALTER.

-- Per-pair declared relationship. Canonical ordering (user_a_id < user_b_id) is
-- enforced by the API before write AND by the CHECK, exactly like
-- synastry_reports / convergence_pair_cache. Either member can set it;
-- last-write-wins (set_by records who wrote last).
CREATE TABLE IF NOT EXISTS pair_context (
  user_a_id    TEXT NOT NULL REFERENCES users(id),
  user_b_id    TEXT NOT NULL REFERENCES users(id),
  relationship TEXT NOT NULL CHECK (relationship IN ('roommate','collaborator','friend','romantic','family')),
  set_by       TEXT REFERENCES users(id),
  updated_at   INTEGER NOT NULL,
  PRIMARY KEY (user_a_id, user_b_id),
  CHECK (user_a_id < user_b_id)
);

-- Optional private profile fields. Free-form-ish, nullable. PRIVATE: returned
-- only on /me, never in member lists, never through Eliza tools. They gate
-- romantic framing server-side (lib/relationship.ts); the values themselves
-- never enter a prompt.
ALTER TABLE users ADD COLUMN sexual_orientation TEXT;
ALTER TABLE users ADD COLUMN relational_preference TEXT;

-- Pair convergence now has prose over its deterministic payload. Keep that
-- narrative beside the existing pair cache, with the lens used to write it so a
-- context change can never serve stale framing.
ALTER TABLE convergence_pair_cache ADD COLUMN narrative TEXT;
ALTER TABLE convergence_pair_cache ADD COLUMN narrative_generated_at INTEGER;
ALTER TABLE convergence_pair_cache ADD COLUMN narrative_lens TEXT;

-- Synastry already stores prose, but needs the lens used to generate it so a
-- context change invalidates framing without deleting the last good report.
ALTER TABLE synastry_reports ADD COLUMN narrative_lens TEXT;
