// Gene Keys -> shared trait space.
//
// HONEST CAVEAT (also in docs/CONVERGENCE.md "what is weakly justified"):
// Gene Keys is derived from the SAME gate activations as Human Design. It is not
// an independent measurement of the person; it is a second interpretive lens on
// the same underlying data. If we let it echo HD's claims it would fake a fifth
// independent voice and inflate every convergence that HD already drives. That
// would corrupt the whole point of the engine.
//
// So we deliberately restrict Gene Keys to the ONE thing it says that HD does
// not: the Shadow/Gift/Siddhi framing, i.e. a named contraction pattern per
// sphere. We map only the Life's Work + Evolution shadows onto self_narrative
// (the "which fixed pattern distorts your seeing" axis), at LOW weight, and we
// emit nothing on the mechanical axes (initiation, energy, authority) that are
// pure HD territory. This keeps gene_keys a distinct-but-modest source rather
// than an HD clone.
//
// Reads the stored /genekeys payload:
//   { activation:{lifes_work:{gate,line}, evolution:{...}, ...},
//     keys:[{gate,shadow,gift,siddhi}] }

import { makeSignal, type Signal } from "../axes";

type Sphere = { gate?: number; line?: number };
type GkKey = { gate?: number; shadow?: string; gift?: string; siddhi?: string };
type GkPayload = {
  activation?: {
    lifes_work?: Sphere;
    evolution?: Sphere;
    radiance?: Sphere;
    purpose?: Sphere;
  };
  keys?: GkKey[];
};

function shadowFor(gk: GkPayload, gate: number | undefined): string | undefined {
  if (typeof gate !== "number") return undefined;
  return gk.keys?.find((k) => k.gate === gate)?.shadow;
}

export function mapGeneKeys(gk: GkPayload | null | undefined): Signal[] {
  if (!gk || !gk.activation) return [];
  const out: (Signal | null)[] = [];

  // Life's Work sphere (personality Sun): the most prominent contraction pattern
  // in the sequence. Its named Shadow is a real, specific "fixed story" the
  // person is invited to notice, so it speaks to self_narrative. Low weight and
  // low value magnitude: it is a named tendency, not a measured intensity, and
  // it is not independent of HD's gate data.
  const lw = gk.activation.lifes_work;
  const lwShadow = shadowFor(gk, lw?.gate);
  if (lwShadow) {
    out.push(
      makeSignal(
        "gene_keys",
        "self_narrative",
        0.35,
        0.35,
        `your life's work carries the shadow of ${lwShadow.toLowerCase()} (gate ${lw?.gate}). that is the fixed pattern the sequence asks you to catch in yourself.`,
      ),
    );
  }

  // Evolution sphere (personality Earth): the relational challenge shadow, a
  // second named pattern. Even lower weight; it reinforces rather than adds.
  const ev = gk.activation.evolution;
  const evShadow = shadowFor(gk, ev?.gate);
  if (evShadow && evShadow !== lwShadow) {
    out.push(
      makeSignal(
        "gene_keys",
        "self_narrative",
        0.3,
        0.25,
        `your evolution sphere carries the shadow of ${evShadow.toLowerCase()} (gate ${ev?.gate}), the pattern that tends to surface in how you meet others.`,
      ),
    );
  }

  return out.filter((s): s is Signal => s !== null);
}
