// ChartWheel. antique manuscript natal chart.
// Oxblood ink, antique gold zodiac ring, parchment center.
// Renders client-side from chart data; degrades to a passable demo if data is sparse.

import type { NatalChart } from "../lib/types";
import { planetGlyph, signGlyph } from "../lib/format";

const SIGNS = [
  "Aries","Taurus","Gemini","Cancer","Leo","Virgo",
  "Libra","Scorpio","Sagittarius","Capricorn","Aquarius","Pisces",
];

interface Props {
  chart: NatalChart | null | undefined;
  size?: number;
  showHouses?: boolean;
  className?: string;
  ariaLabel?: string;
}

// Astrologers traditionally orient with Ascendant on the left (0deg = 9 o'clock).
// SVG: angle 0deg = 3 o'clock, increasing clockwise. Convert ecliptic longitude L
// to SVG angle: theta = 180 - (L - asc).  Then x = cx + r*cos(theta*pi/180),
// y = cy - r*sin(theta*pi/180).
function eclToXY(lon: number, ascendant: number, r: number, cx: number, cy: number) {
  const theta = (180 - (lon - ascendant)) * (Math.PI / 180);
  return { x: cx + r * Math.cos(theta), y: cy - r * Math.sin(theta) };
}

export function ChartWheel({
  chart: rawChart,
  size = 320,
  showHouses = true,
  className = "",
  ariaLabel = "natal chart wheel",
}: Props) {
  // Degrade gracefully if a chart is missing (e.g. a member with no birth data
  // in a synastry view). Render an empty antique ring rather than crashing.
  const chart: NatalChart = rawChart ?? { planets: [], angles: { ascendant: 0, midheaven: 270 } };
  const cx = size / 2;
  const cy = size / 2;
  const rOuter = size * 0.48;       // outer rim
  const rZodInner = size * 0.40;    // zodiac ring inner
  const rHouse = size * 0.32;       // house ring
  const rInner = size * 0.18;       // inner chamber
  const rPlanet = size * 0.255;     // planet glyph radius

  const asc = chart.angles?.ascendant ?? 0;

  // Avoid glyph collisions: bump nearby planets outward slightly.
  const planetsSorted = [...(chart.planets ?? [])].sort((a, b) => a.longitude - b.longitude);
  const placed: Array<{ name: string; x: number; y: number; lon: number; retro: boolean }> = [];
  let lastLon = -999;
  let stagger = 0;
  planetsSorted.forEach((p) => {
    const close = Math.abs(p.longitude - lastLon) < 7;
    stagger = close ? stagger + 1 : 0;
    const r = rPlanet - stagger * size * 0.034;
    const { x, y } = eclToXY(p.longitude, asc, r, cx, cy);
    placed.push({ name: p.name, x, y, lon: p.longitude, retro: !!p.retrograde });
    lastLon = p.longitude;
  });

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label={ariaLabel}
    >
      <defs>
        <radialGradient id="parchmentCenter" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#f9f1de" />
          <stop offset="100%" stopColor="#e9dec1" />
        </radialGradient>
        <radialGradient id="zodiacRing" cx="50%" cy="50%" r="60%">
          <stop offset="0%" stopColor="rgba(169,138,61,0.05)" />
          <stop offset="100%" stopColor="rgba(169,138,61,0.18)" />
        </radialGradient>
        <filter id="grainy" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="1.2" numOctaves="2" />
          <feColorMatrix values="0 0 0 0 0.5  0 0 0 0 0.42  0 0 0 0 0.32  0 0 0 0.05 0" />
          <feComposite in2="SourceGraphic" operator="in" />
        </filter>
      </defs>

      {/* parchment center */}
      <circle cx={cx} cy={cy} r={rZodInner} fill="url(#parchmentCenter)" />
      {/* zodiac ring */}
      <circle cx={cx} cy={cy} r={rOuter} fill="url(#zodiacRing)" />
      <circle cx={cx} cy={cy} r={rOuter} fill="none" stroke="var(--gold)" strokeWidth="0.9" opacity="0.7" />
      <circle cx={cx} cy={cy} r={rZodInner} fill="none" stroke="var(--gold)" strokeWidth="0.7" opacity="0.55" />

      {/* zodiac segments */}
      {SIGNS.map((sign, i) => {
        // sign starts at longitude i*30; midpoint at i*30 + 15
        const startLon = i * 30;
        const endLon = startLon + 30;
        const midLon = startLon + 15;
        const s1 = eclToXY(startLon, asc, rOuter, cx, cy);
        const s2 = eclToXY(startLon, asc, rZodInner, cx, cy);
        const e1 = eclToXY(endLon, asc, rOuter, cx, cy);
        const _ = e1; void _;
        const mid = eclToXY(midLon, asc, (rOuter + rZodInner) / 2, cx, cy);
        return (
          <g key={sign}>
            <line
              x1={s1.x} y1={s1.y} x2={s2.x} y2={s2.y}
              stroke="var(--gold)" strokeWidth="0.6" opacity="0.5"
            />
            <text
              x={mid.x} y={mid.y}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={size * 0.045}
              fill="var(--gold)"
              opacity="0.9"
              fontFamily="Cormorant Garamond, serif"
            >
              {signGlyph(sign)}
            </text>
          </g>
        );
      })}

      {/* house cusps + house ring */}
      {showHouses && (
        <>
          <circle cx={cx} cy={cy} r={rHouse} fill="none" stroke="var(--oxblood)" strokeWidth="0.5" opacity="0.35" />
          {Array.from({ length: 12 }, (_, i) => {
            // Equal-house fallback if chart.houses absent: cusp at asc + i*30
            const cuspLon = chart.houses?.[i] ?? (asc + i * 30);
            const a = eclToXY(cuspLon, asc, rZodInner, cx, cy);
            const b = eclToXY(cuspLon, asc, rInner, cx, cy);
            const isAngular = i === 0 || i === 3 || i === 6 || i === 9;
            return (
              <line
                key={i}
                x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                stroke="var(--oxblood)"
                strokeWidth={isAngular ? 0.9 : 0.4}
                opacity={isAngular ? 0.75 : 0.35}
              />
            );
          })}
        </>
      )}

      {/* inner chamber */}
      <circle cx={cx} cy={cy} r={rInner} fill="none" stroke="var(--oxblood)" strokeWidth="0.6" opacity="0.5" />

      {/* aspects: faint lines between planets within tight orb */}
      <g stroke="var(--oxblood)" strokeWidth="0.4" opacity="0.18" fill="none">
        {planetsSorted.map((p1, i) =>
          planetsSorted.slice(i + 1).map((p2, j) => {
            const diff = Math.abs(((p1.longitude - p2.longitude) % 360 + 360) % 360);
            const d = Math.min(diff, 360 - diff);
            const tight = (target: number) => Math.abs(d - target) < 5;
            if (tight(60) || tight(90) || tight(120) || tight(180)) {
              const a = eclToXY(p1.longitude, asc, rInner, cx, cy);
              const b = eclToXY(p2.longitude, asc, rInner, cx, cy);
              return <line key={`${i}-${j}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />;
            }
            return null;
          }),
        )}
      </g>

      {/* asc / mc marks */}
      {(() => {
        const ascPt = eclToXY(asc, asc, rOuter + size * 0.02, cx, cy);
        const mcPt = eclToXY(chart.angles?.midheaven ?? asc + 270, asc, rOuter + size * 0.02, cx, cy);
        return (
          <>
            <text
              x={ascPt.x} y={ascPt.y}
              textAnchor="middle" dominantBaseline="central"
              fontSize={size * 0.035}
              fill="var(--ink-faint)"
              fontFamily="Cormorant Garamond, serif"
              fontStyle="italic"
            >
              asc
            </text>
            <text
              x={mcPt.x} y={mcPt.y}
              textAnchor="middle" dominantBaseline="central"
              fontSize={size * 0.035}
              fill="var(--ink-faint)"
              fontFamily="Cormorant Garamond, serif"
              fontStyle="italic"
            >
              mc
            </text>
          </>
        );
      })()}

      {/* planet glyphs */}
      {placed.map((p) => (
        <g key={p.name}>
          <text
            x={p.x} y={p.y}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={size * 0.055}
            fill="var(--ink)"
            fontFamily="Cormorant Garamond, serif"
          >
            {planetGlyph(p.name)}
          </text>
          {p.retro && (
            <text
              x={p.x + size * 0.03} y={p.y + size * 0.025}
              fontSize={size * 0.022}
              fill="var(--oxblood)"
              opacity="0.85"
              fontFamily="Cormorant Garamond, serif"
              fontStyle="italic"
            >
              ℞
            </text>
          )}
        </g>
      ))}

      {/* center sigil. tiny gold star */}
      <g transform={`translate(${cx} ${cy})`}>
        <path
          d="M0 -4 L1.1 -1 L4 0 L1.1 1 L0 4 L-1.1 1 L-4 0 L-1.1 -1 Z"
          fill="var(--gold)"
          opacity="0.85"
        />
      </g>
    </svg>
  );
}
