# Constellate

An AI astrologer for you and your friends.

Live at https://constellate.me. Demo video: https://constellate-motion.pages.dev/constellate-motion-v2.mp4

Constellate computes your birth chart, lets you start a circle with the people you are close to, and writes readings about you and about the relationships inside the circle. Each reading opens into a private follow-up chat, so you can ask about it instead of only reading it.

- **Birth charts.** Tropical and sidereal (Lahiri) placements computed by an astronomy engine, not by the model. Unknown birth times are marked as noon estimates.
- **Circles.** Create a circle, share an invite code, see members on a constellation graph. Edges mean membership, not a compatibility score.
- **Relationship readings.** Synastry and pair readings between circle members, with romantic framing off unless both people allow it.
- **Private follow-up chat.** Every reading has a conversation that only its owner can see.
- **More lenses.** Human Design, Gene Keys, Enneagram, Socionics and a convergence view live in the full app under `apps/`.

Astrology here is a reflection practice. It is not prediction, diagnosis, or advice.

## Privacy

Readings and follow-up chats for circles run inside a [Tinfoil](https://tinfoil.sh) secure enclave on an NVIDIA H200. The server uses the official `tinfoil` SDK, which verifies the enclave's attestation before any request is sent. If attestation fails, or the provider is unavailable, the request fails. There is no fallback to a non-private model.

What this does and does not cover:

- The enclave protects the prompt and the model's output from the inference provider.
- The app server still sees your birth details and reading text in plaintext. The database is permission-restricted, not application-encrypted.
- Deleting your profile or account removes the database rows. Backups and filesystem snapshots can retain bytes until they rotate.
- Provider keys never reach the browser. Sessions use secure, HttpOnly cookies, and every mutating request must come from the exact app origin.

## Agent sharing (coming next, not live)

Sharing a summary of your reading with specific circle members, through a Membrane agent running in its own Tinfoil enclave, is not live. The adapter is in `server/src/membrane-remote.ts`. The exact share, read and revoke endpoints it needs exist on the `feat/exact-share-revoke` branch of Membrane and are not deployed. Until they are, the sharing endpoints return 503 and the UI shows sharing as unavailable. Nothing is faked.

## Architecture

```
apps/web        React + Vite frontend (Tailwind, Framer Motion, react-query)
                src/PreviewApp.tsx  circle-first app over the server below
                src/App.tsx         full app (all lenses) over apps/api
                worker/             Cloudflare Worker that serves the built SPA
apps/api        Cloudflare Worker API for the full app (D1, passkeys, narratives)
services/astro  Python (FastAPI) sidecar for charts, Human Design, astrocartography
server          Node + Express backend for circles, readings and chat
                src/server.ts       auth (Better Auth), profile, readings, deletion
                src/circles.ts      circles, invites, membership, chat, share gates
                src/inference.ts    attested Tinfoil reading and chat
                src/chart.ts        Astronomy Engine placements
                src/limits.ts       per-user and provider daily caps
                ops/origin.ts       production entry behind a secret-gated proxy
                ops/pages-worker.js Pages worker that forwards /api to the server
```

The default web entry (`apps/web/src/main.tsx`) loads `PreviewApp`, which calls `/api/*` on the same origin. In production, a Cloudflare Pages worker forwards `/api` to the server with an origin secret. Locally, Vite proxies `/api` to the server.

## Local setup

Requires Node 24+ and npm. Python 3.11+ only if you run `services/astro`.

```sh
# server
cd server
npm ci
cp .env.example .env              # fill in values, see table below
export $(grep -v '^#' .env | xargs) # the server does not load .env itself
APP_URL=http://localhost:5173 npm start
npm test                          # offline tests, no network or keys needed

# web, in another shell
cd apps/web
npm ci
npm run dev                       # http://localhost:5173, /api proxied to :3400
```

`APP_URL` must match the origin your browser uses, because mutating requests are rejected unless `Origin` equals `APP_URL`.

For the full app (`apps/api` + `services/astro`): copy `apps/api/.dev.vars.example` to `.dev.vars`, fill in `apps/api/wrangler.toml` with your own Cloudflare account and D1 database, run migrations from `apps/api/migrations`, then `npm run dev:api`. Swap `apps/web/src/main.tsx` back to `App` and set `VITE_API_URL`.

## Environment variables

### server

| Variable | Required | Description |
| --- | --- | --- |
| `APP_URL` | yes | Exact public origin of the app. HTTPS in production. |
| `PORT` | no | Listen port on 127.0.0.1. Default 3400. |
| `DB_PATH` | no | SQLite file. Default `data/constellate.sqlite`. Keep it on a 0700 directory. |
| `BETTER_AUTH_SECRET` | yes | Session secret, 32+ chars. `openssl rand -hex 32`. |
| `TINFOIL_API_KEY` | for readings | Tinfoil inference key. Not a container admin key. |
| `TINFOIL_MODEL` | for readings | A currently available Tinfoil chat model id. |
| `READINGS_PER_USER_DAY` | no | Per-user daily reading cap. Default 5. |
| `PROVIDER_DAILY_REQUEST_CAP` | no | Global daily inference cap. Default 100. |
| `ORIGIN_PROXY_SECRET` | prod | Shared secret between the Pages worker and `ops/origin.ts`, 32+ chars. |
| `TRUST_LOOPBACK_PROXY` | no | `1` to trust a loopback reverse proxy for client IP. |
| `MEMBRANE_ORIGIN` | no | Membrane enclave origin. Sharing stays off unless set. |
| `MEMBRANE_CONFIG_REPO` | no | GitHub repo the Membrane attestation is checked against. |
| `MEMBRANE_SWARM_SECRET` | no | Membrane user-signing secret. |
| `MEMBRANE_NAMESPACE` | no | Prefix for Membrane user ids. Default `cst`. |

### Pages worker (`server/ops/pages-worker.js`)

| Variable | Description |
| --- | --- |
| `APP_ORIGIN` | Public origin allowed to call `/api`. |
| `API_UPSTREAM` | Origin of the running server. |
| `ORIGIN_PROXY_SECRET` | Same value as on the server. |

### apps/web

| Variable | Description |
| --- | --- |
| `VITE_API_URL` | API base for the full app (`App.tsx`). |
| `VITE_USE_MOCK` | `1` to use the in-browser mock backend for design work. |
| `CONSTELLATE_SERVER_URL` | Dev proxy target for `/api`. Default `http://127.0.0.1:3400`. |

### apps/api (full app)

| Variable | Description |
| --- | --- |
| `ASTRO_URL`, `ASTRO_BEARER` | Astro sidecar URL and shared bearer. |
| `OPENROUTER_API_KEY` | Narrative generation. Without it, readings fall back to non-AI text. |
| `POOL_URL`, `POOL_API_KEY` | Optional Anthropic-compatible endpoint, preferred over OpenRouter when set. |
| `RP_ID`, `RP_NAME`, `APP_ORIGIN`, `ALLOWED_ORIGINS` | Passkey and CORS settings. |

## Status

Working: accounts, birth profile, attested Tinfoil readings, persistent owner-only follow-up chat, circles with invites and membership, account and profile deletion, rate limits. Not done: Membrane sharing (see above), email verification and recovery, application-level encryption at rest.

## License

MIT. See [LICENSE](LICENSE).
