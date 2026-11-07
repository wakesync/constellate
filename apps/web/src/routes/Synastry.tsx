import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Card, Shimmer, EmptyState, ErrorState, ButtonInk } from "../components/ui";
import { ChartWheel } from "../components/ChartWheel";
import { Asterism, Flourish, IconBack } from "../components/svg";
import { api, ApiError, errorCopy } from "../lib/api";
import type { RelationshipKind, RelationshipLens, SynastryGenerationMeta } from "../lib/types";
import { initialsFor, planetGlyph } from "../lib/format";
import { Avatar } from "../components/ui";
import { PrimerButton } from "../components/Primer";
import { HarmonySeal } from "../components/HarmonySeal";
import { ReadingCount } from "../components/ReadingCount";
import { PairMechanicsPanel } from "../components/PairMechanics";
import { ZodiacLens } from "../components/ZodiacLens";
import { useAuth } from "../lib/auth";

const ASPECT_GLYPH: Record<string, string> = {
  conjunction: "☌",
  opposition: "☍",
  trine: "△",
  square: "□",
  sextile: "✶",
  quincunx: "⚻",
};

// lowercase roman numerals for reading numbers: manuscript folio style.
function roman(n: number): string {
  const table: Array<[number, string]> = [
    [1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"],
    [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"],
  ];
  let out = "";
  for (const [v, s] of table) while (n >= v) { out += s; n -= v; }
  return out || "i";
}

function shortDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" }).toLowerCase();
}

const LENS_LABEL: Record<string, string> = {
  roommate: "roommate",
  collaborator: "collaborator",
  friend: "friend",
  romantic: "romantic",
  family: "family",
  unspecified: "platonic",
};

// Which sky a generation was cast under. Tropical (and absent, i.e. every
// pre-lens generation) renders NOTHING: the tropical provenance line stays
// pixel-identical to the pre-feature app. Only sidereal casts carry the tag.
function skyTag(zodiac?: string): string {
  return zodiac === "sidereal" ? " · cast under the sidereal sky" : "";
}

export default function Synastry() {
  const { otherUserId = "" } = useParams();
  const qc = useQueryClient();
  const { user } = useAuth();
  const zodiac = user?.zodiac_system === "sidereal" ? "sidereal" : "tropical";
  const synastryKey = ["synastry", otherUserId, zodiac] as const;
  const synastryGensKey = ["synastry-gens", otherUserId, zodiac] as const;

  // The ACTIVE reading. GET only: opening this page never spends a cast.
  const q = useQuery({
    queryKey: synastryKey,
    queryFn: () => api.synastry(otherUserId),
    retry: 0,
  });

  // The pair's full reading history (metadata only).
  const history = useQuery({
    queryKey: synastryGensKey,
    queryFn: () => api.synastryGenerations(otherUserId),
    enabled: !!otherUserId,
  });

  const context = useQuery({
    queryKey: ["pair-context", otherUserId],
    queryFn: () => api.pairContext(otherUserId),
    enabled: !!otherUserId,
  });

  // Changing the lens only changes what the NEXT cast reads through. It never
  // regenerates: no reading is destroyed or paid for by touching this control.
  const setContext = useMutation({
    mutationFn: (relationship: RelationshipKind) => api.setPairContext(otherUserId, relationship),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["pair-context", otherUserId] }),
        // the framing word (house harmony vs harmony) follows the lens.
        qc.invalidateQueries({ queryKey: ["harmony", otherUserId] }),
        // Current lens rides both payloads. Prefix invalidation refreshes every
        // sky-keyed reading plus the generic pair-card history count.
        qc.invalidateQueries({ queryKey: ["synastry", otherUserId] }),
        qc.invalidateQueries({ queryKey: ["synastry-gens", otherUserId] }),
      ]);
    },
  });

  // Casting is the ONLY way a new reading comes into being. Explicit, priced
  // (one cast = one future credit), and it never erases what came before.
  const cast = useMutation({
    mutationFn: () => api.regenerateSynastry(otherUserId),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["synastry", otherUserId] }),
        qc.invalidateQueries({ queryKey: ["synastry-gens", otherUserId] }),
      ]);
    },
  });

  // Turning back to an earlier reading. Either member can; it moves the
  // pair's shared bookmark, nothing else.
  const switchActive = useMutation({
    mutationFn: (generationId: string) => api.setSynastryActive(otherUserId, generationId),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["synastry", otherUserId] }),
        qc.invalidateQueries({ queryKey: ["synastry-gens", otherUserId] }),
      ]);
    },
  });

  // 404 distinctions: SYNASTRY_NOT_FOUND = no reading cast yet (show the CTA);
  // other 404s = no shared constellation / no birth data.
  const isNoReading = q.error instanceof ApiError && q.error.status === 404 && q.error.code === "SYNASTRY_NOT_FOUND";
  const is404 = q.error instanceof ApiError && q.error.status === 404;

  const harmony = useQuery({
    queryKey: ["harmony", otherUserId],
    queryFn: () => api.harmonyPair(otherUserId),
    enabled: !!otherUserId,
    staleTime: 5 * 60 * 1000,
  });

  const currentLens: RelationshipLens = history.data?.current_lens ?? q.data?.current_lens ?? "unspecified";
  const genMeta = q.data?.generation;
  const lensMismatch = !!genMeta && genMeta.lens !== currentLens;

  return (
    <>
      <div className="mb-3">
        <Link to="/app/constellations" className="inline-flex items-center gap-2 eyebrow min-h-[44px]">
          <IconBack size={18} /> back
        </Link>
      </div>

      <motion.header
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="mb-5"
      >
        <div className="eyebrow">
          synastry · the sky between you
        </div>
        <h1 className="display-title mt-2">
          {q.data?.user_b.display_name
            ? <>you &amp; {q.data.user_b.display_name}</>
            : "where you meet"}
          <PrimerButton primer="synastry" />
        </h1>
      </motion.header>

      <ZodiacLens />

      {q.isLoading && (
        <Card>
          <div className="flex justify-around mb-4">
            <Shimmer className="h-32 w-32 rounded-full" />
            <Shimmer className="h-32 w-32 rounded-full" />
          </div>
          <Shimmer className="h-3 w-2/3" />
          <Shimmer className="h-3 w-3/4 mt-2" />
          <Shimmer className="h-3 w-1/2 mt-2" />
        </Card>
      )}

      {q.data && (
        <>
          {/* the headline: deterministic harmony, before any prose */}
          {harmony.data?.harmony && (
            <Card className="mb-5">
              <HarmonySeal
                harmony={harmony.data.harmony}
                framing={harmony.data.framing}
                verdict={harmony.data.verdict}
              />
            </Card>
          )}

          {/* side-by-side mini charts */}
          <Card className="mb-5">
            <div className="grid grid-cols-2 gap-3 items-end">
              <PersonMini name={q.data.user_a.display_name} chart={q.data.user_a.chart} self />
              <PersonMini name={q.data.user_b.display_name} chart={q.data.user_b.chart} />
            </div>
          </Card>

          {/* relationship context: one small, legible choice, not a settings form */}
          <RelationshipContext
            value={context.data?.relationship ?? null}
            busy={setContext.isPending}
            onChange={(v) => setContext.mutate(v)}
          />

          {/* aspects */}
          <Card className="mb-5">
            <div className="eyebrow mb-2">
              major aspects
            </div>
            {q.data.aspects.length === 0 ? (
              <EmptyState asterism={<Asterism size={64} />} lines={["no major aspects within orb."]} />
            ) : (
              <ul className="space-y-1.5">
                {q.data.aspects.map((a, i) => (
                  <li key={i} className="flex items-center gap-3 py-1.5 border-b border-[rgba(169,138,61,0.18)] last:border-0">
                    <span
                      className="font-serif text-lg w-6 text-center"
                      style={{ color: a.harmonic === "harsh" ? "var(--oxblood)" : a.harmonic === "harmonious" ? "var(--gold-deep)" : "var(--ink-faint)" }}
                    >
                      {ASPECT_GLYPH[a.type] ?? "·"}
                    </span>
                    <span className="font-serif text-[1.02rem] lowercase">
                      <span className="text-[var(--ink)]">{planetGlyph(a.a)}</span> {a.a}
                      <span className="text-[var(--ink-faint)]"> {a.type} </span>
                      <span className="text-[var(--ink)]">{planetGlyph(a.b)}</span> {a.b}
                    </span>
                    <span className="ml-auto text-xs text-[var(--ink-faint)] tabular">
                      {a.orb.toFixed(1)}°
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* the mechanical pair layer: computed facts from HD / gene keys /
              socionics / enneagram. one quiet panel inside the single reading,
              never a five-tab engine dashboard. */}
          {harmony.data?.mechanics && harmony.data.mechanics_sides && (
            <Card className="mb-5">
              <PairMechanicsPanel
                mechanics={harmony.data.mechanics}
                aName={(harmony.data.mechanics_sides.a.display_name ?? "person a").toLowerCase()}
                bName={(harmony.data.mechanics_sides.b.display_name ?? "person b").toLowerCase()}
                meIsA={harmony.data.mechanics_sides.a.id !== otherUserId}
              />
            </Card>
          )}

          {/* narrative — the manuscript, with its provenance */}
          <Card>
            <div className="flex items-baseline justify-between mb-3">
              <div className="eyebrow">
                the manuscript
              </div>
              {genMeta && genMeta.total > 0 && (
                <ReadingCount total={genMeta.total} />
              )}
            </div>

            {/* provenance line: which reading this is, when, through what lens */}
            {genMeta && (
              <p className="font-serif italic text-[0.88rem] text-[var(--ink-faint)] mb-3">
                reading {roman(genMeta.index)} of {roman(genMeta.total)} · {LENS_LABEL[genMeta.lens] ?? genMeta.lens} · {shortDate(genMeta.generated_at)}{skyTag(genMeta.zodiac_system)}
              </p>
            )}

            {/* lens tag: the reading on display was written under another lens.
                informative, never a trigger for regeneration. */}
            {lensMismatch && (
              <p
                className="font-serif italic text-[0.88rem] mb-4 px-3 py-2"
                style={{ color: "var(--oxblood)", borderLeft: "2px solid rgba(122,46,42,0.45)", background: "rgba(122,46,42,0.05)" }}
              >
                read under the {LENS_LABEL[genMeta!.lens] ?? genMeta!.lens} lens. you now read as {LENS_LABEL[currentLens] ?? currentLens}.
              </p>
            )}

            {/* degraded gens: honest about being partial */}
            {q.data.degraded && (
              <p className="font-serif italic text-[0.88rem] text-[var(--ink-faint)] mb-4 text-center">
                the stars were quiet. this is a partial reading.
              </p>
            )}

            <div className="flex justify-center mb-4"><Flourish /></div>
            <Reading text={q.data.narrative} />
            <div className="flex justify-center mt-5"><Asterism size={56} /></div>

            {/* the readings drawer: every casting the pair has ever made */}
            {history.data && history.data.total > 1 && (
              <ReadingsDrawer
                generations={history.data.generations}
                viewingId={genMeta?.id ?? null}
                busy={switchActive.isPending}
                onSelect={(g) => {
                  if (g.id !== genMeta?.id && !g.degraded) switchActive.mutate(g.id);
                }}
              />
            )}

            {/* cast a new reading: explicit, lens named before you commit */}
            <div className="flex flex-col items-center mt-6">
              <ButtonInk onClick={() => cast.mutate()} disabled={cast.isPending}>
                {cast.isPending ? "casting..." : "cast a new reading"}
              </ButtonInk>
              <p className="mt-2 text-xs font-serif italic text-[var(--ink-faint)] text-center">
                cast under the {LENS_LABEL[currentLens] ?? currentLens} lens. earlier readings are kept, always.
              </p>
              {cast.isError && (
                <p className="mt-2 text-xs font-serif italic text-center" style={{ color: "var(--oxblood)" }}>
                  {errorCopy(cast.error)}
                </p>
              )}
            </div>
          </Card>
        </>
      )}

      {/* no reading cast yet: the pair is readable, the manuscript is not
          written. one act, clearly named. */}
      {q.isError && isNoReading && (
        <Card>
          <EmptyState
            asterism={<Asterism size={64} />}
            lines={["the sky between you is uncharted.", "no reading has been cast for this pair."]}
          />
          <div className="flex flex-col items-center mt-4">
            <ButtonInk onClick={() => cast.mutate()} disabled={cast.isPending}>
              {cast.isPending ? "casting..." : "cast the first reading"}
            </ButtonInk>
            <p className="mt-2 text-xs font-serif italic text-[var(--ink-faint)] text-center">
              cast under the {LENS_LABEL[currentLens] ?? currentLens} lens.
            </p>
            {cast.isError && (
              <p className="mt-2 text-xs font-serif italic text-center" style={{ color: "var(--oxblood)" }}>
                {errorCopy(cast.error)}
              </p>
            )}
          </div>
        </Card>
      )}

      {q.isError && is404 && !isNoReading && (
        <Card>
          <EmptyState
            asterism={<Asterism size={64} />}
            lines={["nothing to map yet.", "you both need to share a constellation and enter birth data."]}
          />
        </Card>
      )}

      {q.isError && !is404 && (
        <Card>
          <ErrorState
            asterism={<Asterism size={64} />}
            lines={[errorCopy(q.error)]}
            onRetry={() => q.refetch()}
          />
        </Card>
      )}
    </>
  );
}

// The readings drawer: the pair's full history as a strip of dark plates,
// each a small tarot object. Newest first. The one on display carries a
// wax-seal mark. Tap an older reading to turn the pair's shared bookmark
// back to it, for both of you.
function ReadingsDrawer({
  generations,
  viewingId,
  busy,
  onSelect,
}: {
  generations: SynastryGenerationMeta[];
  viewingId: string | null;
  busy: boolean;
  onSelect: (g: SynastryGenerationMeta) => void;
}) {
  return (
    <div className="mt-6 pt-5" style={{ borderTop: "1px solid rgba(169,138,61,0.25)" }}>
      <div className="flex items-baseline justify-between mb-3">
        <div className="eyebrow">past readings</div>
        <ReadingCount total={generations.length} />
      </div>
      <div className="flex gap-2.5 overflow-x-auto no-scrollbar -mx-1 px-1 pb-1" role="listbox" aria-label="past readings">
        {generations.map((g) => {
          const viewing = g.id === viewingId;
          return (
            <button
              key={g.id}
              type="button"
              role="option"
              aria-selected={viewing}
              disabled={busy || g.degraded}
              onClick={() => onSelect(g)}
              className="relative shrink-0 text-left transition-transform"
              style={{
                minWidth: 118,
                minHeight: 84,
                padding: "0.7rem 0.8rem 0.6rem",
                borderRadius: 3,
                background: viewing
                  ? "radial-gradient(ellipse at 50% 0%, #33281a 0%, #241b10 55%, #170f08 100%)"
                  : "rgba(31, 26, 20, 0.045)",
                border: viewing
                  ? "1px solid rgba(194,165,90,0.55)"
                  : "1px solid rgba(169,138,61,0.28)",
                opacity: g.degraded ? 0.55 : 1,
                cursor: g.degraded ? "default" : viewing ? "default" : "pointer",
              }}
            >
              {/* wax seal on the active reading */}
              {g.active && (
                <span
                  aria-label="active reading"
                  className="absolute"
                  style={{
                    top: -5,
                    right: -5,
                    width: 14,
                    height: 14,
                    borderRadius: 999,
                    background: "radial-gradient(circle at 35% 30%, #a04640, #5e221f 70%)",
                    boxShadow: "0 1px 3px rgba(31,26,20,0.4), inset 0 -1px 1px rgba(0,0,0,0.3)",
                  }}
                />
              )}
              <span
                className="font-display block text-[1.35rem] leading-none lowercase"
                style={{ fontWeight: 430, color: viewing ? "#e8d9b0" : "var(--ink-soft)" }}
              >
                {roman(g.index)}
              </span>
              <span
                className="micro block mt-1.5 lowercase"
                style={{ color: viewing ? "#a08c5c" : "var(--ink-faint)" }}
              >
                {LENS_LABEL[g.lens] ?? g.lens} · {g.zodiac_system === "sidereal" ? "sidereal sky" : "tropical sky"}
              </span>
              <span
                className="micro block mt-0.5 lowercase tabular"
                style={{ color: viewing ? "#a08c5c" : "var(--ink-faint)" }}
              >
                {shortDate(g.generated_at)}{g.degraded ? " · partial" : ""}
              </span>
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-xs font-serif italic text-[var(--ink-faint)]">
        turning back a page turns it for both of you.
      </p>
    </div>
  );
}

const RELATIONSHIPS: Array<{ value: RelationshipKind; label: string }> = [
  { value: "roommate", label: "share a home" },
  { value: "collaborator", label: "build together" },
  { value: "friend", label: "friends" },
  { value: "romantic", label: "romantic" },
  { value: "family", label: "family" },
];

function RelationshipContext({
  value,
  busy,
  onChange,
}: {
  value: RelationshipKind | null;
  busy: boolean;
  onChange: (value: RelationshipKind) => void;
}) {
  return (
    <Card className="mb-5">
      <div className="eyebrow mb-1">
        how you know each other
      </div>
      <p className="font-serif italic text-[0.92rem] text-[var(--ink-soft)] mb-3">
        this changes the lens of your next casting. readings already made are untouched.
      </p>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="relationship context">
        {RELATIONSHIPS.map((item) => {
          const selected = value === item.value;
          return (
            <button
              key={item.value}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={busy}
              onClick={() => !selected && onChange(item.value)}
              className={`min-h-[44px] px-3 py-2 border text-[0.72rem] tracking-[0.08em] lowercase transition-colors ${selected
                ? "border-[var(--oxblood)] text-[var(--oxblood)] bg-[rgba(122,46,42,0.06)]"
                : "border-[rgba(169,138,61,0.32)] text-[var(--ink-soft)] hover:border-[var(--gold-deep)]"}`}
              style={{ borderRadius: 2 }}
            >
              {busy && selected ? "keeping..." : item.label}
            </button>
          );
        })}
      </div>
      {!value && (
        <p className="mt-2 text-xs font-serif italic text-[var(--ink-faint)]">
          no context chosen yet. castings default to platonic.
        </p>
      )}
    </Card>
  );
}

function PersonMini({ name, chart, self }: { name: string | null; chart: import("../lib/types").NatalChart | null; self?: boolean }) {
  return (
    <div className="flex flex-col items-center">
      <ChartWheel chart={chart} size={150} showHouses={false} ariaLabel={`mini chart for ${name ?? "anon"}`} />
      <div className="mt-3 flex items-center gap-2">
        <Avatar initials={initialsFor(name)} size={28} ring={self} />
        <span className="font-serif italic lowercase text-[var(--ink-soft)]">
          {self ? "you" : (name ?? "anon")}
        </span>
      </div>
    </div>
  );
}

type StructuredReading = {
  opening?: string;
  sections?: Array<{ title: string; body: string }>;
  verdict?: string;
  highlights?: Array<{ aspect: string; meaning: string }>;
};

// Try to parse the narrative as the structured JSON format. Returns null if it's
// the old flowing-prose format or the canned fallback, so we degrade gracefully.
// Robust to leading/trailing prose or markdown fences around the JSON object.
function parseStructured(text: string): StructuredReading | null {
  const t = text.trim();
  if (!t.includes("{")) return null;
  // Extract the outermost {...} object even if the model added stray text/fences.
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  const candidate = t.slice(start, end + 1);
  try {
    const obj = JSON.parse(candidate) as StructuredReading;
    if (obj && (obj.sections?.length || obj.opening || obj.verdict)) return obj;
    return null;
  } catch {
    return null;
  }
}

function Reading({ text }: { text: string }) {
  const structured = parseStructured(text);
  if (!structured) return <Essay text={text} />;
  return (
    <article className="max-w-prose mx-auto">
      {structured.opening && (
        <p className="font-serif italic text-[1.15rem] leading-[1.7] text-[var(--ink-soft)] text-center mb-6">
          {structured.opening}
        </p>
      )}
      {(structured.sections ?? []).filter((s) => s.body && s.body.trim() && s.title && !s.title.includes("placeholder")).map((s, i) => (
        <section key={i} className="mb-5">
          <div className="eyebrow text-[var(--gold-deep)] mb-1.5">
            {s.title}
          </div>
          <p className="font-serif text-[1.06rem] leading-[1.8] text-[var(--ink)]">
            {renderEmphasis(s.body)}
          </p>
        </section>
      ))}
      {structured.verdict && (
        <>
          <div className="flex justify-center my-5"><Asterism size={40} /></div>
          <p className="font-serif text-[1.08rem] leading-[1.8] text-[var(--ink)] italic text-center">
            {renderEmphasis(structured.verdict)}
          </p>
        </>
      )}
      {!!structured.highlights?.length && (
        <div className="mt-6 pt-5" style={{ borderTop: "1px solid rgba(169,138,61,0.25)" }}>
          <div className="eyebrow mb-3 text-center">
            the aspects that matter
          </div>
          <ul className="space-y-2.5">
            {structured.highlights.map((h, i) => (
              <li key={i} className="flex flex-col">
                <span className="font-serif text-[0.95rem] text-[var(--oxblood)] lowercase">{h.aspect}</span>
                <span className="font-serif text-[0.98rem] leading-[1.6] text-[var(--ink-soft)]">{h.meaning}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}

function Essay({ text }: { text: string }) {
  const paras = text.split(/\n\n+/);
  return (
    <article className="font-serif text-[1.08rem] leading-[1.85] text-[var(--ink)] max-w-prose mx-auto">
      {paras.map((p, i) => (
        <p key={i} className={i === 0 ? "drop-cap mb-4" : "mb-4"}>
          {renderEmphasis(p)}
        </p>
      ))}
    </article>
  );
}

// Render *italic* markers as <em>. Keep parsing trivial.
function renderEmphasis(p: string): React.ReactNode {
  const parts = p.split(/(\*[^*]+\*)/g);
  return parts.map((seg, i) => {
    if (seg.startsWith("*") && seg.endsWith("*") && seg.length > 2) {
      return <em key={i} style={{ color: "var(--oxblood-deep)" }}>{seg.slice(1, -1)}</em>;
    }
    return <span key={i}>{seg}</span>;
  });
}
