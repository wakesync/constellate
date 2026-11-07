# Constellate

**An AI astrologer for you and your friends. Private by construction.**

Live at **https://constellate.me** · Demo: https://constellate-motion.pages.dev/constellate-motion-v2.mp4

Your birth chart is some of the most identifying data you own: the exact minute and place you were born. Every astrology app today ships it to a frontier API in plaintext. Constellate doesn't. Every reading, every chat and every memory your agent keeps lives inside attested confidential compute on an NVIDIA H200, and nothing leaves your circle without your explicit say.

Add your chart. Invite your circle. Get readings about your relationships, ask your personal agent anything about them, and let your agents compare notes, only through the summaries you approve.

## What it does

- **Real birth charts.** Tropical and sidereal (Lahiri) placements computed by an astronomy engine, not hallucinated by a model. Unknown birth times are marked as noon estimates.
- **Circles.** Start a circle, share an invite code, watch your people appear as a constellation.
- **Relationship readings.** "You + Sam: why you clash, and how to talk about it." Synastry between circle members, with romantic framing off unless both people opt in.
- **A personal agent per member.** Every reading opens into a private conversation with your own agent. Only you can see it.
- **Consented agent-to-agent exchange.** Your agent can share one exact summary you approved with a specific friend's agent. Revoke it any time and future access stops.
- **More lenses.** Human Design, Gene Keys, Enneagram, Socionics and a convergence view in the full app under `apps/`.

Astrology here is a reflection practice, not prediction, diagnosis or advice.

## Built for LOCALHOST

### Most production-ready product (2.1)
Somebody outside the team can use this Monday, and they already have. Real accounts (Better Auth, secure HttpOnly sessions, exact-origin checks on every mutation), persistent readings and chats, full account and profile deletion, per-user and global rate limits, and a public deploy at constellate.me. Two independent test users ran the full journey end to end: sign up, add chart, create circle, invite, reading, private chat. 57 offline tests ship with the server.

### Private inference routing (2.3)
Constellate routes every model call by **data sensitivity**, not by price:

| Data | Route | Guarantee |
| --- | --- | --- |
| Birth details, placements, readings, chats, agent memory | Tinfoil enclave on H200 | Attested before the first byte is sent |
| Public, non-personal copy (daily transits, sign overviews) | Darkbloom | Zero personal data in the prompt |
| Chart math | Local astronomy engine | Never touches a model |

The router minimizes before it sends: the model gets the placements a reading needs, never your raw birth date, time or city. Attestation is verified by the official `tinfoil` SDK on every client. **If attestation fails or the enclave is unreachable, the request fails. There is no fallback to a non-private model, ever.** A sensitive prompt can only ever exit through a verified enclave.

**Threat model, stated plainly.** The enclave hides prompts and outputs from the inference provider and the host. The app server is the trust anchor for accounts and is minimal by design: provider keys never reach the browser, the database is permission-locked, deletes remove rows (backups age out on rotation), and placements are treated as sensitive even without a literal birth date, because they can narrow down when you were born. We name every boundary rather than say "encrypted" and stop there.

### Own the model (2.2)
Readings are a narrow, repeatable skill, so Constellate distills one. An open-weights teacher, licensed to permit distillation, writes readings over a large synthetic set of charts and relationship pairs (synthetic, so no real person's data is used). A small open student model is fine-tuned on that set and served inside the same H200 enclave. The result is a dedicated astrologer model that is cheaper, faster and fully ours, and is never sent to a third-party API.

### Private cooperation (2.4)
Each member's agent holds private context that no other member can see. Agents work together on circle-level readings ("your circle this week: Mars hits everyone's communication house"). Each agent contributes only what its owner approved, and every contribution is attributed to the member who made it. The circle board shows whose context moved the reading, so cooperation is measurable without anyone exposing their chart or chats.

### Private swarm memory (2.5)
Under the agents is **Membrane**: confidential, multiplayer agent memory running in its own Tinfoil enclave. Each member's memory is a separate namespace with signed per-user identity. Sharing is an explicit grant of one exact summary to one specific agent, and revoking it blocks future reads. Membrane speaks plain HTTP behind a small adapter (`server/src/membrane-remote.ts`), so any agent harness can plug into the same memory layer.

### Tinfoil
Both halves of the private stack run on Tinfoil: model inference on an H200 GPU enclave, and Membrane as a measured, attested Tinfoil Container with a public config repo. Every client verifies attestation before it talks to either one. That is the core design of the product, not an extra feature.

### Darkbloom
Darkbloom runs the public lane: transit forecasts, sign content and other copy with no personal data. That keeps enclave capacity for the private work, and the router guarantees birth data never takes this path.

### Cognee
Each circle builds a permissioned knowledge graph: members, approved summaries, recurring themes across readings. Agents learn from it across runs, so the second reading about you and Sam knows what the first one surfaced. Permissions follow the share grants, so a revoked summary disappears from what agents can use.

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
                public/             minimal vanilla UI served by the server itself
membrane       Python (FastAPI) confidential swarm memory, deployed as a Tinfoil Container
                app/shares.py       exact share / read / revoke
                app/router.py       sensitivity router (private | frontier slice | signer)
                clients/            CLI, OpenAI tools, MCP adapters for any agent harness
                tinfoil/            public tinfoil-config.yml (measured, attested)
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

## License
