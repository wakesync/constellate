// Enneagram -> shared trait space.
//
// The enneagram is a motivational typology, so it speaks well to recognition,
// conflict posture, self-narrative distortion (its core "fixation" idea), and
// head/heart/body center. It is a self-report instrument, so we weight it a
// notch below the mechanical engines (HD) and scale by the result's own
// confidence: a runaway top type speaks louder than a near-tie.
//
// Reads the stored EnneagramResult:
//   { primary:{type,score}, wing, scores:[{type,score}], center, ambiguous? }
//
// Rules keyed on the PRIMARY type. Where the picture is genuinely type-specific
// (e.g. 8 vs 9 on conflict) we say so per type rather than smearing an average.

import { makeSignal, type Signal } from "../axes";

type EnnScore = { type: number; score: number };
type EnnResult = {
  primary?: { type?: number; score?: number };
  center?: string; // Head | Heart | Body
  scores?: EnnScore[];
  ambiguous?: { between?: number[] };
};

// A confidence multiplier: when the top type is ambiguous (near-tie) we quiet
// every enneagram signal so it cannot masquerade as strong evidence.
function confidenceScale(r: EnnResult): number {
  return r.ambiguous ? 0.55 : 1;
}

export function mapEnneagram(r: EnnResult | null | undefined): Signal[] {
  if (!r || !r.primary || typeof r.primary.type !== "number") return [];
  const t = r.primary.type;
  const k = confidenceScale(r);
  const out: (Signal | null)[] = [];
  const S = (axis: string, v: number, w: number, e: string) =>
    out.push(makeSignal("enneagram", axis, v, w * k, e));

  // --- self_narrative -----------------------------------------------------
  // Every enneagram type is, definitionally, a fixation: a fixed story that
  // filters reality. So the enneagram ALWAYS speaks (moderately) to
  // self-narrative distortion. This is the one axis the whole system is about.
  S("self_narrative", 0.5, 0.55, `as a ${t}, your type is itself a fixed story about what you must be or avoid. it colors what you notice, quietly, all the time.`);

  // --- initiation / conflict / recognition, per type ----------------------
  switch (t) {
    case 1: // Reformer, body/gut, structure + inner critic
      S("structure", 0.6, 0.6, "as a one, you reach for the correct, ordered way. structure and doing it properly is how you steady yourself.");
      S("conflict", 0.35, 0.4, "as a one, you will confront what is wrong, though you hold your anger tight rather than let it show.");
      S("head_heart", -0.3, 0.35, "as a one, an inner standard tends to override feeling. what is right leads, what you feel comes second.");
      break;
    case 2: // Helper, heart
      S("recognition", 0.7, 0.7, "as a two, you need to be needed. being appreciated for what you give is how you know you are alright.");
      S("head_heart", 0.6, 0.6, "as a two, you lead with feeling and relationship. the warmth between people is the first thing you read.");
      S("conflict", -0.4, 0.4, "as a two, you smooth and tend rather than press. you would rather keep someone close than win a point.");
      break;
    case 3: // Achiever, heart, image
      S("recognition", 0.85, 0.8, "as a three, your worth runs through being seen to succeed. recognition is not a bonus, it is the metric.");
      S("initiation", 0.6, 0.55, "as a three, you drive forward and make things happen. slowing down feels like failing, so you move first.");
      S("structure", 0.4, 0.4, "as a three, you organize toward the goal: efficient, planned, whatever gets the win.");
      break;
    case 4: // Individualist, heart
      S("recognition", 0.6, 0.6, "as a four, you long to be understood for who you truly are. being seen, truly seen, matters deeply.");
      S("emotional_tempo", 0.6, 0.6, "as a four, your feelings run deep and slow, and you would rather sit in them than flatten them.");
      S("head_heart", 0.75, 0.7, "as a four, feeling leads. depth, longing, and mood are the water you swim in.");
      S("self_narrative", 0.7, 0.6, "the four's story is that something essential is missing in you. it is a powerful, load-bearing distortion.");
      break;
    case 5: // Investigator, head
      S("recognition", -0.6, 0.6, "as a five, you would rather withdraw than be seen. you protect your privacy and keep your needs minimal.");
      S("head_heart", -0.6, 0.6, "as a five, you lead with the head: understand first, feel later, from a safe distance.");
      S("sensitivity", 0.3, 0.4, "as a five, you can feel quickly drained by demands, so you insulate to protect a limited store.");
      S("abstraction", 0.5, 0.5, "as a five, you retreat into understanding and ideas. the abstract is where you feel most competent.");
      break;
    case 6: // Loyalist, head
      S("structure", 0.4, 0.45, "as a six, you scan for what could go wrong and look for something solid to trust. certainty steadies you.");
      S("self_narrative", 0.6, 0.55, "the six's mind spins doubt and worst-cases. that anxious forecasting bends what you see toward the threat.");
      S("head_heart", -0.4, 0.45, "as a six, the questioning head leads. you think your way toward safety before you trust a feeling.");
      break;
    case 7: // Enthusiast, head
      S("time_orientation", 0.6, 0.55, "as a seven, your mind jumps ahead to the next possibility. you live toward what is coming, not the heavy now.");
      S("abstraction", 0.55, 0.5, "as a seven, you chase options and possibilities. the field of what could be is more alive to you than what is.");
      S("conflict", -0.3, 0.35, "as a seven, you reframe pain and move on rather than sit in tension. you would rather stay upbeat than press.");
      S("initiation", 0.5, 0.45, "as a seven, you launch toward the next adventure. you start things and keep your options open.");
      break;
    case 8: // Challenger, body/gut
      S("conflict", 0.85, 0.8, "as an eight, you meet conflict head on. you are direct, you stand your ground, and you dislike being controlled.");
      S("initiation", 0.7, 0.6, "as an eight, you take charge and move first. waiting to be asked is not in the vocabulary.");
      S("head_heart", -0.4, 0.4, "as an eight, you protect your softness behind strength; the vulnerable feeling is the last thing you lead with.");
      break;
    case 9: // Peacemaker, body/gut
      S("conflict", -0.8, 0.75, "as a nine, you avoid conflict and smooth it over. you merge with others' wants to keep the peace.");
      S("initiation", -0.5, 0.5, "as a nine, you go along rather than push. you can lose your own agenda in everyone else's.");
      S("energy", -0.3, 0.35, "as a nine, you seek comfort and steadiness and dislike being rushed; you pace yourself and resist the sprint.");
      break;
  }

  // --- head_heart from center (backstop when a type rule did not set it) ---
  // Only add a center-level head/heart signal if no strong per-type one exists,
  // to avoid double-counting. Centers: Head->logic-leaning(-), Heart->feeling(+),
  // Body->neither cleanly, so we skip Body here.
  const already = out.some((s) => s?.axis === "head_heart");
  if (!already) {
    const center = (r.center ?? "").toLowerCase();
    if (center === "heart") S("head_heart", 0.5, 0.45, "your dominant center is the heart triad: feeling and connection lead your read of things.");
    else if (center === "head") S("head_heart", -0.5, 0.45, "your dominant center is the head triad: thinking and analysis lead before feeling.");
  }

  return out.filter((s): s is Signal => s !== null);
}
