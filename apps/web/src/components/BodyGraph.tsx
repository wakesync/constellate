// BodyGraph. A hand-drawn Human Design bodygraph, inked to match ChartWheel.tsx:
// oxblood monoline, antique gold accents, parchment fill. No library, no import
// of any HD renderer. The nine centers sit in their traditional shapes and
// positions; defined centers are filled in oxblood wash, undefined ones are left
// as empty outline. Activated channels are drawn solid; the full channel lattice
// is drawn faint underneath so the shape reads even when little is defined.
//
// Coordinate system: a 260 x 440 canvas, centers laid out on the classic vertical
// spine (Head at top, Root at bottom), Spleen / Solar Plexus flanking, Heart to
// the right of G. Positions are approximate to tradition but tuned to breathe.

import { useMemo } from "react";
import type { HdCenter, HdCenterName, HdChannel } from "../lib/types";

const W = 260;
const H = 440;

// Center geometry. Each entry defines the anchor point (cx, cy) and how to draw
// the traditional shape at that point. Shapes: triangle-up, triangle-down,
// square, diamond. Sizes are per-center to echo the canonical proportions.
type Shape = "tri-up" | "tri-down" | "square" | "diamond";
interface CenterGeom {
  name: HdCenterName;
  cx: number;
  cy: number;
  shape: Shape;
  size: number; // half-extent
  label: string;
}

const CENTERS: CenterGeom[] = [
  { name: "Head", cx: 130, cy: 34, shape: "tri-up", size: 30, label: "head" },
  { name: "Ajna", cx: 130, cy: 96, shape: "tri-down", size: 30, label: "ajna" },
  { name: "Throat", cx: 130, cy: 158, shape: "square", size: 26, label: "throat" },
  { name: "G", cx: 130, cy: 236, shape: "diamond", size: 30, label: "g" },
  { name: "Heart", cx: 196, cy: 250, shape: "tri-up", size: 20, label: "heart" },
  { name: "Sacral", cx: 130, cy: 330, shape: "square", size: 26, label: "sacral" },
  { name: "Solar Plexus", cx: 210, cy: 322, shape: "tri-up", size: 24, label: "solar plexus" },
  { name: "Spleen", cx: 50, cy: 322, shape: "tri-up", size: 24, label: "spleen" },
  { name: "Root", cx: 130, cy: 404, shape: "square", size: 26, label: "root" },
];

const GEOM: Record<string, CenterGeom> = Object.fromEntries(
  CENTERS.map((c) => [c.name, c]),
);

function shapePoints(g: CenterGeom): string {
  const { cx, cy, size, shape } = g;
  switch (shape) {
    case "tri-up":
      return `${cx},${cy - size} ${cx - size},${cy + size} ${cx + size},${cy + size}`;
    case "tri-down":
      return `${cx - size},${cy - size} ${cx + size},${cy - size} ${cx},${cy + size}`;
    case "diamond":
      return `${cx},${cy - size} ${cx + size},${cy} ${cx},${cy + size} ${cx - size},${cy}`;
    case "square":
    default:
      return `${cx - size},${cy - size} ${cx + size},${cy - size} ${cx + size},${cy + size} ${cx - size},${cy + size}`;
  }
}

// The full 36-channel lattice, drawn faint underneath as connective tissue.
// Each connection is a straight run between two center anchors.
const ALL_CONNECTIONS: [HdCenterName, HdCenterName][] = [
  ["Head", "Ajna"],
  ["Ajna", "Throat"],
  ["Throat", "G"],
  ["Throat", "Heart"],
  ["Throat", "Spleen"],
  ["Throat", "Solar Plexus"],
  ["Throat", "Sacral"],
  ["G", "Heart"],
  ["G", "Sacral"],
  ["G", "Spleen"],
  ["Heart", "Solar Plexus"],
  ["Heart", "Spleen"],
  ["Sacral", "Spleen"],
  ["Sacral", "Solar Plexus"],
  ["Sacral", "Root"],
  ["Spleen", "Root"],
  ["Solar Plexus", "Root"],
];

function connKey(a: string, b: string): string {
  return [a, b].sort().join("~");
}

interface Props {
  centers: HdCenter[];
  channels: HdChannel[];
  size?: number;
  selected?: HdCenterName | null;
  onSelectCenter?: (name: HdCenterName) => void;
  className?: string;
}

export function BodyGraph({
  centers,
  channels,
  size = 300,
  selected = null,
  onSelectCenter,
  className = "",
}: Props) {
  const definedSet = useMemo(
    () => new Set(centers.filter((c) => c.defined).map((c) => c.name)),
    [centers],
  );

  // Which center-to-center connections are activated (have at least one channel
  // running between those two centers).
  const activeConns = useMemo(() => {
    const s = new Set<string>();
    for (const ch of channels) {
      if (ch.centers?.length === 2) {
        s.add(connKey(ch.centers[0], ch.centers[1]));
      }
    }
    return s;
  }, [channels]);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width={size}
      height={(size * H) / W}
      className={className}
      role="img"
      aria-label="your human design bodygraph"
    >
      <defs>
        <radialGradient id="bgParchment" cx="50%" cy="50%" r="65%">
          <stop offset="0%" stopColor="#f9f1de" />
          <stop offset="100%" stopColor="#e9dec1" />
        </radialGradient>
        <linearGradient id="definedFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(122,46,42,0.30)" />
          <stop offset="100%" stopColor="rgba(122,46,42,0.16)" />
        </linearGradient>
      </defs>

      {/* faint full channel lattice underneath */}
      <g stroke="var(--gold)" strokeWidth="0.7" opacity="0.22" fill="none" strokeLinecap="round">
        {ALL_CONNECTIONS.map(([a, b]) => {
          const ga = GEOM[a];
          const gb = GEOM[b];
          return <line key={`lat-${a}-${b}`} x1={ga.cx} y1={ga.cy} x2={gb.cx} y2={gb.cy} />;
        })}
      </g>

      {/* activated channels, solid oxblood on top */}
      <g stroke="var(--oxblood)" strokeWidth="2" opacity="0.85" fill="none" strokeLinecap="round">
        {ALL_CONNECTIONS.filter(([a, b]) => activeConns.has(connKey(a, b))).map(([a, b]) => {
          const ga = GEOM[a];
          const gb = GEOM[b];
          return <line key={`act-${a}-${b}`} x1={ga.cx} y1={ga.cy} x2={gb.cx} y2={gb.cy} />;
        })}
      </g>

      {/* the nine centers */}
      {CENTERS.map((g) => {
        const defined = definedSet.has(g.name);
        const isSel = selected === g.name;
        return (
          <g
            key={g.name}
            onClick={onSelectCenter ? () => onSelectCenter(g.name) : undefined}
            style={{ cursor: onSelectCenter ? "pointer" : "default" }}
            role={onSelectCenter ? "button" : undefined}
            aria-label={`${g.label}, ${defined ? "defined" : "undefined"}`}
            tabIndex={onSelectCenter ? 0 : undefined}
            onKeyDown={
              onSelectCenter
                ? (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelectCenter(g.name);
                    }
                  }
                : undefined
            }
          >
            {/* fat invisible hit target */}
            <circle cx={g.cx} cy={g.cy} r={g.size + 8} fill="transparent" />
            <polygon
              points={shapePoints(g)}
              fill={defined ? "url(#definedFill)" : "url(#bgParchment)"}
              stroke={defined ? "var(--oxblood)" : "var(--ink-faint)"}
              strokeWidth={defined ? 1.4 : 1}
              opacity={defined ? 1 : 0.7}
            />
            {isSel && (
              <polygon
                points={shapePoints({ ...g, size: g.size + 5 })}
                fill="none"
                stroke="var(--gold-deep)"
                strokeWidth="1.2"
                opacity="0.9"
              />
            )}
            <text
              x={g.cx}
              y={g.cy}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize="8.5"
              fontFamily="Cormorant Garamond, serif"
              fontStyle="italic"
              fill={defined ? "var(--oxblood-deep)" : "var(--ink-faint)"}
              opacity={defined ? 0.95 : 0.75}
              style={{ pointerEvents: "none" }}
            >
              {g.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// Skeleton shaped like the bodygraph, for the loading state.
export function BodyGraphSkeleton({ size = 300 }: { size?: number }) {
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width={size}
      height={(size * H) / W}
      aria-hidden="true"
      className="opacity-70"
    >
      <g opacity="0.5">
        {ALL_CONNECTIONS.map(([a, b]) => {
          const ga = GEOM[a];
          const gb = GEOM[b];
          return (
            <line
              key={`sk-${a}-${b}`}
              x1={ga.cx}
              y1={ga.cy}
              x2={gb.cx}
              y2={gb.cy}
              stroke="var(--parchment-shadow)"
              strokeWidth="1.5"
            />
          );
        })}
      </g>
      {CENTERS.map((g) => (
        <polygon
          key={`sk-${g.name}`}
          points={shapePoints(g)}
          fill="color-mix(in oklab, var(--parchment-shadow) 70%, transparent)"
          className="ink-shimmer"
        />
      ))}
    </svg>
  );
}

export { CENTERS as BODYGRAPH_CENTERS };
