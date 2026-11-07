// CircleGraph: the constellation, properly. Members as stars in a framed
// night-sky panel (the inverse of the parchment page: ink sky, gold lines),
// edges drawn from the REAL circle graph (shared deterministic traits +
// synastry aspects), edge brightness weighted by the pair's harmony score.
//
// Interaction model (mobile-first, nothing hidden behind hover):
//   tap a star  -> that member's brightest derived facts
//   tap a line  -> why the line exists: harmony, shared traits, aspects,
//                  and the way into the pair's synastry when you're on it
// A caption always says what tapping does. Layout is deterministic (seeded by
// member id), so the sky never jitters between renders. No graph-layout dep:
// a ring with per-star drift reads as a constellation at 2..8 members and
// costs zero bundle.

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { CircleGraphEdge, CircleGraphMember } from "../lib/types";

interface Props {
  members: CircleGraphMember[];
  edges: CircleGraphEdge[];
  selfId: string | undefined;
  size?: number;
  // hero mode: the home first-viewport treatment. taller aspect, bigger
  // stars, display-face name labels, harmony numbers glowing on the lines.
  hero?: boolean;
  onOpenMember?: (id: string) => void;
}

type Selection =
  | { type: "member"; id: string }
  | { type: "edge"; key: string }
  | null;

// Small deterministic hash for per-member drift. Same id, same star, always.
function seed(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) % 9973;
  return h;
}

interface StarNode {
  m: CircleGraphMember;
  x: number;
  y: number;
  isSelf: boolean;
}

function layout(members: CircleGraphMember[], selfId: string | undefined, w: number, h: number): StarNode[] {
  const cx = w / 2;
  const cy = h / 2 - 6;
  const r = Math.min(w, h) * 0.36;
  const ordered = [...members];
  ordered.sort((a, b) => (a.id === selfId ? -1 : b.id === selfId ? 1 : a.id < b.id ? -1 : 1));
  const n = ordered.length;
  if (n === 1) return [{ m: ordered[0], x: cx, y: cy, isSelf: ordered[0].id === selfId }];
  return ordered.map((m, i) => {
    const s = seed(m.id);
    // ring position with deterministic drift: radius +-12%, angle +-9deg.
    const drift = ((s % 100) / 100 - 0.5) * 0.24;
    const aDrift = (((s >> 3) % 100) / 100 - 0.5) * 18;
    const angle = (-90 + (360 / n) * i + aDrift) * (Math.PI / 180);
    const rr = r * (1 + drift);
    return { m, x: cx + rr * Math.cos(angle), y: cy + rr * Math.sin(angle), isSelf: m.id === selfId };
  });
}

// deterministic faint background stars for the sky. two depth layers: dust
// (tiny, still) and near stars (bigger, a few twinkle). same seed, same sky.
function backgroundStars(w: number, h: number): Array<{ x: number; y: number; r: number; o: number; tw: number }> {
  const out: Array<{ x: number; y: number; r: number; o: number; tw: number }> = [];
  let s = 41;
  for (let i = 0; i < 64; i += 1) {
    s = (s * 137 + 71) % 10007;
    const x = (s % 1000) / 1000;
    s = (s * 137 + 71) % 10007;
    const y = (s % 1000) / 1000;
    const near = i % 5 === 0; // every fifth star sits closer
    out.push({
      x: x * w,
      y: y * h,
      r: near ? 0.9 + (s % 3) * 0.35 : 0.45 + (s % 3) * 0.22,
      o: near ? 0.22 + ((s >> 2) % 5) * 0.07 : 0.1 + ((s >> 2) % 5) * 0.04,
      // only some near stars twinkle, each on its own clock
      tw: near && (s >> 4) % 2 === 0 ? 3.2 + ((s >> 5) % 40) / 10 : 0,
    });
  }
  return out;
}

function edgeOpacity(e: CircleGraphEdge): number {
  if (!e.harmony) return 0.16;
  return 0.2 + (e.harmony.score / 100) * 0.6;
}

export function CircleGraph({ members, edges, selfId, size = 340, hero = false, onOpenMember }: Props) {
  const nav = useNavigate();
  const [selection, setSelection] = useState<Selection>(null);
  const W = size;
  const H = Math.round(size * (hero ? 1.02 : 0.88));
  const starScale = hero ? 1.45 : 1;

  const nodes = useMemo(() => layout(members, selfId, W, H), [members, selfId, W, H]);
  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.m.id, n])), [nodes]);
  const bgStars = useMemo(() => backgroundStars(W, H), [W, H]);

  const selectedEdge = selection?.type === "edge" ? edges.find((e) => `${e.a}|${e.b}` === selection.key) ?? null : null;
  const selectedMember = selection?.type === "member" ? members.find((m) => m.id === selection.id) ?? null : null;

  function nameOf(id: string): string {
    const m = members.find((x) => x.id === id);
    if (!m) return "them";
    return id === selfId ? "you" : (m.display_name ?? "anon");
  }

  function toggleEdge(key: string) {
    setSelection((cur) => (cur?.type === "edge" && cur.key === key ? null : { type: "edge", key }));
  }
  function toggleMember(id: string) {
    setSelection((cur) => (cur?.type === "member" && cur.id === id ? null : { type: "member", id }));
  }

  return (
    <div>
      <div
        className="relative rounded-sm overflow-hidden"
        style={{
          // deeper falloff: a lit zenith fading to true dark at the frame, so
          // the panel reads as an aperture into night, not a dark rectangle.
          background:
            "radial-gradient(ellipse at 50% 16%, #322718 0%, #251c11 42%, #1a1309 78%, #140e07 100%)",
          border: "1px solid rgba(169,138,61,0.4)",
          boxShadow: "inset 0 0 70px rgba(0,0,0,0.62), inset 0 -18px 40px rgba(0,0,0,0.35)",
        }}
      >
        {/* gold corner ticks, matching card-paper */}
        <span aria-hidden className="absolute top-1.5 left-1.5 w-2.5 h-2.5 border-t border-l" style={{ borderColor: "rgba(194,165,90,0.6)" }} />
        <span aria-hidden className="absolute bottom-1.5 right-1.5 w-2.5 h-2.5 border-b border-r" style={{ borderColor: "rgba(194,165,90,0.6)" }} />

        <svg
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          style={{ display: "block", aspectRatio: `${W} / ${H}` }}
          role="img"
          aria-label="the constellation. tap a star for a member, tap a line for what two members share."
        >
          <defs>
            {/* soft halation for member stars: the glow that makes a star a star */}
            <radialGradient id="cg-halo">
              <stop offset="0%" stopColor="#e8d9b0" stopOpacity="0.5" />
              <stop offset="45%" stopColor="#c2a55a" stopOpacity="0.18" />
              <stop offset="100%" stopColor="#c2a55a" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="cg-halo-self">
              <stop offset="0%" stopColor="#f5ecd9" stopOpacity="0.65" />
              <stop offset="45%" stopColor="#e8d9b0" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#e8d9b0" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* faint sky: dust layer + near stars, a few twinkling */}
          <g fill="#f0e4c8" className="sky-drift">
            {bgStars.map((s, i) => (
              <circle
                key={i}
                cx={s.x}
                cy={s.y}
                r={s.r}
                opacity={s.o}
                className={s.tw > 0 ? "star-twinkle" : undefined}
                style={s.tw > 0 ? ({ "--twinkle-dur": `${s.tw}s`, "--twinkle-delay": `${(i % 7) * 0.6}s` } as React.CSSProperties) : undefined}
              />
            ))}
          </g>

          {/* constellation lines, harmony-weighted brightness */}
          <g strokeLinecap="round">
            {edges.map((e) => {
              const na = nodeById.get(e.a);
              const nb = nodeById.get(e.b);
              if (!na || !nb) return null;
              const key = `${e.a}|${e.b}`;
              const active = selection?.type === "edge" && selection.key === key;
              const dim = selection !== null && !active;
              const baseO = edgeOpacity(e);
              const mx = (na.x + nb.x) / 2;
              const my = (na.y + nb.y) / 2;
              const hScore = e.harmony ? e.harmony.score / 100 : 0;
              const drawDelay = 0.25 + (edges.indexOf(e) % 8) * 0.12;
              return (
                <g key={key} style={{ cursor: "pointer" }} onClick={() => toggleEdge(key)}>
                  {/* fat invisible hit target for thumbs */}
                  <line x1={na.x} y1={na.y} x2={nb.x} y2={nb.y} stroke="transparent" strokeWidth={22} />
                  {/* under-glow: high-harmony pairs shine, not just thicken */}
                  {e.harmony && (
                    <line
                      x1={na.x} y1={na.y} x2={nb.x} y2={nb.y}
                      pathLength={1}
                      className="edge-draw"
                      style={{ animationDelay: `${drawDelay}s` }}
                      stroke="#e8d9b0"
                      strokeWidth={2.4 + hScore * 2.6}
                      opacity={(dim ? 0.02 : active ? 0.22 : 0.05 + hScore * 0.13)}
                    />
                  )}
                  <line
                    x1={na.x} y1={na.y} x2={nb.x} y2={nb.y}
                    pathLength={1}
                    className={e.harmony ? "edge-draw" : undefined}
                    style={e.harmony ? { animationDelay: `${drawDelay}s` } : undefined}
                    stroke="#c2a55a"
                    strokeWidth={active ? 1.8 : 0.7 + hScore * 1.1}
                    strokeDasharray={e.harmony ? undefined : "2 5"}
                    opacity={dim ? baseO * 0.35 : active ? 0.95 : baseO}
                  />
                  {/* harmony seal at the midpoint: the number lives ON the line,
                      glowing warm when the pair runs high, cool when it runs low */}
                  {e.harmony && (
                    <g transform={`translate(${mx} ${my})`} pointerEvents="none" opacity={dim ? 0.3 : 1}>
                      <g className="soft-in" style={{ animationDelay: `${drawDelay + 0.7}s` }}>
                        {hero && (
                          <circle
                            r={16}
                            fill={e.harmony.score >= 70 ? "rgba(232,184,75,0.16)" : e.harmony.score < 45 ? "rgba(127,163,196,0.14)" : "rgba(232,217,176,0.1)"}
                          />
                        )}
                        <circle
                          r={(active ? 12 : hero ? 11.5 : 10)}
                          fill="#241c12"
                          stroke={e.harmony.score >= 70 ? "rgba(232,184,75,0.75)" : e.harmony.score < 45 ? "rgba(127,163,196,0.6)" : "rgba(194,165,90,0.55)"}
                          strokeWidth={active ? 1 : hero ? 0.9 : 0.6}
                        />
                        <text
                          textAnchor="middle"
                          dominantBaseline="central"
                          fontSize={active ? 10.5 : hero ? 10.5 : 9}
                          fill={e.harmony.score >= 70 ? "#e8b84b" : e.harmony.score < 45 ? "#a8c4dc" : "#e8d9b0"}
                          fontFamily="Fraunces, Cormorant Garamond, serif"
                          fontWeight={560}
                        >
                          {e.harmony.score}
                        </text>
                      </g>
                    </g>
                  )}
                </g>
              );
            })}
          </g>

          {/* member stars: halo + kindle-in + slow breathe */}
          <g>
            {nodes.map((nd, ni) => {
              const active = selection?.type === "member" && selection.id === nd.m.id;
              const inEdge = selectedEdge !== null && (selectedEdge.a === nd.m.id || selectedEdge.b === nd.m.id);
              const dim = selection !== null && !active && !inEdge;
              return (
                <g
                  key={nd.m.id}
                  transform={`translate(${nd.x} ${nd.y})`}
                  style={{ cursor: "pointer", transition: "opacity 0.3s cubic-bezier(0.25,1,0.5,1)" }}
                  onClick={() => toggleMember(nd.m.id)}
                  opacity={dim ? 0.4 : 1}
                >
                  <circle r={22 * starScale} fill="transparent" />
                  <g className="star-kindle" style={{ animationDelay: `${ni * 0.12}s` }}>
                    {/* halation, always on; brighter when self or selected */}
                    <circle
                      r={(nd.isSelf || active ? 19 : 15) * starScale}
                      fill={nd.isSelf || active ? "url(#cg-halo-self)" : "url(#cg-halo)"}
                    />
                    {/* four-point star */}
                    <g transform={`scale(${starScale})`}>
                      <path
                        d="M0 -8.5 L1.9 -1.9 L8.5 0 L1.9 1.9 L0 8.5 L-1.9 1.9 L-8.5 0 L-1.9 -1.9 Z"
                        fill={active ? "#f5ecd9" : nd.isSelf ? "#e8d9b0" : "#c2a55a"}
                        className="star-mark"
                      />
                    </g>
                  </g>
                  <text
                    y={24 * starScale + (hero ? 4 : 0)}
                    textAnchor="middle"
                    fontSize={hero ? 17 : 12.5}
                    fontStyle="italic"
                    fill={active ? "#f5ecd9" : "#e0d2ab"}
                    fontFamily={hero ? "Fraunces, Cormorant Garamond, serif" : "Cormorant Garamond, serif"}
                    fontWeight={hero ? 420 : undefined}
                    className="soft-in"
                    style={{ animationDelay: `${0.3 + ni * 0.12}s` }}
                  >
                    {nd.isSelf ? "you" : (nd.m.display_name ?? "anon")}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>

        {/* detail panel: parchment text on the night sky, nothing behind hover */}
        {(selectedEdge || selectedMember) && (
          <div
            className="px-4 pb-4 pt-3 soft-in"
            style={{ borderTop: "1px solid rgba(194,165,90,0.28)", animationDuration: "0.4s" }}
            aria-live="polite"
          >
            {selectedEdge && (
              <EdgePanel
                edge={selectedEdge}
                nameA={nameOf(selectedEdge.a)}
                nameB={nameOf(selectedEdge.b)}
                selfId={selfId}
                onOpenSynastry={(otherId) => nav(`/app/synastry/${otherId}`)}
              />
            )}
            {selectedMember && <><MemberPanel member={selectedMember} isSelf={selectedMember.id === selfId} onOpenSynastry={(otherId) => nav(`/app/synastry/${otherId}`)} />{onOpenMember && <button className="font-serif italic min-h-[44px] text-[#e8d9b0]" onClick={() => onOpenMember(selectedMember.id)}>open member →</button>}</>}
          </div>
        )}
      </div>

      <p className="text-center font-serif italic text-[var(--ink-faint)] text-[0.9rem] mt-2" aria-live="polite">
        {selection
          ? "tap it again to let the sky settle."
          : members.length > 1
            ? "tap a star for a member. tap a line for what joins two of you."
            : "invite someone to draw the first line."}
      </p>
    </div>
  );
}

function EdgePanel({
  edge,
  nameA,
  nameB,
  selfId,
  onOpenSynastry,
}: {
  edge: CircleGraphEdge;
  nameA: string;
  nameB: string;
  selfId: string | undefined;
  onOpenSynastry: (otherId: string) => void;
}) {
  const involvesSelf = selfId !== undefined && (edge.a === selfId || edge.b === selfId);
  const otherId = edge.a === selfId ? edge.b : edge.a;
  return (
    <div className="text-[#e8dcc0]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="eyebrow" style={{ color: "#a08c5c" }}>
            {edge.harmony_framing}
          </div>
          <div className="font-serif text-[1.15rem] lowercase leading-tight mt-0.5">
            {nameA} &amp; {nameB}
          </div>
        </div>
        {edge.harmony && (
          <div className="text-right shrink-0">
            <span className="font-serif text-[1.7rem] leading-none" style={{ color: "#f0e4c8" }}>{edge.harmony.score}</span>
            <div className="font-serif italic text-[0.82rem]" style={{ color: "#cbbc97" }}>{edge.harmony.band}</div>
          </div>
        )}
      </div>

      {edge.verdict && (
        <p className="font-serif text-[1.03rem] leading-snug mt-3" style={{ color: "#f0e4c8" }}>
          {edge.verdict}
        </p>
      )}
      {edge.harmony && edge.harmony.engines != null && (
        <p className="micro lowercase mt-1" style={{ color: "#a08c5c" }}>
          derived from {edge.harmony.engines} engines across {edge.harmony.shared_axes} shared {edge.harmony.shared_axes === 1 ? "axis" : "axes"}
        </p>
      )}

      {edge.shared.length > 0 && (
        <div className="mt-3">
          <div className="eyebrow mb-1.5" style={{ color: "#a08c5c" }}>
            what you share
          </div>
          <ul className="flex flex-wrap gap-1.5">
            {edge.shared.map((t) => (
              <li
                key={t.token}
                className="font-serif text-[0.86rem] lowercase px-2 py-0.5 rounded-full"
                style={{ border: "1px solid rgba(194,165,90,0.35)", color: "#e8dcc0" }}
              >
                {t.label}
              </li>
            ))}
          </ul>
        </div>
      )}

      {edge.aspects.length > 0 && (
        <div className="mt-3">
          <div className="eyebrow mb-1" style={{ color: "#a08c5c" }}>
            between your charts
          </div>
          <ul className="space-y-0.5">
            {edge.aspects.map((a, i) => (
              <li key={i} className="font-serif text-[0.9rem] lowercase" style={{ color: a.harmonious ? "#cbbc97" : "#d4a29a" }}>
                {a.label}
              </li>
            ))}
          </ul>
        </div>
      )}

      {edge.shared.length === 0 && edge.aspects.length === 0 && !edge.harmony && (
        <p className="font-serif italic text-[0.9rem] mt-2" style={{ color: "#a08c5c" }}>
          nothing computed between these two yet. their engines have to speak first.
        </p>
      )}

      {involvesSelf && (
        <button
          type="button"
          onClick={() => onOpenSynastry(otherId)}
          className="mt-3.5 font-serif italic text-[0.95rem] min-h-[44px] inline-flex items-center gap-2"
          style={{ color: "#e8d9b0" }}
        >
          read the sky between you →
        </button>
      )}
    </div>
  );
}

function MemberPanel({
  member,
  isSelf,
  onOpenSynastry,
}: {
  member: CircleGraphMember;
  isSelf: boolean;
  onOpenSynastry: (otherId: string) => void;
}) {
  return (
    <div className="text-[#e8dcc0]">
      <div className="font-serif text-[1.15rem] lowercase leading-tight">
        {isSelf ? "you" : (member.display_name ?? "anon")}
      </div>
      {member.highlights.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5 mt-2">
          {member.highlights.map((h, i) => (
            <li
              key={i}
              className="font-serif text-[0.86rem] lowercase px-2 py-0.5 rounded-full"
              style={{ border: "1px solid rgba(194,165,90,0.35)" }}
            >
              {h.label}
            </li>
          ))}
        </ul>
      ) : (
        <p className="font-serif italic text-[0.9rem] mt-1.5" style={{ color: "#a08c5c" }}>
          {member.has_birth_data ? "their chart is still being read into the sky." : "waiting on their birth data."}
        </p>
      )}
      {!isSelf && member.has_birth_data && (
        <button
          type="button"
          onClick={() => onOpenSynastry(member.id)}
          className="mt-3 font-serif italic text-[0.95rem] min-h-[44px] inline-flex items-center gap-2"
          style={{ color: "#e8d9b0" }}
        >
          read the sky between you →
        </button>
      )}
    </div>
  );
}
