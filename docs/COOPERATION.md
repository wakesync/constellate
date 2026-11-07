# Private cooperation and swarm memory (tracks 2.4, 2.5)

Constellate's agents cooperate only through **Membrane** (`membrane/`), a confidential memory service that runs as a Tinfoil Container. The server talks to it through `server/src/membrane-remote.ts`; the cooperation API is `server/src/cooperation.ts`; the UI panel is `apps/web/src/components/CircleBoard.tsx` (on `/sharing` in the preview app).

## Identity and namespaces

Every Membrane call is signed as exactly one member: `X-Swarm-User: cst:<userId>`, `X-Swarm-Sig = HMAC(SWARM_SECRET, "<user>.<ts>")`. The user id comes from the server session, never from the browser. Shares are stored under the circle's context (`cst:<circleId>`), so each member and each circle is a separate namespace inside Membrane.

## Grants

`POST /api/circles/:id/grants {summary, to, consent:true}` creates a Membrane share of that exact text with `readers=[cst:<to>]`. One summary, one member's agent. The app keeps a sha256 of the text and the Membrane share id, and the grantee only ever sees metadata until a reading reads the text through Membrane.

`DELETE /api/circles/:id/grants/:grantId` (owner only) blocks locally, then deletes the share in Membrane (hard delete, `secure_delete`). Every later read fails, for the grantee and for this server. If Membrane is unreachable, the grant stays blocked and the call can be retried. Deleting your account or profile revokes every grant you made and every grant made to you.

## Circle readings

`POST /api/circles/:id/circle-reading {question}`:

1. The asker is label `[A]`. Their contribution is their own active grant. Each other member contributes only the grants they made **to the asker**.
2. Each contribution is read from Membrane **signed as the asker**, so Membrane decides what is readable, not the app. The text has to match the stored sha256.
3. The model (attested Tinfoil inference, no fallback) gets the question plus the labelled approved texts. No birth data, no placements, no readings, no chats.
4. If anything was revoked while the reading was being made, it is discarded.
5. Attribution is stored per member: label, grant ids, sha256s (never the text) and how many times the reading cited that label.

`GET /api/circles/:id/circle-readings` returns the asker's own readings only.

## Circle board

`GET /api/circles/:id/board` is visible to every member. For each member it shows active grants, readings their context fed, readings it actually moved (was cited in), and total citations. Counts only, never summaries or reading text.

## Configuration

| `MEMBRANE_ORIGIN` | behaviour |
|---|---|
| unset | sharing, grants and circle readings return 503. Nothing is simulated. |
| `https://...` | attested: `tinfoil` `SecureClient` verifies the enclave against `MEMBRANE_CONFIG_REPO` before the first byte |
| `http://127.0.0.1:<port>` + `MEMBRANE_INSECURE_LOOPBACK=1` | local dev/CI only, no attestation, refused when `NODE_ENV=production` |

## Tests

`server/test/cooperation.test.ts` starts the real Membrane service (`membrane/app`, model disabled) on loopback and runs the real Express app against it: grantee read ok, non-grantee denied, wrong circle denied, forged owner denied, wrong secret denied, revoke then denied (also out of band), raw birth data and chat never in the Membrane wire or the reading prompt, attribution and board counts correct, deletion revokes everything. Needs `pip install -r membrane/requirements.txt` (or `MEMBRANE_PYTHON=<venv python>`), otherwise those tests skip with a reason.
