# Membrane

Confidential, multiplayer agent memory for Constellate. Runs as a Tinfoil Container: a FastAPI memory service plus an in-enclave vLLM model on a closed network, attested before any client sends a byte.

This directory is the full service: memory API, org/wall policy, sensitivity router, exact share/read/revoke, agent clients, the Tinfoil config, and tests. All demo data is synthetic.

## Layout

```
app/main.py            API: signed auth, orgs/members/walls, remember/recall, graph, attestation
app/shares.py          exact scoped shares: POST /shares, GET /shares/{id}, DELETE /shares/{id}[/readers/{reader}]
app/router.py          sensitivity router: private (enclave) | frontier (de-identified slice) | signer (mock)
app/cognee_backend.py  experimental cognee backend (one dataset per org / personal scope)
clients/               swarm.sh (CLI), swarm_client.py + tools.json (OpenAI tools), mcp/swarm_mcp.py (MCP stdio)
tests/                 shares_test, router_test, router_security_test (offline), leak_test (against a running instance)
tinfoil/               public Tinfoil config: tinfoil-config.yml, pin.sh, fallback model config, release workflow templates
web/                   landing, console demo, graph, router views (static)
demo/                  local container runner + synthetic seed scenarios
scripts/               product-demo.py (isolated synthetic demo backend), demo-edge.py (bounded public edge)
docs/                  membership-gating-proof.json (403 negative controls, synthetic)
```

## Auth

Every route is signed: `X-Swarm-User`, `X-Swarm-Ts`, `X-Swarm-Sig = hex(HMAC_SHA256(SWARM_SECRET, "<user>.<ts>"))`, 300 s skew. Constellate signs as `cst:<userId>` from the server-side session, never from browser input. The shared secret can sign any identity, so it stays server-side; per-agent scoped credentials are on the roadmap.

## Exact share / read / revoke

Separate from `/remember` + `/recall` on purpose. Share text is never written to the memories table, never embedded, never reachable via `/recall`, `/graph` or any model call.

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/shares` | `{context<=96, text 1..4000, readers[<=16]}` | `{id, sha256, readers, context}`, owner = signed caller |
| GET | `/shares/{id}` | | byte-exact `{id, owner, context, text, sha256}` for owner or listed reader; missing, revoked and unauthorized are the same 404 |
| DELETE | `/shares/{id}` | | owner only, idempotent, hard delete (`secure_delete`) |
| DELETE | `/shares/{id}/readers/{reader}` | | owner only, idempotent (member left the circle) |

Constellate's client for this lives at `server/src/membrane-remote.ts`.

## Run tests (offline, no model, no network)

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python tests/shares_test.py
.venv/bin/python tests/router_test.py
.venv/bin/python tests/router_security_test.py
```

`tests/leak_test.py` plants canaries and runs extraction prompts against a running instance:

```bash
docker build -t membrane:dev .
SWARM_SECRET=$(openssl rand -hex 24) demo/run-local.sh membrane-dev 18091
SWARM_URL=http://127.0.0.1:18091 SWARM_SECRET=... python3 tests/leak_test.py
```

## Env

`SWARM_SECRET` (required), `LLM_BASE_URL` (default in-enclave vLLM), `LLM_MODEL`, `LLM_API_KEY`, `DB_PATH`, `MEMORY_BACKEND` (`sqlite` | `cognee`), `GRAPH_K`, `RECALL_K`, `STRIPE_KEY` (`none` for stub). Router: `ENCLAVE_URL`, `FRONTIER_URL`, `FRONTIER_MODEL`, `FRONTIER_API_KEY`, `ROUTER_DEMO`.

## Deploy to Tinfoil

1. Build and push the image (`.github-workflows-example/image.yml`), copy the digest.
2. `tinfoil/pin.sh api sha256:<digest>`.
3. Push `tinfoil/` to a public config repo with the release workflows from `tinfoil/github-workflows-template/`, then run the release workflow.
4. `tinfoil secret create SWARM_SECRET`, then `tinfoil container create <name> --repo <org>/<config-repo> --tag <version> --host <gpu-host> --secret SWARM_SECRET`.
5. Verify with `tinfoil attestation verify` or the SDK `SecureClient` before sending anything.

`/data` is tmpfs, so memory resets on redeploy unless an encrypted persistent volume is attached.
