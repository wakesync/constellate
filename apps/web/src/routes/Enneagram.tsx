import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardHeading, Shimmer, ErrorState } from "../components/ui";
import { RecordNav } from "../components/RecordNav";
import { EnneagramRing } from "../components/EnneagramRing";
import { Asterism, Flourish } from "../components/svg";
import { api, errorCopy } from "../lib/api";
import type { EnneagramResult } from "../lib/types";
import { PrimerButton } from "../components/Primer";

const AGREEMENT = [
  { v: 1, label: "not me" },
  { v: 2, label: "rarely" },
  { v: 3, label: "sometimes" },
  { v: 4, label: "often" },
  { v: 5, label: "deeply me" },
];

export default function Enneagram() {
  const qc = useQueryClient();
  const state = useQuery({ queryKey: ["enneagram"], queryFn: () => api.enneagramState() });

  const reading = useQuery({
    queryKey: ["enneagram", "reading"],
    queryFn: () => api.enneagramReading(),
    enabled: !!state.data?.result,
    staleTime: Infinity,
  });

  const reset = useMutation({
    mutationFn: () => api.enneagramReset(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["enneagram"] }),
  });

  return (
    <>
      <RecordNav />

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
          your type
        <PrimerButton primer="enneagram" /></h1>
        <p className="font-serif italic text-[var(--ink-soft)] mt-1">
          nine ways of being a person. this one you answer for yourself. take your time with it.
        </p>
      </motion.header>

      {state.isLoading && (
        <Card>
          <div className="space-y-3">
            <Shimmer className="h-3 w-1/3" />
            <Shimmer className="h-16 w-full" />
            <Shimmer className="h-3 w-2/3" />
          </div>
        </Card>
      )}

      {state.isError && (
        <Card>
          <ErrorState
            asterism={<Asterism size={72} />}
            lines={[errorCopy(state.error)]}
            onRetry={() => state.refetch()}
          />
        </Card>
      )}

      {state.data && !state.data.result && (
        <Quiz
          answered={state.data.answered}
          onDone={() => qc.invalidateQueries({ queryKey: ["enneagram"] })}
        />
      )}

      {state.data?.result && (
        <Result
          result={state.data.result}
          reading={reading.data?.text}
          readingLoading={reading.isLoading}
          onReset={() => reset.mutate()}
          resetting={reset.isPending}
        />
      )}
    </>
  );
}

// ---- Quiz ------------------------------------------------------------------

function Quiz({ answered, onDone }: { answered: number; onDone: () => void }) {
  const questions = useQuery({
    queryKey: ["enneagram", "questions"],
    queryFn: () => api.enneagramQuestions(),
  });

  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [idx, setIdx] = useState(0);

  const save = useMutation({
    mutationFn: (partial: Record<string, number>) => api.enneagramSave(partial),
    onSuccess: (st) => {
      if (st.result) onDone();
    },
  });

  const qs = questions.data?.questions ?? [];
  const total = qs.length;
  const current = qs[idx];
  const done = idx >= total && total > 0;

  // Progress reflects work already saved server-side plus what's answered this
  // session, so closing the tab never loses the climb.
  const progress = useMemo(() => {
    const localCount = Object.keys(answers).length;
    return Math.min(total, Math.max(answered, localCount));
  }, [answers, answered, total]);

  function choose(v: number) {
    if (!current) return;
    const partial = { [current.id]: v };
    setAnswers((prev) => ({ ...prev, ...partial }));
    // Persist each answer as we go (per the contract's partial POST).
    save.mutate(partial);
    // small delay for the selection to register visually
    setIdx((i) => i + 1);
  }

  if (questions.isLoading) {
    return (
      <Card>
        <div className="space-y-4">
          <Shimmer className="h-3 w-1/4" />
          <Shimmer className="h-12 w-full" />
          <div className="flex gap-2">
            {AGREEMENT.map((_, i) => (
              <Shimmer key={i} className="h-10 flex-1" />
            ))}
          </div>
        </div>
      </Card>
    );
  }

  if (questions.isError) {
    return (
      <Card>
        <ErrorState
          asterism={<Asterism size={72} />}
          lines={[errorCopy(questions.error)]}
          onRetry={() => questions.refetch()}
        />
      </Card>
    );
  }

  if (done && !save.data?.result) {
    // All questions answered, waiting on the scored result.
    return (
      <Card>
        <div className="flex flex-col items-center py-8 text-center">
          <Asterism size={72} />
          <p className="mt-5 font-serif italic text-[var(--ink-soft)]">
            reading your answers back to you.
          </p>
          {save.isPending && <Shimmer className="mt-4 h-3 w-32" />}
        </div>
      </Card>
    );
  }

  return (
    <Card>
      {/* progress: a thin gold thread, not a loud bar */}
      <div className="mb-6">
        <div className="flex items-baseline justify-between mb-2">
          <span className="eyebrow">
            the questions
          </span>
          <span className="font-serif italic text-[0.9rem] text-[var(--ink-faint)] tabular">
            {Math.min(idx + 1, total)} of {total}
          </span>
        </div>
        <div className="h-px w-full bg-[rgba(169,138,61,0.25)] relative overflow-hidden">
          <motion.div
            className="absolute inset-y-0 left-0"
            style={{ background: "var(--gold-deep)" }}
            initial={false}
            animate={{ width: `${(progress / Math.max(1, total)) * 100}%` }}
            transition={{ duration: 0.5 }}
          />
        </div>
      </div>

      <AnimatePresence mode="wait">
        {current && (
          <motion.div
            key={current.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.35 }}
          >
            <p className="font-serif text-[1.35rem] sm:text-[1.5rem] leading-snug text-[var(--ink)] min-h-[4.5rem]">
              {current.text}
            </p>

            <div className="mt-6 grid grid-cols-5 gap-1.5">
              {AGREEMENT.map((a) => (
                <button
                  key={a.v}
                  type="button"
                  onClick={() => choose(a.v)}
                  className="flex flex-col items-center gap-1.5 py-3 px-1 rounded-sm border border-[rgba(169,138,61,0.3)] hover:border-[var(--gold)] hover:bg-[rgba(169,138,61,0.06)] transition-colors min-h-[64px]"
                >
                  <span
                    className="inline-block rounded-full"
                    style={{
                      width: 8 + a.v * 2,
                      height: 8 + a.v * 2,
                      background: "var(--oxblood)",
                      opacity: 0.3 + a.v * 0.14,
                    }}
                  />
                  <span className="micro uppercase text-center leading-tight">
                    {a.label}
                  </span>
                </button>
              ))}
            </div>

            {idx > 0 && (
              <button
                type="button"
                onClick={() => setIdx((i) => Math.max(0, i - 1))}
                className="btn-link mt-4"
              >
                ← back a question
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <p className="mt-6 font-serif italic text-[0.85rem] text-[var(--ink-faint)] text-center">
        your answers are kept as you go. you can close this and return.
      </p>
    </Card>
  );
}

// ---- Result ----------------------------------------------------------------

const TYPE_COPY: Record<number, string> = {
  1: "the sense that things could be right, and the quiet labor of making them so.",
  2: "the pull toward others' needs, and love that arrives as usefulness.",
  3: "the drive to become, to be seen as the thing you set out to be.",
  4: "the long romance with what is missing, and the search for the real thing.",
  5: "the retreat inward to understand before you spend yourself.",
  6: "the mind that scans for what could go wrong, out of a wish to be safe.",
  7: "the reach for the next bright thing, and the fear of being fenced in.",
  8: "the will to stand at full size and let nothing move you against yourself.",
  9: "the gift for peace, and the cost of leaving your own position out of it.",
};

function Result({
  result,
  reading,
  readingLoading,
  onReset,
  resetting,
}: {
  result: EnneagramResult;
  reading?: string;
  readingLoading: boolean;
  onReset: () => void;
  resetting: boolean;
}) {
  const sorted = [...result.scores].sort((a, b) => b.score - a.score);
  const top = sorted[0];
  const second = sorted[1];
  // If the top two are near-tied, say so rather than pretend certainty.
  const nearTie = top && second && top.score - second.score < 0.06;

  return (
    <>
      <Card className="mb-5">
        <div className="flex flex-col items-center text-center">
          <div className="eyebrow mb-1">
            you came out as
          </div>
          <h2 className="font-serif text-[2.1rem] lowercase tracking-wide leading-none">
            type {result.primary.type}
          </h2>
          <div className="font-serif italic text-[1.15rem] text-[var(--oxblood)] mt-1">
            {result.primary.name.toLowerCase()}
          </div>
          <div className="mt-2 flex items-center gap-2 eyebrow">
            <span>{result.wing.label}</span>
            <span aria-hidden="true">·</span>
            <span>{result.center.toLowerCase()} center</span>
            {result.instinct && (
              <>
                <span aria-hidden="true">·</span>
                <span>{result.instinct}</span>
              </>
            )}
          </div>
          <p className="mt-4 font-serif italic text-[1.05rem] text-[var(--ink-soft)] leading-snug max-w-md">
            {TYPE_COPY[result.primary.type]}
          </p>
        </div>

        {nearTie && (
          <div className="inline-message mt-5">
            type {top.type} and type {second.type} came out nearly even. you may live between them,
            or one may simply be quieter. sit with both before you decide which is home.
          </div>
        )}
      </Card>

      <Card className="mb-5">
        <CardHeading eyebrow="all nine" title="where you fell" />
        <div className="flex flex-col items-center">
          <EnneagramRing scores={result.scores} primary={result.primary.type} size={252} />
        </div>
        {result.tritype && result.tritype.length === 3 && (
          <p className="mt-3 font-serif italic text-[0.9rem] text-[var(--ink-faint)] text-center">
            your tritype: {result.tritype.join(" · ")}, one from each center.
          </p>
        )}
      </Card>

      <Card>
        <CardHeading eyebrow="the reading" title="what this way of being is like" />
        {readingLoading && (
          <div className="space-y-2.5">
            <Shimmer className="h-3 w-full" />
            <Shimmer className="h-3 w-full" />
            <Shimmer className="h-3 w-5/6" />
          </div>
        )}
        {reading && (
          <div className="space-y-4 font-serif text-[1.05rem] text-[var(--ink-soft)] leading-relaxed">
            {reading.split("\n\n").map((para, i) => (
              <p key={i} className={i === 0 ? "drop-cap" : ""}>
                {para}
              </p>
            ))}
          </div>
        )}
        {!reading && !readingLoading && (
          <p className="font-serif italic text-[var(--ink-faint)]">
            the reading is quiet for now. it will return.
          </p>
        )}
        <div className="mt-5 flex justify-center">
          <Flourish />
        </div>
      </Card>

      <div className="mt-6 flex justify-center">
        <button
          type="button"
          onClick={onReset}
          disabled={resetting}
          className="btn-link"
        >
          {resetting ? "clearing…" : "answer it again"}
        </button>
      </div>
    </>
  );
}