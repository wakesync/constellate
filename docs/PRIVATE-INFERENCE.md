# Private inference boundary

`generateReading(chart)` uses the actual `tinfoil` 1.2.2 `TinfoilAI` SDK, not a public OpenAI client. Required server-only environment variables are `TINFOIL_API_KEY` (inference API key, not the container admin key) and `TINFOIL_MODEL` (an available Tinfoil chat model identifier). No provider endpoint overrides or unverified client are accepted.

The SDK is explicitly configured for EHBP encrypted transport, zero retries and a fresh random per-reading prompt-cache secret, so unrelated users never share an application-wide cache identity. We await SDK readiness and require the SDK verification document's `securityVerified === true` before dispatching the chart. `sdk-attested` provenance denotes successful SDK attestation, not a claim made by generated text, and is only returned on successful completion. The SDK owns enclave verification and encrypted transport. There is no fallback provider and no simulated success.

Only validated, allowlisted placement fields and a boolean time-known flag are serialized. No name, email, birth date/time, coordinates, timezone, chart calculation timestamp, free-form limitations, or arbitrary extra fields are sent. In particular, this application's `calculatedAt` is the ephemeris evaluation instant, which could expose the birthday. It must not cross this boundary. Unknown-time limitations are expressed in the fixed system prompt rather than forwarding free text.

The entire operation has a 60-second response deadline, including SDK initialization/attestation, with a 45-second SDK request timeout. Requests are aborted on the outer deadline; the installed SDK does not expose cancellation for its initial attestation discovery, so discovery may finish in the background, but post-deadline guards prevent chart dispatch. Provider errors are discarded and replaced with a constant safe error. Do not log provider exceptions, prompts or SDK documents. Output requires a normal `stop` completion, nonempty text and at most 12,000 provider characters, plus a fixed disclaimer; generation is limited to 1,200 tokens.

The system prompt frames astrology as reflective entertainment, prohibits diagnostic/medical/financial directives and event prediction, respects unknown-time uncertainty, and forbids invented houses/ascendant/aspects. A fixed disclaimer is prepended independent of model compliance. This is instruction-based generation safety, not a guarantee that every model sentence is compliant. Treat output as untrusted text and render with textContent, never HTML.

## Honest scope

The app server still sees birth details and plaintext readings. SQLite stores those details and readings. Provider attestation does not attest this application, its host, authentication, or database. A configured flag is only configuration presence, not a live attestation or availability check.

Offline tests exercise minimization, missing config, rejected attestation, SDK errors, timeout including late initialization, malformed placements and bounded/empty/truncated output. They do not demonstrate a live provider response. Live inference remains a release gate until an inference API key and supported model are supplied and an actual attested response is observed.

SDK references: https://docs.tinfoil.sh/sdk/javascript-sdk and the installed 1.2.2 declaration/source files (`tinfoil-ai`, `secure-client`). The upstream main-branch README now describes a different 2.x factory API; implementation intentionally follows the installed 1.x API rather than mixing versions.
