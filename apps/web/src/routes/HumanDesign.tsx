import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardHeading, Shimmer, EmptyState, ErrorState } from "../components/ui";
import { RecordNav } from "../components/RecordNav";
import { BodyGraph, BodyGraphSkeleton } from "../components/BodyGraph";
import { Asterism, Flourish } from "../components/svg";
import { api, ApiError, errorCopy } from "../lib/api";
import type { HdCenterName, HumanDesign as Hd } from "../lib/types";
import { PrimerButton } from "../components/Primer";
import { AlternateLensNote, ZodiacLens } from "../components/ZodiacLens";

export default function HumanDesign() {
  const q = useQuery({ queryKey: ["humandesign"], queryFn: () => api.humandesign() });
  const reading = useQuery({
    queryKey: ["humandesign", "reading"],
    queryFn: () => api.humandesignReading(),
    enabled: !!q.data?.hd,
    staleTime: Infinity,
  });
  const [selected, setSelected] = useState<HdCenterName | null>(null);

  const hd = q.data?.hd;
  const sidereal = hd?.zodiac === "sidereal";

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
          your design
        <PrimerButton primer="humandesign" /></h1>
        <p className="font-serif italic text-[var(--ink-soft)] mt-1">
          the same sky, read a second way. what was fixed in you, and what was left open to the world.
        </p>
      </motion.header>

      {sidereal && <AlternateLensNote system="humandesign" />}

      {q.isLoading && (
        <Card>
          <div className="flex flex-col items-center gap-4">
            <BodyGraphSkeleton size={280} />
            <Shimmer className="h-3 w-2/3" />
            <Shimmer className="h-3 w-1/2" />
          </div>
        </Card>
      )}

      {hd && (
        <>
          <Card className="mb-5">
            <div className="flex flex-col items-center">
              <BodyGraph
                centers={hd.centers}
                channels={hd.channels}
                size={288}
                selected={selected}
                onSelectCenter={(n) => setSelected((prev) => (prev === n ? null : n))}
              />
              <p className="mt-3 font-serif italic text-[0.9rem] text-[var(--ink-faint)] text-center">
                filled shapes are defined in you. open ones are where you take the world in.
              </p>
              <p className="mt-1 font-serif italic text-[0.82rem] text-[var(--ink-faint)] text-center">
                tap a center to hear what it means.
              </p>
            </div>
          </Card>

          <Card className="mb-5">
            <CardHeading eyebrow="the shape of it" title="how you are made" />
            <dl className="grid grid-cols-2 gap-x-4 gap-y-4">
              <Attr label="type" value={hd.type.toLowerCase()} />
              <Attr label="authority" value={hd.authority.toLowerCase()} />
              <Attr label="strategy" value={hd.strategy} span />
              <Attr label="profile" value={`${hd.profile.label} · ${hd.profile.name.toLowerCase()}`} span />
              <Attr label="definition" value={hd.definition.toLowerCase()} />
              <Attr label="centers defined" value={`${hd.defined_count} of 9`} />
              <Attr label="signature" value={hd.signature} />
              <Attr label="not-self" value={hd.not_self} />
            </dl>
            <div className="rule-gold my-5" />
            <div>
              <div className="eyebrow mb-1">
                incarnation cross
              </div>
              <div className="font-serif text-[1.05rem] lowercase leading-snug">
                {hd.incarnation_cross.label.toLowerCase()}
              </div>
              <div className="mt-1 font-serif italic text-[0.9rem] text-[var(--ink-faint)]">
                gates {hd.incarnation_cross.gates.join(" · ")}
              </div>
            </div>
          </Card>

          <Card>
            <CardHeading eyebrow="the reading" title="what it asks of you" />
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

      {!q.isLoading && !q.isError && !hd && <EmptyCard />}

      <AnimatePresence>
        {selected && hd && (
          <CenterDrawer hd={hd} center={selected} onClose={() => setSelected(null)} />
        )}
      </AnimatePresence>
    </>
  );
}

function Attr({ label, value, span }: { label: string; value: string; span?: boolean }) {
  return (
    <div className={span ? "col-span-2" : ""}>
      <dt className="eyebrow mb-0.5">
        {label}
      </dt>
      <dd className="font-serif text-[1.05rem] lowercase leading-snug">{value}</dd>
    </div>
  );
}

function EmptyCard() {
  return (
    <Card>
      <EmptyState
        asterism={<Asterism size={80} />}
        lines={["no design yet.", "complete onboarding and we'll draw your bodygraph."]}
      />
    </Card>
  );
}

// Defined vs undefined, per center, in house voice.
const CENTER_COPY: Record<HdCenterName, { defined: string; undefined: string }> = {
  Head: {
    defined: "you generate your own questions. the pressure to know comes from inside and it is steady, yours to trust.",
    undefined: "you take in the pressure of other people's questions. not all of them are yours to answer. let most of them pass.",
  },
  Ajna: {
    defined: "you hold a fixed way of making sense of things. it is reliable, and it is also a lens you rarely take off.",
    undefined: "you can think in many ways, none of them fixed. this is not indecision. it is a mind that stays open on purpose.",
  },
  Throat: {
    defined: "you have a consistent way of speaking and doing. what wants to be said tends to find its way out.",
    undefined: "you speak in the color of the room. you can voice things others can't, and you learn to wait for the right moment.",
  },
  G: {
    defined: "you carry a steady sense of who you are and where you are going, even when the path is unclear.",
    undefined: "your sense of self and direction shifts with where you are and who you are with. the right places make you feel like yourself.",
  },
  Heart: {
    defined: "you have access to a steady willpower. you can make a promise and keep it without straining.",
    undefined: "you feel the pull to prove your worth. you have nothing to prove. your value was never in question.",
  },
  Sacral: {
    defined: "you have a deep, renewable life force, made for work you love. your body answers yes and no before your mind.",
    undefined: "you are not built for relentless output. you take in others' energy and must learn when enough is enough.",
  },
  "Solar Plexus": {
    defined: "your emotions move in waves. clarity comes over time, not in the moment. wait for the wave to pass before you decide.",
    undefined: "you absorb the emotional weather of a room and amplify it. much of what you feel is not yours to keep.",
  },
  Spleen: {
    defined: "you have a steady, quiet instinct for what is safe and healthy. it speaks once, softly. learn to trust it.",
    undefined: "you take in others' fears and hold onto things past their time. not every warning is real. let some go.",
  },
  Root: {
    defined: "you carry a steady pressure to act and to move. it is a rhythm, and it is yours to set.",
    undefined: "you feel the world's rush to be done. the hurry is borrowed. you do not have to answer every pressure with speed.",
  },
};

function CenterDrawer({
  hd,
  center,
  onClose,
}: {
  hd: Hd;
  center: HdCenterName;
  onClose: () => void;
}) {
  const defined = hd.centers.find((c) => c.name === center)?.defined ?? false;
  const copy = CENTER_COPY[center];
  return (
    <>
      <motion.div
        className="fixed inset-0 z-40 bg-[rgba(31,26,20,0.28)]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      />
      <motion.div
        className="fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-screen-sm safe-bot"
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ type: "spring", stiffness: 320, damping: 34 }}
      >
        <div className="card-paper rounded-t-2xl px-5 pt-5 pb-7 sm:px-7">
          <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-[rgba(169,138,61,0.45)]" />
          <div className="flex items-baseline justify-between">
            <div className="font-serif text-[1.35rem] lowercase leading-none">{center.toLowerCase()}</div>
            <div className="eyebrow">
              {defined ? "defined" : "open"}
            </div>
          </div>
          <div className="rule-gold my-4" />
          <p className="font-serif italic text-[1.08rem] text-[var(--ink-soft)] leading-relaxed">
            {defined ? copy.defined : copy.undefined}
          </p>
          <button type="button" onClick={onClose} className="btn-ghost w-full mt-5">
            close
          </button>
        </div>
      </motion.div>
    </>
  );
}
