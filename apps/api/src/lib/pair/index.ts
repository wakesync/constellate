// The PAIR LAYER: mechanical, deterministic pair facts from every engine that
// can honestly produce them, assembled into one object.
//
// Product rule (Shadow, 2026-07-30): the engines are EVIDENCE SOURCES for one
// reading per pair, not five separate features. This module is where their
// pair-level facts are computed (pure functions, no LLM, no fetch) and where
// they are folded into:
//   1. the harmony score (pairEvidence -> lib/convergence/harmony.ts), and
//   2. the pair narrative prompt (digest -> a compact structured block the
//      model may ONLY describe, never extend).
//
// Engines and what they contribute here:
//   human design  - the connection chart (hdConnection.ts): four channel
//                   classes, composite definition, conditioning map.
//   gene keys     - wheel geometry only (geneKeysPair.ts): programming-partner
//                   axes + shared activation keys. thin and honest.
//   socionics     - the verified 16x16 intertype relation (socEnnPair.ts).
//   enneagram     - raw type/wing/center/harmonic/hornevian contrasts as
//                   facts. NO fabricated pair-dynamics labels, and enneagram
//                   deliberately contributes NOTHING to the harmony number.
//   astrology     - already covered by the synastry aspect grid, which remains
//                   the astro pair layer.

import { connectionChart, type ConnectionChart, type HdPayloadLike } from "./hdConnection";
import { geneKeysPairing, type GeneKeysPairing, type GkPayloadLike } from "./geneKeysPair";
import { socionicsPair, enneagramPair, type SocionicsPairFact, type EnneagramPairFact } from "./socEnnPair";
import type { EnginePayloads } from "../convergence";

export type PairMechanics = {
  connection: ConnectionChart | null;
  gene_keys: GeneKeysPairing | null;
  socionics: SocionicsPairFact | null;
  enneagram: EnneagramPairFact | null;
};

type SocResultLike = { type?: { code?: string } };
type EnnResultLike = { primary?: { type?: number }; wing?: { label?: string } | null };

export function buildPairMechanics(a: EnginePayloads, b: EnginePayloads): PairMechanics {
  const hdA = a.human_design as HdPayloadLike | null;
  const hdB = b.human_design as HdPayloadLike | null;
  const gk = geneKeysPairing(a.gene_keys as GkPayloadLike | null, b.gene_keys as GkPayloadLike | null);
  return {
    connection: hdA && hdB ? connectionChart(hdA, hdB) : null,
    gene_keys: gk.programming_partners.length || gk.shared_keys.length ? gk : null,
    socionics: socionicsPair(
      (a.socionics as SocResultLike | null)?.type?.code,
      (b.socionics as SocResultLike | null)?.type?.code,
    ),
    enneagram: enneagramPair(a.enneagram as EnnResultLike | null, b.enneagram as EnnResultLike | null),
  };
}

// ---------------------------------------------------------------------------
// harmony evidence. Documented formula (docs/CONVERGENCE.md §10):
//
// Only pair facts with a DEFENSIBLE valence in their own system's canon are
// allowed to move the number, each with a small fixed weight. Correlated facts
// are deduplicated and per-engine mass is bounded so mechanics cannot swamp the
// triangulated convergence axes:
//
//   HD (one item per signed class; channels in one overlay are correlated):
//     companionship present  +0.10  (shared ground: both carry it)
//     compromise present     -0.12  (the full-channel side overrides)
//     electromagnetic + dominance channels carry NO sign: canon reads them as
//     charge and transmission respectively, both cut both ways, so they are
//     surfaced as facts and counted into confidence only via the signed items.
//   Gene Keys (cap 0.15 total):
//     programming-partner axis  +0.05 each  (opposite ends of one field,
//       canon reads the axis as complementary)
//     shared activation key     +0.04 each  (same spectrum held by both)
//   Socionics (single item): the intertype relation's classic favorability,
//     per the published comfort-ordering of the 16 relations (duality most
//     comfortable at close distance ... conflict least; wikisocion "Intertype
//     relations", sociotype.com):
//       Duality +0.30, Activity +0.22, Semi-Duality +0.16, Mirror +0.14,
//       Mirage +0.12, Identity +0.10, Kindred +0.06, Look-a-like +0.06,
//       Benefit -0.10, Quasi-Identity -0.12, Contrary -0.12, Super-Ego -0.16,
//       Supervision -0.22, Conflict -0.30.
//   Enneagram: contributes NOTHING to the number (no defensible pair valence).
// ---------------------------------------------------------------------------

export type MechEvidenceItem = {
  source: "human_design" | "gene_keys" | "socionics";
  label: string;   // human-readable receipt, house voice
  weight: number;  // contribution magnitude, > 0
};

export type PairMechEvidence = {
  agreements: MechEvidenceItem[];
  tensions: MechEvidenceItem[];
};

const SOC_VALENCE: Record<string, number> = {
  Duality: 0.3, Activity: 0.22, "Semi-Duality": 0.16, Mirror: 0.14,
  Mirage: 0.12, Identity: 0.1, Kindred: 0.06, "Look-a-like": 0.06,
  Benefit: -0.1, "Quasi-Identity": -0.12, Contrary: -0.12, "Super-Ego": -0.16,
  Supervision: -0.22, Conflict: -0.3,
};

const round3 = (n: number) => Math.round(n * 1000) / 1000;

// Cap a list of same-sign items to a total mass, scaling proportionally.
function capMass(items: MechEvidenceItem[], cap: number): MechEvidenceItem[] {
  const total = items.reduce((s, i) => s + i.weight, 0);
  if (total <= cap) return items;
  const k = cap / total;
  return items.map((i) => ({ ...i, weight: round3(i.weight * k) }));
}

export function pairEvidence(m: PairMechanics): PairMechEvidence {
  const agree: MechEvidenceItem[] = [];
  const tension: MechEvidenceItem[] = [];

  if (m.connection) {
    // Channel occurrences inside one bodygraph overlay are correlated, not
    // independent observations. Count each defensibly signed CLASS once per
    // pair. Otherwise the normal 2-6 compromise channels seen in real overlays
    // accumulate to the old cap and one engine dominates every sparse score.
    // The full channel list remains in PairMechanics and the narrative digest.
    const companionship = m.connection.channels.filter((ch) => ch.class === "companionship");
    const compromise = m.connection.channels.filter((ch) => ch.class === "compromise");
    if (companionship.length) {
      agree.push({
        source: "human_design",
        label: `${companionship.length} companionship channel${companionship.length === 1 ? "" : "s"}: shared ground in the connection chart`,
        weight: 0.1,
      });
    }
    if (compromise.length) {
      tension.push({
        source: "human_design",
        label: `${compromise.length} compromise channel${compromise.length === 1 ? "" : "s"}: full-channel expression overrides a hanging gate`,
        weight: 0.12,
      });
    }
  }

  if (m.gene_keys) {
    const gkAgree: MechEvidenceItem[] = [];
    for (const p of m.gene_keys.programming_partners) {
      gkAgree.push({ source: "gene_keys", label: `programming partners: gate ${p.a_gate} (${p.a_sphere}) opposite gate ${p.b_gate} (${p.b_sphere}), one field worked from both ends`, weight: 0.05 });
    }
    for (const s of m.gene_keys.shared_keys) {
      gkAgree.push({ source: "gene_keys", label: `shared key ${s.gate}: the same spectrum sits in both sequences`, weight: 0.04 });
    }
    agree.push(...capMass(gkAgree, 0.15));
  }

  if (m.socionics) {
    const v = SOC_VALENCE[m.socionics.relation.kind] ?? 0;
    if (v > 0) {
      agree.push({ source: "socionics", label: `intertype: ${m.socionics.relation.kind.toLowerCase()} (${m.socionics.a_type} x ${m.socionics.b_type})`, weight: v });
    } else if (v < 0) {
      tension.push({ source: "socionics", label: `intertype: ${m.socionics.relation.kind.toLowerCase()} (${m.socionics.a_type} x ${m.socionics.b_type})`, weight: -v });
    }
  }

  return { agreements: agree, tensions: tension };
}

// ---------------------------------------------------------------------------
// the prompt digest: a compact structured block for the narrative model.
// Names are attached so the model can attribute correctly. Everything in here
// is a computed fact; the prompt forbids extending it.
// ---------------------------------------------------------------------------
export function mechanicsDigest(m: PairMechanics, aName: string, bName: string): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  if (m.connection && m.connection.channels.length) {
    out.human_design_connection = {
      note: "channel classes: electromagnetic = each carries one gate, exists only together (spark). companionship = both carry the full channel (shared ground). dominance = one has the full channel, the other neither gate (one transmits, the other receives it whole). compromise = one full channel vs the other's single gate (the full side overrides).",
      channels: m.connection.channels.map((c) => ({
        channel: `${c.key} ${c.name.toLowerCase()}`,
        between_centers: c.centers.join(" and "),
        class: c.class,
        ...(c.dominant ? { full_channel_side: c.dominant === "a" ? aName : bName } : {}),
      })),
      centers_defined_only_together: m.connection.composite_centers,
      [`${aName}_open_centers_defined_by_${bName}`]: m.connection.a_open_defined_by_b,
      [`${bName}_open_centers_defined_by_${aName}`]: m.connection.b_open_defined_by_a,
    };
  }
  if (m.gene_keys) {
    out.gene_keys = {
      programming_partner_axes: m.gene_keys.programming_partners.map((p) => ({
        [aName]: `gate ${p.a_gate} in the ${p.a_sphere} sphere${p.a_triad ? ` (shadow ${p.a_triad.shadow.toLowerCase()}, gift ${p.a_triad.gift.toLowerCase()})` : ""}`,
        [bName]: `gate ${p.b_gate} in the ${p.b_sphere} sphere${p.b_triad ? ` (shadow ${p.b_triad.shadow.toLowerCase()}, gift ${p.b_triad.gift.toLowerCase()})` : ""}`,
        note: "opposite gates on the wheel: the same field worked from opposite ends",
      })),
      shared_keys: m.gene_keys.shared_keys.map((s) => ({
        gate: s.gate,
        [`${aName}_spheres`]: s.a_spheres,
        [`${bName}_spheres`]: s.b_spheres,
        ...(s.triad ? { spectrum: `${s.triad.shadow.toLowerCase()} to ${s.triad.gift.toLowerCase()} to ${s.triad.siddhi.toLowerCase()}` } : {}),
      })),
    };
  }
  if (m.socionics) {
    out.socionics_intertype = {
      [aName]: m.socionics.a_type,
      [bName]: m.socionics.b_type,
      relation: m.socionics.relation.kind,
      ...(m.socionics.relation.direction
        ? { direction: `${m.socionics.relation.direction === "supervisor" || m.socionics.relation.direction === "benefactor" ? aName : bName} is the ${m.socionics.relation.direction === "supervisor" || m.socionics.relation.direction === "supervisee" ? "supervisor" : "benefactor"}` }
        : {}),
      blurb: m.socionics.relation.blurb,
    };
  }
  if (m.enneagram) {
    out.enneagram_contrast = {
      [aName]: { type: m.enneagram.a_type, wing: m.enneagram.a_wing, center: m.enneagram.centers.a, coping_under_stress: m.enneagram.harmonic.a, social_stance: m.enneagram.hornevian.a },
      [bName]: { type: m.enneagram.b_type, wing: m.enneagram.b_wing, center: m.enneagram.centers.b, coping_under_stress: m.enneagram.harmonic.b, social_stance: m.enneagram.hornevian.b },
      note: "raw type facts only. no pair-dynamics label exists in canon; describe the contrast, do not invent a relationship type.",
    };
  }
  return Object.keys(out).length ? out : null;
}
