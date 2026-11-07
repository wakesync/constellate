// Human Design CONNECTION CHART: the overlay of two bodygraphs.
//
// Pure gate math over the two stored /humandesign payloads, zero LLM, zero
// sidecar calls. The four channel classes below are the standard partnership
// analysis categories (Jovian Archive lineage, same source line as the channel
// table itself; see docs/HUMAN-DESIGN.md):
//
//   electromagnetic - each person carries exactly ONE gate of the channel, so
//     the channel only exists when they are together. attraction / spark.
//   companionship   - BOTH people carry the full channel. neither adds anything
//     the other lacks here; it is shared ground. stability.
//   dominance       - one person has the full channel, the other has NEITHER
//     gate. the definition flows one way: teaching / transmission. the open
//     party experiences it fully as the other's energy.
//   compromise      - one person has the full channel, the other has ONE gate
//     of it. the full-channel side always wins the expression; the single-gate
//     side feels their half overridden. the classic friction class.
//
// Composite definition: centers that are defined ONLY when the two charts are
// overlaid (electromagnetic channels bridging what neither defines alone).
// Conditioning: which of A's open centers B's own definition defines, and vice
// versa. That is the "you make me feel my undefined solar plexus" mechanic.

import { CHANNELS, CENTER_ORDER, type CenterName, type Channel } from "./hdChannels";

// The stored /humandesign payload shape (subset the connection chart needs).
export type HdPayloadLike = {
  type?: string;
  gates?: {
    personality?: Array<{ gate?: number }>;
    design?: Array<{ gate?: number }>;
  };
  centers?: Array<{ name: string; defined?: boolean }>;
  open_centers?: string[];
};

export type ChannelClass = "electromagnetic" | "companionship" | "dominance" | "compromise";

export type ConnectionChannel = {
  key: string;
  name: string;
  gates: [number, number];
  centers: [CenterName, CenterName];
  class: ChannelClass;
  // For asymmetric classes: which side carries the full channel ("a" | "b").
  // null for the symmetric classes (electromagnetic, companionship).
  dominant: "a" | "b" | null;
  // Which gates each side contributes (sorted; empty for the empty side of a
  // dominance channel).
  a_gates: number[];
  b_gates: number[];
};

export type ConnectionChart = {
  channels: ConnectionChannel[];       // every channel defined in the overlay
  counts: Record<ChannelClass, number>;
  // Centers defined only by the two charts TOGETHER (composite definition).
  composite_centers: CenterName[];
  // Conditioning: a_open_defined_by_b = centers open in A that B's own chart
  // defines (B's definition floods A's openness there), and the mirror.
  a_open_defined_by_b: CenterName[];
  b_open_defined_by_a: CenterName[];
  // How many of the nine centers the pair defines together (composite total).
  defined_together: number;
};

export function activeGates(hd: HdPayloadLike): Set<number> {
  const out = new Set<number>();
  for (const list of [hd.gates?.personality, hd.gates?.design]) {
    for (const g of list ?? []) {
      if (typeof g?.gate === "number") out.add(g.gate);
    }
  }
  return out;
}

// Centers a single gate-set defines on its own (a center is defined iff at
// least one channel touching it has both gates active in the set). Identical
// rule to compute_bodygraph() in services/astro/hd.py.
export function definedCenters(gates: Set<number>): Set<CenterName> {
  const out = new Set<CenterName>();
  for (const ch of CHANNELS) {
    if (gates.has(ch.gates[0]) && gates.has(ch.gates[1])) {
      out.add(ch.centers[0]);
      out.add(ch.centers[1]);
    }
  }
  return out;
}

function contribution(gates: Set<number>, ch: Channel): number[] {
  return ch.gates.filter((g) => gates.has(g)).sort((x, y) => x - y);
}

export function classifyChannel(
  ch: Channel,
  aGates: Set<number>,
  bGates: Set<number>,
): ConnectionChannel | null {
  const [g1, g2] = ch.gates;
  // the channel must exist in the overlay at all.
  const union = (aGates.has(g1) || bGates.has(g1)) && (aGates.has(g2) || bGates.has(g2));
  if (!union) return null;

  const aFull = aGates.has(g1) && aGates.has(g2);
  const bFull = bGates.has(g1) && bGates.has(g2);
  const aCount = (aGates.has(g1) ? 1 : 0) + (aGates.has(g2) ? 1 : 0);
  const bCount = (bGates.has(g1) ? 1 : 0) + (bGates.has(g2) ? 1 : 0);

  let cls: ChannelClass;
  let dominant: "a" | "b" | null = null;
  if (aFull && bFull) {
    cls = "companionship";
  } else if (aFull || bFull) {
    const other = aFull ? bCount : aCount;
    cls = other === 0 ? "dominance" : "compromise";
    dominant = aFull ? "a" : "b";
  } else {
    // neither has the full channel but the union completes it: each side must
    // be carrying at least one gate, and between them both gates are covered.
    cls = "electromagnetic";
  }

  return {
    key: ch.key,
    name: ch.name,
    gates: [Math.min(g1, g2), Math.max(g1, g2)],
    centers: ch.centers,
    class: cls,
    dominant,
    a_gates: contribution(aGates, ch),
    b_gates: contribution(bGates, ch),
  };
}

function sortCenters(centers: Iterable<CenterName>): CenterName[] {
  return [...centers].sort((x, y) => CENTER_ORDER.indexOf(x) - CENTER_ORDER.indexOf(y));
}

export function connectionChart(a: HdPayloadLike, b: HdPayloadLike): ConnectionChart {
  const aGates = activeGates(a);
  const bGates = activeGates(b);

  const channels: ConnectionChannel[] = [];
  for (const ch of CHANNELS) {
    const c = classifyChannel(ch, aGates, bGates);
    if (c) channels.push(c);
  }
  // deterministic order: class significance (electromagnetic first, then
  // compromise, dominance, companionship), then channel key.
  const CLASS_ORDER: ChannelClass[] = ["electromagnetic", "compromise", "dominance", "companionship"];
  channels.sort(
    (x, y) => CLASS_ORDER.indexOf(x.class) - CLASS_ORDER.indexOf(y.class) || (x.key < y.key ? -1 : 1),
  );

  const counts: Record<ChannelClass, number> = {
    electromagnetic: 0, companionship: 0, dominance: 0, compromise: 0,
  };
  for (const c of channels) counts[c.class] += 1;

  const aCenters = definedCenters(aGates);
  const bCenters = definedCenters(bGates);
  const unionCenters = definedCenters(new Set([...aGates, ...bGates]));
  const composite = sortCenters(
    [...unionCenters].filter((c) => !aCenters.has(c) && !bCenters.has(c)),
  );

  return {
    channels,
    counts,
    composite_centers: composite,
    a_open_defined_by_b: sortCenters([...bCenters].filter((c) => !aCenters.has(c))),
    b_open_defined_by_a: sortCenters([...aCenters].filter((c) => !bCenters.has(c))),
    defined_together: unionCenters.size,
  };
}
