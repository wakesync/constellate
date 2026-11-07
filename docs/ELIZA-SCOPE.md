# Eliza scope + consent model

This app holds people's birth data and private journals. A leak here is
unforgivable. Eliza is an agent that reads that data to answer questions. Her
access is bounded, in code, by `apps/api/src/lib/eliza/scope.ts`. This document
states the model plainly and records the tests that assert it.

## The one principle

**Access control lives in the tools, never in the prompt.** A prompt is not an
access-control mechanism. Every tool that touches a person's data goes through
`scope.ts`, which enforces the rules below regardless of what the model asks for.

## The rules

Every tool runs with an explicit context:

- `actorUserId` — the person asking. All reads are performed on their behalf.
- `constellationId` — the ONE active circle. Every read is bound to it.

1. **The actor must be a member of the active constellation.** Enforced before
   any tool returns data (`assertActorInCircle`), and again defensively inside
   each data tool. A non-member gets nothing.

2. **A member's typology is readable only if they are a member of the active
   circle.** `assertTargetReadable` requires the target to be in
   `constellationId` (or to be the actor themselves). This is the strict form of
   the check `/synastry/:other_user_id` already performs (`sharesConstellation`),
   tightened to the single active circle so data can never cross circles.

3. **Personal journal entries are private, full stop.** `searchSharedJournal`
   pins `constellation_id` to the active circle AND requires it be non-null.
   There is no code path that reads an entry with a NULL `constellation_id`. A
   personal entry can never match a non-null bound value, so it is structurally
   impossible for a personal entry to be returned, regardless of who is asking or
   whose entry it is. The author filter still only searches shared entries.

4. **No non-member data, ever.** `resolveMember` resolves a reference (id or
   display name) only to a member of the active circle; it returns `null` for
   anyone else and never guesses. A non-member reference simply cannot be turned
   into a readable target.

5. **No cross-constellation leakage.** Because every read is bound to the single
   active `constellationId`, and membership is re-checked per read, a member of
   circle A operating in circle A can never surface circle B data, and the same
   actor cannot act inside circle B at all.

## Denials are not data

When a tool denies access it returns `{ denied: true, reason }`, surfaced to the
model as a refusal. The system prompt instructs eliza not to explain the security
model or hint at what the data might be. She simply cannot see it.

## Tests

`apps/api/test/eliza-scope.test.ts` runs the REAL `scope.ts` logic against an
in-memory D1 fake seeded with two circles (A: alice+rowan, B: bob+carol),
including personal (NULL constellation) journal entries and a B-only shared entry.

Run: `npx tsx apps/api/test/eliza-scope.test.ts`

Asserted:

- personal entries are never returned by search (direct or with an author filter)
- a circle-B shared entry never leaks into a circle-A search
- alice cannot read non-member bob's typology (throws `ScopeError`)
- alice CAN read co-member rowan and herself
- alice cannot act inside circle B (actor gate, target read, and journal search
  all throw)
- `resolveMember` never resolves a non-member (by name or id)
- `circleMembers` returns only the active circle's members

**Result: 17/17 checks passed.**

The dry-run harness (`eliza-dryrun.test.ts`) additionally proves, end to end
through the agent loop, that a personal entry never appears in an answer to the
killer question, and that missing/absent data degrades to a stated
unavailability rather than an invented fact.

**Result: all asserts passed.**
