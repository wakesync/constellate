// SynastryPairCard: a pair as a tarot-grade object, not a list row. Night-sky
// ground inside a gold frame-in-frame, the deterministic harmony number
// oversized in the display face, the band word as display type, the verdict
// as one elegant line. Used on home, constellation detail, and convergence.

import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { IconArrowRight } from "./svg";
import { api } from "../lib/api";
import { readingCountCopy } from "./ReadingCount";

interface Props {
  otherId: string;
  selfName: string | null | undefined;
  otherName: string | null | undefined;
  // when the other person hasn't entered birth data yet, the pair isn't readable
  canRead?: boolean;
  // optional contextual subtitle, e.g. constellation name on home
  context?: string;
}

// two tiny stars joined by a line: the pair, drawn instead of avatar circles
function PairMark({ dim = false }: { dim?: boolean }) {
  return (
    <svg viewBox="0 0 64 16" width="64" height="16" aria-hidden="true" className="shrink-0">
      <line x1="10" y1="8" x2="54" y2="8" stroke="#c2a55a" strokeWidth="0.8" opacity={dim ? 0.3 : 0.6} />
      <path d="M8 3 L9.2 6.8 L13 8 L9.2 9.2 L8 13 L6.8 9.2 L3 8 L6.8 6.8 Z" fill="#e8d9b0" opacity={dim ? 0.4 : 0.9} />
      <path d="M56 3 L57.2 6.8 L61 8 L57.2 9.2 L56 13 L54.8 9.2 L51 8 L54.8 6.8 Z" fill="#c2a55a" opacity={dim ? 0.4 : 0.9} />
    </svg>
  );
}

export function SynastryPairCard({ otherId, selfName: _selfName, otherName, canRead = true, context }: Props) {
  // Deterministic harmony for the card. Cached and cheap server-side
  // (convergence_cache hits); react-query dedupes across surfaces.
  const harmony = useQuery({
    queryKey: ["harmony", otherId],
    queryFn: () => api.harmonyPair(otherId),
    enabled: canRead,
    staleTime: 5 * 60 * 1000,
    retry: 0,
  });
  const h = harmony.data?.harmony ?? null;
  const high = h !== null && h.score >= 70;
  const low = h !== null && h.score < 45;

  // How many readings this pair has cast: the credits-ready affordance.
  // Metadata-only endpoint, cached long; absent on error, never blocking.
  const gens = useQuery({
    queryKey: ["synastry-gens", otherId],
    queryFn: () => api.synastryGenerations(otherId),
    enabled: canRead,
    staleTime: 5 * 60 * 1000,
    retry: 0,
  });
  const castCount = gens.data?.total ?? 0;

  const inner = (
    <div className="card-tarot-inner">
      <div className="relative z-10 flex items-stretch gap-4">
        {/* the big number is the hero of the card */}
        {canRead && h ? (
          <div className="shrink-0 flex flex-col items-start justify-center pr-4" style={{ borderRight: "1px solid rgba(194,165,90,0.25)" }}>
            <span
              className={`display-num text-[3.1rem] ${high ? "tone-high" : low ? "tone-low" : ""}`}
              style={!high && !low ? { color: "#e8d9b0" } : undefined}
            >
              {h.score}
            </span>
            <span className="micro lowercase" style={{ color: "#a08c5c" }}>of 100</span>
          </div>
        ) : (
          <div className="shrink-0 flex items-center pr-4" style={{ borderRight: "1px solid rgba(194,165,90,0.18)" }}>
            <span className="font-serif text-[2rem]" style={{ color: "rgba(232,217,176,0.35)" }} aria-hidden="true">✶</span>
          </div>
        )}

        <div className="min-w-0 flex-1 flex flex-col justify-center py-0.5">
          <div className="flex items-center justify-between gap-2">
            <PairMark dim={!canRead} />
            {canRead && <IconArrowRight className="row-arrow shrink-0" style={{ color: "#c2a55a" }} />}
          </div>
          <div className="font-serif text-[1.12rem] lowercase leading-tight mt-1.5" style={{ color: "#f0e4c8" }}>
            {canRead ? <>you &amp; {otherName ?? "anon"}</> : <>{otherName ?? "anon"}</>}
          </div>
          {canRead && h && (
            <div
              className={`font-display text-[1.3rem] lowercase leading-tight mt-0.5 ${high ? "tone-high" : low ? "tone-low" : ""}`}
              style={{ fontWeight: 430, ...(high || low ? {} : { color: "#e8d9b0" }) }}
            >
              {h.band}
            </div>
          )}
          <div className="font-serif italic text-[0.86rem] leading-snug mt-1" style={{ color: "#cbbc97" }}>
            {canRead
              ? h
                ? (harmony.data?.verdict ?? `${harmony.data?.framing ?? "harmony"} ${h.score}`)
                : (context ? `read the sky between you · ${context}` : "read the sky between you")
              : "waiting on their birth data"}
          </div>
          {canRead && castCount > 0 && (
            <div className="micro lowercase mt-1.5" style={{ color: "#a08c5c", letterSpacing: "0.08em" }}>
              {readingCountCopy(castCount)}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  if (!canRead) {
    return <div className="card-tarot opacity-75">{inner}</div>;
  }

  return (
    <Link to={`/app/synastry/${otherId}`} className="card-tarot">
      {inner}
    </Link>
  );
}
