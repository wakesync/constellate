-- 0009_circle_graph.sql
-- The circle graph (docs/CIRCLE-GRAPH.md): a typed edge table projecting the
-- deterministic engine outputs (HD gates/channels/centers, natal placements,
-- synastry aspects, later convergence axes / intertype / pair context) into one
-- indexed, queryable structure for Eliza's graph tools.
--
-- Every edge traces to a deterministic engine payload: `source` names the
-- engine, `inputs_hash` is the FNV-1a hash of the exact payload the edge was
-- extracted from (same hashing as convergence_cache). No LLM ever writes here.
-- No birth data, no journal text, no coordinates ever enter a row.
--
-- Access control is NOT in this table. Edges are per-user facts; every read
-- goes through lib/eliza/scope.ts and is filtered to the active constellation's
-- members at query time, exactly like every other Eliza tool.
--
-- Idempotent (IF NOT EXISTS), additive only, matching 0003..0008 style.

CREATE TABLE IF NOT EXISTS graph_edges (
  id               TEXT PRIMARY KEY,   -- deterministic content hash: same fact => same id, duplicates impossible
  subject_id       TEXT NOT NULL REFERENCES users(id),
  predicate        TEXT NOT NULL,      -- 'has_gate' | 'has_channel' | 'defined_center' | 'open_center'
                                       -- | 'hd_type' | 'hd_authority' | 'hd_profile' | 'placement' | 'aspect' | ...
  object_id        TEXT NOT NULL,      -- trait token ('gate:34', 'planet_sign:Sun:Leo') OR a user id for pair edges
  object_is_member INTEGER NOT NULL DEFAULT 0,  -- 1 => object_id is a user id (pair edge, canonical order subject<object)
  qualifiers_json  TEXT,               -- edge-specific detail (side/planet/line, orb/harmonious, ...)
  source           TEXT NOT NULL,      -- 'human_design' | 'natal' | 'synastry' | (later: 'convergence' | 'socionics' | 'pair_context')
  inputs_hash      TEXT NOT NULL,      -- hash of the source payload this edge was extracted from
  computed_at      INTEGER NOT NULL    -- unix seconds
);

-- Query family 1: neighborhood ("everything about this member").
CREATE INDEX IF NOT EXISTS idx_graph_edges_subject ON graph_edges(subject_id, predicate);
-- Query family 2: who-has-trait ("who else has gate 34").
CREATE INDEX IF NOT EXISTS idx_graph_edges_trait ON graph_edges(predicate, object_id);
-- Query family 3: pair edges by object member (aspects reach a member from either side).
CREATE INDEX IF NOT EXISTS idx_graph_edges_pair_object ON graph_edges(object_is_member, object_id);
