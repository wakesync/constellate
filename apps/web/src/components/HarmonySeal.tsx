// HarmonySeal: the harmony score as an illuminated wax-seal medallion, plus a
// one-line deterministic explanation of what drives it (top agreement + top
// tension, straight from the scorer's ranked lists, no prose model anywhere).
//
// Framing rule carried through from the API: the label word comes from the
// relationship lens ("house harmony" for roommates), and the copy never claims
// compatibility. A thin-confidence score says so out loud.

import type { HarmonyResult } from "../lib/types";

export function HarmonySeal({
  harmony,
  framing,
  verdict,
  size = 128,
}: {
  harmony: HarmonyResult;
  framing: string;
  verdict?: string | null;
  size?: number;
}) {
  const r = size / 2;
  const ring = r - 5;
  const circumference = 2 * Math.PI * ring;
  const arc = circumference * (harmony.score / 100);
  const high = harmony.score >= 70;
  const low = harmony.score < 45;
  const arcStroke = high ? "url(#seal-aurora)" : low ? "var(--tension-deep)" : "var(--gold-deep)";
  return (
    <div className="flex flex-col sm:flex-row items-center sm:items-center gap-5 sm:gap-7">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label={`${framing} ${harmony.score} of 100, ${harmony.band}`}>
          <defs>
            {/* aurora ring for harmony highs: starlight gold into sea-teal */}
            <linearGradient id="seal-aurora" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#8a6a1f" />
              <stop offset="55%" stopColor="#b8862c" />
              <stop offset="100%" stopColor="#3f6f74" />
            </linearGradient>
          </defs>
          <circle cx={r} cy={r} r={ring} fill="color-mix(in oklab, var(--parchment-shadow) 55%, transparent)" stroke="rgba(169,138,61,0.3)" strokeWidth="1" />
          {/* score arc, drawn from the top; animates to the score on mount so
              the number feels computed, not asserted */}
          <circle
            cx={r}
            cy={r}
            r={ring}
            fill="none"
            stroke={arcStroke}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray={`${arc} ${circumference - arc}`}
            transform={`rotate(-90 ${r} ${r})`}
            opacity={0.45 + harmony.confidence * 0.55}
            className="seal-arc"
            style={{ "--seal-arc": `${arc}` } as React.CSSProperties}
          />
          <text
            x={r}
            y={r - size * 0.045}
            textAnchor="middle"
            dominantBaseline="central"
            fontFamily="Fraunces, Cormorant Garamond, serif"
            fontWeight={560}
            fontSize={size * 0.4}
            letterSpacing="-0.04em"
            fill="var(--oxblood-deep)"
          >
            {harmony.score}
          </text>
          <text
            x={r}
            y={r + size * 0.21}
            textAnchor="middle"
            fontFamily="Cormorant Garamond, serif"
            fontStyle="italic"
            fontSize={size * 0.1}
            fill="var(--ink-faint)"
          >
            of 100
          </text>
        </svg>
      </div>
      <div className="min-w-0 text-center sm:text-left">
        <div className="eyebrow">{framing}</div>
        <div className="display-heading text-[var(--ink)] mt-0.5">{harmony.band}</div>
        <p className="font-serif text-[1.08rem] leading-snug text-[var(--ink)] mt-1.5">
          {verdict ?? driverLine(harmony)}
        </p>
        {harmony.engines != null && (
          <p className="micro mt-2 lowercase">
            derived from {harmony.engines} {harmony.engines === 1 ? "engine" : "engines"} across {harmony.shared_axes} shared {harmony.shared_axes === 1 ? "axis" : "axes"}
          </p>
        )}
      </div>
    </div>
  );
}

// The deterministic one-liner: strongest shared lean + sharpest contrast, taken
// verbatim from the scorer's ranked output. No model writes this.
const AXIS_NOUN: Record<string, string> = {
  initiation: "who moves first",
  recognition: "being seen",
  authority_locus: "where the yes comes from",
  emotional_tempo: "emotional weather",
  structure: "plans",
  conflict: "how you fight",
  energy: "pace",
  sensitivity: "how much the room gets in",
  time_orientation: "now versus later",
  self_narrative: "the story you each tell",
  head_heart: "head versus heart",
  abstraction: "ideas versus things",
};

function axisNoun(axis: string): string {
  return AXIS_NOUN[axis] ?? axis.replace(/_/g, " ");
}

export function driverLine(harmony: HarmonyResult): string {
  const agree = harmony.agreements[0];
  const tension = harmony.tensions[0];
  if (agree && tension) return `you agree on ${axisNoun(agree.axis)} and differ on ${axisNoun(tension.axis)}.`;
  if (agree && harmony.agreements[1]) return `you agree on ${axisNoun(agree.axis)} and on ${axisNoun(harmony.agreements[1].axis)}.`;
  if (agree) return `you agree on ${axisNoun(agree.axis)}. that is the whole overlap so far.`;
  if (tension && harmony.tensions[1]) return `you differ on ${axisNoun(tension.axis)} and on ${axisNoun(harmony.tensions[1].axis)}.`;
  if (tension) return `you differ on ${axisNoun(tension.axis)}. that is the loudest thing between you.`;
  return "not enough shared ground to call it yet.";
}

// Compact inline variant for list rows: just the number in a small seal.
export function HarmonyBadge({ score, size = 34 }: { score: number; size?: number }) {
  const r = size / 2;
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-label={`harmony ${score} of 100`} className="shrink-0">
      <circle cx={r} cy={r} r={r - 1.5} fill="color-mix(in oklab, var(--parchment-shadow) 55%, transparent)" stroke="rgba(169,138,61,0.45)" strokeWidth="1" />
      <text
        x={r}
        y={r + 0.5}
        textAnchor="middle"
        dominantBaseline="central"
        fontFamily="Cormorant Garamond, serif"
        fontWeight={600}
        fontSize={size * 0.44}
        fill="var(--oxblood-deep)"
      >
        {score}
      </text>
    </svg>
  );
}
