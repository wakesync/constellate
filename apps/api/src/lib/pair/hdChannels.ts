// The canonical Human Design 36-channel table, TypeScript port of the verified
// table in services/astro/hd.py (CANON_CHANNELS). Same source lineage: the
// standard BodyGraph 36-channel set (Jovian Archive lineage), cross-checked in
// docs/HUMAN-DESIGN.md. Kept as data here so the connection-chart math on the
// Worker needs no sidecar round-trip: a pair overlay is pure set arithmetic
// over gates that are already stored per user in human_design_cache.
//
// If hd.py's table ever changes, this file must change with it. The unit test
// (test/hd-connection.test.ts) asserts the structural invariants: exactly 36
// channels, 64 distinct gates with every gate in at least one channel, and
// every center name drawn from the canonical nine.

export type CenterName =
  | "Head" | "Ajna" | "Throat" | "G" | "Heart"
  | "Sacral" | "Solar Plexus" | "Spleen" | "Root";

export const CENTER_ORDER: CenterName[] = [
  "Head", "Ajna", "Throat", "G", "Heart",
  "Sacral", "Solar Plexus", "Spleen", "Root",
];

export type Channel = {
  key: string;          // "min-max" of the two gates, canonical id
  gates: [number, number];
  name: string;
  centers: [CenterName, CenterName];
};

function ch(a: number, b: number, name: string, ca: CenterName, cb: CenterName): Channel {
  const [lo, hi] = a < b ? [a, b] : [b, a];
  return { key: `${lo}-${hi}`, gates: [a, b], name, centers: [ca, cb] };
}

export const CHANNELS: Channel[] = [
  ch(64, 47, "Abstraction", "Head", "Ajna"),
  ch(61, 24, "Awareness", "Head", "Ajna"),
  ch(63, 4, "Logic", "Head", "Ajna"),
  ch(17, 62, "Acceptance", "Ajna", "Throat"),
  ch(43, 23, "Structuring", "Ajna", "Throat"),
  ch(11, 56, "Curiosity", "Ajna", "Throat"),
  ch(16, 48, "The Wavelength", "Throat", "Spleen"),
  ch(20, 57, "The Brainwave", "Throat", "Spleen"),
  ch(20, 10, "Awakening", "Throat", "G"),
  ch(31, 7, "The Alpha", "Throat", "G"),
  ch(8, 1, "Inspiration", "Throat", "G"),
  ch(33, 13, "The Prodigal", "Throat", "G"),
  ch(20, 34, "Charisma", "Throat", "Sacral"),
  ch(12, 22, "Openness", "Throat", "Solar Plexus"),
  ch(35, 36, "Transitoriness", "Throat", "Solar Plexus"),
  ch(45, 21, "Money", "Throat", "Heart"),
  ch(10, 34, "Exploration", "G", "Sacral"),
  ch(15, 5, "Rhythm", "G", "Sacral"),
  ch(2, 14, "The Beat", "G", "Sacral"),
  ch(46, 29, "Discovery", "G", "Sacral"),
  ch(10, 57, "Perfected Form", "G", "Spleen"),
  ch(25, 51, "Initiation", "G", "Heart"),
  ch(34, 57, "Power", "Sacral", "Spleen"),
  ch(27, 50, "Preservation", "Sacral", "Spleen"),
  ch(59, 6, "Mating", "Sacral", "Solar Plexus"),
  ch(42, 53, "Maturation", "Sacral", "Root"),
  ch(3, 60, "Mutation", "Sacral", "Root"),
  ch(9, 52, "Concentration", "Sacral", "Root"),
  ch(26, 44, "Surrender", "Heart", "Spleen"),
  ch(37, 40, "Community", "Solar Plexus", "Heart"),
  ch(49, 19, "Synthesis", "Solar Plexus", "Root"),
  ch(55, 39, "Emoting", "Solar Plexus", "Root"),
  ch(30, 41, "Recognition", "Solar Plexus", "Root"),
  ch(32, 54, "Transformation", "Spleen", "Root"),
  ch(28, 38, "Struggle", "Spleen", "Root"),
  ch(18, 58, "Judgment", "Spleen", "Root"),
];

// ---------------------------------------------------------------------------
// The gate wheel (Rave mandala order), TypeScript port of GATE_WHEEL in
// services/astro/hd.py, verified there against two independent by-degree
// sources (Gate 41 = 2 deg Aquarius, 5.625 deg per gate). The pair layer needs
// it for ONE piece of geometry: the gate directly opposite on the wheel
// (index + 32 mod 64), which is the Gene Keys "programming partner"
// (Richard Rudd, Gene Keys: the programming partner of a key is its opposite
// hexagram across the wheel; e.g. 1 <-> 2, 4 <-> 49).
// ---------------------------------------------------------------------------
export const GATE_WHEEL: number[] = [
  41, 19, 13, 49, 30, 55, 37, 63, 22, 36,
  25, 17, 21, 51, 42, 3,
  27, 24, 2, 23, 8,
  20, 16, 35, 45, 12, 15,
  52, 39, 53, 62, 56,
  31, 33, 7, 4, 29,
  59, 40, 64, 47, 6, 46,
  18, 48, 57, 32, 50,
  28, 44, 1, 43, 14,
  34, 9, 5, 26, 11, 10,
  58, 38, 54, 61, 60,
];

const WHEEL_INDEX: Map<number, number> = new Map(GATE_WHEEL.map((g, i) => [g, i]));

// The gate directly opposite on the wheel = the Gene Keys programming partner.
export function programmingPartner(gate: number): number | null {
  const i = WHEEL_INDEX.get(gate);
  if (i === undefined) return null;
  return GATE_WHEEL[(i + 32) % 64];
}
