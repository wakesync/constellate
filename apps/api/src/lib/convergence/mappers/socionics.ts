// Socionics -> shared trait space.
//
// Socionics gives us two very clean things: four measured dichotomies in 0..1
// (extraversion, intuition, logic, irrationality) and the winning type's Model A
// (base + creative element). The dichotomies map almost directly onto several
// axes; the base element sharpens time-orientation and sensitivity.
//
// It is a self-report instrument with an honest confidence field, so we scale
// every signal by that confidence. A 0.9-confidence result speaks near full
// weight; a coin-flip result is quieted.
//
// Reads the stored SocionicsResult:
//   { type:{code}, confidence, dichotomies:{extraversion,intuition,logic,
//     irrationality}, model_a:[{position,element,role}], quadra }

import { makeSignal, type Signal } from "../axes";

type ModelAPos = { position?: number; element?: string; role?: string };
type SocResult = {
  type?: { code?: string; nickname?: string };
  confidence?: number;
  dichotomies?: {
    extraversion?: number; // 0..1, 1 = extroverted
    intuition?: number;    // 0..1, 1 = intuitive (vs sensing)
    logic?: number;        // 0..1, 1 = logic/thinking (vs ethics/feeling)
    irrationality?: number;// 0..1, 1 = irrational/perceiving lead (vs rational)
  };
  model_a?: ModelAPos[];
};

// map a 0..1 dichotomy to a -1..1 axis value.
const spread = (d: number) => Math.max(-1, Math.min(1, (d - 0.5) * 2));

export function mapSocionics(r: SocResult | null | undefined): Signal[] {
  if (!r || !r.dichotomies || !r.type?.code) return [];
  const conf = typeof r.confidence === "number" ? Math.max(0.2, Math.min(1, r.confidence)) : 0.6;
  const d = r.dichotomies;
  const code = r.type.code;
  const base = r.model_a?.find((p) => p.position === 1)?.element ?? "";
  const out: (Signal | null)[] = [];
  // magnitude-aware weight: a strongly-expressed dichotomy speaks louder than a
  // near-neutral one. We fold both the confidence and the |dichotomy| distance
  // from neutral into the weight.
  const W = (baseW: number, dichVal: number) =>
    baseW * conf * (0.4 + 0.6 * Math.abs(spread(dichVal)));
  const S = (axis: string, dichVal: number, baseW: number, e: string) =>
    out.push(makeSignal("socionics", axis, spread(dichVal), W(baseW, dichVal), e));

  // --- initiation ---------------------------------------------------------
  // Extraversion in socionics is about directing energy outward at the world
  // (initiating) vs taking it in first (responsive).
  if (typeof d.extraversion === "number") {
    if (d.extraversion >= 0.5) {
      S("initiation", d.extraversion, 0.55, `as ${code}, you lead with an extroverted element, directing energy outward. you tend to act on the world first.`);
    } else {
      S("initiation", d.extraversion, 0.55, `as ${code}, you lead with an introverted element, taking the world in before acting. you respond more than you initiate.`);
    }
    // extraversion also lightly informs recognition-seeking (outer orientation).
    S("recognition", d.extraversion, 0.3, `your ${code} orientation runs ${d.extraversion >= 0.5 ? "outward, toward engagement and being met" : "inward, needing less from the room"}.`);
  }

  // --- head_heart ---------------------------------------------------------
  // logic (T) vs ethics (F) is socionics' cleanest statement here. Value sign
  // must FLIP: our head_heart axis is +feeling, so high logic => negative.
  if (typeof d.logic === "number") {
    S("head_heart", 1 - d.logic, 0.7,
      d.logic >= 0.5
        ? `as ${code}, you lead with a logical element: systems and what works land before the feeling of it.`
        : `as ${code}, you lead with an ethical element: the feeling and the relationship land before the logic.`);
  }

  // --- abstraction --------------------------------------------------------
  // intuition (N) vs sensing (S) maps directly onto abstraction vs concrete.
  if (typeof d.intuition === "number") {
    S("abstraction", d.intuition, 0.7,
      d.intuition >= 0.5
        ? `as ${code}, an intuitive lead pulls you toward patterns and possibilities over the concrete here-and-now.`
        : `as ${code}, a sensing lead keeps you grounded in the tangible and actual rather than the abstract.`);
  }

  // --- structure ----------------------------------------------------------
  // rationality (judging lead) vs irrationality (perceiving lead). Our axis is
  // +structure, so high irrationality => negative (improvises).
  if (typeof d.irrationality === "number") {
    S("structure", 1 - d.irrationality, 0.55,
      d.irrationality >= 0.5
        ? `as ${code}, an irrational (perceiving) lead keeps you flexible and improvisational, letting the shape emerge.`
        : `as ${code}, a rational (judging) lead reaches for order and a settled plan.`);
  }

  // --- time_orientation, sensitivity: from the BASE element ---------------
  // These are element-specific, not dichotomy-wide, so weight from confidence
  // alone (the element is a fact of the type, not a graded measurement).
  const eW = 0.6 * conf;
  const eS = (axis: string, v: number, e: string) =>
    out.push(makeSignal("socionics", axis, v, eW, e));
  if (base === "Ni") eS("time_orientation", 0.85, `your base function is Ni, intuition of time. your attention lives in how things ripen and arrive, the long unfolding view.`);
  else if (base === "Se") eS("time_orientation", -0.7, `your base function is Se, force in the present. your attention lives in the immediate, the pressure of the now.`);
  else if (base === "Si") eS("time_orientation", -0.5, `your base function is Si, the body's read of the present moment. you rest in the concrete now.`);

  if (base === "Si") eS("sensitivity", 0.4, `your base function is Si means you read the room through comfort and bodily state, attuned to its texture.`);
  if (base === "Se") eS("energy", 0.4, `your base function is Se carries an active, forceful presence, a readiness to push and sustain contact.`);

  return out.filter((s): s is Signal => s !== null);
}
