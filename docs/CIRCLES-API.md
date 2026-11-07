# Reading conversations and circle backend

## Status

Implemented in `src/conversation.ts`, `src/circles.ts`, integrated into the actual application entry `src/server.ts`.

Personal follow-up conversations use a separate real Tinfoil SDK call with EHBP, checked SDK attestation, isolated per-request cache secret, no retries/fallback and 60-second deadline. Context is only the saved reading interpretation and that reading's owner-isolated conversation. Raw birth profile and chart evaluation timestamp are not sent. Threads persist in SQLite, cascade on reading/account deletion, and refuse to save replies if the reading disappears during inference. Initial readings and followups share the same persistent user/global usage limiter. Failed inference attempts count. Ten exchanges per reading, 2,000 characters per user message.

**Production circle sharing is intentionally unavailable.** No supported Membrane adapter has been provisioned. The read-only live EHBP probe succeeded with SDK attestation and HTTP 200 on `/openapi.json`. Its actual route list has add-member and wall-toggle operations but no member removal/revocation, exact scoped memory read, or memory deletion. `/recall` is synthesized retrieval across authorized scopes, not an exact summary retrieval API. It cannot fulfill this contract without owner-side work. This is capability evidence, NOT a successful circle interaction.

The injected `Membrane` seam is for explicit adapters and offline tests, not a mock enabled by production environment. No credentials have been read, no remote memories created, no provisioning or deployment changes made. An adapter must provide remote authorization and exact summary integrity, scoped identities, idempotent revocation, bounded deadlines, and atomic share failure cleanup. Do not wire the existing generic `/recall` endpoint into this seam and claim equivalent semantics.

## Authenticated API

All APIs retain existing session authentication, ownership checks, same-origin write requirement, and no-store policy.

- `GET /api/readings/:id/chat` returns `{messages:[{role,content}]}`.
- `POST /api/readings/:id/chat`, `{message}` returns `{messages,reply}`. Reply includes text/provider/model/verification/generatedAt. 429 for budget or concurrent request, 503 for unavailable verified inference, 409 at thread limit or deleted reading.
- `GET /api/circles` returns `{circles,membraneConfigured}`.
- `POST /api/circles`, `{name}` creates a circle and owner membership, returns `{circle}`.
- `POST /api/circles/join`, `{inviteCode,consent:true}` joins as the signed-in person, never accepts a caller-supplied user ID.
- `GET /api/circles/:id` returns `{circle}` for members only.
- `POST /api/circles/:id/shares`, `{summary,consent:true}` shares exactly the human-previewed string, max 1,500 chars. No automatic summary extraction or birth sharing. Requires at least two members. Returns `{circle}` only after remote acknowledgement. Currently 503 in production.
- `DELETE /api/circles/:id/shares/me` blocks local use immediately, confirms remote revocation before 204. Remote failure returns 503 and retains a retryable tombstone. Pending grants must finish before revocation. Users can revoke only their own share.
- `POST /api/circles/:id/interact`, `{message}` max 1,000 chars. Requires caller and another member to each have active approved summaries. Returns `{turns:[{agentFor,text,provider,model,verification,generatedAt}],transport:'membrane',persisted:false}` only after two independent attested inference calls with remote scoped reads and post-call revocation checks. Each call consumes the initiating user's/global quota. Currently 503 in production.

Circle shape: `{id,name,inviteCode,createdAt,members:[{id,isYou}],shares:[{userId,status,summary?}],membraneConfigured}`. Only your own summary is returned from circle metadata. Other members' summary content is never read directly through the UI metadata endpoint. Membership freezes once sharing begins, avoiding silent access grants to new members. Maximum eight members.

Revocation prevents future authorized app reads/inference. It cannot undo text somebody already received. Interaction results are not retained server-side. Account/profile deletion requires remote revocation to succeed first, otherwise returns 503 rather than falsely claiming cleanup.

## Checks

`npm run typecheck && npm test`

Offline tests explicitly label the Membrane test double. Cover session isolation, exact owner-only chat context, chat persistence, deleted-reading races, absent Membrane fail-closed behavior, consent, two members, nonmember denial, frozen membership, independent agent calls, and revoke failure/retry. Conversation tests cover attestation-before-dispatch and cache isolation.

Read-only capability probe:

`MEMBRANE_ORIGIN=https://<your-membrane>.containers.tinfoil.dev RUN_MEMBRANE_CAPABILITY_PROBE=1 npx tsx --test test/circles.membrane.live.test.ts`
