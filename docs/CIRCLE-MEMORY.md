# Circle memory: a permissioned knowledge graph (Cognee)

Each circle builds a small knowledge graph so the second reading about you and
a friend knows what the first one surfaced, without anyone exposing more than
they approved.

```
CircleMember --authored--> ApprovedSummary --about--> CircleTheme
CircleReading --between--> CircleMember (x2)
              --surfaced--> CircleTheme
              --drew_on---> ApprovedSummary   (provenance)
```

## Rules (enforced by both backends, covered by tests)

1. **Only approved content enters.** A summary is added only after Membrane
   confirmed the share active. Private readings, chats and charts are never
   written. A reading contributes only labels from a closed theme vocabulary
   (communication, emotional needs, conflict and drive, ...) plus which
   approved shares it drew on. Its text is never stored. A reading can only be
   recorded if both members have an active approved share in the circle and
   every source is one of them.
2. **Revoke removes.** Revoking a share drops that summary, every reading that
   drew on it or involved that member, and themes left orphaned. Account
   deletion does the same in every circle. The graph drop runs before the
   remote Membrane revoke, so derived themes stop being usable even if the
   remote revoke has to be retried.
3. **Memory across runs.** `priorThemes(circle, a, b)` returns themes earlier
   readings for that pair surfaced, most recurring first. `/interact` passes
   them to the agents as `priorCircleThemes`, records the new reading's themes,
   and returns `{memory: {priorThemes, themes}}`. Distilled models are trained
   on the same field (docs/OWN-THE-MODEL.md).
4. **Reads follow grants.** `GET /api/circles/:id/memory` is member-only; other
   members' summary text is never returned, only their themes.

## Backends

- `server/src/circle-graph.ts`: `createSqliteCircleGraph`, pure TS on the app's
  SQLite. Default, offline, used by tests.
- `membrane/app/circle_graph.py`: the Cognee backend, running self-hosted inside
  the Membrane enclave (`pip install cognee`). Nodes are Cognee DataPoints
  written with Cognee's low-level `add_data_points`, empty `index_fields`, so
  no LLM or embedding call is made and nothing leaves the enclave. The enclave
  enforces the rules itself: the summary route takes a **share id, not text**
  and reads the text from Membrane's exact-share table only if the caller owns
  that share in this circle; every read first purges summaries whose share is
  gone, so revoking through `DELETE /shares/{id}` alone is enough; prior themes
  are answered only to a member of the pair.
- `server/src/circle-graph-cognee.ts`: the app-side adapter for the Cognee
  routes, same HMAC identity and attested transport as `membrane-remote.ts`.

Routes on the Membrane service:

| Route | Who | Effect |
| --- | --- | --- |
| `POST /circle-graph/{ctx}/summaries {share_id}` | share owner | add approved summary (text read from the share) |
| `POST /circle-graph/{ctx}/readings {reading_id,pair,themes,sources}` | pair member | record themes + provenance |
| `GET /circle-graph/{ctx}/prior-themes?a=&b=` | pair member | themes from earlier readings |
| `GET /circle-graph/{ctx}` | circle member with a grant | snapshot, text only for readable shares |
| `DELETE /circle-graph/{ctx}/members/{m}` | that member | drop the member and everything derived |

Tests: `server/test/circle-graph.test.ts` (SQLite backend + HTTP API + adapter)
and `membrane/tests/circle_graph_test.py` (real Cognee, skipped if not installed).
