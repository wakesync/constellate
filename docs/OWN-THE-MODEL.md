# Own the model (2.2): distilling a Constellate astrologer

Readings are a narrow, repeatable skill: placements in, a grounded reflective
reading out. `distill/` turns that into a small open model we own and serve
inside the same H200 enclave as everything else private.

```
distill/
  gen/generate.ts            synthetic charts + relationship pairs (real ephemeris, synthetic people)
  gen/pair.ts                deterministic pair features + theme vocabulary
  gen/generate_swe.py        same generator on the Swiss Ephemeris engine in services/astro
  prompts.py                 the exact prompt contract (production reading prompt + pair prompt)
  quality.py                 deterministic safety/grounding checks (filter + eval)
  teacher.py                 teacher over any OpenAI-compatible endpoint -> JSONL
  train_lora.py              LoRA SFT of the student (transformers + peft)
  eval.py                    student vs teacher on held-out charts
  serve/tinfoil-vllm.block.yml   vLLM block that drops into the H200 Tinfoil config
  samples/inputs.sample.jsonl   50 synthetic inputs, Astronomy Engine (committed, = generate.ts --n 50 --seed 7)
  samples/inputs.swe.sample.jsonl  20 synthetic inputs, Swiss Ephemeris (committed)
  samples/teacher.sample.jsonl  real teacher outputs for synthetic inputs (committed, see below)
```

## 1. Synthetic data, real ephemeris

No real person's chart is used. `generate.ts` draws a birth instant
(1940-2010), an IANA zone and a 12% chance of unknown birth time from a seeded
PRNG, then runs the production chart code (`server/src/chart.ts`, Astronomy
Engine) to get real placements for that synthetic instant. `generate_swe.py`
does the same with the Swiss Ephemeris engine (`services/astro`), and also
emits ascendant + houses when the synthetic birth time is known.

Each row keeps only what the model is allowed to see in production:
placements and `timeKnown`. The synthetic birth date, time and place are never
written, so the student is trained on exactly the minimized payload the private
router sends. Pair rows add deterministic features (shared elements, closest
aspects between personal planets), a relationship type, the romantic opt-in
flag (romantic framing only when both opted in, same rule as the product) and,
for ~30% of pairs, `priorThemes`: the circle-memory input from the Cognee graph
(docs/CIRCLE-MEMORY.md), so the student learns to build on earlier readings.

```sh
server/node_modules/.bin/tsx distill/gen/generate.ts --n 5000 --seed 7 --out distill/data/inputs.jsonl
```

Same `(n, seed)` always yields the same dataset. ~10% of rows are `heldout`
and never train.

## 2. Teacher and license

Default teacher: **Qwen3 Instruct (Apache-2.0)**. Apache-2.0 places no
restriction on using model outputs to train another model, which is what
distillation needs. We use the 235B-A22B-Instruct-2507 checkpoint for the real
run (fits one H200 in FP8 under vLLM), and any smaller Qwen3 Instruct size for
local smoke runs.

Why not others:
- Llama 3.x community license: outputs may train other models, but the derived
  model must carry "Llama" in its name and the license's attribution and AUP
  terms. Workable, more strings attached.
- Qwen2.5 3B / 72B: Qwen license (not Apache). Qwen2.5 0.5/1.5/7/14/32B are Apache-2.0.
- Frontier APIs: terms forbid training competing models, and they would see the prompts.

`teacher.py` enforces an allowlist of distillation-permitted families
(Qwen3, Apache-licensed Qwen2.5 sizes, gpt-oss, Mistral Small, OLMo). Anything
else needs `TEACHER_LICENSE_ACK=1` after reading its license.

```sh
TEACHER_BASE_URL=http://localhost:8001/v1 TEACHER_MODEL=Qwen/Qwen3-235B-A22B-Instruct-2507 \
  python3 distill/teacher.py --in distill/data/inputs.jsonl --out distill/data/teacher.jsonl --workers 16
```

Every output goes through `quality.py`: length, truncation, think-tag leaks,
invented placements (ascendant/houses/nodes when not supplied), directives,
sign claims that contradict the input chart, romantic language without opt-in,
missing reflection questions. Rejected rows are kept in the JSONL with their
`problems` and excluded from training.

## 3. Student

**Qwen2.5-1.5B-Instruct (Apache-2.0)**, LoRA r=16 on all attention + MLP
projections, loss on the completion only, 2 epochs, cosine 2e-4. 3B is a flag
away but the Qwen2.5-3B license is not Apache, so 1.5B is the default (Qwen3
1.7B Instruct is the Apache alternative).

```sh
pip install -r distill/requirements-train.txt
python distill/train_lora.py --data distill/data/teacher.jsonl --out runs/astro-1.5b --merge
python distill/train_lora.py --data distill/samples/teacher.sample.jsonl --dry-run   # CPU: tokenize + count only
```

## 4. Eval

Same held-out synthetic charts, same prompt, both models behind
OpenAI-compatible endpoints. Deterministic metrics: pass rate (zero quality
problems), grounding (share of "<Body> in <Sign>" claims that match the
chart), romantic leak rate, median words and latency.

```sh
STUDENT_BASE_URL=http://localhost:8002/v1 STUDENT_MODEL=constellate-astro-1.5b \
TEACHER_BASE_URL=... TEACHER_MODEL=... \
  python3 distill/eval.py --in distill/data/inputs.jsonl --teacher-cache distill/data/teacher.jsonl --out runs/eval.json
python3 distill/eval.py --in distill/samples/inputs.sample.jsonl --score-only distill/samples/teacher.sample.jsonl
```

## 5. Serving in the enclave

`distill/serve/tinfoil-vllm.block.yml` is a vLLM container + `models:` entry
for the merged student, on the closed `swarm` network next to the existing
model. Push the merged weights to a HF repo, run `tinfoil model wrap`, paste
the repo@commit and mpk, merge the block into the H200 config and cut a
release. Weights are part of the measured config, so the attestation proves
which astrologer is answering. Router change: point `TINFOIL_MODEL` at
`constellate-astro-1.5b` for readings.

## Status (what is real today)

- Real: generator (both engines), prompt contract, quality filter, teacher
  script, eval script (score-only mode run on the sample), vLLM block.
- Written, not executed here: train_lora.py (no GPU and no torch on the build host).
  Its --dry-run mode tokenizes and counts on CPU once transformers is installed.
- Real sample: `teacher.sample.jsonl` was generated by a small Qwen3 Instruct
  teacher (4B, Apache-2.0) running locally on CPU, over synthetic inputs. It
  is a format/pipeline sample, not the training set.
- Not done: the full teacher run, the GPU fine-tune, the student eval numbers
  and the enclave deploy. No GPU job was launched for this PR.
