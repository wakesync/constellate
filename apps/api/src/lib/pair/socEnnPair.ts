// Socionics + Enneagram pair facts. Lookup tables and raw contrasts only,
// nothing invented.
//
// SOCIONICS: the intertype relation comes from the machine-verified 16x16
// matrix in lib/socionics.ts (sources cited there: socionics.com/rel/relcht.htm,
// wikisocion "Intertype relations", socionicsinsight.com; invariants asserted
// in test/socionics.matrix.test.ts). This module only re-exposes the relation
// from the PAIR's point of view, keeping the asymmetric relations (Benefit,
// Supervision) directional: relation(a,b) is read from a toward b.
//
// ENNEAGRAM: there is no canonical, defensible "type X x type Y relationship
// dynamics" table that is not vendor prose, so we refuse to fabricate one.
// What IS canon (Riso-Hudson, The Wisdom of the Enneagram / Personality Types)
// and is a per-type fact we can compare mechanically:
//   - centers:          Body 8,9,1 / Heart 2,3,4 / Head 5,6,7
//   - harmonic groups (how a type copes when it does not get what it wants):
//       competency 1,3,5 / positive outlook 2,7,9 / reactive 4,6,8
//   - hornevian groups (social stance, after Karen Horney):
//       assertive 3,7,8 / compliant 1,2,6 / withdrawn 4,5,9
// We expose the raw type pair, wings, and same/different on each grouping as
// FACTS. No compatibility label is derived from them.

import { relationBetween, type Relation } from "../socionics";

export type SocionicsPairFact = {
  a_type: string;
  b_type: string;
  relation: Relation; // read from a toward b; direction matters for Bn/Sup
};

export function socionicsPair(
  aCode: string | null | undefined,
  bCode: string | null | undefined,
): SocionicsPairFact | null {
  if (!aCode || !bCode) return null;
  const relation = relationBetween(aCode, bCode);
  if (relation.title === "unknown") return null;
  return { a_type: aCode, b_type: bCode, relation };
}

// -- enneagram ---------------------------------------------------------------

type Group = { name: string; members: number[] };

const HARMONIC: Group[] = [
  { name: "competency", members: [1, 3, 5] },
  { name: "positive outlook", members: [2, 7, 9] },
  { name: "reactive", members: [4, 6, 8] },
];
const HORNEVIAN: Group[] = [
  { name: "assertive", members: [3, 7, 8] },
  { name: "compliant", members: [1, 2, 6] },
  { name: "withdrawn", members: [4, 5, 9] },
];
const CENTERS: Group[] = [
  { name: "body", members: [8, 9, 1] },
  { name: "heart", members: [2, 3, 4] },
  { name: "head", members: [5, 6, 7] },
];

function groupOf(groups: Group[], t: number): string | null {
  return groups.find((g) => g.members.includes(t))?.name ?? null;
}

export type EnneagramPairFact = {
  a_type: number;
  b_type: number;
  a_wing: string | null;
  b_wing: string | null;
  same_type: boolean;
  centers: { a: string | null; b: string | null; same: boolean };
  // coping style under stress (harmonic group): the most behaviorally live
  // contrast between two enneagram types that canon actually supports.
  harmonic: { a: string | null; b: string | null; same: boolean };
  // social stance (hornevian group).
  hornevian: { a: string | null; b: string | null; same: boolean };
};

type EnnResultLike = {
  primary?: { type?: number };
  wing?: { label?: string } | null;
};

export function enneagramPair(
  a: EnnResultLike | null | undefined,
  b: EnnResultLike | null | undefined,
): EnneagramPairFact | null {
  const at = a?.primary?.type;
  const bt = b?.primary?.type;
  if (typeof at !== "number" || typeof bt !== "number") return null;
  const mk = (groups: Group[]) => {
    const ga = groupOf(groups, at);
    const gb = groupOf(groups, bt);
    return { a: ga, b: gb, same: !!ga && ga === gb };
  };
  return {
    a_type: at,
    b_type: bt,
    a_wing: a?.wing?.label ?? null,
    b_wing: b?.wing?.label ?? null,
    same_type: at === bt,
    centers: mk(CENTERS),
    harmonic: mk(HARMONIC),
    hornevian: mk(HORNEVIAN),
  };
}
