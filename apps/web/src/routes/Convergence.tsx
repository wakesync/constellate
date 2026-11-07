import { useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Card, CardHeading, Shimmer, EmptyState, ErrorState } from "../components/ui";
import { RecordNav } from "../components/RecordNav";
import { Asterism, Flourish } from "../components/svg";
import { api, ApiError, errorCopy } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { Convergence as Conv, Tension, ConvergenceSource, ConvergenceCoverage } from "../lib/types";
import { PrimerButton } from "../components/Primer";
import { SynastryPairCard } from "../components/SynastryPairCard";

const SOURCE_LABEL: Record<ConvergenceSource, string> = {
  astro: "astrology",
  human_design: "human design",
  gene_keys: "gene keys",
  enneagram: "enneagram",
  socionics: "socionics",
};

// which record surface each engine lives on, for the coverage links.
const SOURCE_LINK: Record<ConvergenceSource, string> = {
  astro: "/app/chart",
  human_design: "/app/design",
  gene_keys: "/app/keys",
  enneagram: "/app/enneagram",
  socionics: "/app/socionics",
};

const rise = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.6 },
};

export default function Convergence() {
  const { user } = useAuth();
  const q = useQuery({ queryKey: ["convergence"], queryFn: () => api.convergence() });
  const reading = useQuery({
    queryKey: ["convergence", "reading"],
    queryFn: () => api.convergenceReading(),
    enabled: !!q.data,
    staleTime: Infinity,
  });

  // Harmony with your circle: the pair-level view of the same trait space.
  // react-query dedupes these against home/circle pages, so this stays cheap.
  const constellations = useQuery({ queryKey: ["constellations"], queryFn: () => api.constellations() });
  const withMembers = (constellations.data ?? []).filter((c) => c.member_count > 1);
  const memberQueries = useQueries({
    queries: withMembers.map((c) => ({
      queryKey: ["constellation", c.id, "members"],
      queryFn: () => api.constellationMembers(c.id),
    })),
  });
  const others = useMemo(() => {
    const seen = new Set<string>();
    const out: { id: string; display_name: string | null; has_birth_data?: boolean }[] = [];
    memberQueries.forEach((mq) => {
      mq.data?.forEach((m) => {
        if (m.id === user?.id || seen.has(m.id)) return;
        seen.add(m.id);
        out.push(m);
      });
    });
    return out;
  }, [memberQueries, user?.id]);

  const data = q.data;
  const coveredCount = data ? Object.values(data.coverage).filter(Boolean).length : 0;
  const thin = !!data && coveredCount <= 2;

  return (
    <>
      <RecordNav />

      <motion.header {...rise} className="mb-5">
        <div className="eyebrow">
          your record
        </div>
        <h1 className="display-title mt-2">
          where they meet
        <PrimerButton primer="convergence" /></h1>
        <p className="font-serif italic text-[var(--ink-soft)] mt-1">
          five systems, one person. this is where they agree, and the more interesting places where they do not.
        </p>
      </motion.header>

      {q.isLoading && (
        <>
          <Card className="mb-5">
            <Shimmer className="h-3 w-1/3 mb-4" />
            <Shimmer className="h-3 w-full mb-2" />
            <Shimmer className="h-3 w-full mb-2" />
            <Shimmer className="h-3 w-5/6" />
          </Card>
          <Card>
            <Shimmer className="h-3 w-1/2 mb-4" />
            <Shimmer className="h-3 w-full mb-2" />
            <Shimmer className="h-3 w-11/12" />
          </Card>
        </>
      )}

      {data && (
        <>
          <CoverageStrip coverage={data.coverage} />

          {thin && (
            <Card className="mb-5">
              <p className="font-serif italic text-[var(--ink-soft)] leading-relaxed">
                only {coveredCount === 1 ? "one system has" : "two systems have"} spoken so far. that is not enough
                to triangulate anything honestly. finish another reading and the agreements start to mean something.
              </p>
            </Card>
          )}

          {/* the reading, over the scored result */}
          <Card className="mb-5">
            <CardHeading eyebrow="the reading" title="what the systems keep saying" />
            {reading.isLoading && (
              <div className="space-y-2.5">
                <Shimmer className="h-3 w-full" />
                <Shimmer className="h-3 w-full" />
                <Shimmer className="h-3 w-5/6" />
                <Shimmer className="h-3 w-11/12" />
              </div>
            )}
            {reading.data && (
              <div className="space-y-4 font-serif text-[1.05rem] text-[var(--ink-soft)] leading-relaxed">
                {reading.data.text.split("\n\n").map((para, i) => (
                  <p key={i} className={i === 0 ? "drop-cap" : ""}>
                    {para}
                  </p>
                ))}
              </div>
            )}
            {reading.isError && (
              <p className="font-serif italic text-[var(--ink-faint)]">
                the reading is quiet for now. the agreements below are still true.
              </p>
            )}
          </Card>

          {/* convergences: visible triangulation */}
          {data.convergences.length > 0 && (
            <section className="mb-6">
              <div className="eyebrow mb-3">
                convergences
              </div>
              <div className="space-y-4">
                {data.convergences.map((c, i) => (
                  <ConvergenceCard key={c.axis} conv={c} index={i} />
                ))}
              </div>
            </section>
          )}

          {/* tensions: the best thing on the page, given weight */}
          {data.tensions.length > 0 && (
            <section className="mb-6">
              <div className="eyebrow mb-3">
                tensions
              </div>
              <div className="space-y-5">
                {data.tensions.map((t, i) => (
                  <TensionCard key={t.axis} tension={t} index={i} />
                ))}
              </div>
            </section>
          )}

          {/* pair harmony: the same trait space, read across the circle */}
          {others.length > 0 && (
            <Card className="mb-6">
              <CardHeading eyebrow="across the circle" title="harmony, pair by pair" />
              <p className="font-serif italic text-[var(--ink-soft)] -mt-2 mb-2 text-[0.92rem]">
                the same axes, held against each person you share a sky with.
              </p>
              <ul className="grid gap-4 mt-4">
                {others.slice(0, 5).map((m) => (
                  <li key={m.id}>
                    <SynastryPairCard
                      otherId={m.id}
                      selfName={user?.display_name}
                      otherName={m.display_name}
                      canRead={m.has_birth_data !== false}
                    />
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {data.convergences.length === 0 && data.tensions.length === 0 && !thin && (
            <Card>
              <EmptyState
                asterism={<Asterism size={72} />}
                lines={[
                  "the systems have not lined up on anything decisive yet.",
                  "that is its own kind of honesty.",
                ]}
              />
            </Card>
          )}

          <div className="mt-6 flex justify-center">
            <Flourish />
          </div>
        </>
      )}

      {!q.isLoading && q.isError && (q.error instanceof ApiError && q.error.status === 404 ? (
        <Card>
          <EmptyState
            asterism={<Asterism size={80} />}
            lines={["nothing to converge yet.", "complete a reading or two and return here."]}
          />
        </Card>
      ) : (
        <Card>
          <ErrorState
            asterism={<Asterism size={72} />}
            lines={[errorCopy(q.error)]}
            onRetry={() => q.refetch()}
          />
        </Card>
      ))}
    </>
  );
}

// Which engines fill in from birth data alone vs. require sitting a quiz.
const QUIZ_SOURCES: ConvergenceSource[] = ["enneagram", "socionics"];
const BIRTH_SOURCES: ConvergenceSource[] = ["astro", "human_design", "gene_keys"];

// The birth-data tier rule: show what IS speaking; never render absent engines
// as gaps. A member on birth data alone sees three present chips and one quiet
// line offering the quizzes. A missing BIRTH engine (no chart yet) still links,
// because that is real missing foundation, not an optional deepening.
function CoverageStrip({ coverage }: { coverage: ConvergenceCoverage }) {
  const entries = Object.entries(coverage) as [ConvergenceSource, boolean][];
  const present = entries.filter(([, has]) => has);
  const missingBirth = BIRTH_SOURCES.filter((s) => !coverage[s]);
  const missingQuiz = QUIZ_SOURCES.filter((s) => !coverage[s]);
  return (
    <div className="mb-5 -mx-1 overflow-x-auto no-scrollbar">
      <div className="flex items-center gap-1.5 px-1 min-w-max">
        {present.map(([src]) => (
          <span
            key={src}
            className="whitespace-nowrap text-[0.7rem] tracking-[0.08em] lowercase px-2.5 py-1 rounded-full"
            style={{
              border: "1px solid rgba(169,138,61,0.55)",
              color: "var(--ink-soft)",
              background: "color-mix(in oklab, var(--parchment-shadow) 55%, transparent)",
            }}
          >
            {"· "}
            {SOURCE_LABEL[src]}
          </span>
        ))}
      </div>
      {missingBirth.length > 0 && (
        <p className="px-1 mt-2 font-serif italic text-[0.82rem] text-[var(--ink-faint)]">
          not yet cast:{" "}
          {missingBirth.map((src, i) => (
            <span key={src}>
              <a href={SOURCE_LINK[src]} className="btn-link">
                {SOURCE_LABEL[src]}
              </a>
              {i < missingBirth.length - 1 ? ", " : ""}
            </span>
          ))}
        </p>
      )}
      {missingBirth.length === 0 && missingQuiz.length > 0 && (
        <p className="px-1 mt-2 font-serif italic text-[0.82rem] text-[var(--ink-faint)]">
          deepen it, if you like: the{" "}
          {missingQuiz.map((src, i) => (
            <span key={src}>
              <a href={SOURCE_LINK[src]} className="btn-link">
                {SOURCE_LABEL[src]}
              </a>
              {i < missingQuiz.length - 1 ? " and " : ""}
            </span>
          ))}{" "}
          {missingQuiz.length === 1 ? "reading adds" : "readings add"} another voice. the record stands without them.
        </p>
      )}
    </div>
  );
}

function StrengthDots({ strength }: { strength: number }) {
  const filled = Math.max(1, Math.round(strength * 5));
  return (
    <span className="inline-flex items-center gap-1" aria-label={`strength ${Math.round(strength * 100)} percent`}>
      {[0, 1, 2, 3, 4].map((i) => (
        <span
          key={i}
          className="inline-block rounded-full"
          style={{
            width: 5,
            height: 5,
            background: i < filled ? "var(--gold-deep)" : "rgba(169,138,61,0.28)",
          }}
        />
      ))}
    </span>
  );
}

function ConvergenceCard({ conv, index }: { conv: Conv; index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: Math.min(index * 0.05, 0.25) }}
    >
      <Card>
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <h3 className="font-serif text-[1.3rem] lowercase leading-tight">{conv.label}</h3>
            <div className="mt-0.5 font-serif italic text-[var(--ink-soft)]">
              {conv.sources.length} systems point toward{" "}
              <span className="text-[var(--oxblood)]">{conv.direction}</span>
            </div>
          </div>
          <StrengthDots strength={conv.strength} />
        </div>

        <div className="rule-gold my-4" />

        {/* stacked evidence: the point is you SEE them pointing the same way */}
        <ul className="space-y-3">
          {conv.evidence.map((e, i) => (
            <li key={i} className="flex gap-3">
              <span
                aria-hidden
                className="mt-2 inline-block shrink-0 rounded-full"
                style={{ width: 6, height: 6, background: "var(--gold-deep)" }}
              />
              <div>
                <div className="eyebrow mb-0.5">
                  {SOURCE_LABEL[e.source]}
                </div>
                <p className="font-serif text-[0.98rem] text-[var(--ink-soft)] leading-relaxed">
                  {e.evidence}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </motion.div>
  );
}

function TensionCard({ tension, index }: { tension: Tension; index: number }) {
  const [neg, pos] = tension.poles;
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: Math.min(index * 0.05, 0.25) }}
    >
      <Card
        className="border"
        // give tensions visual weight: a warmer, heavier frame
      >
        <div
          className="rounded-sm"
          style={{ borderLeft: "2px solid var(--oxblood)", paddingLeft: "0.9rem" }}
        >
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="font-serif text-[1.35rem] lowercase leading-tight">{tension.label}</h3>
            <StrengthDots strength={tension.strength} />
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3">
            <PoleRow ev={neg} />
            <div className="flex items-center gap-2 py-0.5">
              <span className="flex-1 h-px" style={{ background: "rgba(122,46,42,0.28)" }} />
              <span className="eyebrow text-[var(--oxblood)]">against</span>
              <span className="flex-1 h-px" style={{ background: "rgba(122,46,42,0.28)" }} />
            </div>
            <PoleRow ev={pos} />
          </div>

          <div className="rule-gold my-4" />

          <p className="font-serif italic text-[1.12rem] text-[var(--oxblood-deep)] leading-relaxed">
            {tension.question}
          </p>
        </div>
      </Card>
    </motion.div>
  );
}

function PoleRow({ ev }: { ev: Tension["poles"][number] }) {
  return (
    <div>
      <div className="eyebrow mb-0.5">
        {SOURCE_LABEL[ev.source]}
      </div>
      <p className="font-serif text-[0.98rem] text-[var(--ink-soft)] leading-relaxed">{ev.evidence}</p>
    </div>
  );
}
