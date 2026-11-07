// Enneagram questionnaire instrument + scoring.
//
// This is a defensible self-report instrument, NOT birth-derived. 54 statements
// (6 per type), 1..5 agreement scale. Scoring weights live ONLY here on the
// server and are NEVER sent to the client (GET /enneagram/questions returns text
// + id only). Centers: Head 5/6/7, Heart 2/3/4, Body 8/9/1.
//
// The item wording draws on the standard Enneagram type descriptions (core
// motivation + fear per type). It is a screening instrument, offered honestly:
// when scores are close we surface the tie rather than force one type.

export type EnneagramQuestion = {
  id: string; // stable id e.g. "q1"
  text: string;
  type: number; // 1..9, the type this statement loads on (server-only)
  reverse?: boolean; // if true, agreement counts AGAINST the type
};

// 6 items per type, id order is shuffled at serve time so the instrument does
// not telegraph its structure. Wording is first-person, present-tense.
export const QUESTIONS: EnneagramQuestion[] = [
  // Type 1 - The Reformer (Body). Core: integrity, correctness, self-control.
  { id: "q1", type: 1, text: "i have a strong inner sense of right and wrong, and it is hard to let it go." },
  { id: "q2", type: 1, text: "i notice mistakes and imperfections that other people seem to miss." },
  { id: "q3", type: 1, text: "i hold myself to high standards and feel guilty when i fall short." },
  { id: "q4", type: 1, text: "i try to improve things and do them the proper way." },
  { id: "q5", type: 1, text: "i can be critical of myself and others when things are not done well." },
  { id: "q6", type: 1, text: "i suppress my anger because it does not feel acceptable to show it." },

  // Type 2 - The Helper (Heart). Core: to be loved, to be needed.
  { id: "q7", type: 2, text: "i am attuned to what other people need, often before they ask." },
  { id: "q8", type: 2, text: "i feel best about myself when i am helping someone." },
  { id: "q9", type: 2, text: "i find it hard to admit i have needs of my own." },
  { id: "q10", type: 2, text: "i want to be appreciated for how much i give to others." },
  { id: "q11", type: 2, text: "i can lose track of my own feelings while tending to everyone else's." },
  { id: "q12", type: 2, text: "i go out of my way to make people feel close to me." },

  // Type 3 - The Achiever (Heart). Core: value through success + image.
  { id: "q13", type: 3, text: "i am driven to succeed and to be seen as successful." },
  { id: "q14", type: 3, text: "i adjust how i present myself depending on who i am with." },
  { id: "q15", type: 3, text: "i measure my worth by what i accomplish." },
  { id: "q16", type: 3, text: "i am efficient and good at getting things done." },
  { id: "q17", type: 3, text: "i avoid slowing down because it feels like failing." },
  { id: "q18", type: 3, text: "i care a lot about how i come across to others." },

  // Type 4 - The Individualist (Heart). Core: identity, authenticity, longing.
  { id: "q19", type: 4, text: "i often feel different from other people, like something is missing." },
  { id: "q20", type: 4, text: "my emotions run deep and i do not want to flatten them." },
  { id: "q21", type: 4, text: "i am drawn to what is beautiful, melancholy, or meaningful." },
  { id: "q22", type: 4, text: "i long for what is absent more than i enjoy what is present." },
  { id: "q23", type: 4, text: "i want to be understood for who i truly am." },
  { id: "q24", type: 4, text: "i can envy the ease or wholeness i see in others." },

  // Type 5 - The Investigator (Head). Core: competence, knowledge, privacy.
  { id: "q25", type: 5, text: "i need time alone to recharge after being with people." },
  { id: "q26", type: 5, text: "i would rather observe and understand than jump in." },
  { id: "q27", type: 5, text: "i protect my energy and my privacy carefully." },
  { id: "q28", type: 5, text: "i feel more secure when i have thoroughly understood something." },
  { id: "q29", type: 5, text: "i keep my needs minimal so i do not depend on others." },
  { id: "q30", type: 5, text: "i can feel drained by demands on my time and attention." },

  // Type 6 - The Loyalist (Head). Core: security, support, doubt.
  { id: "q31", type: 6, text: "i scan for what could go wrong so i am not caught off guard." },
  { id: "q32", type: 6, text: "i value loyalty and being able to trust the people around me." },
  { id: "q33", type: 6, text: "my mind can spin with doubts and worst-case scenarios." },
  { id: "q34", type: 6, text: "i look for guidance or a trusted authority when unsure." },
  { id: "q35", type: 6, text: "i am reliable and i show up for the people i commit to." },
  { id: "q36", type: 6, text: "i question things, sometimes including my own decisions." },

  // Type 7 - The Enthusiast (Head). Core: freedom, options, avoiding pain.
  { id: "q37", type: 7, text: "i keep my options open and dislike feeling trapped." },
  { id: "q38", type: 7, text: "i chase new experiences and get restless when bored." },
  { id: "q39", type: 7, text: "i tend to reframe pain quickly and look for the upside." },
  { id: "q40", type: 7, text: "my mind jumps ahead to the next exciting possibility." },
  { id: "q41", type: 7, text: "i would rather stay upbeat than sit with something heavy." },
  { id: "q42", type: 7, text: "i love planning adventures and things to look forward to." },

  // Type 8 - The Challenger (Body). Core: control, strength, protection.
  { id: "q43", type: 8, text: "i am direct and i say what i think, even when it is blunt." },
  { id: "q44", type: 8, text: "i take charge naturally and dislike being controlled." },
  { id: "q45", type: 8, text: "i protect the people and things that are mine." },
  { id: "q46", type: 8, text: "i am comfortable with conflict and standing my ground." },
  { id: "q47", type: 8, text: "i hide my vulnerability behind strength." },
  { id: "q48", type: 8, text: "i respond to injustice with force and want to make it right." },

  // Type 9 - The Peacemaker (Body). Core: harmony, comfort, avoiding conflict.
  { id: "q49", type: 9, text: "i go along to keep the peace and avoid conflict." },
  { id: "q50", type: 9, text: "i can see everyone's point of view, which makes deciding hard." },
  { id: "q51", type: 9, text: "i tend to merge with others' wants and lose track of my own." },
  { id: "q52", type: 9, text: "i seek comfort and steadiness, and dislike being rushed." },
  { id: "q53", type: 9, text: "i numb out or distract myself rather than face tension." },
  { id: "q54", type: 9, text: "i want everyone to get along and feel at ease." },
];

export const TYPE_NAMES: Record<number, string> = {
  1: "The Reformer",
  2: "The Helper",
  3: "The Achiever",
  4: "The Individualist",
  5: "The Investigator",
  6: "The Loyalist",
  7: "The Enthusiast",
  8: "The Challenger",
  9: "The Peacemaker",
};

export const CENTER_OF: Record<number, "Head" | "Heart" | "Body"> = {
  5: "Head", 6: "Head", 7: "Head",
  2: "Heart", 3: "Heart", 4: "Heart",
  8: "Body", 9: "Body", 1: "Body",
};

// Wing is the adjacent type (numerically, wrapping 9<->1) with the higher score.
function wingCandidates(type: number): [number, number] {
  const left = type === 1 ? 9 : type - 1;
  const right = type === 9 ? 1 : type + 1;
  return [left, right];
}

export type EnneagramScore = { type: number; score: number };
export type EnneagramResult = {
  primary: { type: number; name: string; score: number };
  wing: { type: number; label: string } | null;
  tritype: [number, number, number] | null;
  scores: EnneagramScore[];
  center: "Head" | "Heart" | "Body";
  instinct: "sp" | "so" | "sx" | null;
  completed_at: number;
  // honest signal when the top types are within a hair of each other.
  ambiguous?: { between: number[]; note: string };
};

// Public question shape: text + id only. NEVER the type or weights.
export function publicQuestions(): Array<{ id: string; text: string }> {
  // Deterministic shuffle by id hash so the order is stable per deploy but does
  // not follow the type grouping. Simple: sort by a hash of the id.
  const hash = (s: string): number => {
    let h = 2166136261;
    for (let i = 0; i < s.length; i += 1) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  };
  return QUESTIONS.map((q) => ({ id: q.id, text: q.text }))
    .sort((a, b) => hash(a.id) - hash(b.id));
}

export const TOTAL_QUESTIONS = QUESTIONS.length;

// Score a set of answers { questionId: 1..5 } into a full result. Answers may be
// partial; we normalize by the max possible for the items actually answered per
// type so an incomplete quiz still yields a sensible (if softer) read.
export function score(answers: Record<string, number>, completedAt: number): EnneagramResult {
  const raw: Record<number, number> = {};
  const maxByType: Record<number, number> = {};
  for (let t = 1; t <= 9; t += 1) {
    raw[t] = 0;
    maxByType[t] = 0;
  }
  for (const q of QUESTIONS) {
    const a = answers[q.id];
    if (typeof a !== "number") continue;
    const clamped = Math.max(1, Math.min(5, a));
    // Map 1..5 to 0..1 contribution; reverse items invert.
    const contribution = q.reverse ? (5 - clamped) / 4 : (clamped - 1) / 4;
    raw[q.type] += contribution;
    maxByType[q.type] += 1;
  }

  const scores: EnneagramScore[] = [];
  for (let t = 1; t <= 9; t += 1) {
    const denom = maxByType[t] || 1;
    scores.push({ type: t, score: Math.round((raw[t] / denom) * 1000) / 1000 });
  }
  const sorted = [...scores].sort((a, b) => b.score - a.score);
  const primaryType = sorted[0].type;

  // wing: adjacent type with the higher score.
  const [wl, wr] = wingCandidates(primaryType);
  const wlScore = scores.find((s) => s.type === wl)?.score ?? 0;
  const wrScore = scores.find((s) => s.type === wr)?.score ?? 0;
  const wingType = wlScore >= wrScore ? wl : wr;
  const wing =
    Math.max(wlScore, wrScore) > 0
      ? { type: wingType, label: `${primaryType}w${wingType}` }
      : null;

  // tritype: highest-scoring type in EACH center, only if all three are present
  // with a meaningful score. Ordered by score.
  const topInCenter = (center: "Head" | "Heart" | "Body"): EnneagramScore | null => {
    const inC = scores.filter((s) => CENTER_OF[s.type] === center).sort((a, b) => b.score - a.score);
    return inC[0] && inC[0].score > 0.2 ? inC[0] : null;
  };
  const head = topInCenter("Head");
  const heart = topInCenter("Heart");
  const body = topInCenter("Body");
  let tritype: [number, number, number] | null = null;
  if (head && heart && body) {
    const trio = [head, heart, body].sort((a, b) => b.score - a.score);
    tritype = [trio[0].type, trio[1].type, trio[2].type];
  }

  // ambiguity: if the runner-up is within 0.06 of the top, say so honestly.
  let ambiguous: EnneagramResult["ambiguous"];
  if (sorted[1] && sorted[0].score - sorted[1].score < 0.06) {
    ambiguous = {
      between: [sorted[0].type, sorted[1].type],
      note: `you are between ${sorted[0].type} and ${sorted[1].type}. sit with both; the questionnaire is a mirror, not a verdict.`,
    };
  }

  return {
    primary: { type: primaryType, name: TYPE_NAMES[primaryType], score: sorted[0].score },
    wing,
    tritype,
    scores,
    center: CENTER_OF[primaryType],
    instinct: null, // instinctual subtype not measured by this instrument
    completed_at: completedAt,
    ...(ambiguous ? { ambiguous } : {}),
  };
}
