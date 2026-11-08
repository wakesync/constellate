# The circle graph

*P2 phase 1 design. Status: skeleton shipped (migration 0009 + extraction pass +
tests), Discord wiring deferred to phase 2 pending review.*

*P4 update (2026-07-29): the graph gained its first READ surface. `GET
/constellations/:id/graph` (membership-gated, same isMember 404 discipline as
the members route) returns the scoped slice the web renders: members with
derived highlight tokens, plus per-pair edges carrying shared traits (channel/
gate/center/placement intersections over `graph_edges`), top synastry aspects,
and the deterministic pair harmony score (docs/CONVERGENCE.md §9). Edge sync is
lazy + hash-guarded on the read path (`lib/graph/circle.ts`, batched: steady
state is 4 reads per request regardless of circle size). Crown-jewel rule
unchanged: every returned token is a derived typology fact from `graph_edges`;
no birth data can appear because it never enters a row.*

Constellate already computes a small-world knowledge graph, it just stores it as
JSON blobs. Every deterministic engine emits typed facts: gates, channels,
centers, placements, aspects, intertype relations, convergence axes. The circle
graph makes those facts queryable as one indexed structure, so Eliza can answer
"who else in the circle has gate 34" or "what do ada and bram share" in one
tool call instead of N payload fetches, and so she can weave proactively
("three of you carry the 20-34 channel, that is a house-level theme").

## Principles

1. **Every edge traces to a deterministic engine output.** The graph is a
   *projection* of existing computed payloads, never a source of truth and never
   a place an LLM writes. There is no code path where a model inserts an edge.
   Each row carries `source` (which engine payload it was derived from) and
   `inputs_hash` (the hash of that payload), so any edge can be audited back to
   the exact bytes that produced it.

2. **Crown jewels never enter the graph.** Edge rows contain derived typology
   tokens (`gate:34`, `Sun:Leo`, `aspect square 1.2 orb`), never birth
   date/time/place, never coordinates, never journal text. The extraction
   functions receive only the computed payloads, and the tests assert no
   birth-shaped field survives into a row.

3. **The graph has no opinions about access.** Scope lives where it always
   lives: in the tools, through `lib/eliza/scope.ts`. Edge rows are keyed by
   user id, not constellation, because typology is a fact about a person, not a
   circle. Every read binds to the active constellation via a membership join at
   query time. A member of circle A can never see circle B members' edges, same
   guarantee, same code path, as every other Eliza tool.

## Node and edge taxonomy

Nodes are implicit. A node is either a **member** (a user id) or a **trait
token** (a typed string like `gate:34`). We do not store a node table; a trait
node exists iff an edge references it, and trait tokens are closed vocabularies
emitted by deterministic code, so there is nothing to store about them that the
token does not already say.

Edges are typed rows: `subject —predicate→ object` plus qualifiers.

| predicate | subject | object | qualifiers | source |
|---|---|---|---|---|
| `has_gate` | member | `gate:N` | side (personality/design), planet, line | human_design_cache |
| `has_channel` | member | `channel:A-B` | name, centers | human_design_cache |
| `defined_center` | member | `center:Name` | | human_design_cache |
| `open_center` | member | `center:Name` | | human_design_cache |
| `hd_type` | member | `hdtype:Type` | strategy | human_design_cache |
| `hd_authority` | member | `authority:Name` | | human_design_cache |
| `hd_profile` | member | `profile:X/Y` | name | human_design_cache |
| `placement` | member | `planet_sign:Planet:Sign` | house, degree, retrograde | birth_data.natal_chart_json |
| `aspect` | member | member | a_planet, b_planet, aspect, orb, harmonious, generational, effective | astro /synastry grid |

Phase 2+ predicates, same table, no schema change needed:

| predicate | notes |
|---|---|
| `axis_lean` | member → `axis:id:pole`, from convergence_cache (direction + strength) |
| `intertype` | member → member, from socionics relationBetween |
| `electromagnetic` | member → member, channel completed between two, from the get_hd_connection math |
| `pair_axis` | member → member, from convergence_pair_cache when that lane lands |
| `relationship_context` | member → member, from P1's pair context (roommate/collaborator/friend/romantic/family). This edge is what keeps proactive weaving platonic-by-default for a shared household |
| `journal_theme` | member → `theme:token`, **consent-gated, see below, not in phase 1 or 2** |

Pair edges (`aspect`, and later `intertype`/`electromagnetic`/`pair_axis`) are
stored in **canonical pair order** (`subject_id < object_id`, same `pair()`
convention as synastry_reports), one row per fact, and the extraction function
*throws* if handed a non-canonical pair. This is the same three-layer
orientation discipline that fixed the synastry your-sun-is-their-sun bug; the
graph inherits it rather than re-learning it.

Multiplicity: a gate can be activated more than once (different planets, both
charts). We store **one edge per activation**, qualifiers carrying side, planet,
line. "Who has gate 34" is a `DISTINCT subject_id` query; "how is it activated"
is the same rows unaggregated. Completeness beats pre-aggregation, and the
deterministic edge id (below) makes duplicates structurally impossible.

## Storage: typed edge table, not views

Two candidate shapes:

**A. Materialized views over the existing tables.** The payloads already exist
in `human_design_cache.payload_json` etc, so in principle SQL views with
`json_each` could project edges at read time with zero new writes.

**B. One typed edge table,** written by an explicit extraction pass, rebuilt
when a source payload changes.

We pick **B**. The argument:

- D1 is SQLite: there are no true materialized views, only ordinary views that
  re-execute on every read. Option A means every graph query re-parses multiple
  JSON blobs with nested `json_each` trees. That is the expensive path on the
  hot loop (Eliza tool calls inside a chat turn) to save writes on the cold path
  (a member's chart changed, which effectively happens once).
- The view SQL would couple the query layer to the *internal shape* of five
  different engine payloads. When a payload shape evolves, a 200-line view
  breaks silently at read time. An extraction function breaks loudly in a unit
  test at write time, which is where we want it.
- Cross-payload queries ("shared traits between a and b across HD *and* astro")
  are one indexed self-join on an edge table, and something close to
  unwriteable as a composed json_each view.
- The table gives us a place to hang provenance (`source`, `inputs_hash`,
  `computed_at`) per edge, which the every-fact-traces rule requires anyway.

Staleness handling reuses the convergence pattern: the extraction pass stores
the source payload's `inputs_hash` on every edge; the rebuild entrypoint
compares the current payload hash against the stored edges' hash and rebuilds
only that (subject, source) slice when they differ. Rebuild is delete-then-
insert inside a batch, so readers never see a half-written slice.

Migration: `0009_circle_graph.sql`. One table, `graph_edges`, plus three
indexes shaped for exactly the three query families below. Idempotent,
additive, touches nothing else.

## How Eliza queries it

Three new tools (phase 2, alongside the wiring), all going through `scope.ts`
like every existing tool, access control in code, never in the prompt:

- **`get_graph_neighborhood(member)`** — every edge whose subject (or pair
  object) is this member, grouped by predicate. Scope: member must resolve via
  `resolveMember` + `assertTargetReadable` in the active circle. This is her
  one-call answer to "tell me about ada's wiring."
- **`get_shared_traits(a, b)`** — the intersection: trait objects both members
  have edges to (same gate, same defined center, same placement sign...), plus
  the pair edges between them (aspects, later intertype/electromagnetic). One
  indexed join: `e1.object_id = e2.object_id AND e1.predicate = e2.predicate`.
  Feeds "you two should talk about X."
- **`find_members_with(trait)`** — "who else has gate 34 / an open Solar
  Plexus / Sun in Leo": `SELECT DISTINCT subject_id WHERE predicate = ? AND
  object_id = ?`, then **filtered through `circleMembers`** so only co-members
  of the active circle ever come back. The membership join is the security
  boundary; the tests for phase 2 must assert a non-member with the same gate is
  never returned.

Results are compact token lists, not payload dumps, so a graph tool call costs
a fraction of a `get_human_design` call in tokens. The no-fact-without-a-tool
rule already covers these: a graph tool result IS the receipt.

## Journal themes: consent-gated, deferred

Journal themes would be genuinely valuable edges ("three people journaled about
sleep this month") and genuinely dangerous ones. The rules, decided now so the
schema and consent flags exist before any code does:

1. Theme extraction reads **shared** entries only, through
   `searchSharedJournal`, inheriting the structural personal-entry guarantee.
2. Even for shared entries, a `journal_theme` edge is written only for members
   with an explicit opt-in flag (`graph_settings.journal_themes_consent`,
   per-member, default OFF).
3. Theme edges **never surface in the groupchat**, regardless of consent flags,
   unless the member has a *second* explicit flag
   (`journal_themes_groupchat_consent`, default OFF). Web-app Eliza and
   groupchat Eliza have different blast radii; consent is per-surface.
4. Theme tokens come from a closed vocabulary matcher (deterministic), not from
   an LLM read of the entry. No closed vocabulary, no edge.

None of this ships in phase 1 or 2. It is documented so nobody bolts it on
later without the consent architecture.

## The groupchat surface (phase 2, design only)

### Transport

A **Discord gateway sidecar**, same operational pattern as the astro sidecar: a
small managed Node process, holding the bot's gateway
connection (passive listening requires a gateway; Workers-side interaction
webhooks only get slash commands, which cannot do proactive weaving or
should_respond over ambient conversation). The sidecar is deliberately thin: it
forwards messages to the API (`POST /internal/eliza/discord`, bearer-authed
like ASTRO_BEARER) and posts replies back. All logic, scope, and state stay in
the Worker + D1. The sidecar holds no data and makes no decisions.

### Identity: linking Discord ids to members

New table `discord_links(discord_user_id PK, user_id, linked_at)` plus
`discord_channels(channel_id PK, constellation_id, added_by, added_at)`.

Link flow: a signed-in member generates a short-lived one-time code in the web
app (passkey session, so the link inherits real auth). They DM the bot
`/link <code>`; the sidecar forwards it; the API burns the code and writes the
row. A Discord link **never grants login**, it only resolves an actor for
scope. Unlinking is one delete, from the web app.

Channel binding: a constellation admin binds a channel to exactly ONE
constellation. Every message in that channel resolves to
`ScopeCtx { actorUserId: linked user, constellationId: bound circle }`, and
every tool call flows through the existing scope layer unchanged. An unlinked
speaker gets no actor: Eliza can be addressed by them, but member-data tools
deny, and her only useful answer is how to link. No linked actor, no data. The
prompt is never the mechanism; this is the same rule wearing a Discord skin.

### should_respond for proactive weaving

The existing gate (addressed / scheduled / notable) extends with a **proactive
lane** with strict discipline. She is a member of the house, not a notification
system.

Reactive (unchanged): addressed by name, direct question in a pair. Quiet
default for human banter.

Proactive triggers, all deterministic, all graph- or transit-backed:
- **transit-timed nudge:** a transit crosses a natal point that the graph shows
  two+ members share, and the daily reflection setting is on.
- **shared-trait surfacing:** a new member's data lands and the graph shows a
  high-weight shared edge with an existing member.
- **weave suggestion:** a `get_shared_traits` intersection above a strength
  threshold that has never been surfaced before.

Anti-spam rules, enforced in code, in this order:

1. **Latest-human-edge wins.** Before sending, re-check the channel's newest
   message id against the one composition started from. If a human spoke in
   between, the proactive message is dropped, not queued. Humans steer; she
   yields.
2. **One message per turn, ever.** No follow-ups, no triple-tap, no threads of
   her own making.
3. **Budget: one proactive message per circle per day** (default, admin
   adjustable down to zero), respecting the existing `quiet_hours_json`.
4. **Dedupe forever:** a `weave_log(constellation_id, weave_key, sent_at)` row
   per surfaced weave, keyed by the deterministic content that triggered it
   (e.g. `shared:channel:20-34:u_a:u_b`). A weave surfaces once. Repetition is
   how a member becomes a bot.
5. **Relationship context gates the framing.** P1's pair context is an edge in
   the graph; proactive prose about a pair must pass through the same
   de-romanticized framing rules. Household framing is explicitly selected.
6. **Journal themes never appear**, per the consent section above.

Green for P2 overall stays what the charter says: Eliza live in a consenting test
groupchat, graph queryable, at least one real proactive weave that lands. The
discipline above is what makes "lands" mean *welcome*, not tolerated.

## Phase plan

- **Phase 1 (this lane, shipped):** migration `0009_circle_graph.sql`, pure
  extraction pass in `apps/api/src/lib/graph/extract.ts` (HD gates/channels/
  centers/type/authority/profile, natal placements, synastry aspects), D1 sync
  in `apps/api/src/lib/graph/sync.ts`, unit tests in
  `apps/api/test/graph-extract.test.ts`. No routes, no Discord, no behavior
  change anywhere.
- **Phase 2 (after product review):** graph tools + scope tests,
  rebuild hooks on the write paths of the source caches, Discord sidecar +
  link/bind flow + proactive gate, convergence/intertype/electromagnetic/
  relationship-context edges.
- **Phase 3 (needs its own consent pass):** journal themes, house-level
  aggregates for P3's house weather.
