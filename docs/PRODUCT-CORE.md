# Production product core

The public tree carries the full production product as fresh source files, not imported git history. The monorepo source revision is `9816556`. The earlier standalone app and landing repositories are older and do not contain the dual-sky or synastry-generation product. Read-only inspection of the public site's route bundles found the full chart, design, keys, atlas, convergence, synastry and zodiac-lens app, not the small circle preview. A bundle match is not proof of the deployed API revision.

## Layout and entry points

- `apps/web/src/App.tsx` is the default React application: passkey onboarding, natal chart, tropical/fixed-star lens, Human Design, Gene Keys, questionnaires, convergence, astrocartography, journal, constellations and synastry generations.
- `apps/api` is its Hono/Workers API, with D1 migrations, scope/consent checks, deterministic pair mechanics, append-only generation storage and editorial synastry formatting.
- `services/astro` retains the Swiss Ephemeris sidecar, exact solar-arc design solver, dual-sky calculations and deterministic aspect geometry. Calculations are not model calls.
- `server/` remains the separate Better Auth + SQLite hackathon circle backend, with attested readings/chat and exact approved-summary exchange.
- `membrane/` remains the confidential memory service. No second copy or overwritten directory.
- `VITE_APP_MODE=circles` explicitly selects `PreviewApp` for that separate backend. This is not the default and does not pretend to implement the full production API. Accounts/storage are separate.

Most product files were already present in the public base, identical to the production source except for sanitization. This change restores their actual entry point and replaces the remaining non-attested model transports rather than overwriting clean files with private originals.

## One inference hook

`apps/api/src/lib/inference.ts::productInference(env, request)` is the product hook. Every narrative and circle-agent turn calls it. It delegates to `server/src/inference.ts::createAttestedChat`, the same Tinfoil SDK path as hackathon readings and chats. Router integrations should classify every call at this product hook as private, including transit reflections computed using a member's location.

Only `TINFOIL_API_KEY` and `TINFOIL_MODEL` select inference. No pool credentials, public-provider endpoint or fallback model. The shared SDK verifies attestation before dispatch, uses EHBP and per-request cache isolation, bounds input/output, and sanitizes failures. Missing configuration or failure yields explicit `degraded` non-AI copy. It is never cached as a successful reading.

Structured evidence drops raw birth input, coordinates, timezone, email and design timestamps before dispatch. Free text, member display names and derived placements can still be sensitive and remain private. This is minimization, not anonymization or end-to-end encryption. The application and its database still handle plaintext.

Circle agent tool calls use a bounded JSON protocol over that same text seam. Untrusted tool proposals are validated against the existing tool registry; the existing scoped handlers enforce access control. Unknown tools, malformed JSON, oversized transcript, unverified inference and truncated output fail closed. The model cannot choose another transport. The existing 16,000-character per-message bound can reject long multi-tool transcripts rather than silently truncate evidence.

## Isolated configuration

The default web API is same-origin `/product-api`, never the live product. Vite forwards it to the local Worker on port 8787. `/api` remains the separate circle server on port 3400. For a built site, set `VITE_API_URL` to your own API origin, or bind `PRODUCT_API` on the static Worker. Absent that service binding, `/product-api` returns 503. Never reuse production databases, credentials or passkey origins for a demo.

Wrangler configuration uses example domains, placeholder identifiers and demo resource names. API bundling requires `nodejs_compat` for the Tinfoil SDK. Install both the root and `server/` lockfiles before typechecking/bundling because the product deliberately imports the existing shared transport, not a divergent copy.

## Verification and exclusions

Offline verification covers server tests, API tests, frontend SSR tests, frontend build, Worker dry-run bundle, Swiss Ephemeris tests and Membrane tests. It does not prove live attestation, model JSON quality, hosted availability or deployment readiness. No deployment is performed by this port.

Excluded: operational runbooks, deployment scripts, private infra identifiers, credentials, production databases, screenshots, reference charts of real people, actual generated readings and private-circle backfills. The formatter regression fixture is newly invented parser text, not a renamed real reading. Design context is retained in `docs/DESIGN.md`; feature documentation remains alongside the source.
