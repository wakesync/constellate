import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Card, CardHeading, Shimmer, EmptyState, ErrorState } from "../components/ui";
import { RecordNav } from "../components/RecordNav";
import { Asterism, Flourish, TinyStar } from "../components/svg";
import { api, ApiError, errorCopy } from "../lib/api";
import type { GkKey, GkSphere } from "../lib/types";
import { PrimerButton } from "../components/Primer";
import { AlternateLensNote, ZodiacLens } from "../components/ZodiacLens";

const SPHERE_ORDER: { key: "lifes_work" | "evolution" | "radiance" | "purpose"; blurb: string }[] = [
  { key: "lifes_work", blurb: "the work you are here to do, and the way you are meant to do it." },
  { key: "evolution", blurb: "the challenge you keep meeting, the one that grows you if you let it." },
  { key: "radiance", blurb: "how your vitality wants to move through the world when you are well." },
  { key: "purpose", blurb: "the quiet aim underneath everything, the thing you are for." },
];

export default function GeneKeys() {
  const q = useQuery({ queryKey: ["genekeys"], queryFn: () => api.genekeys() });
  const reading = useQuery({
    queryKey: ["genekeys", "reading"],
    queryFn: () => api.genekeysReading(),
    enabled: !!q.data?.gk,
    staleTime: Infinity,
  });

  const gk = q.data?.gk;
  const sidereal = gk?.zodiac === "sidereal";
  const keyByGate = new Map<number, GkKey>((gk?.keys ?? []).map((k) => [k.gate, k]));

  return (
    <>
      <RecordNav />
      <ZodiacLens />

      <motion.header
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="mb-5"
      >
        <div className="eyebrow">
          your record
        </div>
        <h1 className="display-title mt-2">
          your gene keys
        <PrimerButton primer="genekeys" /></h1>
        <p className="font-serif italic text-[var(--ink-soft)] mt-1">
          not a verdict. a contemplation. four gates, each one a slow climb from shadow to gift to the thing above it.
        </p>
      </motion.header>

      {sidereal && <AlternateLensNote system="genekeys" />}

      {q.isLoading && (
        <div className="space-y-5">
          {[0, 1].map((i) => (
            <Card key={i}>
              <Shimmer className="h-3 w-1/3 mb-4" />
              <div className="space-y-3">
                <Shimmer className="h-10 w-full" />
                <Shimmer className="h-10 w-full" />
                <Shimmer className="h-10 w-full" />
              </div>
            </Card>
          ))}
        </div>
      )}

      {gk && (
        <>
          <div className="space-y-5">
            {SPHERE_ORDER.map(({ key, blurb }, idx) => {
              const sphere = gk.activation[key] as GkSphere;
              const gkey = keyByGate.get(sphere.gate);
              return (
                <motion.div
                  key={key}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.55, delay: idx * 0.08 }}
                >
                  <Card>
                    <div className="flex items-baseline justify-between mb-1">
                      <h2 className="font-serif text-[1.5rem] lowercase tracking-wide leading-tight">
                        {sphere.sphere.toLowerCase()}
                      </h2>
                      <span className="font-serif text-[1.05rem] text-[var(--ink-faint)] tabular">
                        {sphere.gate}.{sphere.line}
                      </span>
                    </div>
                    <p className="font-serif italic text-[0.95rem] text-[var(--ink-faint)] leading-snug mb-5">
                      {blurb}
                    </p>
                    {gkey ? (
                      <Ascent gk={gkey} />
                    ) : (
                      <p className="font-serif italic text-[var(--ink-faint)]">
                        this gate is still being read.
                      </p>
                    )}
                    {gkey?.codon_ring && (
                      <div className="mt-4 eyebrow">
                        {gkey.codon_ring.toLowerCase()}
                      </div>
                    )}
                  </Card>
                </motion.div>
              );
            })}
          </div>

          <Card className="mt-5">
            <CardHeading eyebrow="the reading" title="how to sit with these" />
            {reading.isLoading && (
              <div className="space-y-2.5">
                <Shimmer className="h-3 w-full" />
                <Shimmer className="h-3 w-full" />
                <Shimmer className="h-3 w-5/6" />
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
                the reading is quiet for now. it will return.
              </p>
            )}
            <p className="eyebrow mt-5 text-center">tropical canon + fixed-star alternate · read together</p>
            <div className="mt-3 flex justify-center">
              <Flourish />
            </div>
          </Card>
        </>
      )}

      {!q.isLoading && q.isError && (q.error instanceof ApiError && q.error.status === 404 ? (
        <EmptyCard />
      ) : (
        <Card>
          <ErrorState
            asterism={<Asterism size={72} />}
            lines={[errorCopy(q.error)]}
            onRetry={() => q.refetch()}
          />
        </Card>
      ))}

      {!q.isLoading && !q.isError && !gk && <EmptyCard />}
    </>
  );
}

// The three tiers as an ascent: shadow low and dim, gift in the middle, siddhi
// high and luminous. A faint vertical thread joins them, like a stem.
function Ascent({ gk }: { gk: GkKey }) {
  const tiers = [
    {
      rank: "siddhi",
      word: gk.siddhi,
      note: "the fruit. rare, and worth the whole climb.",
      opacity: 1,
      color: "var(--gold-deep)",
      star: true,
    },
    {
      rank: "gift",
      word: gk.gift,
      note: "the everyday medicine. where you want to live.",
      opacity: 0.92,
      color: "var(--oxblood)",
      star: false,
    },
    {
      rank: "shadow",
      word: gk.shadow,
      note: "not a flaw. the low note of the same sound.",
      opacity: 0.62,
      color: "var(--ink-faint)",
      star: false,
    },
  ];
  return (
    <div className="relative pl-6">
      {/* the stem */}
      <div
        className="absolute left-[7px] top-2 bottom-2 w-px"
        style={{
          background:
            "linear-gradient(to top, rgba(109,94,70,0.35), rgba(122,46,42,0.5), rgba(169,138,61,0.7))",
        }}
        aria-hidden="true"
      />
      <ul className="space-y-5">
        {tiers.map((t) => (
          <li key={t.rank} className="relative" style={{ opacity: t.opacity }}>
            <span
              className="absolute -left-[22px] top-1.5 inline-flex items-center justify-center"
              aria-hidden="true"
            >
              {t.star ? (
                <TinyStar size={11} color="var(--gold)" />
              ) : (
                <span
                  className="inline-block w-2 h-2 rounded-full"
                  style={{ background: t.color, opacity: 0.8 }}
                />
              )}
            </span>
            <div className="flex items-baseline gap-3">
              <span className="eyebrow w-12 shrink-0">
                {t.rank}
              </span>
              <span
                className="font-serif text-[1.2rem] lowercase leading-none"
                style={{ color: t.color }}
              >
                {t.word.toLowerCase()}
              </span>
            </div>
            <p className="font-serif italic text-[0.88rem] text-[var(--ink-faint)] leading-snug mt-1 pl-[3.75rem]">
              {t.note}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function EmptyCard() {
  return (
    <Card>
      <EmptyState
        asterism={<Asterism size={80} />}
        lines={["no keys yet.", "complete onboarding and we'll trace your four gates."]}
      />
    </Card>
  );
}
