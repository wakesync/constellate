// ModelA. A hand-drawn socionics Model A block diagram, inked to match
// BodyGraph.tsx / ChartWheel.tsx: oxblood monoline, antique gold accents,
// parchment fill. No charting library. Four blocks stacked as they are in the
// theory: Ego at the top (prominent), Super-Ego beneath it, then Super-Id, then
// Id at the base (quieter). Each block holds two function cells; each cell shows
// the information-element symbol drawn as a small glyph, the element letters, the
// position number, and the position name.
//
// The socion draws its elements as symbol pairs (a filled/empty circle, triangle,
// or square). We render a simple, legible glyph per element rather than the exact
// esoteric symbols, so the diagram reads on a phone: a shape whose fill encodes
// extroverted (solid) vs introverted (open), and whose form encodes the Jungian
// function family. Ego cells are drawn strong; Super-Id softer; Id quietest.

import type { ModelAPosition, SocionicsElement } from "../lib/types";

const W = 280;
const H = 360;

// element -> {family shape, extroverted?}
// families: intuition (circle), sensing (square), logic (triangle-up), ethics (triangle-down)
const ELEMENT_GLYPH: Record<SocionicsElement, { shape: "circle" | "square" | "tri-up" | "tri-down"; extro: boolean }> = {
  Ne: { shape: "circle", extro: true },
  Ni: { shape: "circle", extro: false },
  Se: { shape: "square", extro: true },
  Si: { shape: "square", extro: false },
  Te: { shape: "tri-up", extro: true },
  Ti: { shape: "tri-up", extro: false },
  Fe: { shape: "tri-down", extro: true },
  Fi: { shape: "tri-down", extro: false },
};

function Glyph({ el, cx, cy, r, strong }: { el: SocionicsElement; cx: number; cy: number; r: number; strong: boolean }) {
  const g = ELEMENT_GLYPH[el];
  const stroke = strong ? "var(--oxblood)" : "var(--ink-faint)";
  const fill = g.extro ? (strong ? "rgba(122,46,42,0.5)" : "rgba(122,46,42,0.28)") : "url(#maParchment)";
  const sw = strong ? 1.4 : 1;
  const common = { fill, stroke, strokeWidth: sw } as const;
  switch (g.shape) {
    case "circle":
      return <circle cx={cx} cy={cy} r={r} {...common} />;
    case "square":
      return <rect x={cx - r} y={cy - r} width={r * 2} height={r * 2} rx={1.5} {...common} />;
    case "tri-up":
      return <polygon points={`${cx},${cy - r} ${cx - r},${cy + r} ${cx + r},${cy + r}`} {...common} />;
    case "tri-down":
    default:
      return <polygon points={`${cx - r},${cy - r} ${cx + r},${cy - r} ${cx},${cy + r}`} {...common} />;
  }
}

// block layout: y offset per block, and a strength (opacity of the cell frame).
const BLOCK_ORDER: { block: string; label: string; strong: boolean }[] = [
  { block: "Ego", label: "ego", strong: true },
  { block: "Super-Ego", label: "super-ego", strong: false },
  { block: "Super-Id", label: "super-id", strong: false },
  { block: "Id", label: "id", strong: false },
];

interface Props {
  stack: ModelAPosition[];
  size?: number;
  selected?: number | null;              // selected position (1..8)
  onSelect?: (position: number) => void;
  className?: string;
}

export function ModelA({ stack, size = 300, selected = null, onSelect, className = "" }: Props) {
  const byBlock: Record<string, ModelAPosition[]> = {};
  for (const p of stack) (byBlock[p.block] ??= []).push(p);

  const padX = 14;
  const blockGap = 10;
  const blockH = (H - padX * 2 - blockGap * 3) / 4;
  const cellW = (W - padX * 2 - 8) / 2;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width={size}
      height={(size * H) / W}
      className={className}
      role="img"
      aria-label="your model a: the eight functions in their blocks"
    >
      <defs>
        <radialGradient id="maParchment" cx="50%" cy="40%" r="70%">
          <stop offset="0%" stopColor="#f9f1de" />
          <stop offset="100%" stopColor="#e9dec1" />
        </radialGradient>
      </defs>

      {BLOCK_ORDER.map((b, bi) => {
        const y = padX + bi * (blockH + blockGap);
        const cells = (byBlock[b.block] ?? []).sort((a, z) => a.position - z.position);
        // Ego most prominent; blocks below quiet down.
        const frameOpacity = b.strong ? 0.9 : bi === 3 ? 0.4 : 0.6;
        return (
          <g key={b.block}>
            {/* block label down the left gutter */}
            <text
              x={padX - 4}
              y={y + blockH / 2}
              textAnchor="middle"
              transform={`rotate(-90 ${padX - 4} ${y + blockH / 2})`}
              fontSize="7.5"
              fontFamily="Cormorant Garamond, serif"
              fontStyle="italic"
              letterSpacing="0.12em"
              fill={b.strong ? "var(--oxblood-deep)" : "var(--ink-faint)"}
              opacity={b.strong ? 0.9 : 0.6}
            >
              {b.label}
            </text>

            {cells.map((p, ci) => {
              const x = padX + 10 + ci * (cellW + 8);
              const isSel = selected === p.position;
              const strong = b.strong;
              return (
                <g
                  key={p.position}
                  onClick={onSelect ? () => onSelect(p.position) : undefined}
                  style={{ cursor: onSelect ? "pointer" : "default" }}
                  role={onSelect ? "button" : undefined}
                  aria-label={`position ${p.position}, ${p.role}, ${p.element}`}
                  tabIndex={onSelect ? 0 : undefined}
                  onKeyDown={
                    onSelect
                      ? (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onSelect(p.position);
                          }
                        }
                      : undefined
                  }
                >
                  <rect
                    x={x}
                    y={y}
                    width={cellW}
                    height={blockH}
                    rx={2}
                    fill={strong ? "rgba(122,46,42,0.05)" : "url(#maParchment)"}
                    stroke={isSel ? "var(--gold-deep)" : strong ? "var(--oxblood)" : "var(--ink-faint)"}
                    strokeWidth={isSel ? 1.6 : strong ? 1.2 : 0.9}
                    opacity={frameOpacity}
                  />
                  {/* position number, small, upper-left */}
                  <text
                    x={x + 7}
                    y={y + 14}
                    fontSize="9"
                    fontFamily="Cormorant Garamond, serif"
                    fill={strong ? "var(--oxblood-deep)" : "var(--ink-faint)"}
                    opacity="0.85"
                  >
                    {p.position}
                  </text>
                  {/* glyph, centered-left */}
                  <Glyph el={p.element} cx={x + 26} cy={y + blockH / 2 + 3} r={9} strong={strong} />
                  {/* element letters */}
                  <text
                    x={x + 44}
                    y={y + blockH / 2 - 1}
                    fontSize="13"
                    fontFamily="Cormorant Garamond, serif"
                    fontWeight="600"
                    fill={strong ? "var(--oxblood)" : "var(--ink-soft)"}
                  >
                    {p.element}
                  </text>
                  {/* role name */}
                  <text
                    x={x + 44}
                    y={y + blockH / 2 + 12}
                    fontSize="7.5"
                    fontFamily="Cormorant Garamond, serif"
                    fontStyle="italic"
                    letterSpacing="0.04em"
                    fill="var(--ink-faint)"
                  >
                    {p.role.toLowerCase()}
                  </text>
                </g>
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}

export function ModelASkeleton({ size = 300 }: { size?: number }) {
  const padX = 14;
  const blockGap = 10;
  const blockH = (H - padX * 2 - blockGap * 3) / 4;
  const cellW = (W - padX * 2 - 8) / 2;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={size} height={(size * H) / W} aria-hidden="true" className="opacity-70">
      {[0, 1, 2, 3].map((bi) =>
        [0, 1].map((ci) => (
          <rect
            key={`${bi}-${ci}`}
            x={padX + 10 + ci * (cellW + 8)}
            y={padX + bi * (blockH + blockGap)}
            width={cellW}
            height={blockH}
            rx={2}
            fill="color-mix(in oklab, var(--parchment-shadow) 70%, transparent)"
            className="ink-shimmer"
          />
        )),
      )}
    </svg>
  );
}
