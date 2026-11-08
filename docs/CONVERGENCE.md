# Constellate: the Convergence Engine

Phase 1 of the plan of record. Five typology engines describe one person in five
private vocabularies. Five separate readings is a horoscope buffet. The product
is where they **agree** (evidence, triangulation) and where they **disagree**
(the interesting part, surfaced as uncomfortable questions, not verdicts).

Everything scored here is **deterministic code with unit tests**. No LLM finds
"themes". An LLM freeforming common threads would flatter the user and hallucinate
agreement. The LLM only writes prose OVER an already-scored result.

Migration: `0007_convergence.sql`. Code: `apps/api/src/lib/convergence/**`.
API: `GET /me/convergence`, `GET /me/convergence/reading`, `GET /convergence/pair/:id`.
Web: `apps/web/src/routes/Convergence.tsx` at `/app/convergence`.
Tests: `apps/api/test/convergence.test.ts` (run: `npx tsx apps/api/test/convergence.test.ts`).

---

## 1. The trait space (`lib/convergence/axes.ts`)

12 bounded axes. Each is a spectrum from a negative pole (-1) through neutral (0)
to a positive pole (+1). Poles are **non-judgmental**: this is self-knowledge,
not a scorecard. An axis earns its place only if **at least two engines** can
speak to it (otherwise it can never converge or tense with anything).

| id | label | negative pole (-1) | positive pole (+1) |
|---|---|---|---|
| `initiation` | initiation and response | responsive | initiating |
| `recognition` | recognition | self-contained | needs to be seen |
| `authority_locus` | where your yes lives | outer or heady | inner or gut |
| `emotional_tempo` | emotional tempo | steady in the moment | moves in waves |
| `structure` | structure and improvisation | improvises | builds structure |
| `conflict` | conflict posture | avoids and smooths | meets it head on |
| `energy` | energy sustainability | paces and conserves | renewable engine |
| `sensitivity` | sensitivity to environment | insulated | porous |
| `time_orientation` | time orientation | present and immediate | future and unfolding |
| `self_narrative` | the story you tell about yourself | settled | prone to distortion |
| `head_heart` | head and heart | leads with logic | leads with feeling |
| `abstraction` | abstraction and the concrete | grounded in the concrete | drawn to the abstract |

**Changes from the plan's starting proposal, with rationale:**
- Added `head_heart` and `abstraction`. Socionics gives clean, high-signal reads
  on logic-vs-ethics and intuition-vs-sensing; enneagram and astro echo them.
  Without these axes, socionics' two strongest statements had nowhere to land.
- Kept `self_narrative` even though it is one of the weaker-coverage axes, because
  it is the enneagram's whole thesis (a type is a fixation) and the one place
  gene keys is allowed to speak. It is where the systems are *about* distortion.
- Dropped no proposed axis outright; folded "inner authority locus" into
  `authority_locus` and kept `time_orientation` narrow (socionics Ni/Se + a light
  astro modality read) rather than stretching astro's Saturn/Uranus claims.

Every signal a mapper emits is `{ axis, value: -1..1, weight: 0..1, evidence }`,
built through `makeSignal()` which clamps value/weight and **refuses any signal
without evidence**. No claim without a receipt.

---

## 2. The mappers (`lib/convergence/mappers/*.ts`)

Weight philosophy: a discrete mechanical fact (a defined sacral) speaks loudly;
a self-report instrument speaks a notch quieter and is scaled by its own
confidence; sun-sign psychology whispers. Getting weights honest matters more
than covering every axis. **If an engine genuinely says nothing about an axis, it
emits nothing.** We never manufacture coverage.

Below: every mapping rule, its axis, sign, weight, and a one-line rationale.

### Human Design (the strongest, most mechanical mapper)
| rule | axis | value | weight | rationale |
|---|---|---|---|---|
| Manifestor type | initiation | +0.9 | 0.8 | manifestor is defined by initiating |
| Generator/MG type | initiation | -0.75 | 0.85 | generator is defined by responding |
| Projector type | initiation | -0.7 | 0.7 | waits for the invitation |
| Reflector type | initiation | -0.8 | 0.6 | lunar, deeply responsive |
| Sacral defined | initiation | -0.7 | 0.9 | a defined sacral answers, never launches; HD's single strongest initiation statement |
| Sacral defined | energy | +0.85 | 0.9 | the sacral is a renewable life-force engine |
| Sacral open | energy | -0.7 | 0.75 | not built for relentless output |
| Authority = Sacral | authority_locus | +0.85 | 0.85 | the yes is a gut response in the body |
| Authority = Splenic | authority_locus | +0.8 | 0.8 | instinctive knowing in the body, in the now |
| Authority = Emotional | authority_locus | +0.55 | 0.7 | inner, but arrives as a wave |
| Authority = Emotional | emotional_tempo | +0.85 | 0.85 | clarity comes after the wave |
| Authority = Ego/Heart | authority_locus | +0.5 | 0.55 | knows by what it wills |
| Authority = Self-Projected | authority_locus | -0.3 | 0.5 | truth heard by speaking aloud, partly third-party |
| Authority = Mental/Lunar | authority_locus | -0.7 | 0.7 | decided across time / talking through, not inner-fixed |
| Solar Plexus defined | emotional_tempo | +0.8 | 0.85 | emotion moves in self-generated waves |
| Solar Plexus open | emotional_tempo | -0.4 | 0.55 | takes in emotion, moves through rather than swells |
| Solar Plexus open | sensitivity | +0.7 | 0.7 | porous to the room's emotional weather |
| >= 5 open centers | sensitivity | +0.8 | 0.8 | deeply porous; weight scales with open count |
| 3-4 open centers | sensitivity | +0.45 | 0.6 | takes in a fair amount unfiltered |
| <= 1 open center | sensitivity | -0.5 | 0.55 | insulated |
| Heart defined | conflict | +0.4 | 0.45 | steady will to hold a line (modest: HD is not a conflict system) |
| Single definition | structure | +0.35 | 0.4 | one self-contained connected whole |
| Split definition | structure | -0.3 | 0.4 | looks to others to bridge, stays open |

### Enneagram (motivational; self-report, so scaled by ambiguity)
Every result scales its signals by 0.55 when the top type is a near-tie
(`ambiguous`), else 1.0. The enneagram **always** emits `self_narrative` (+0.5 @
0.55): a type *is* a fixation, a fixed filtering story. That is the axis the
whole system is about.

Per-primary-type rules (abbreviated; full evidence strings in the mapper):
- **1**: structure +0.6@0.6, conflict +0.35@0.4, head_heart -0.3@0.35
- **2**: recognition +0.7@0.7, head_heart +0.6@0.6, conflict -0.4@0.4
- **3**: recognition +0.85@0.8, initiation +0.6@0.55, structure +0.4@0.4
- **4**: recognition +0.6@0.6, emotional_tempo +0.6@0.6, head_heart +0.75@0.7, self_narrative +0.7@0.6
- **5**: recognition -0.6@0.6, head_heart -0.6@0.6, sensitivity +0.3@0.4, abstraction +0.5@0.5
- **6**: structure +0.4@0.45, self_narrative +0.6@0.55, head_heart -0.4@0.45
- **7**: time_orientation +0.6@0.55, abstraction +0.55@0.5, conflict -0.3@0.35, initiation +0.5@0.45
- **8**: conflict +0.85@0.8, initiation +0.7@0.6, head_heart -0.4@0.4
- **9**: conflict -0.8@0.75, initiation -0.5@0.5, energy -0.3@0.35

Rationale: each is the type's textbook core motivation mapped to the nearest
axis. Centers (Head/Heart/Body) provide a head_heart backstop only when a
per-type rule did not already set it, to avoid double-counting.

### Socionics (clean dichotomies; scaled by confidence AND magnitude)
Dichotomies are 0..1; `spread(d) = (d-0.5)*2` maps to -1..1. Weight folds in the
result's `confidence` and how far the dichotomy sits from neutral (a strongly
expressed dichotomy speaks louder than a coin-flip one).
| source | axis | mapping | base weight | rationale |
|---|---|---|---|---|
| extraversion | initiation | spread(E) | 0.55 | directing energy outward = initiating |
| extraversion | recognition | spread(E) | 0.3 | outward orientation, lightly |
| logic (T/F) | head_heart | spread(1 - logic) | 0.7 | **sign flips**: our axis is +feeling, high logic = negative |
| intuition (N/S) | abstraction | spread(N) | 0.7 | intuition = abstract/possibilities |
| irrationality | structure | spread(1 - irr) | 0.55 | **sign flips**: rational lead = +structure |
| base = Ni | time_orientation | +0.85 | 0.6*conf | intuition of time, the long unfolding view |
| base = Se | time_orientation | -0.7 | 0.6*conf | force in the present |
| base = Si | time_orientation | -0.5 | 0.6*conf | body's read of the present moment |
| base = Si | sensitivity | +0.4 | 0.6*conf | reads the room through comfort/texture |
| base = Se | energy | +0.4 | 0.6*conf | active forceful presence |

### Astro (deliberately the weakest; all weights <= 0.25)
Sun-sign psychology is thin, and **without a birth time there are no houses and
no ascendant**, so a chart can be almost mute. We emit only element/modality
reads (the least contested part of the tradition) at low weight.
| source | axis | value | weight | rationale |
|---|---|---|---|---|
| water sun | head_heart | +0.45 | 0.25 | water = feeling-led (traditional) |
| water sun | sensitivity | +0.4 | 0.25 | water = most porous |
| air sun | head_heart | -0.35 | 0.2 | air = mental distance |
| air sun | abstraction | +0.35 | 0.22 | air = ideas/concepts |
| fire sun | initiation | +0.4 | 0.25 | fire = quick to move |
| earth sun | abstraction | -0.35 | 0.22 | earth = grounded/practical |
| cardinal sun | initiation | +0.35 | 0.22 | cardinal = starting impulse |
| fixed sun | structure | +0.35 | 0.2 | fixed = holds shape |
| mutable sun | structure | -0.3 | 0.2 | mutable = adaptable |
| fire mars | conflict | +0.4 | 0.25 | direct with friction |
| water mars | conflict | -0.35 | 0.22 | moves around conflict |

### Gene Keys (intentionally the most restricted)
Gene Keys is derived from the **same gate activations as Human Design**. It is
not an independent measurement; it is a second lens on the same data. If it
echoed HD's claims it would fake a fifth independent voice and inflate every
HD-driven convergence. So Gene Keys is restricted to the **one** thing HD does
not say: the Shadow framing.
| source | axis | value | weight | rationale |
|---|---|---|---|---|
| Life's Work shadow | self_narrative | +0.35 | 0.35 | the prime named contraction pattern; a fixed story to catch |
| Evolution shadow | self_narrative | +0.3 | 0.25 | secondary named pattern, reinforces only |

It emits **nothing** on the mechanical axes (initiation, energy, authority) that
are pure HD territory.

---

## 3. Scoring (`lib/convergence/score.ts`)

Pure, deterministic. Same signals in, byte-identical result out (unit-tested,
including signal-order invariance).

**Per source collapse.** For each axis, each source is collapsed to its single
highest-weight signal (`collapsePerSource`), so a chatty mapper cannot outvote a
quiet one by sheer volume.

**Deadzone.** A signal only "leans" if `|value| > 0.12`. Near-zero is genuinely
neutral and counts toward neither side.

**Convergence.** For a sign (+ or -), require **>= 3 distinct sources** leaning
that way. Compute the weight-centroid; keep only members within `AGREE_BAND`
(0.6) of it (drop stragglers that share a sign but disagree in magnitude); require
>= 3 still. Strength:
```
sourceBonus = min(1, (nSources - 2) / 3)      # 3 src -> 0.33, 5 src -> 1
strength    = min(1, meanWeight*(0.6 + 0.4*sourceBonus) + 0.15*sourceBonus)
```
Four systems agreeing outranks two agreeing hard, exactly as the spec demands.
Ranked by strength, then source count, then fixed axis order (determinism).

**Tension.** The strongest positive-leaning vs strongest negative-leaning signal
on an axis, **both above the weight floor** `TENSION_MIN_WEIGHT` (0.35). Two
whispers in opposite directions are not a real tension. Strength:
```
strength = min(1, wPos * wNeg * (separation/2) * 2.2)   # separation = |vPos - vNeg|, 0..2
```
One tension per axis (the sharpest opposition). Each carries a templated
**question**, not a verdict (see below). Ranked by strength, then axis order.

**Coverage.** `coverage[source] = true` iff that source produced any signal. When
only 1-2 engines have data, no convergence can form (needs >= 3 sources), and the
UI reads `coverage` to say so plainly instead of dressing thin data as insight.

### The tension question
Each axis has a short, deliberately uncomfortable, not-glibly-answerable question
(`TENSION_QUESTIONS`). The deterministic default ships with the API so it is
complete without the LLM; the reading prompt is allowed to sharpen it. Example
(`conflict`): *"when it matters most, do you press or do you smooth. and who
taught you that."*

---

## 4. Cache invalidation design

`inputsHash(payloads)` = FNV-1a 32-bit over a **stable-stringified** (sorted-key)
concatenation of the five source payloads. The convergence result is a pure
function of those payloads, so:

- `convergence_cache(user_id PK, payload_json, computed_at, inputs_hash)`.
- On read, recompute the hash of the *current* source payloads. If it matches the
  cached `inputs_hash`, serve the cache. If not, a source engine changed:
  recompute, overwrite, and **delete the stale `readings_cache` row** (kind
  `convergence`) so the prose can never drift from the score.
- The reading endpoint ensures a fresh scored result exists before generating,
  and caches the prose only when the model did not degrade (never persists the
  canned fallback), matching the existing HD/GK/enneagram/socionics pattern.
- Pair cache `convergence_pair_cache(user_a_id, user_b_id, ..., PK(a,b))` with
  canonical `a < b` ordering, hashed over both members' payloads so it
  invalidates when either person's engines change.

This is the thing that silently rots if done lazily. It is done properly: the
hash is cheap, the invalidation is correct by construction, and prose is bound to
its score.

---

## 5. API

- `GET /me/convergence` -> the scored `ConvergenceResult` (convergences, tensions,
  coverage, axes_touched, computed_at).
- `GET /me/convergence/reading` -> LLM prose over the scored result (never over
  raw engine payloads). Prompt: `apps/api/src/prompts/convergence.ts`
  (`convergenceReadingSystemPrompt`). Reuses `narrative.ts`, rate limiting
  (`RULES.narrative`), and D1 `readings_cache`.
  **Note on file format:** the lane brief asked for `convergence-reading.md`. The
  working narrative pipeline (`cachedReading`) consumes a string constant imported
  from a `.ts` prompt module, which is what every other engine's prompt migrated
  to. The prompt therefore lives as `.ts`; its content is exactly what the `.md`
  would have held.
- `GET /convergence/pair/:other_user_id` -> pair convergence + where the two
  people agree/diverge. Mirrors the synastry authz gate exactly: a shared
  constellation is required, else 404 (never confirm the id).

---

## 6. Frontend

`apps/web/src/routes/Convergence.tsx` at `/app/convergence`, added to the
`RecordNav` pill strip (additive; strip stays horizontally scrollable on a 390px
phone, verified). Matches the house style: parchment, serif display, lowercase
headings, italic subcopy, `Card/Shimmer/EmptyState/ErrorState`, framer-motion
fade+rise, `@tanstack/react-query`. No em-dashes.

- **Convergences** show the axis, the direction, and stacked per-system evidence
  so the user SEES several systems pointing the same way (visible triangulation).
- **Tensions** get the visual weight: an oxblood-framed card with the two poles
  opposed and the question underneath.
- **Coverage** is a quiet strip; missing engines link to their record surface.
- Mocks in `lib/mock-api.ts` + types in `lib/types.ts` (additive) render under
  `VITE_USE_MOCK=1`. A `constellate.mock.conv` localStorage flag (`thin`|`error`)
  exercises the thin-coverage and error branches for QA. Mock-only, never in prod.

---

## 7. Test results

`npx tsx apps/api/test/convergence.test.ts` -> **PASS 16/16 checks**. Asserts:
1. Determinism: same input twice = identical output; signal order does not change
   the scored result.
2. A synthetic profile where HD + enneagram + socionics all read *responsive*
   surfaces as an `initiation` convergence (>= 3 sources, negative direction,
   every evidence item carries a receipt).
3. A synthetic profile where enneagram 9 (avoids) opposes an HD defined-will
   (holds a line), both above the weight floor, surfaces as a `conflict` tension
   with genuinely opposed poles and a question.
4. Thin coverage: a single engine cannot manufacture a convergence; coverage is
   reported honestly.
5. `inputs_hash` is stable for identical inputs and changes when a payload changes.

**Playwright QA** at 390x844 and 1440x900 with `VITE_USE_MOCK=1`: loading,
populated, thin-coverage, and error states captured for both viewports.
**Zero console errors.** Record-nav strip does not overflow the 390px body.

Run against the astro service is not required (convergence uses stored payloads).

**Deploy is intentionally NOT run.** To ship:
```
# migration (local first, then remote when the orchestrator says go)
cd apps/api && npx wrangler d1 migrations apply constellate-prod --local
cd apps/api && npx wrangler d1 migrations apply constellate-prod --remote
cd apps/api && npx wrangler deploy
cd apps/web && npm run build && npx wrangler deploy
```

---

## 8. What is weakly justified (read this before trusting a result)

Be honest about thin coverage and soft mappings. In order of how much they should
worry you:

1. **Gene Keys is not an independent voice.** It is derived from the same gate
   activations as HD. We restricted it to Shadow-only `self_narrative` signals to
   stop it inflating HD-driven convergences, but even those two shadow signals are
   downstream of the same birth data HD uses. Treat `gene_keys` in a convergence's
   source list as "half a source" conceptually. It never touches a mechanical axis.

2. **Astro without a birth time is nearly mute, and even with one it is thin.**
   All astro weights are <= 0.25 on purpose. Sun-sign element/modality psychology
   is the softest content in the whole engine. An astro-only lean should never
   drive anything; it can only reinforce. We do **not** currently read houses,
   ascendant, or aspects into the trait space at all (future work), so astro's
   contribution is deliberately shallow.

3. **Enneagram and socionics are self-report instruments.** We scale enneagram by
   its ambiguity flag and socionics by its confidence, but a wrong type-out
   produces confidently wrong signals. The scorer's per-source collapse and the
   >= 3-source convergence bar limit the blast radius, but a bad quiz is a bad
   quiz.

4. **The `self_narrative` axis is more interpretive than measured.** It leans on
   the enneagram's "type = fixation" premise and gene keys' Shadow names, neither
   of which is a graded measurement of distortion. It is meaningful but not
   quantitative; read its convergences as "these systems name a fixed story," not
   "your distortion level is X."

5. **Axis coverage is uneven.** `initiation`, `sensitivity`, `head_heart`, and
   `conflict` are richly triangulated. `recognition`, `time_orientation`, and
   `energy` are covered by fewer engines and will surface convergences less often,
   which is correct: absence of a convergence there is thin coverage, not
   disagreement.

6. **Pair convergence is a first cut.** `/convergence/pair` reports where each
   person's individual convergences point the same or opposite way. It does not
   yet model interaction (a responsive person and an initiating person may be a
   good fit, not a "divergence"). The individual engine is the moat; the pair view
   is a useful but shallower derivative for now.

The honest one-line summary: **HD carries the mechanical axes, socionics carries
the cognitive ones, enneagram carries motivation and fixation, astro whispers, and
gene keys is a careful half-voice.** A convergence with HD + enneagram + socionics
all present is trustworthy. A "convergence" that leans on astro + gene_keys doing
the heavy lifting should be read with suspicion, and the weights are set so that
rarely happens.

---

## 9. Pair harmony (`lib/convergence/harmony.ts`)

One deterministic headline number per pair, derived entirely from the two
members' already-scored convergence results. Pure function, unit-tested
(`test/harmony.test.ts`, includes determinism + symmetry), no LLM anywhere near
the number. Surfaced on pair cards, the synastry header, the convergence page,
and the circle graph edges (`GET /harmony/pair/:id`,
`/convergence/pair/:id` rides it along, `/constellations/:id/graph` carries a
compact form per edge).

### Formula

For every axis where BOTH members have a convergence (each of which already
required >= 3 independent engines, by construction of the scorer):

```
srcNorm   = min(engines_a, engines_b) <= 3 ? 3 : 4       # reachable-source ceiling
srcMult   = min(1, min(|sources_a|, |sources_b|) / srcNorm)
w         = sqrt(strength_a * strength_b) * srcMult      # symmetric evidence weight
same sign:  agreement contribution = w * (1 - |v_a - v_b| / 2)
opposite:   contrast mass = w * (|v_a - v_b| / 2), split equally
            across agreeW/tensionW (score-neutral, confidence-bearing)

agreeW    = sum(agreement contributions) + half unsigned contrast
tensionW  = sum(signed tension contributions) + half unsigned contrast
raw        = agreeW / (agreeW + tensionW)                # 0..1 balance
confidence = min(1, (agreeW + tensionW) / 1.2)           # shared evidence mass
score      = round(100 * (0.5 + (raw - 0.5) * confidence))
```

Bands: 78+ `in step`, 62-77 `fair weather`, 48-61 `mixed sky`, 34-47
`crosswinds`, <34 `charged`.

### Design decisions

1. **Only convergences feed the number.** A convergence is already triangulated
   (>= 3 engines), so harmony is triangulation about triangulation; a single
   loud quiz answer cannot move it.
2. **Thin data shrinks toward 50, honestly.** `confidence` scales the deviation
   from the midpoint, so a pair with one weak shared axis reads "mixed sky"
   with low confidence, and zero shared axes returns `null`, never a number.
3. **Symmetric by construction.** `sqrt(strength_a * strength_b)` and the
   axis-set intersection are order-independent; the tests assert
   `harmony(a,b) == harmony(b,a)`.
4. **Contrast is weather, not incompatibility.** Opposite leans (a responder
   and an initiator) are often complementary, and there is no validated table
   assigning compatibility valence to these invented cross-system axes. Their
   contrast mass is therefore split equally around neutral: it raises confidence
   and remains visible in the tension receipt, but cannot lower the score by
   itself. Only mechanics with defensible source-system valence may do that.
   The bands remain weather words, never compatibility verdicts.
5. **The relationship lens picks the framing WORD only** (`harmonyFraming`):
   roommates get "house harmony", collaborators "working harmony", everyone
   else plain "harmony". Romantic pairs get NO special percent framing; this is
   explicitly not a compatibility score.
6. Inherits section 8's caveats wholesale: harmony over convergences that lean
   on astro/gene-keys coverage is as soft as those convergences are.

## 10. The mechanical pair layer (`lib/pair/`, 2026-07-30)

Beyond the axis comparison, every engine that can produce DEFENSIBLE pair-level
facts now does, deterministically. The product surface stays one reading per
pair; these are evidence sources, not features.

### What each engine contributes

- **Human Design connection chart** (`lib/pair/hdConnection.ts`). Overlay of
  two bodygraphs over the 36-channel table (ported from `services/astro/hd.py`,
  same verified source lineage). Every channel present in the overlay is
  classified:
  - `electromagnetic`: each person carries one gate; the channel exists only
    together (spark / charge; canon reads it as attraction AND friction).
  - `companionship`: both carry the full channel (shared ground, stability).
  - `dominance`: one has the full channel, the other has neither gate
    (transmission; the open party receives it whole). Directional.
  - `compromise`: one full channel vs. the other's single gate; the full side
    always overrides (the classic friction class). Directional.
  Plus composite definition (centers defined only together) and the
  conditioning map (whose definition floods whose open centers).
- **Gene Keys** (`lib/pair/geneKeysPair.ts`): wheel geometry ONLY.
  Programming-partner axes (opposite gate on the Rave wheel, index+32 mod 64;
  spot-checked 1<->2, 4<->49) between the two activation sequences, and shared
  activation keys with both sphere positions. There is NO canonical cross-key
  "A's shadow hits B's gift" table, so none is fabricated: a shared key IS the
  shared spectrum, and that is what we expose.
- **Socionics** (`lib/pair/socEnnPair.ts`): the intertype relation from the
  machine-verified 16x16 matrix in `lib/socionics.ts` (sources cited there).
  Directional for Benefit and Supervision, read from A toward B.
- **Enneagram**: raw pair facts only. Type, wing, and same/different on the
  three canonical groupings (centers 8-9-1/2-3-4/5-6-7; harmonic groups
  1-3-5/2-7-9/4-6-8; hornevian groups 3-7-8/1-2-6/4-5-9, the published typology references). There
  is no defensible enneagram pair-dynamics table, so NO relationship label is
  derived and enneagram moves the harmony number by exactly zero.

### Harmony fold-in (`pairEvidence`)

Only facts with defensible valence in their own canon move the number, at
small fixed weights, capped per engine so mechanics can never swamp the
triangulated axes:

```
HD (one item per signed class): companionship present +0.10, compromise
  present -0.12. Multiple channels in one overlay are correlated observations
  from the same bodygraph, not independent votes, so channel count is retained
  in mechanics/narrative but cannot stack score mass. Electromagnetic +
  dominance carry no sign (canon: they cut both ways); they surface as facts.
Gene Keys (cap 0.15):    programming-partner axis +0.05, shared key +0.04.
Socionics (one item):    classic comfort-ordering of the 16 relations,
  Duality +0.30 ... Conflict -0.30 (table in lib/pair/index.ts).
Enneagram:               zero mass, always.
```

The items are added to `agreeW`/`tensionW` before the existing formula runs,
so signed mechanical evidence also raises `confidence`. Mechanical evidence
alone can carry a low-confidence score when no axes are shared yet; zero
signed evidence still returns `null`. Results carry
`mech_agreements`/`mech_tensions` receipts.

### Canonical production assembly

`computePairHarmony` is the only production helper that assembles a harmony
result. It accepts both scored convergence results and both raw engine payload
sets, builds `PairMechanics`, folds `pairEvidence`, and supplies adaptive
`engines_present` counts. The graph endpoint, harmony pair endpoint, and pair
narrative endpoint all call it. This prevents a surface from silently dropping
mechanics or reverting birth-tier pairs to the full-coverage normalizer.

### Narrative

`mechanicsDigest` renders the facts as a compact JSON block with display names
attached and per-class explanatory notes. The synastry and pair-convergence
prompts receive it as `pair_mechanics` with hard rules: describe only what is
present, translate through the relationship lens (electromagnetic between
roommates = household charge, never attraction), honor every note field.

Tests: `test/pair-mechanics.test.ts` (104 checks: all four channel classes,
composite/conditioning, wheel involution, symmetric + directional intertype,
caps, fold-in monotonicity, determinism).

## 11. The birth-data tier (2026-07-30)

Enneagram and socionics are quiz-gated; several members will only ever enter
birth data. The three birth-derived engines (astro, human design, gene keys)
must produce a complete solo + pair experience with zero quiz rows.

### The rule

- **Adaptive triangulation threshold** (`score.ts`): `T = 3` when 4+ engines
  produced any data (classic rule, unchanged); `T = 2` when 3 or fewer did.
  Rationale: demanding 3-of-3 among exactly three engines makes triangulation
  nearly unreachable (astro is deliberately weak and often mute on an axis),
  while 2-of-3 among *present* engines is the same evidentiary posture as
  3-of-5. The strength formula already scores 2-source convergences lower
  (`sourceBonus = (n-2)/3 = 0` at n=2), so thinner triangulation reads weaker,
  honestly. Results carry `engines_present` + `triangulation_threshold` for
  transparency.
- **Absence is absence, never zero.** Absent engines cannot vote, cannot appear
  in sources, and create no penalty axes.
- **Harmony source normalizer adapts** (`harmony.ts`): `srcNorm = 3` when
  `min(engines_a, engines_b) <= 3`, else 4. A 3-of-3 birth convergence then
  multiplies at 1.0 instead of 0.75, and 2-of-3 at ~0.67 instead of 0.5, so a
  well-triangulated birth-only pair is not double-punished for quizzes that
  were never taken. Confidence math itself is untouched: thin evidence still
  shrinks toward 50.
- **Cache**: `SCORER_V` folded into the inputs hash (bumped to 2) so existing
  cached results for quiz-less members recompute under the new rule.
- **Narrative**: solo + pair prompts forbid mentioning absent engines or
  suggesting quizzes. The reading is written entirely from what is present and
  must feel complete.
- **UI**: coverage strip shows present engines only; missing birth engines
  (no chart yet) still link as real gaps; missing quiz engines collapse into
  one quiet "deepen it, if you like" line.
- **Astro mapper widened** (same day): moon (element -> sensitivity/head_heart,
  modality -> emotional_tempo) and mercury (element -> abstraction/head_heart/
  initiation) signals added at the same cautious weights (<= 0.3), because for
  a birth-only member astro is one of only three voices and sun-only left it
  nearly mute. **Birth-tier tension floor**: TENSION_MIN_WEIGHT drops 0.35 ->
  0.2 when <= 3 engines are present, so an astro-vs-HD opposition (the most
  interesting available content for a birth-only member) can register; the
  full-coverage floor is unchanged.

Tests: `test/birth-tier.test.ts` (threshold adaptation, absence semantics,
harmony normalizer + confidence honesty, and a full end-to-end birth-only
person through the real mappers into pair mechanics + harmony + digest).
