# Eliza in the circle

> "eliza is in the group chat and should just be able to do it."

Eliza is a member of a constellation, not a product feature. She answers
questions like *"why do rowan and i keep having the same fight"* by calling
deterministic typology engines as tools and citing real receipts. The
per-system pages become optional; the primary surface is her, inside the circle.

## Architecture

```
POST /constellations/:id/eliza  (membership required, rate limited)
        │
        ▼
  should_respond gate ──(quiet)──► persist user msg, return {eliza: null}
        │ (speak)
        ▼
  runTurn(env, scope, respondCtx, priorMessages)      apps/api/src/lib/eliza/agent.ts
        │
        ├── system prompt ......... apps/api/src/prompts/eliza-system.md (.ts mirror)
        ├── tool-calling loop (Tinfoil, shared productInference seam)
        │     ├── model requests tool calls
        │     ├── each tool runs through scope.ts ..... lib/eliza/scope.ts
        │     │     (access control here, NEVER in the prompt)
        │     └── results (data | unavailable | denied) fed back
        │
        └── final answer, no-fact-without-a-tool enforced
              │
              ▼
        persist eliza msg + tool_trace_json, return reply
```

Frontend: `apps/web/src/components/ElizaThread.tsx`, mounted inside
`routes/ConstellationDetail.tsx`, between the invite card and the shared journal.
Parchment house style: serif, lowercase, `Card`, `Shimmer` while she thinks,
framer-motion fade+rise, `@tanstack/react-query`. Her lines are marked with an
asterism and her name in italic, visually a member speaking, not a chatbot bubble.

## Tools

Registry: `apps/api/src/lib/eliza/tools.ts`. Each tool is deterministic: she
calls it, she never computes the typology herself.

| tool | backing | notes |
|---|---|---|
| `get_circle` | memberships | members + who has which data |
| `get_chart` | astro `/natal` | member natal chart |
| `get_transits` | astro `/transit` | sky vs natal, date optional |
| `get_synastry` | astro `/synastry` | aspect grid between two |
| `get_astrocartography` | astro `/astrocartography` | lines |
| `get_human_design` | astro `/humandesign` (cached) | bodygraph |
| `get_gene_keys` | astro `/genekeys` (cached) | activation sequence |
| `get_enneagram` | `enneagram_results` | quiz result |
| `get_socionics` | `socionics_results` | type + Model A |
| `get_intertype` | `lib/socionics.relationBetween` | socionics relation |
| `get_hd_connection` | computed in-tool | electromagnetic channels between two |
| `get_convergence` | `convergence_cache` (lane 0007) | stubs if absent |
| `get_convergence_pair` | (not built) | stubs as unavailable |
| `search_journal` | `journal_entries` | **shared-only**, see scope doc |

**Graceful degradation is first-class.** A tool whose data or backing endpoint is
absent returns `{ unavailable: true, reason }`, never an error. `get_convergence`
detects a missing `convergence_cache` table and degrades; `get_convergence_pair`
stubs until that lane ships. Eliza then says what is missing and what the person
could do about it.

`get_hd_connection` is computed deterministically from each person's activated
gates against the standard 36-channel map: an electromagnetic connection is a
channel neither holds alone that the two complete together.

## The no-fact-without-a-tool rule

**Eliza may not state a typological fact she did not receive from a tool.** This
is enforced in two places:

1. **System prompt** (`prompts/eliza-system.md`): she is told, plainly, that a
   typological claim requires a tool call this turn, that she never infers an
   authority or guesses a PoLR, and that missing data is stated, not filled in.

2. **The loop** (`agent.ts`): after the model produces a final answer, if the
   text asserts typology (matched against a broad vocabulary of system terms) and
   **no tool ran this turn**, the answer is not shipped as fact. She gets one
   corrective pass to either call the backing tool or answer without asserting
   typology; if she still will not, a hedged refusal is returned instead. False
   positives only make her hedge, which is the safe direction.

The `tool_trace_json` stored with every reply makes each answer auditable against
the receipts it claims.

## Etiquette gate (`should_respond`)

She is a member, not a bot that answers every line. `shouldRespond` runs BEFORE
the loop and speaks only when: addressed (named, or a direct POST to her
endpoint), a scheduled reflection is due, something notable happens, or a bare
question in a two-person circle. Idle human banter in a larger circle → quiet.
One message per turn, no running commentary, no triple-tap.

## Chat surface + data

- Migration `0008_eliza.sql`: `eliza_messages(id, constellation_id, user_id
  NULLABLE, role, body, tool_trace_json, created_at)` + index on
  `(constellation_id, created_at)`; `eliza_settings(constellation_id PK, enabled,
  daily_prompt_enabled, quiet_hours_json)`. Idempotent, 0003/0004 style.
- Routes (additive in `index.ts`):
  - `GET /constellations/:id/eliza` — recent messages (membership required)
  - `POST /constellations/:id/eliza` — `{body}` → her reply (membership, rate
    limited via `RULES.narrative`)
  - `PATCH /constellations/:id/eliza/settings` — creator/admin only
- Mocks in `lib/mock-api.ts` (`elizaMessages`, `elizaSend`) render the surface
  under `VITE_USE_MOCK=1`, including a scripted answer to the killer question.

## Token / cost estimate per turn

One LLM client (the shared attested Tinfoil transport, configured with `TINFOIL_MODEL`). Per turn:
system prompt + short history + up to `MAX_TOOL_CALLS` (6) round-trips, capped by
`MAX_TURN_TOKENS` (~4k). A typical single-tool answer is 1–2 round-trips
(~1.5–3k tokens). The killer question fans out to ~5 tools in one assistant turn,
then one answer turn: ~2 model round-trips, roughly 4–6k tokens total. Tool
outputs (charts, HD graphs) are the bulk of input tokens; typology reads are
cached in D1 so repeated questions do not recompute. Rate limiting is the same
`narrative` bucket used everywhere else.

## Deploy notes

**Do NOT deploy from this lane.** When shipped:

1. Apply migration `0008_eliza.sql` (`wrangler d1 migrations apply
   constellate-prod`).
2. Configure `TINFOIL_MODEL` and `TINFOIL_API_KEY`, `ASTRO_URL`, `ASTRO_BEARER`.
3. `get_convergence` / `get_convergence_pair` degrade until lane 0007's
   `convergence_cache` + pair endpoint exist; no action needed to ship eliza
   first.
4. If `TINFOIL_API_KEY` is unset, `runTurn` returns a quiet in-voice fallback
   rather than failing.

## Files

- `apps/api/migrations/0008_eliza.sql`
- `apps/api/src/lib/eliza/scope.ts` (security; see `docs/ELIZA-SCOPE.md`)
- `apps/api/src/lib/eliza/tools.ts`
- `apps/api/src/lib/eliza/agent.ts`
- `apps/api/src/prompts/eliza-system.md` + `eliza.ts`
- `apps/api/src/index.ts` (3 additive routes)
- `apps/web/src/components/ElizaThread.tsx`
- `apps/web/src/routes/ConstellationDetail.tsx` (additive mount)
- `apps/web/src/lib/{api,mock-api,types}.ts` (additive)
- `apps/api/test/eliza-scope.test.ts`, `apps/api/test/eliza-dryrun.test.ts`
