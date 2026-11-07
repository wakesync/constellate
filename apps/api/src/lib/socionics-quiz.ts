// Socionics questionnaire bank + scoring.
//
// Honesty note baked into the design: a quiz is a WEAK instrument for socionics.
// We score the four dichotomies AND score element-preference directly, then map
// to a type two independent ways and report a runner-up when the top two are
// close. The UI is told to surface that uncertainty rather than fake precision.
//
// Weights NEVER leave the server: /socionics/questions returns only { id, text }.

import {
  TYPES, TYPE_BY_CODE, CODES, buildModelA, dualOf, QUADRA_VALUES,
  type Element, type SocionicsResult, type SocionicsType,
} from "./socionics";

// Each statement loads onto ONE dichotomy pole (+ direction) and, optionally, a
// specific information element (so we can build an element-preference profile).
// pole: which dichotomy. dir: +1 pulls toward the first-named pole.
//   E/I  : +1 = extraversion
//   N/S  : +1 = intuition
//   T/F  : +1 = logic
//   R/Ir : +1 = irrationality (perceiving/irrational lead)
type Pole = "EI" | "NS" | "TF" | "RI";

export interface QuizItem {
  id: string;
  text: string;
  pole: Pole;
  dir: 1 | -1;
  element?: Element; // the element this statement most expresses (for the element profile)
}

// 56 statements, balanced across poles and directions. lowercase, in voice.
export const QUIZ: QuizItem[] = [
  // --- E / I (extraversion vs introversion) ---
  { id: "s01", text: "i widen a plan by adding people to it, not by narrowing it down.", pole: "EI", dir: 1, element: "Ne" },
  { id: "s02", text: "i would rather act on the world than watch how it settles.", pole: "EI", dir: 1, element: "Se" },
  { id: "s03", text: "i set the mood of a room more than i absorb it.", pole: "EI", dir: 1, element: "Fe" },
  { id: "s04", text: "i reach outward for new input before i have finished the last.", pole: "EI", dir: 1, element: "Te" },
  { id: "s05", text: "i refill by being alone, not by being among people.", pole: "EI", dir: -1, element: "Si" },
  { id: "s06", text: "i keep my strongest reactions private and let them settle inside.", pole: "EI", dir: -1, element: "Fi" },
  { id: "s07", text: "i would rather deepen one thing than spread across many.", pole: "EI", dir: -1, element: "Ti" },
  { id: "s08", text: "i wait and watch the long shape of a thing before i move.", pole: "EI", dir: -1, element: "Ni" },

  // --- N / S (intuition vs sensing) ---
  { id: "s09", text: "i am pulled toward what a thing could become more than what it is.", pole: "NS", dir: 1, element: "Ne" },
  { id: "s10", text: "i sense where events are heading before there is evidence.", pole: "NS", dir: 1, element: "Ni" },
  { id: "s11", text: "abstract patterns feel more real to me than the objects in front of me.", pole: "NS", dir: 1, element: "Ne" },
  { id: "s12", text: "i often live slightly ahead of the present, in what is coming.", pole: "NS", dir: 1, element: "Ni" },
  { id: "s13", text: "i notice the physical state of a room, the light, the comfort, the wear.", pole: "NS", dir: -1, element: "Si" },
  { id: "s14", text: "i trust what i can touch, test, and put my weight against.", pole: "NS", dir: -1, element: "Se" },
  { id: "s15", text: "i am good at making a space feel physically right.", pole: "NS", dir: -1, element: "Si" },
  { id: "s16", text: "i read strength and territory quickly, who holds the ground.", pole: "NS", dir: -1, element: "Se" },

  // --- T / F (logic vs ethics) ---
  { id: "s17", text: "i judge a plan by whether it works, not by how it feels.", pole: "TF", dir: 1, element: "Te" },
  { id: "s18", text: "i need a system to be internally consistent before i trust it.", pole: "TF", dir: 1, element: "Ti" },
  { id: "s19", text: "i reach for the efficient method even when it is cold.", pole: "TF", dir: 1, element: "Te" },
  { id: "s20", text: "i sort ideas into clean categories almost automatically.", pole: "TF", dir: 1, element: "Ti" },
  { id: "s21", text: "i track how close or distant i feel to each person i know.", pole: "TF", dir: -1, element: "Fi" },
  { id: "s22", text: "i tend to the emotional temperature of a group as if it were my job.", pole: "TF", dir: -1, element: "Fe" },
  { id: "s23", text: "my sense of right and wrong runs through my private feelings, not rules.", pole: "TF", dir: -1, element: "Fi" },
  { id: "s24", text: "i can raise or lift the feeling in a room on purpose.", pole: "TF", dir: -1, element: "Fe" },

  // --- R / Ir (rational/judging vs irrational/perceiving lead) ---
  { id: "s25", text: "i keep my options open and dislike closing them too early.", pole: "RI", dir: 1, element: "Ne" },
  { id: "s26", text: "i move by impulse and the pull of the moment more than by schedule.", pole: "RI", dir: 1, element: "Se" },
  { id: "s27", text: "i would rather perceive and gather than decide and finish.", pole: "RI", dir: 1, element: "Ni" },
  { id: "s28", text: "plans feel like cages; i prefer to stay loose and responsive.", pole: "RI", dir: 1, element: "Si" },
  { id: "s29", text: "i like to settle a decision and then stop reopening it.", pole: "RI", dir: -1, element: "Te" },
  { id: "s30", text: "i feel calmer when the day has a fixed order to it.", pole: "RI", dir: -1, element: "Ti" },
  { id: "s31", text: "i state my judgments plainly and hold to them.", pole: "RI", dir: -1, element: "Fe" },
  { id: "s32", text: "i finish what i start before i let myself drift to the next thing.", pole: "RI", dir: -1, element: "Fi" },

  // --- second pass, reinforcing each pole with fresh phrasing ---
  { id: "s33", text: "brainstorming with others gives me more than quiet study does.", pole: "EI", dir: 1, element: "Ne" },
  { id: "s34", text: "i tire when i cannot get back to my own quiet for a while.", pole: "EI", dir: -1, element: "Si" },
  { id: "s35", text: "i am the one who names the possibility no one else saw.", pole: "NS", dir: 1, element: "Ne" },
  { id: "s36", text: "i keep an eye on how a mood will age, not just how it feels now.", pole: "NS", dir: 1, element: "Ni" },
  { id: "s37", text: "i am practical about food, rest, and the body's real needs.", pole: "NS", dir: -1, element: "Si" },
  { id: "s38", text: "when something must be pushed, i am willing to push.", pole: "NS", dir: -1, element: "Se" },
  { id: "s39", text: "i can explain why a method is the most effective one available.", pole: "TF", dir: 1, element: "Te" },
  { id: "s40", text: "a contradiction in an argument bothers me until it is resolved.", pole: "TF", dir: 1, element: "Ti" },
  { id: "s41", text: "loyalty and quiet trust matter to me more than being agreeable.", pole: "TF", dir: -1, element: "Fi" },
  { id: "s42", text: "i naturally warm a group and draw people into feeling together.", pole: "TF", dir: -1, element: "Fe" },
  { id: "s43", text: "i resist committing to one path while others still look open.", pole: "RI", dir: 1, element: "Ne" },
  { id: "s44", text: "i respond fast to what is in front of me rather than planning ahead.", pole: "RI", dir: 1, element: "Se" },
  { id: "s45", text: "i prefer a decided, orderly life to an open, improvised one.", pole: "RI", dir: -1, element: "Te" },
  { id: "s46", text: "i like clear structure and closure more than i like surprises.", pole: "RI", dir: -1, element: "Ti" },

  // --- third pass for stability, lighter touch ---
  { id: "s47", text: "i speak up and step forward more than i hold back and observe.", pole: "EI", dir: 1, element: "Fe" },
  { id: "s48", text: "i process things inwardly first and share the conclusion later.", pole: "EI", dir: -1, element: "Ni" },
  { id: "s49", text: "meaning and metaphor come to me faster than facts and specifics.", pole: "NS", dir: 1, element: "Ni" },
  { id: "s50", text: "i notice small physical details others walk right past.", pole: "NS", dir: -1, element: "Si" },
  { id: "s51", text: "i can be blunt about what is true even when it is unwelcome.", pole: "TF", dir: 1, element: "Te" },
  { id: "s52", text: "i feel other people's feelings almost before they do.", pole: "TF", dir: -1, element: "Fe" },
  { id: "s53", text: "i would rather keep gathering than lock a thing down.", pole: "RI", dir: 1, element: "Ne" },
  { id: "s54", text: "unfinished business sits uneasily with me until it is closed.", pole: "RI", dir: -1, element: "Fi" },
  { id: "s55", text: "i am quick to sense the underlying force in a situation.", pole: "NS", dir: -1, element: "Se" },
  { id: "s56", text: "i hold a steady inner reading of how much i trust each person.", pole: "TF", dir: -1, element: "Fi" },
];

export const QUIZ_TOTAL = QUIZ.length;

// public question list (NO weights)
export function questionsPublic(): { id: string; text: string }[] {
  return QUIZ.map((q) => ({ id: q.id, text: q.text }));
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

// Score answers (1..5 agreement). Returns a full SocionicsResult.
export function score(answers: Record<string, number>, completedAt: number): SocionicsResult {
  // 1) dichotomy sums. center each answer at 0 (range -2..+2), apply direction.
  const poleSum: Record<Pole, number> = { EI: 0, NS: 0, TF: 0, RI: 0 };
  const poleMax: Record<Pole, number> = { EI: 0, NS: 0, TF: 0, RI: 0 };
  const elementSum: Record<Element, number> = { Ne: 0, Ni: 0, Se: 0, Si: 0, Te: 0, Ti: 0, Fe: 0, Fi: 0 };
  const elementN: Record<Element, number> = { Ne: 0, Ni: 0, Se: 0, Si: 0, Te: 0, Ti: 0, Fe: 0, Fi: 0 };

  for (const q of QUIZ) {
    const raw = answers[q.id];
    if (typeof raw !== "number") continue;
    const centered = (raw - 3) / 2; // -1..+1
    poleSum[q.pole] += centered * q.dir;
    poleMax[q.pole] += 1;
    if (q.element) {
      // agreement raises that element's expressed preference (0..1)
      elementSum[q.element] += (raw - 1) / 4;
      elementN[q.element] += 1;
    }
  }

  // dichotomy scores in 0..1 (0.5 = neutral). +pole shown as the higher value.
  const dich = {
    extraversion: clamp01(0.5 + (poleMax.EI ? poleSum.EI / poleMax.EI : 0) / 2),
    intuition: clamp01(0.5 + (poleMax.NS ? poleSum.NS / poleMax.NS : 0) / 2),
    logic: clamp01(0.5 + (poleMax.TF ? poleSum.TF / poleMax.TF : 0) / 2),
    irrationality: clamp01(0.5 + (poleMax.RI ? poleSum.RI / poleMax.RI : 0) / 2),
  };

  // element preference profile 0..1 each
  const elemPref: Record<Element, number> = { Ne: 0.5, Ni: 0.5, Se: 0.5, Si: 0.5, Te: 0.5, Ti: 0.5, Fe: 0.5, Fi: 0.5 };
  for (const el of Object.keys(elemPref) as Element[]) {
    elemPref[el] = elementN[el] ? elementSum[el] / elementN[el] : 0.5;
  }

  // 2) two independent type scores:
  //    (a) dichotomy fit: how well each type's E/I, N/S, T/F, R/Ir matches.
  //    (b) element fit: how strongly the type's valued Ego elements (base+creative)
  //        are preferred, minus its unvalued weak ones (role+PoLR).
  const scores = CODES.map((code) => {
    const t = TYPE_BY_CODE[code];
    const dScore = dichotomyFit(t, dich);
    const eScore = elementFit(t, elemPref);
    // blend: dichotomy carries structure, element sanity-checks it.
    const blended = 0.55 * dScore + 0.45 * eScore;
    return { code, raw: blended };
  });

  // normalize to 0..1 across the 16 with a soft spread so the top stands out.
  const raws = scores.map((s) => s.raw);
  const min = Math.min(...raws);
  const max = Math.max(...raws);
  const span = max - min || 1;
  const normalized = scores
    .map((s) => ({ code: s.code, score: Number((0.15 + 0.85 * ((s.raw - min) / span)).toFixed(4)) }))
    .sort((a, b) => b.score - a.score);

  const top = normalized[0];
  const second = normalized[1] ?? null;
  const winner = TYPE_BY_CODE[top.code];

  // confidence: gap between #1 and #2, scaled. honest about being a weak instrument.
  const gap = second ? top.score - second.score : 0.3;
  const confidence = Number(clamp01(0.35 + gap * 2.2).toFixed(2));

  // runner_up surfaced when close.
  const runner_up = second && top.score - second.score < 0.12 ? { code: second.code, score: second.score } : null;

  const dual = dualOf(winner.code);

  return {
    type: { code: winner.code, mbti_style: winner.mbti_style, nickname: winner.nickname, alias: winner.alias },
    confidence,
    quadra: { name: QUADRA_VALUES[winner.quadra].name, values: QUADRA_VALUES[winner.quadra].values },
    model_a: buildModelA(winner.base, winner.creative),
    dichotomies: {
      extraversion: Number(dich.extraversion.toFixed(2)),
      intuition: Number(dich.intuition.toFixed(2)),
      logic: Number(dich.logic.toFixed(2)),
      irrationality: Number(dich.irrationality.toFixed(2)),
    },
    scores: normalized,
    runner_up,
    dual: { code: dual.code, mbti_style: dual.mbti_style, nickname: dual.nickname },
    completed_at: completedAt,
  };
}

// how well a type's four dichotomy poles match the measured 0..1 dichotomies.
function dichotomyFit(t: SocionicsType, d: { extraversion: number; intuition: number; logic: number; irrationality: number }): number {
  const isExtro = ["Ne", "Se", "Fe", "Te"].includes(t.base);
  const isIntuitive = ["Ne", "Ni"].includes(t.base) || ["Ne", "Ni"].includes(t.creative);
  const isLogical = ["Te", "Ti"].includes(t.base) || ["Te", "Ti"].includes(t.creative);
  // irrational lead = base is a perceiving element (Ne/Ni/Se/Si).
  const isIrrational = ["Ne", "Ni", "Se", "Si"].includes(t.base);

  const targetE = isExtro ? 1 : 0;
  const targetN = isIntuitive ? 1 : 0;
  const targetT = isLogical ? 1 : 0;
  const targetIr = isIrrational ? 1 : 0;

  // 1 - mean absolute distance across the four axes -> 0..1
  const dist =
    Math.abs(d.extraversion - targetE) +
    Math.abs(d.intuition - targetN) +
    Math.abs(d.logic - targetT) +
    Math.abs(d.irrationality - targetIr);
  return clamp01(1 - dist / 4);
}

// element fit: reward valued Ego elements being preferred, penalize weak
// Super-Ego (role+PoLR) elements being preferred.
function elementFit(t: SocionicsType, pref: Record<Element, number>): number {
  const stack = buildModelA(t.base, t.creative);
  const base = stack[0].element;
  const creative = stack[1].element;
  const role = stack[2].element;
  const polr = stack[3].element;
  const suggestive = stack[4].element;
  // valued: base, creative, suggestive (Super-Id is valued too). weak/unvalued: role, polr.
  const valued = (pref[base] + pref[creative] + 0.5 * pref[suggestive]) / 2.5;
  const unvalued = (pref[role] + pref[polr]) / 2;
  return clamp01(0.5 + (valued - unvalued) * 0.9);
}
