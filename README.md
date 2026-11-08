# Constellate

**An AI astrologer for you and your friends. Private inference, deliberate sharing.**

This repository combines the real Constellate product with the LOCALHOST confidential-compute additions. The public website is https://constellate.me; this branch is an isolated integration, not a statement that its changes are deployed there.

## Product

The default application is the full production React product: passkeys, natal charts, tropical and fixed-star skies, astrocartography, Human Design, Gene Keys, Enneagram, Socionics, deterministic convergence, journals, constellation graphs and versioned synastry readings. Swiss Ephemeris computes the astronomical evidence. Models write prose over computed facts, never calculate a chart.

Every product reading and circle-agent model turn now enters **`productInference` in `apps/api/src/lib/inference.ts`**, which uses the same attested Tinfoil SDK transport as the hackathon server. There is no public-provider fallback. Inference failures yield marked, fixed non-AI copy while deterministic pages remain available.

Astrology and typology are interpretive reflection practices, not validated prediction, diagnosis or advice.

## Architecture

- `apps/web`: full product UI by default (`App.tsx`). Explicit `VITE_APP_MODE=circles` builds the separate circle preview (`PreviewApp.tsx`).
- `apps/api`: Hono Worker, D1, passkeys, scoped tools, chart and typology caches, relationship context, synastry generations.
- `services/astro`: FastAPI, Swiss Ephemeris, dual-sky charts, exact solar-arc design solver and astrocartography.
- `server`: separate Node/Express, Better Auth and SQLite circle backend. Attested readings, private chat, consented summary exchange and deletion.
- `membrane`: confidential multiplayer memory service, exact share/read/revoke and experimental graph backend.

The two backends retain separate authentication and storage. No real accounts, readings, production databases or private infrastructure are imported. See [product core and inference contract](docs/PRODUCT-CORE.md), [private inference](docs/PRIVATE-INFERENCE.md), [circle API](docs/CIRCLES-API.md) and [design context](docs/DESIGN.md).

## LOCALHOST capabilities and boundaries

- **Product (2.1):** the production UI and deterministic engines, plus the isolated circle backend. Offline tests are not a claim of hosted availability.
- **Owned model (2.2):** a dedicated model may be served on confidential infrastructure. Source configuration alone is not evidence of a trained or live model.
- **Sensitivity routing (2.3):** all product requests are private, including personalized transit reflections. The private path is Tinfoil-only. Public-copy routing can be added separately but must never accept member data.
- **Private cooperation (2.4):** the circle server lets independently authenticated members approve exact summaries, then runs two scoped agent turns. Revocation blocks future reads, not information already received.
- **Memory (2.5):** Membrane provides signed identity, scoped namespaces and exact grants. Configuration and experimental graph code are not proof of an attested deployment.

The application host and database can access plaintext birth data, readings and chats. Tinfoil attests the inference endpoint, not this application, its authentication or database. This is not end-to-end encryption. Missing attestation or configuration fails closed; generated prose cannot confer access permissions.

## Local setup

Node 24+, npm, Python 3.11+. Install both JavaScript lockfiles because the Worker imports the server's existing inference transport rather than another copy:

```sh
npm ci
(cd server && npm ci)
cp apps/api/.dev.vars.example apps/api/.dev.vars
# Edit the isolated demo origins/bindings in apps/api/wrangler.toml.
# Set RP_ID=localhost and APP_ORIGIN=http://localhost:5173 for local passkeys.
(cd apps/api && npx wrangler d1 migrations apply constellate-demo --local)
npm run dev:api
# Another shell:
npm run dev:web
```

Vite forwards `/product-api` to the local Worker on port 8787 and `/api` to the circle backend on port 3400. Neither defaults to the live product. For a built site, set `VITE_API_URL` to your isolated API origin or bind `PRODUCT_API` on the static Worker. Without the binding, same-origin product API requests return 503.

Run the sidecar with a shared `ASTRO_BEARER`:

```sh
python3 -m venv .venv
.venv/bin/pip install -r services/astro/requirements.txt
# Set ASTRO_BEARER in your environment, also in apps/api/.dev.vars.
(cd services/astro && ../../.venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000)
```

For the separate hackathon circle preview:

```sh
# Configure server variables from server/.env.example in your shell.
(cd server && APP_URL=http://localhost:5173 npm start)
VITE_APP_MODE=circles npm run dev:web
```

## Configuration

- Product: `DB`, passkey `RP_ID`/`RP_NAME`, `APP_ORIGIN`/`ALLOWED_ORIGINS`, `ASTRO_URL`, `ASTRO_BEARER`, `TINFOIL_API_KEY`, `TINFOIL_MODEL`.
- Circle server: `APP_URL`, `BETTER_AUTH_SECRET`, optional `DB_PATH` and `PORT`, `TINFOIL_API_KEY`, `TINFOIL_MODEL`, rate-limit settings in `server/.env.example`.
- Memory: `MEMBRANE_ORIGIN`, `MEMBRANE_CONFIG_REPO`, `MEMBRANE_SWARM_SECRET`, `MEMBRANE_NAMESPACE` on the server. Sharing remains unavailable when unconfigured.

Inference keys are server-side only and must not be container-management keys. Wrangler resource identifiers and domains are placeholders; use separate demo resources. No deployment is required to run the offline tests.

## Offline verification

```sh
npm run typecheck
npm run build
(cd server && npm test && npm run typecheck)
for t in apps/api/test/*.test.ts; do server/node_modules/.bin/tsx "$t" || exit 1; done
server/node_modules/.bin/tsx --tsconfig apps/web/tsconfig.json apps/web/test/zodiac-lens.test.tsx
(cd apps/api && npx wrangler deploy --dry-run --outdir ../../artifacts/api)
(cd services/astro && ../../.venv/bin/python test_hd.py && ../../.venv/bin/python test_acg.py)
# With pytest installed:
(cd services/astro && ../../.venv/bin/python -m pytest -q)
```

Membrane has its own requirements and offline `shares_test.py`, `router_test.py` and `router_security_test.py` suites. Live inference and capability probes are opt-in and skipped by default. Builds and offline tests do not prove live attestation or provider/model availability.
