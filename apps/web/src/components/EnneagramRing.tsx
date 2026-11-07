// EnneagramRing. A nine-point ring showing all type scores, inked to match the
// manuscript style: oxblood spokes on parchment, gold accents, the primary type
// marked with a small star. Not a chart library; hand-drawn SVG. The polygon
// connecting the nine score points reads like a constellation traced on the ring.

import type { EnneagramTypeScore } from "../lib/types";

const SIZE = 260;
const CX = SIZE / 2;
const CY = SIZE / 2;
const R_OUTER = 108;
const R_INNER = 30;

// Enneagram positions: type 9 at top (12 o'clock), then 1..8 clockwise, which is
// the traditional layout. We map: index 0 -> type at top. Order around the ring
// is 9,1,2,3,4,5,6,7,8.
const RING_ORDER = [9, 1, 2, 3, 4, 5, 6, 7, 8];

function pointFor(type: number, radius: number): { x: number; y: number } {
  const idx = RING_ORDER.indexOf(type);
  // -90deg puts index 0 at top; clockwise.
  const angle = (-90 + idx * 40) * (Math.PI / 180);
  return { x: CX + radius * Math.cos(angle), y: CY + radius * Math.sin(angle) };
}

export function EnneagramRing({
  scores,
  primary,
  size = 260,
}: {
  scores: EnneagramTypeScore[];
  primary: number;
  size?: number;
}) {
  const byType = new Map(scores.map((s) => [s.type, s.score]));
  const maxScore = Math.max(0.001, ...scores.map((s) => s.score));

  // Score polygon points, radius scaled by normalized score.
  const polyPts = RING_ORDER.map((t) => {
    const s = byType.get(t) ?? 0;
    const r = R_INNER + (R_OUTER - R_INNER) * (s / maxScore);
    const p = pointFor(t, r);
    return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
  }).join(" ");

  return (
    <svg
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      width={size}
      height={size}
      role="img"
      aria-label="your nine enneagram scores"
    >
      <defs>
        <radialGradient id="enneaWash" cx="50%" cy="50%" r="55%">
          <stop offset="0%" stopColor="rgba(169,138,61,0.05)" />
          <stop offset="100%" stopColor="rgba(169,138,61,0.14)" />
        </radialGradient>
      </defs>

      {/* concentric guide rings */}
      <circle cx={CX} cy={CY} r={R_OUTER} fill="url(#enneaWash)" stroke="var(--gold)" strokeWidth="0.8" opacity="0.7" />
      <circle cx={CX} cy={CY} r={(R_OUTER + R_INNER) / 2} fill="none" stroke="var(--gold)" strokeWidth="0.4" opacity="0.4" />
      <circle cx={CX} cy={CY} r={R_INNER} fill="none" stroke="var(--oxblood)" strokeWidth="0.5" opacity="0.45" />

      {/* spokes */}
      {RING_ORDER.map((t) => {
        const p = pointFor(t, R_OUTER);
        return (
          <line
            key={`spoke-${t}`}
            x1={CX}
            y1={CY}
            x2={p.x}
            y2={p.y}
            stroke="var(--gold)"
            strokeWidth="0.4"
            opacity="0.3"
          />
        );
      })}

      {/* the score polygon: a traced constellation of the self */}
      <polygon
        points={polyPts}
        fill="rgba(122,46,42,0.10)"
        stroke="var(--oxblood)"
        strokeWidth="1.1"
        strokeLinejoin="round"
        opacity="0.85"
      />

      {/* score nodes */}
      {RING_ORDER.map((t) => {
        const s = byType.get(t) ?? 0;
        const r = R_INNER + (R_OUTER - R_INNER) * (s / maxScore);
        const node = pointFor(t, r);
        const isPrimary = t === primary;
        return (
          <circle
            key={`node-${t}`}
            cx={node.x}
            cy={node.y}
            r={isPrimary ? 3 : 1.8}
            fill={isPrimary ? "var(--gold)" : "var(--oxblood)"}
            stroke={isPrimary ? "var(--oxblood-deep)" : "none"}
            strokeWidth="0.4"
          />
        );
      })}

      {/* type numerals around the outside */}
      {RING_ORDER.map((t) => {
        const p = pointFor(t, R_OUTER + 16);
        const isPrimary = t === primary;
        return (
          <text
            key={`num-${t}`}
            x={p.x}
            y={p.y}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize="13"
            fontFamily="Cormorant Garamond, serif"
            fontStyle={isPrimary ? "normal" : "italic"}
            fontWeight={isPrimary ? 600 : 400}
            fill={isPrimary ? "var(--oxblood)" : "var(--ink-faint)"}
          >
            {t}
          </text>
        );
      })}

      {/* center sigil */}
      <g transform={`translate(${CX} ${CY})`}>
        <path
          d="M0 -4 L1.1 -1 L4 0 L1.1 1 L0 4 L-1.1 1 L-4 0 L-1.1 -1 Z"
          fill="var(--gold)"
          opacity="0.85"
        />
      </g>
    </svg>
  );
}
