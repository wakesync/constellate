// Invariant test for the socionics Model A stacks + the 16x16 intertype matrix.
// Run: npx tsx apps/api/test/socionics.matrix.test.ts   (from repo root)
//
// This is the correctness bar for the lane. It asserts:
//   Model A:
//     - every type uses all 8 elements exactly once
//     - four published stacks match exactly (ILE, SEI, ESE, LII)
//     - the derived dual matches the matrix's Duality cell
//   Matrix:
//     - 16x16, every cell a known relation
//     - identity on the diagonal (and ONLY the diagonal)
//     - duality is symmetric, and each type has exactly ONE dual
//     - symmetric relations are actually symmetric (M[i][j]==M[j][i])
//     - Benefit and Supervision are asymmetric and mirror correctly
//       (if A benefacts B, then B is beneficiary of A; same for supervision)
//     - Benefit rings and Supervision rings are rings of 4 (closed cycles)

import {
  TYPES, CODES, buildModelA, relationBetween, dualOf, TYPE_BY_CODE,
  _internal, type Element,
} from "../src/lib/socionics";

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
// Model A
// ---------------------------------------------------------------------------
console.log("Model A stacks");

const ALL_ELEMENTS: Element[] = ["Ne", "Ni", "Se", "Si", "Te", "Ti", "Fe", "Fi"];
for (const t of TYPES) {
  const stack = buildModelA(t.base, t.creative);
  ok(stack.length === 8, `${t.code}: stack has 8 positions`);
  const els = stack.map((p) => p.element);
  const uniq = new Set(els);
  ok(uniq.size === 8, `${t.code}: uses 8 distinct elements (got ${els.join(",")})`);
  for (const e of ALL_ELEMENTS) ok(uniq.has(e), `${t.code}: contains ${e}`);
  ok(stack[0].element === t.base, `${t.code}: position 1 is base ${t.base}`);
  ok(stack[1].element === t.creative, `${t.code}: position 2 is creative ${t.creative}`);
  ok(stack[0].block === "Ego" && stack[1].block === "Ego", `${t.code}: 1,2 are Ego`);
  ok(stack[2].block === "Super-Ego" && stack[3].block === "Super-Ego", `${t.code}: 3,4 Super-Ego`);
  ok(stack[4].block === "Super-Id" && stack[5].block === "Super-Id", `${t.code}: 5,6 Super-Id`);
  ok(stack[6].block === "Id" && stack[7].block === "Id", `${t.code}: 7,8 Id`);
}

// four published reference stacks (element per position 1..8)
const REFERENCE: Record<string, Element[]> = {
  // ILE (ENTp): Ne Ti Se Fi Si Fe Ni Te
  ILE: ["Ne", "Ti", "Se", "Fi", "Si", "Fe", "Ni", "Te"],
  // SEI (ISFp): Si Fe Ni Te Ne Ti Se Fi
  SEI: ["Si", "Fe", "Ni", "Te", "Ne", "Ti", "Se", "Fi"],
  // ESE (ESFj): Fe Si Te Ni Ti Ne Fi Se
  ESE: ["Fe", "Si", "Te", "Ni", "Ti", "Ne", "Fi", "Se"],
  // LII (INTj): Ti Ne Fi Se Fe Si Te Ni
  LII: ["Ti", "Ne", "Fi", "Se", "Fe", "Si", "Te", "Ni"],
};
for (const [code, ref] of Object.entries(REFERENCE)) {
  const t = TYPE_BY_CODE[code];
  const stack = buildModelA(t.base, t.creative).map((p) => p.element);
  ok(JSON.stringify(stack) === JSON.stringify(ref), `${code}: matches published Model A stack (got ${stack.join(",")}, want ${ref.join(",")})`);
}

// ---------------------------------------------------------------------------
// Matrix shape + identity diagonal
// ---------------------------------------------------------------------------
console.log("Matrix shape");
const { MATRIX, SOCION_ORDER } = _internal;
ok(MATRIX.length === 16, "matrix has 16 rows");
for (let i = 0; i < 16; i++) ok(MATRIX[i].length === 16, `row ${i} has 16 cells`);

for (let i = 0; i < 16; i++) {
  for (let j = 0; j < 16; j++) {
    const rel = relationBetween(SOCION_ORDER[i], SOCION_ORDER[j]);
    if (i === j) {
      ok(rel.kind === "Identity", `diagonal [${SOCION_ORDER[i]}] is Identity`);
    } else {
      ok(rel.kind !== "Identity", `off-diagonal [${SOCION_ORDER[i]},${SOCION_ORDER[j]}] is not Identity`);
    }
  }
}

// ---------------------------------------------------------------------------
// Duality: symmetric, unique, one per type, and matches derived dual
// ---------------------------------------------------------------------------
console.log("Duality");
for (const a of CODES) {
  const duals = CODES.filter((b) => b !== a && relationBetween(a, b).kind === "Duality");
  ok(duals.length === 1, `${a}: has exactly one dual (got ${duals.join(",") || "none"})`);
  if (duals.length === 1) {
    const b = duals[0];
    ok(relationBetween(b, a).kind === "Duality", `${a}<->${b}: duality is symmetric`);
    ok(dualOf(a).code === b, `${a}: derived dual (${dualOf(a).code}) matches matrix dual (${b})`);
    ok(dualOf(b).code === a, `${b}: derived dual (${dualOf(b).code}) matches matrix dual (${a})`);
  }
}

// ---------------------------------------------------------------------------
// Symmetric relations really are symmetric
// ---------------------------------------------------------------------------
console.log("Symmetry");
const SYMMETRIC = new Set([
  "Identity", "Duality", "Activity", "Mirror", "Semi-Duality", "Mirage",
  "Look-a-like", "Kindred", "Contrary", "Super-Ego", "Quasi-Identity", "Conflict",
]);
for (let i = 0; i < 16; i++) {
  for (let j = 0; j < 16; j++) {
    const a = SOCION_ORDER[i], b = SOCION_ORDER[j];
    const rab = relationBetween(a, b);
    const rba = relationBetween(b, a);
    if (SYMMETRIC.has(rab.kind)) {
      ok(rab.kind === rba.kind, `${a},${b}: ${rab.kind} is symmetric`);
    }
  }
}

// ---------------------------------------------------------------------------
// Benefit + Supervision: asymmetric, correctly mirrored, rings of 4
// ---------------------------------------------------------------------------
console.log("Asymmetric (Benefit / Supervision)");
for (let i = 0; i < 16; i++) {
  for (let j = 0; j < 16; j++) {
    if (i === j) continue;
    const a = SOCION_ORDER[i], b = SOCION_ORDER[j];
    const rab = relationBetween(a, b);
    const rba = relationBetween(b, a);
    if (rab.kind === "Benefit") {
      ok(rba.kind === "Benefit", `${a},${b}: benefit mirrored as benefit`);
      ok(rab.direction !== rba.direction, `${a},${b}: benefit direction flips`);
      if (rab.direction === "benefactor") ok(rba.direction === "beneficiary", `${a}->${b} benefactor => beneficiary back`);
      if (rab.direction === "beneficiary") ok(rba.direction === "benefactor", `${a}<-${b} beneficiary => benefactor back`);
    }
    if (rab.kind === "Supervision") {
      ok(rba.kind === "Supervision", `${a},${b}: supervision mirrored`);
      if (rab.direction === "supervisor") ok(rba.direction === "supervisee", `${a}->${b} supervisor => supervisee back`);
      if (rab.direction === "supervisee") ok(rba.direction === "supervisor", `${a}<-${b} supervisee => supervisor back`);
    }
  }
}

// each type has exactly one "I benefit" (benefactor), one "I am benefited"
// (beneficiary), one "I supervise", one "I am supervised".
console.log("One of each asymmetric role per type");
for (const a of CODES) {
  const benefactorTo = CODES.filter((b) => {
    const r = relationBetween(a, b);
    return r.kind === "Benefit" && r.direction === "benefactor";
  });
  const beneficiaryOf = CODES.filter((b) => {
    const r = relationBetween(a, b);
    return r.kind === "Benefit" && r.direction === "beneficiary";
  });
  const supervises = CODES.filter((b) => {
    const r = relationBetween(a, b);
    return r.kind === "Supervision" && r.direction === "supervisor";
  });
  const supervisedBy = CODES.filter((b) => {
    const r = relationBetween(a, b);
    return r.kind === "Supervision" && r.direction === "supervisee";
  });
  ok(benefactorTo.length === 1, `${a}: benefactor to exactly one (${benefactorTo.join(",")})`);
  ok(beneficiaryOf.length === 1, `${a}: beneficiary of exactly one (${beneficiaryOf.join(",")})`);
  ok(supervises.length === 1, `${a}: supervises exactly one (${supervises.join(",")})`);
  ok(supervisedBy.length === 1, `${a}: supervised by exactly one (${supervisedBy.join(",")})`);
}

// rings of 4: follow "I supervise X, X supervises Y, ..." back to start in 4 steps.
console.log("Supervision + Benefit rings of 4");
function follow(startCode: string, step: (from: string) => string): string[] {
  const ring = [startCode];
  let cur = startCode;
  for (let n = 0; n < 8; n++) {
    const next = step(cur);
    if (next === startCode) return ring;
    ring.push(next);
    cur = next;
  }
  return ring; // will be >4 if it never closed, flagged below
}
const nextSupervisee = (from: string) => CODES.find((b) => {
  const r = relationBetween(from, b);
  return r.kind === "Supervision" && r.direction === "supervisor";
})!;
const nextBeneficiary = (from: string) => CODES.find((b) => {
  const r = relationBetween(from, b);
  return r.kind === "Benefit" && r.direction === "benefactor";
})!;

const seenSup = new Set<string>();
for (const start of CODES) {
  if (seenSup.has(start)) continue;
  const ring = follow(start, nextSupervisee);
  ok(ring.length === 4, `supervision ring from ${start} is length 4 (${ring.join(" -> ")})`);
  ring.forEach((c) => seenSup.add(c));
}
const seenBn = new Set<string>();
for (const start of CODES) {
  if (seenBn.has(start)) continue;
  const ring = follow(start, nextBeneficiary);
  ok(ring.length === 4, `benefit ring from ${start} is length 4 (${ring.join(" -> ")})`);
  ring.forEach((c) => seenBn.add(c));
}

// every off-diagonal cell resolves to a known relation kind
console.log("Coverage");
const KNOWN = new Set([
  "Identity", "Duality", "Activity", "Mirror", "Semi-Duality", "Mirage",
  "Look-a-like", "Kindred", "Contrary", "Super-Ego", "Quasi-Identity",
  "Conflict", "Benefit", "Supervision",
]);
for (const a of CODES) for (const b of CODES) {
  ok(KNOWN.has(relationBetween(a, b).kind), `${a},${b}: known relation kind`);
}

// ---------------------------------------------------------------------------
console.log("");
if (failures === 0) {
  console.log(`PASS  ${checks} assertions, 0 failures`);
  process.exit(0);
} else {
  console.error(`FAIL  ${failures} of ${checks} assertions failed`);
  process.exit(1);
}
