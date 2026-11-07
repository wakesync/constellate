// Gene Keys PAIRING: deterministic wheel geometry between two activation
// sequences. Thin and honest by design.
//
// What Gene Keys canon actually gives us for two people (Richard Rudd, the
// Gene Keys transmission; wheel geometry verified in hdChannels.ts):
//
//   1. PROGRAMMING PARTNERS. every key has exactly one programming partner:
//      the opposite hexagram across the wheel (index + 32 of 64). when one
//      person's activation key is the programming partner of the other's, the
//      two spheres sit on the same axis of the wheel: the same field worked
//      from opposite ends. this is pure geometry, canon, and checkable.
//
//   2. SHARED KEYS. the same key appearing in both people's activation
//      sequences (possibly in different spheres). both people carry the same
//      shadow/gift/siddhi spectrum as a life theme; the sphere names say where
//      it sits for each.
//
// What we deliberately do NOT compute: "A's shadow activates B's gift" as a
// cross-key mechanic. shadow, gift, and siddhi are frequency bands of ONE key,
// not separate gates, so there is no canonical cross-contact table for them.
// A shared key IS the shadow-on-gift surface: both people hold the same
// spectrum and can meet each other anywhere on it. we expose the shared key
// with its triad and both sphere positions, and the prose layer may say that
// honestly. inventing a lookup table here would be fabricated canon.

import { programmingPartner } from "./hdChannels";

type Sphere = { gate?: number; line?: number; sphere?: string };
type GkKey = { gate?: number; shadow?: string; gift?: string; siddhi?: string };
export type GkPayloadLike = {
  activation?: {
    lifes_work?: Sphere;
    evolution?: Sphere;
    radiance?: Sphere;
    purpose?: Sphere;
  };
  keys?: GkKey[];
};

const SPHERES = ["lifes_work", "evolution", "radiance", "purpose"] as const;
const SPHERE_LABEL: Record<(typeof SPHERES)[number], string> = {
  lifes_work: "life's work",
  evolution: "evolution",
  radiance: "radiance",
  purpose: "purpose",
};

export type ProgrammingPartnerLink = {
  a_sphere: string;   // which of A's spheres
  a_gate: number;
  b_sphere: string;   // which of B's spheres
  b_gate: number;     // = programmingPartner(a_gate)
  a_triad: { shadow: string; gift: string; siddhi: string } | null;
  b_triad: { shadow: string; gift: string; siddhi: string } | null;
};

export type SharedKey = {
  gate: number;
  a_spheres: string[]; // where it sits in A's sequence
  b_spheres: string[];
  triad: { shadow: string; gift: string; siddhi: string } | null;
};

export type GeneKeysPairing = {
  programming_partners: ProgrammingPartnerLink[];
  shared_keys: SharedKey[];
};

function triadFor(gk: GkPayloadLike, gate: number): { shadow: string; gift: string; siddhi: string } | null {
  const k = gk.keys?.find((x) => x.gate === gate);
  if (!k || !k.shadow || !k.gift || !k.siddhi) return null;
  return { shadow: k.shadow, gift: k.gift, siddhi: k.siddhi };
}

function sphereGates(gk: GkPayloadLike): Array<{ sphere: string; gate: number }> {
  const out: Array<{ sphere: string; gate: number }> = [];
  for (const s of SPHERES) {
    const gate = gk.activation?.[s]?.gate;
    if (typeof gate === "number") out.push({ sphere: SPHERE_LABEL[s], gate });
  }
  return out;
}

export function geneKeysPairing(a: GkPayloadLike | null | undefined, b: GkPayloadLike | null | undefined): GeneKeysPairing {
  if (!a?.activation || !b?.activation) {
    return { programming_partners: [], shared_keys: [] };
  }
  const aSpheres = sphereGates(a);
  const bSpheres = sphereGates(b);

  // programming-partner links: A's sphere gate whose wheel-opposite appears in
  // B's sequence. deduplicate on the unordered gate axis so the same axis is
  // reported once even if a gate repeats across spheres; keep every sphere
  // pairing on that axis listed inside the one link.
  const partners: ProgrammingPartnerLink[] = [];
  const seenAxis = new Set<string>();
  for (const as of aSpheres) {
    const pp = programmingPartner(as.gate);
    if (pp === null) continue;
    for (const bs of bSpheres) {
      if (bs.gate !== pp) continue;
      const axis = [Math.min(as.gate, bs.gate), Math.max(as.gate, bs.gate)].join("-") + `|${as.sphere}|${bs.sphere}`;
      if (seenAxis.has(axis)) continue;
      seenAxis.add(axis);
      partners.push({
        a_sphere: as.sphere,
        a_gate: as.gate,
        b_sphere: bs.sphere,
        b_gate: bs.gate,
        a_triad: triadFor(a, as.gate),
        b_triad: triadFor(b, bs.gate),
      });
    }
  }
  partners.sort((x, y) => x.a_gate - y.a_gate || (x.a_sphere < y.a_sphere ? -1 : 1));

  // shared keys: same gate present in both activation sequences.
  const bByGate = new Map<number, string[]>();
  for (const bs of bSpheres) {
    bByGate.set(bs.gate, [...(bByGate.get(bs.gate) ?? []), bs.sphere]);
  }
  const sharedByGate = new Map<number, SharedKey>();
  for (const as of aSpheres) {
    const bIn = bByGate.get(as.gate);
    if (!bIn) continue;
    const existing = sharedByGate.get(as.gate);
    if (existing) {
      if (!existing.a_spheres.includes(as.sphere)) existing.a_spheres.push(as.sphere);
    } else {
      sharedByGate.set(as.gate, {
        gate: as.gate,
        a_spheres: [as.sphere],
        b_spheres: [...bIn],
        triad: triadFor(a, as.gate) ?? triadFor(b, as.gate),
      });
    }
  }
  const shared = [...sharedByGate.values()].sort((x, y) => x.gate - y.gate);

  return { programming_partners: partners, shared_keys: shared };
}
