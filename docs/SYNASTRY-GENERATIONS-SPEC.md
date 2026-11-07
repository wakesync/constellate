# SYNASTRY GENERATIONS — full spec (2026-07-30)

Product directive: "all the generations should be saved and we
should be able to switch between them, and it should not regen everytime. also we have
to be able to see all readings and intuitive ux for how many readings done, we'll
probably have credits in the future."

Incident that motivated this: on 07-30 six synastry narratives were generated for one
pair across three lenses, and each regen **destroyed** the previous one because
`synastry_reports` is a single-row-per-pair UPSERT. Recovery required manual
archaeology in the LLM traces. That failure mode must be structurally impossible.

## Problems with current design

1. `synastry_reports` has `UNIQUE(user_a_id, user_b_id)` + `ON CONFLICT DO UPDATE`.
   Every POST overwrites the narrative. History is destroyed by design.
2. GET returns 404 when `narrative_lens != effectiveLens(...)`, which forces the
   client to POST (i.e., **regen**) on every lens change. Lens flip = destroy + pay
   for a new LLM call. Wrong on both cost and data-loss axes.
3. No visibility: users can't see how many readings exist, when they were made, or
   under what lens. No credits story is possible without that ledger.

## Design

### 1. Schema (new migration, additive)

```sql
-- 0011_synastry_generations.sql
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
-- and are set active. Keep synastry_reports table for now (read-compat), stop
-- writing to it after cutover.
INSERT INTO synastry_generations (id, user_a_id, user_b_id, lens, aspects_json, narrative, generated_at, degraded)
SELECT 'syng_bf_' || id, user_a_id, user_b_id, COALESCE(narrative_lens,'friend'), aspects_json, narrative, generated_at, 0
FROM synastry_reports;
INSERT INTO synastry_active (user_a_id, user_b_id, generation_id, updated_at)
SELECT user_a_id, user_b_id, 'syng_bf_' || id, unixepoch() FROM synastry_reports;
```

### 2. API semantics (breaking-ish, but the web client is ours)

- **GET /synastry/:other** → returns the ACTIVE generation for the pair, regardless
  of current lens. NO 404-on-lens-mismatch. Response gains:
  `generation: { id, lens, generated_at, index, total }` where index/total describe
  position in pair history (1-based, newest = total). If pair has zero generations →
  404 SYNASTRY_NOT_FOUND (client shows "generate first reading" CTA).
  - Lens-mismatch safety is preserved differently: response includes
    `current_lens` (effectiveLens now) vs `generation.lens`; the client renders a
    subtle "read under the {lens} lens" tag instead of silently regenerating.
    Romantic-privacy gate STILL applies at read time: if effectiveLens forbids
    romantic (a member's prefs changed), romantic generations are hidden from list
    and cannot be active; active falls back to newest allowed generation.
- **GET /synastry/:other/generations** → list for the pair: `[{ id, lens,
  generated_at, generated_by, active }]`, newest first, plus `total`. Narratives NOT
  included (keep payload small); fetch one via GET /synastry/:other?generation=<id>.
- **POST /synastry/:other** → EXPLICIT generate only. Always creates a NEW row in
  synastry_generations (never upserts, never deletes), sets it active. Degraded
  gens are returned to the caller but persisted with degraded=1 and NOT set active
  (active stays on last good one). Rate-limit stays (RULES.synastry); this is also
  the future credits hook: one POST = one credit.
- **PUT /synastry/:other/active { generation_id }** → switch active generation.
  Validates the generation belongs to the pair AND its lens is currently allowed
  (romantic gate). Either member can switch; last-write-wins with updated_by.
- Authz unchanged everywhere: sharesConstellation gate, canonical pair() ordering,
  unprobeable 404s.

### 3. Frontend (Synastry.tsx + SynastryPairCard)

- On load: GET active generation. NO auto-POST. If 404 → empty state with a single
  "cast the reading" button.
- **Readings drawer/strip**: manuscript-style horizontal strip (or drawer on
  mobile) listing all generations: "reading III · romantic · jul 30". Tap to view
  (sets active via PUT). Active one visibly marked (wax-seal motif fits the
  parchment aesthetic).
- **Reading counter**: "6 readings cast" badge on the pair card + in the drawer
  header. This is the credits-ready affordance: same spot later shows
  "6 readings cast · 4 credits left". Keep the copy in one component so the
  credits swap is one-line.
- **Regenerate** = explicit button ("cast a new reading"), with the CURRENT lens
  shown next to it before you commit ("casting under the romantic lens — change?").
  Lens picker adjacent (writes pair_context via existing endpoint) but changing
  lens does NOT auto-regen; it just changes what the next cast uses, and filters
  which historical readings show a lens tag.
- Degraded gens: render with a "the stars were quiet, this is a partial reading"
  note, excluded from the count of "readings cast"? NO — count them (they cost a
  call) but flag them visually. Decision: count everything that hit the model.

### 4. Backfill of tonight's six variants

Archived at `~/.moltbot/projects/constellate/syn-generations-2026-07-30/`
(trace line numbers 2731, 3329, 3330, 3334, 3337, 3338 from
trace-2026-07-30.jsonl). Builder: write a one-off script (ops/) that inserts all
six as generations for the ada+bram pair with their true lenses
(2731 + 3329 + 3330 + 3338 = roommate-family of prompts — check each request body
for the exact lens marker; 3334 = collaborator; 3337 = romantic) and correct
generated_at timestamps from the trace, then sets active = the one currently in
synastry_reports (the 08:55b "one house, two clocks" roommate reading). Verify
against prod D1 (constellate-prod) with a dry-run print first.

### 5. Non-goals (this pass)

- No credits enforcement (UX affordance only, counter component).
- No convergence_pair_cache generalization (same disease, separate migration
  later; note it in the receipt).
- Do not delete synastry_reports or its endpoints' compat until web is cutover in
  the same deploy.

## Acceptance

1. POST twice → two rows, both retrievable, newest active. Nothing overwritten.
2. Lens change → zero LLM calls, zero deletions; old readings still listed.
3. Switch active to an older reading → GET returns it for BOTH members.
4. Romantic gate: flip a member's preference to forbid romantic → romantic gens
   vanish from list, active falls back, PUT to a romantic gen 404s.
5. Backfill: all six 07-30 readings visible in the UI drawer for the pair,
   counter reads "6 readings cast".
6. Migration is additive + idempotent; deploy order safe (migrate → api → web).
7. Screenshots (desktop + mobile) of the drawer, counter, empty state, and
   lens-tag states in the receipt. Impeccable/taste review pass on the drawer UI.

## Build notes

- Model policy: fable + impeccable + taste + frontend-design skills (constellate
  standing rule).
- Repo: ~/projects/constellate (monorepo). Workers: constellate-api,
  constellate-app. D1: constellate-prod. Deploy via wrangler as in ops/.
