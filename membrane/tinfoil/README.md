# Membrane: Tinfoil config (public)

This is the public verification recipe for **Membrane**, confidential shared memory for multiplayer agents. `tinfoil-config.yml` pins:

- `memory-api`: the Membrane image, by sha256 digest
- `vllm`: `vllm/vllm-openai:v0.33.0`, by digest, serving **Qwen3.8-27B** (dm-verity mpk root `19a7de4e…f484`) on a closed network. It isn't exposed through the shim.

Release: `gh workflow run tinfoil-release.yml -f version=v0.0.1` (workflows copied unchanged from tinfoilsh/tinfoil-containers-template).
Fallback model config: `fallback/tinfoil-config.gpt-oss-20b.yml`.

## Profiles

| File | Enclave | What runs | Use |
|---|---|---|---|
| `tinfoil-config.yml` | 16 CPU, 64 GB, 1x H200 | memory-api + in-enclave vLLM on a closed network | full Membrane: `/recall` synthesis, walls, exact shares |
| `fallback/tinfoil-config.gpt-oss-20b.yml` | same | same, smaller model | if the primary model misbehaves |
| `fallback/tinfoil-config.cpu-shares.yml` | 2 CPU, 8 GB, no GPU, no egress | memory-api only, `LLM_ENABLED=0` | Constellate circles: exact share / read / revoke + signed identity only |

All three are measured per release tag and pin every image by sha256. `__API_DIGEST__` is a placeholder until the image is built (`.github-workflows-example/image.yml`), then `tinfoil/pin.sh api sha256:<digest>` pins it in the primary and CPU profiles. `tests/tinfoil_config_test.py` checks the invariants clients rely on (digest pins, secrets never inlined, only memory-api behind the shim, closed model network).

Clients verify before talking: Constellate's `server/src/membrane-remote.ts` opens a `tinfoil` `SecureClient` against `MEMBRANE_CONFIG_REPO` and refuses to send a byte unless `securityVerified` is true.
