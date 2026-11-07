# Membrane: setup review, not personal installation

Status: prototype. Personal onboarding is NOT enabled. This website issues no credentials and is not the memory API. Do not connect or send personal data based solely on these notes.

## Ask your existing agent

Review compatibility with the local Python 3 stdio MCP adapter. Explain permissions and what the receiving model will see. Do not request credentials, upload history, or make network calls without explicit approval.

## Current implementation

The project checkout contains clients/mcp/swarm_mcp.py, clients/swarm_client.py and clients/tools.json. Keep their relative paths intact. No published install package or public API URL is supplied by this site.

MCP process configuration (operator-only isolated test):
- Command: python3
- Argument: actual absolute checkout path to clients/mcp/swarm_mcp.py
- SWARM_URL: operator-confirmed memory API base URL, not the Pages site
- SWARM_USER: synthetic test user ID
- SWARM_SECRET: shared operator secret, loaded through local process environment or secret storage, never chat, browser, or shell history

No Python dependencies beyond the standard library are needed by this adapter. It uses ordinary HTTPS and does not itself attest the enclave. Configure and verify an attesting client/proxy before relying on enclave identity.

The adapter uses HMAC-SHA256 authentication over user ID and timestamp, in X-Swarm-User, X-Swarm-Ts and X-Swarm-Sig. The shared secret can sign arbitrary user identities; it is NOT a scoped personal token. Do not distribute it to untrusted agents or users.

## Synthetic-data tools

Explicitly approve each call through your harness:

swarm_remember({"text": "My fictional test preference is Friday deep work."})
swarm_recall({"query": "What is my fictional test preference for Friday?"})

These map to POST /remember and POST /recall. Check actual tool responses. Omitting org makes a note personal to the signed user. Recall can also use allowed shared context, so it is not a personal-only query scope. Adding org shares a note according to that workspace's policy.

## Consent and revoke

The intended personal journey is: connect your existing agent, approve a limited scope, save/retrieve approved memories, revoke access. Scoped credential issuance, consent UI, expiry and independently revocable agent grants are not implemented in the inspected contract. Do not mistake a setup review or these instructions for that finished flow.

Remove or disable the MCP server in your harness to stop that client. This does not revoke a copied secret or delete data. An operator can rotate the shared secret, affecting all clients. No per-agent revoke endpoint or memory deletion tool is available in the inspected adapter/API.

## Privacy limits

Private inference protects calls sent through the private path, not context already shared with a frontier model. A recall answer returned to your agent can be seen by the model running that agent. A private memory service alone does not protect that receiving model call.

Personal-note isolation depends on authentic user identity; shared-secret auth is not sufficient for untrusted individual connections. Memory attestation does not attest a separate router or signer. The diagnostic router's payment path is mock and is not part of installation. Static hosting does not provide its API.

Before personal use: establish scoped per-agent auth, explicit consent, expiry, revoke, deletion/retention rules, verified transport, and the receiving model's privacy boundary.
