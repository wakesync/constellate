// Unit tests for the pair layer (lib/pair): HD connection chart classification,
// gene keys wheel geometry, socionics intertype pair facts (symmetric AND
// asymmetric), enneagram raw contrasts, and the harmony fold-in.
// Run: npx tsx apps/api/test/pair-mechanics.test.ts   (from repo root)

import { CHANNELS, GATE_WHEEL, programmingPartner, CENTER_ORDER } from "../src/lib/pair/hdChannels";
import { connectionChart, classifyChannel, activeGates, definedCenters, type HdPayloadLike } from "../src/lib/pair/hdConnection";
import { geneKeysPairing, type GkPayloadLike } from "../src/lib/pair/geneKeysPair";
import { socionicsPair, enneagramPair } from "../src/lib/pair/socEnnPair";
import { buildPairMechanics, pairEvidence, mechanicsDigest } from "../src/lib/pair";
import { scoreHarmony } from "../src/lib/convergence/harmony";
import type { Convergence } from "../src/lib/convergence/score";

let failures = 0;
let checks = 0;
function ok(cond: boolean, msg: string) {
  checks++;
  if (!cond) {
    failures++;
    console.error("  FAIL:", msg);
  }
}

// ---------------------------------------------------------------------------
console.log("channel table invariants (must mirror services/astro/hd.py)");
{
  ok(CHANNELS.length === 36, `36 canonical channels, got ${CHANNELS.length}`);
  const keys = new Set(CHANNELS.map((c) => c.key));
  ok(keys.size === 36, "channel keys are unique");
  const gates = new Set(CHANNELS.flatMap((c) => c.gates));
  ok(gates.size === 64, `all 64 gates appear in the channel table, got ${gates.size}`);
  for (const c of CHANNELS) {
    ok(CENTER_ORDER.includes(c.centers[0]) && CENTER_ORDER.includes(c.centers[1]), `centers valid for ${c.key}`);
  }
  ok(GATE_WHEEL.length === 64 && new Set(GATE_WHEEL).size === 64, "gate wheel has each gate exactly once");
}

console.log("programming partner geometry (opposite on the wheel)");
{
  // canon spot checks: 1<->2, 4<->49 are published programming partner pairs.
  ok(programmingPartner(1) === 2, `pp(1) = 2, got ${programmingPartner(1)}`);
  ok(programmingPartner(2) === 1, "pp(2) = 1");
  ok(programmingPartner(4) === 49, `pp(4) = 49, got ${programmingPartner(4)}`);
  ok(programmingPartner(49) === 4, "pp(49) = 4");
  // involution: pp(pp(g)) === g for every gate.
  ok(GATE_WHEEL.every((g) => programmingPartner(programmingPartner(g)!) === g), "pp is an involution");
  ok(programmingPartner(999) === null, "unknown gate -> null");
}

// ---------------------------------------------------------------------------
console.log("connection chart: all four channel classes");
{
  // Build synthetic charts around channel 34-57 (Power, Sacral-Spleen) and
  // friends. helper to make an hd payload from a gate list.
  const hd = (gates: number[]): HdPayloadLike => ({
    gates: { personality: gates.map((g) => ({ gate: g })), design: [] },
  });

  // electromagnetic: A has 34, B has 57. neither alone, together defined.
  {
    const chart = connectionChart(hd([34]), hd([57]));
    const c = chart.channels.find((x) => x.key === "34-57");
    ok(!!c && c.class === "electromagnetic", "34 + 57 split across two people = electromagnetic");
    ok(!!c && c.dominant === null, "electromagnetic has no dominant side");
    ok(!!c && c.a_gates.join() === "34" && c.b_gates.join() === "57", "gate contributions recorded per side");
  }

  // companionship: both have 34 and 57.
  {
    const chart = connectionChart(hd([34, 57]), hd([34, 57]));
    const c = chart.channels.find((x) => x.key === "34-57");
    ok(!!c && c.class === "companionship", "both full = companionship");
    ok(!!c && c.dominant === null, "companionship has no dominant side");
  }

  // dominance: A has full 34-57, B has neither gate.
  {
    const chart = connectionChart(hd([34, 57]), hd([1]));
    const c = chart.channels.find((x) => x.key === "34-57");
    ok(!!c && c.class === "dominance" && c.dominant === "a", "full vs none = dominance, a dominant");
    // asymmetry: swap the people, dominance flips side.
    const flipped = connectionChart(hd([1]), hd([34, 57])).channels.find((x) => x.key === "34-57");
    ok(!!flipped && flipped.class === "dominance" && flipped.dominant === "b", "dominance direction flips with the pair order");
  }

  // compromise: A has full 34-57, B has just 57.
  {
    const chart = connectionChart(hd([34, 57]), hd([57]));
    const c = chart.channels.find((x) => x.key === "34-57");
    ok(!!c && c.class === "compromise" && c.dominant === "a", "full vs one gate = compromise, full side dominant");
    ok(!!c && c.b_gates.join() === "57", "compromise records the overridden half");
  }

  // no channel: A has 34, B has nothing relevant.
  {
    const chart = connectionChart(hd([34]), hd([1]));
    ok(!chart.channels.find((x) => x.key === "34-57"), "hanging gate alone defines nothing");
  }
}

console.log("connection chart: composite definition + conditioning");
{
  const hd = (gates: number[]): HdPayloadLike => ({
    gates: { personality: gates.map((g) => ({ gate: g })), design: [] },
  });
  // A carries 34 (sacral hanging gate) + full 18-58 (Spleen-Root -> defines both).
  // B carries 57 (spleen hanging gate) only.
  const a = hd([34, 18, 58]);
  const b = hd([57]);
  const chart = connectionChart(a, b);
  // electromagnetic 34-57 defines Sacral + Spleen. A already defines Spleen
  // (18-58), so composite (only-together) = Sacral only.
  ok(chart.channels.find((x) => x.key === "34-57")?.class === "electromagnetic", "34-57 electromagnetic in overlay");
  ok(chart.composite_centers.join() === "Sacral", `composite = Sacral only, got ${chart.composite_centers.join()}`);
  // conditioning: A defines Spleen + Root alone; B defines nothing alone.
  ok(chart.b_open_defined_by_a.includes("Spleen") && chart.b_open_defined_by_a.includes("Root"), "B's open spleen+root are defined by A");
  ok(chart.a_open_defined_by_b.length === 0, "B alone defines nothing, so conditions nothing");
  ok(chart.defined_together === 3, `sacral+spleen+root defined together, got ${chart.defined_together}`);

  // determinism: same inputs, byte-identical output.
  ok(JSON.stringify(connectionChart(a, b)) === JSON.stringify(connectionChart(a, b)), "connection chart is deterministic");
}

console.log("connection chart: real-shape payload (design+personality merge)");
{
  const a: HdPayloadLike = {
    gates: {
      personality: [{ gate: 13 }],
      design: [{ gate: 33 }],
    },
  };
  ok([...activeGates(a)].sort((x, y) => x - y).join() === "13,33", "active gates merge personality + design");
  ok(definedCenters(activeGates(a)).size === 2, "13+33 defines Throat + G");
}

// ---------------------------------------------------------------------------
console.log("gene keys pairing: programming partners + shared keys");
{
  const gk = (gates: [number, number, number, number]): GkPayloadLike => ({
    activation: {
      lifes_work: { gate: gates[0], line: 1 },
      evolution: { gate: gates[1], line: 1 },
      radiance: { gate: gates[2], line: 1 },
      purpose: { gate: gates[3], line: 1 },
    },
    keys: gates.map((g) => ({ gate: g, shadow: `S${g}`, gift: `G${g}`, siddhi: `Z${g}` })),
  });

  // A's life's work gate 1; B's life's work gate 2 (= pp(1)). plus a shared key
  // 30. (careful fixture: avoid accidental second axes like 9<->16.)
  const a = gk([1, 30, 43, 9]);
  const b = gk([2, 30, 44, 15]);
  const p = geneKeysPairing(a, b);
  ok(p.programming_partners.length === 1, `one pp axis, got ${p.programming_partners.length}`);
  ok(p.programming_partners[0]?.a_gate === 1 && p.programming_partners[0]?.b_gate === 2, "1 <-> 2 axis found");
  ok(p.programming_partners[0]?.a_sphere === "life's work", "sphere label carried");
  ok(p.programming_partners[0]?.a_triad?.shadow === "S1", "triad carried from keys[]");
  ok(p.shared_keys.length === 1 && p.shared_keys[0]?.gate === 30, "shared key 30 found");
  ok(p.shared_keys[0]?.a_spheres.join() === "evolution" && p.shared_keys[0]?.b_spheres.join() === "evolution", "shared key sphere positions recorded");
  // no fabricated cross-contacts: nothing else appears.
  ok(geneKeysPairing(null, b).programming_partners.length === 0, "missing payload -> empty, no invention");
  // determinism
  ok(JSON.stringify(geneKeysPairing(a, b)) === JSON.stringify(geneKeysPairing(a, b)), "gk pairing deterministic");
}

// ---------------------------------------------------------------------------
console.log("socionics pair: symmetric and asymmetric relations");
{
  const dual = socionicsPair("ILE", "SEI");
  ok(dual?.relation.kind === "Duality" && dual.relation.symmetric === true, "ILE x SEI = duality (symmetric)");

  const conflict = socionicsPair("ILE", "ESI");
  ok(conflict?.relation.kind === "Conflict", "ILE x ESI = conflict");

  // supervision is DIRECTIONAL: ILE supervises LSI (row->column in the matrix).
  const supAB = socionicsPair("ILE", "LSI");
  const supBA = socionicsPair("LSI", "ILE");
  ok(supAB?.relation.kind === "Supervision" && supAB.relation.direction === "supervisor", "ILE -> LSI: ILE is supervisor");
  ok(supBA?.relation.kind === "Supervision" && supBA.relation.direction === "supervisee", "LSI -> ILE: LSI is supervisee");

  // benefit is directional too: ILE is benefactor of EIE.
  const benAB = socionicsPair("ILE", "EIE");
  const benBA = socionicsPair("EIE", "ILE");
  ok(benAB?.relation.kind === "Benefit" && benAB.relation.direction === "benefactor", "ILE -> EIE: benefactor");
  ok(benBA?.relation.kind === "Benefit" && benBA.relation.direction === "beneficiary", "EIE -> ILE: beneficiary");

  ok(socionicsPair(null, "SEI") === null, "missing type -> null, never a fabricated relation");
  ok(socionicsPair("XXX", "SEI") === null, "unknown code -> null");
}

console.log("enneagram pair: raw facts, no fabricated labels");
{
  const e = (t: number, wing: string | null) => ({ primary: { type: t }, wing: wing ? { label: wing } : null });
  const f = enneagramPair(e(1, "1w9"), e(7, "7w8"));
  ok(f?.a_type === 1 && f.b_type === 7, "types carried");
  ok(f?.centers.a === "body" && f?.centers.b === "head" && f?.centers.same === false, "centers contrast (body vs head)");
  ok(f?.harmonic.a === "competency" && f?.harmonic.b === "positive outlook" && !f.harmonic.same, "harmonic groups contrast");
  ok(f?.hornevian.a === "compliant" && f?.hornevian.b === "assertive" && !f.hornevian.same, "hornevian groups contrast");
  const same = enneagramPair(e(9, null), e(9, null));
  ok(same?.same_type === true && same.centers.same && same.harmonic.same && same.hornevian.same, "same type -> all groups shared");
  ok(enneagramPair(null, e(1, null)) === null, "missing result -> null");
  // no relationship label anywhere in the fact object.
  ok(!("relation" in (f as object)) && !("label" in (f as object)), "no invented pair label");
}

// ---------------------------------------------------------------------------
console.log("pair evidence: valence, caps, and the harmony fold-in");
{
  const hd = (gates: number[]): HdPayloadLike => ({ gates: { personality: gates.map((g) => ({ gate: g })), design: [] } });
  const mech = buildPairMechanics(
    { human_design: hd([34, 57, 18, 58]), socionics: { type: { code: "ILE" } }, gene_keys: null, enneagram: { primary: { type: 1 } }, astro: null },
    { human_design: hd([34, 57, 58]), socionics: { type: { code: "SEI" } }, gene_keys: null, enneagram: { primary: { type: 7 } }, astro: null },
  );
  // 34-57 companionship (both full), 18-58: a full vs b's single 58 = compromise.
  const ev = pairEvidence(mech);
  ok(ev.agreements.some((i) => i.source === "human_design" && i.label.includes("1 companionship channel")), "companionship class counted once as agreement");
  ok(ev.tensions.some((i) => i.source === "human_design" && i.label.includes("1 compromise channel")), "compromise class counted once as tension");
  ok(ev.agreements.some((i) => i.source === "socionics" && i.label.includes("duality")), "duality counted as agreement");
  // enneagram never contributes to the number.
  ok(!ev.agreements.some((i) => i.source as string === "enneagram") && !ev.tensions.some((i) => i.source as string === "enneagram"), "enneagram contributes zero mass");

  // correlated channels: 10 companionship channels remain one class-level item.
  const many = { connection: { channels: Array.from({ length: 10 }, (_, i) => ({ key: `k${i}`, name: "X", gates: [1, 2] as [number, number], centers: ["G", "Throat"] as any, class: "companionship" as const, dominant: null, a_gates: [1, 2], b_gates: [1, 2] })), counts: { electromagnetic: 0, companionship: 10, dominance: 0, compromise: 0 }, composite_centers: [], a_open_defined_by_b: [], b_open_defined_by_a: [], defined_together: 0 }, gene_keys: null, socionics: null, enneagram: null };
  const capped = pairEvidence(many as any);
  const mass = capped.agreements.reduce((s, i) => s + i.weight, 0);
  ok(Math.abs(mass - 0.1) < 1e-9 && capped.agreements.length === 1, `hd class contributes once (mass 0.1), got ${mass}`);

  // harmony fold-in: mech agreements raise the score, mech tensions lower it.
  const conv = (axis: string, value: number): Convergence => ({
    axis, label: axis, direction: "x", value, strength: 0.6,
    sources: ["human_design", "enneagram", "socionics"] as any, evidence: [],
  });
  const A = [conv("initiation", 0.5)];
  const B = [conv("initiation", 0.5)];
  const base = scoreHarmony(A, B)!;
  const withAgree = scoreHarmony(A, B, { agreements: [{ source: "socionics", label: "duality", weight: 0.3 }], tensions: [] })!;
  const withTension = scoreHarmony(A, B, { agreements: [], tensions: [{ source: "socionics", label: "conflict", weight: 0.3 }] })!;
  ok(withAgree.score >= base.score, `mech agreement never lowers the score (${base.score} -> ${withAgree.score})`);
  ok(withAgree.confidence > base.confidence, "mech evidence raises confidence");
  ok(withTension.score < base.score, `mech tension lowers the score (${base.score} -> ${withTension.score})`);
  ok(withAgree.mech_agreements?.length === 1 && withTension.mech_tensions?.length === 1, "mech items carried in the result");
  ok(base.mech_agreements === undefined, "axis-only result omits mech fields (back-compat)");
  // mech-only: no shared axes but real mechanical evidence still scores.
  const mechOnly = scoreHarmony([], [], { agreements: [{ source: "human_design", label: "companionship", weight: 0.2 }], tensions: [] });
  ok(mechOnly !== null && mechOnly.score > 50, "mechanical evidence alone can carry a (low-confidence) score");
  ok(scoreHarmony([], [], { agreements: [], tensions: [] }) === null, "nothing at all -> null, never fabricated");
  // determinism of the full path.
  ok(JSON.stringify(scoreHarmony(A, B, pairEvidence(mech))) === JSON.stringify(scoreHarmony(A, B, pairEvidence(mech))), "harmony with mech evidence is deterministic");
}

console.log("digest: facts only, names attached, nothing invented");
{
  const hd = (gates: number[]): HdPayloadLike => ({ gates: { personality: gates.map((g) => ({ gate: g })), design: [] } });
  const mech = buildPairMechanics(
    { human_design: hd([34]), socionics: { type: { code: "ILE" } }, gene_keys: null, enneagram: null, astro: null },
    { human_design: hd([57]), socionics: { type: { code: "LSI" } }, gene_keys: null, enneagram: null, astro: null },
  );
  const d = mechanicsDigest(mech, "ada", "bram")!;
  ok(!!d.human_design_connection, "digest carries the connection block");
  ok(JSON.stringify(d).includes("34-57"), "digest names the actual channel");
  const soc = d.socionics_intertype as Record<string, unknown>;
  ok(soc.relation === "Supervision" && String(soc.direction).includes("ada is the supervisor"), "asymmetric direction attributed by name");
  ok(mechanicsDigest(buildPairMechanics({ astro: null, human_design: null, gene_keys: null, enneagram: null, socionics: null }, { astro: null, human_design: null, gene_keys: null, enneagram: null, socionics: null }), "a", "b") === null, "empty mechanics -> null digest");
}

if (failures > 0) {
  console.error(`\nFAIL ${failures}/${checks} checks failed`);
  process.exit(1);
}
console.log(`\nPASS ${checks}/${checks} checks`);
