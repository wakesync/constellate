# Socionics

Full-stack socionics feature for Constellate: Model A (the 8-function stack per
type), the four quadras, the complete 16x16 intertype relation matrix, a resumable
48-to-64 statement questionnaire, an LLM reading, and a parchment-styled React
route at `/app/socionics` whose centerpiece is a hand-drawn inline-SVG Model A
block diagram.

This is deliberately NOT "MBTI with a lowercase last letter". The content that
carries the feature is Model A and the intertype relations, and both are built
from first principles and machine-verified against published tables.

## What was built

### Backend (`apps/api`)
- `src/lib/socionics.ts` — the 8 information elements, the 16 types (base +
  creative + quadra + both naming conventions), the derived Model A stack builder,
  the quadra value profiles, and the full 16x16 relation matrix with asymmetric
  Benefit/Supervision directions. `relationBetween(a, b)` and `dualOf(code)`.
- `src/lib/socionics-quiz.ts` — 56-statement question bank (weights server-only),
  dichotomy + element-preference dual scoring, and the `SocionicsResult` builder.
- `src/prompts/socionics.ts` + `src/prompts/socionics-reading.md` — the reading
  system prompt (`.md` is the source-of-record; `.ts` is what the worker sends,
  matching the codebase's existing prompt pattern).
- `migrations/0006_socionics.sql` — `socionics_answers`, `socionics_results`
  (+ index). The reading is cached in the shared `readings_cache` table under
  `kind='socionics'` (created in 0005), same as enneagram.
- Routes in `src/index.ts` (additive only):
  - `GET  /socionics/questions` -> `{ questions: [{id, text}] }` (no weights)
  - `GET  /me/socionics` -> `{ result, answered, total }`
  - `POST /me/socionics` -> partial saves; scores + returns result on completion
  - `DELETE /me/socionics` -> reset
  - `GET  /me/socionics/reading` -> cached LLM narrative
  - `GET  /socionics/relations/:other_user_id` -> intertype relation between two
    users' types, gated by the same shared-constellation auth check as
    `/synastry/:other_user_id`.

### Frontend (`apps/web`)
- `src/routes/Socionics.tsx` at `/app/socionics` — quiz + result in one route,
  same pattern as `Enneagram.tsx`. @tanstack/react-query, framer-motion fade+rise,
  Card/Shimmer/ErrorState, lowercase serif, no em-dashes, no exclamation marks.
- `src/components/ModelA.tsx` — the centerpiece. Hand-drawn inline SVG, four
  stacked blocks (Ego prominent at top, then Super-Ego, Super-Id, Id quietest),
  two function cells each, every cell showing an element glyph + letters + position
  number + role name. Same inked-on-parchment visual family as `BodyGraph.tsx`
  (oxblood monoline, antique-gold accents, parchment fills). No charting library.
- Additive edits: `lib/types.ts`, `lib/api.ts`, `lib/mock-api.ts` (renders under
  `VITE_USE_MOCK=1` with a real ILE stack), `components/RecordNav.tsx` (adds the
  "socionics" pill, strip stays horizontally scrollable on 390px), `App.tsx`
  (lazy route).

## Model A source and derivation

Base + creative per type were taken from published sources and are treated as
ground truth. The remaining six positions are DERIVED by the canonical socion
construction, so the stack cannot drift out of internal consistency:

```
flip(x) = same typological dichotomy, opposite introversion/extroversion
          (Ne<->Ni, Se<->Si, Te<->Ti, Fe<->Fi)
dual(x) = the completing element
          (Ne<->Si, Ni<->Se, Te<->Fi, Ti<->Fe)

1 Leading (Ego)        = base
2 Creative (Ego)       = creative
5 Suggestive (Super-Id)= dual(base)
6 Mobilizing (Super-Id)= dual(creative)
3 Role (Super-Ego)     = flip(pos5)
4 Vulnerable (Super-Ego, PoLR) = flip(pos6)
7 Ignoring (Id)        = flip(base)
8 Demonstrative (Id)   = flip(creative)
```

Verified by hand and in the test against four published Model A stacks:
- ILE (ENTp): Ne Ti Se Fi Si Fe Ni Te
- SEI (ISFp): Si Fe Ni Te Ne Ti Se Fi
- ESE (ESFj): Fe Si Te Ni Ti Ne Fi Se
- LII (INTj): Ti Ne Fi Se Fe Si Te Ni

Every one of the 16 stacks uses all 8 elements exactly once (asserted in the test).

### Sources
- Model A + the 8 information elements: wikisocion (Model A / functions),
  the Japanese Socionics Society `socionics.or.jp/en/model_a`, `sociotype.com`,
  `worldsocionics.blogspot.com`.
- Base/creative per type + quadras: `sociotype.com`, wikisocion type pages,
  `socionics.or.jp/en/all_type`, `classicsocionics.wordpress.com/quadras`.

## Relation matrix source

The full 16x16 matrix is encoded in `SOCION_ORDER` (the canonical socion order,
in which the supervision and benefit rings run cleanly). Cells are directional
from the ROW type toward the COLUMN type; `Bn>`/`Sup>` mean the row type is the
benefactor/supervisor of the column type. Verified against:
- `socionics.com/rel/relcht.htm` (the classic relation chart)
- `socionicsinsight.com/relations/`
- wikisocion "Intertype relations"

### Sources cross-checked against structural invariants
Rather than trust any single copied table, the matrix is machine-checked for the
properties every valid socionics relation table must have (see below). This
catches a transcription error in any single source.

## Invariant test

`apps/api/test/socionics.matrix.test.ts` — a standalone `tsx` script (the repo has
no vitest). Run from the repo root:

```
npx tsx apps/api/test/socionics.matrix.test.ts
```

It asserts:
- **Model A:** every type uses all 8 elements once; positions 1-2 Ego, 3-4
  Super-Ego, 5-6 Super-Id, 7-8 Id; four published stacks match exactly; each
  type's derived dual matches its Duality cell in the matrix.
- **Matrix shape:** 16x16, every cell a known relation.
- **Identity:** on the diagonal and ONLY the diagonal.
- **Duality:** symmetric, and each type has exactly one dual.
- **Symmetry:** the 12 symmetric relations satisfy `M[i][j] == M[j][i]`.
- **Asymmetry:** Benefit and Supervision mirror with flipped direction
  (benefactor<->beneficiary, supervisor<->supervisee); each type is benefactor to
  exactly one, beneficiary of exactly one, supervises exactly one, is supervised by
  exactly one.
- **Rings of 4:** following "I supervise -> they supervise -> ..." closes in
  exactly four steps for every ring; same for benefit.

### Result (last run)

```
Model A stacks
Matrix shape
Duality
Symmetry
Asymmetric (Benefit / Supervision)
One of each asymmetric role per type
Supervision + Benefit rings of 4
Coverage

PASS  1277 assertions, 0 failures
```

## QA performed
- `npm --workspace apps/api run typecheck` — clean.
- `npm --workspace apps/web run build` (tsc -b + vite) — clean.
- Invariant test — 1277 assertions, 0 failures.
- Playwright at 390x844 (quiz) and 1440x900 (result), `VITE_USE_MOCK=1`,
  `chromium.launch(args=['--no-sandbox'])`: zero console errors/warnings. Result
  page confirmed to render the type (ILE), the Model A diagram with all 8 elements,
  the dual (SEI), the quadra, the reading, and the "this is not the mbti" caveat.

## What could NOT be verified
- The exact esoteric symbol glyphs for the 8 elements are rendered as simplified,
  legible shapes (circle/square/triangle, filled = extroverted, open = introverted)
  rather than the traditional socionics symbols, a deliberate choice so the diagram
  reads on a 390px phone. The element LETTERS (Ne, Ti, ...) are canonical.
- Quiz-derived typing is a genuinely weak instrument. The scoring blends a
  dichotomy fit and an element-preference fit and surfaces a `runner_up` when the
  top two are close; the UI copy is explicit that the result should be held gently.
  It is a screening aid, not a verdict, and this is stated in the product copy.
- Quadra value descriptions and per-relation blurbs are in-voice paraphrases of the
  standard socionics characterizations, not verbatim quotes from a single source.

## Deploy notes (NOT run here)
Nothing was deployed. To ship:

```
# D1 migration (local first, then remote)
cd apps/api
npx wrangler d1 migrations apply constellate-prod --local
npx wrangler d1 migrations apply constellate-prod --remote   # applies 0005 + 0006

# API worker
npm --workspace apps/api run deploy      # wrangler deploy

# Web
npm --workspace apps/web run deploy      # vite build && wrangler deploy
```

Note migration `0006_socionics.sql` depends on the shared `readings_cache` table
created by the other lane's `0005_hd_gk_enneagram.sql`; apply 0005 before 0006
(wrangler does this in order automatically).
