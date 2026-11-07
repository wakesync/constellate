// Convergence engine entry point: gather the five engine payloads, run every
// mapper, score deterministically. Pure and side-effect free; the API layer owns
// fetching payloads and caching the result.

import { mapAstro } from "./mappers/astro";
import { mapHumanDesign } from "./mappers/humanDesign";
import { mapGeneKeys } from "./mappers/geneKeys";
import { mapEnneagram } from "./mappers/enneagram";
import { mapSocionics } from "./mappers/socionics";
import { scoreConvergence, inputsHash, type ConvergenceResult } from "./score";
import type { Signal } from "./axes";

export type EnginePayloads = {
  astro?: unknown | null;         // normalized natal chart { planets:[...] }
  human_design?: unknown | null;  // /humandesign payload
  gene_keys?: unknown | null;     // /genekeys payload
  enneagram?: unknown | null;     // EnneagramResult
  socionics?: unknown | null;     // SocionicsResult
};

// Compute all signals from the raw payloads. Exposed for tests + the pair path.
export function computeSignals(p: EnginePayloads): Signal[] {
  return [
    ...mapAstro(p.astro as any),
    ...mapHumanDesign(p.human_design as any),
    ...mapGeneKeys(p.gene_keys as any),
    ...mapEnneagram(p.enneagram as any),
    ...mapSocionics(p.socionics as any),
  ];
}

export function computeConvergence(p: EnginePayloads, computedAt: number): ConvergenceResult {
  return scoreConvergence(computeSignals(p), computedAt);
}

// Hash only the payloads that actually feed the scorer, in a stable order, so
// the cache invalidates iff a source engine's stored result changes. SCORER_V
// is folded in so a change to the scoring RULES (not just the inputs) also
// invalidates: bumped to 2 for the birth-data tier (adaptive triangulation
// threshold, 2026-07-30), 3 for the moon/mercury astro signals + birth-tier
// tension floor (same day), which change results for byte-identical payloads.
const SCORER_V = 3;
export function convergenceInputsHash(p: EnginePayloads): string {
  return inputsHash({
    scorer_v: SCORER_V,
    astro: p.astro ?? null,
    human_design: p.human_design ?? null,
    gene_keys: p.gene_keys ?? null,
    enneagram: p.enneagram ?? null,
    socionics: p.socionics ?? null,
  });
}

export type { ConvergenceResult } from "./score";
export type { Signal } from "./axes";
export { AXES } from "./axes";
