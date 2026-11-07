import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardHeading, Shimmer, ErrorState } from "../components/ui";
import { RecordNav } from "../components/RecordNav";
import { ModelA } from "../components/ModelA";
import { Asterism, Flourish } from "../components/svg";
import { api, errorCopy } from "../lib/api";
import type { SocionicsResult, ModelAPosition } from "../lib/types";
import { PrimerButton } from "../components/Primer";

const AGREEMENT = [
  { v: 1, label: "not me" },
  { v: 2, label: "rarely" },
  { v: 3, label: "sometimes" },
  { v: 4, label: "often" },
  { v: 5, label: "deeply me" },
];

export default function Socionics() {
  const qc = useQueryClient();
  const state = useQuery({ queryKey: ["socionics"], queryFn: () => api.socionicsState() });

  const reading = useQuery({
    queryKey: ["socionics", "reading"],
    queryFn: () => api.socionicsReading(),
    enabled: !!state.data?.result,
    staleTime: Infinity,
  });

  const reset = useMutation({
    mutationFn: () => api.socionicsReset(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["socionics"] }),
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
          your socionics
        <PrimerButton primer="socionics" /></h1>
        <p className="font-serif italic text-[var(--ink-soft)] mt-1">
          sixteen shapes of mind, and the eight functions each is built from. the useful part is not the
          label. it is who completes you.
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
          onDone={() => qc.invalidateQueries({ queryKey: ["socionics"] })}
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
    queryKey: ["socionics", "questions"],
    queryFn: () => api.socionicsQuestions(),
  });

  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [idx, setIdx] = useState(0);

  const save = useMutation({
    mutationFn: (partial: Record<string, number>) => api.socionicsSave(partial),
    onSuccess: (st) => {
      if (st.result) onDone();
    },
  });

  const qs = questions.data?.questions ?? [];
  const total = qs.length;
  const current = qs[idx];
  const done = idx >= total && total > 0;

  const progress = useMemo(() => {
    const localCount = Object.keys(answers).length;
    return Math.min(total, Math.max(answered, localCount));
  }, [answers, answered, total]);

  function choose(v: number) {
    if (!current) return;
    const partial = { [current.id]: v };
    setAnswers((prev) => ({ ...prev, ...partial }));
    save.mutate(partial);
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
        your answers are kept as you go. you can close this and return. socionics is genuinely hard to
        pin from a quiz, so hold the result gently.
      </p>
    </Card>
  );
}

// ---- Result ----------------------------------------------------------------

function Result({
  result,
  reading,
  readingLoading,
  onReset,
  resetting,
}: {
  result: SocionicsResult;
  reading?: string;
  readingLoading: boolean;
  onReset: () => void;
  resetting: boolean;
}) {
  const [selected, setSelected] = useState<number | null>(1);
  const selPos: ModelAPosition | undefined = result.model_a.find((p) => p.position === selected);

  return (
    <>
      <Card className="mb-5">
        <div className="flex flex-col items-center text-center">
          <div className="eyebrow mb-1">
            you came out as
          </div>
          <h2 className="font-serif text-[2.1rem] lowercase tracking-wide leading-none">
            {result.type.code}
          </h2>
          <div className="font-serif italic text-[1.15rem] text-[var(--oxblood)] mt-1">
            the {result.type.nickname.toLowerCase()}
          </div>
          <div className="mt-2 flex items-center gap-2 eyebrow">
            <span>{result.type.alias.toLowerCase()}</span>
            <span aria-hidden="true">·</span>
            <span>{result.quadra.name.toLowerCase()} quadra</span>
          </div>

          {/* the mbti-style code, with the honest caveat */}
          <div className="mt-4 inline-message">
            written in the old letters as {result.type.mbti_style}. this is not the mbti {result.type.mbti_style.toUpperCase()}.
            socionics and mbti share letters and mean different things by them. read the functions below, not the code.
          </div>

          {result.runner_up && (
            <div className="inline-message mt-3">
              {result.type.code} and {result.runner_up.code} came out close. a quiz is a weak instrument
              for this. you may sit between the two. sit with both before you decide which is home.
            </div>
          )}
        </div>
      </Card>

      {/* Model A centerpiece */}
      <Card className="mb-5">
        <CardHeading eyebrow="model a" title="your eight functions" />
        <div className="flex flex-col items-center">
          <ModelA stack={result.model_a} selected={selected} onSelect={setSelected} size={300} />
        </div>
        {selPos && (
          <motion.div
            key={selPos.position}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
            className="mt-4 text-center"
          >
            <div className="font-serif text-[1.1rem] text-[var(--oxblood)]">
              {selPos.position}. {selPos.role.toLowerCase()} · {selPos.element}
            </div>
            <div className="font-serif italic text-[0.9rem] text-[var(--ink-faint)] mt-0.5">
              {selPos.element_name}
            </div>
            <p className="mt-2 font-serif text-[1.02rem] text-[var(--ink-soft)] leading-snug max-w-md mx-auto">
              {selPos.meaning}
            </p>
          </motion.div>
        )}
        <p className="mt-4 font-serif italic text-[0.82rem] text-[var(--ink-faint)] text-center">
          tap a function to read its place. the top block, the ego, is where you live. the lower blocks
          are quieter, weaker, or unspoken.
        </p>
      </Card>

      {/* the dual: the emotional hook */}
      <Card className="mb-5">
        <CardHeading eyebrow="the one who completes you" title="your dual" />
        <div className="flex flex-col items-center text-center">
          <div className="font-serif text-[1.6rem] text-[var(--oxblood)] lowercase">
            {result.dual.code}
          </div>
          <div className="font-serif italic text-[1.05rem] text-[var(--ink-soft)] mt-0.5">
            the {result.dual.nickname.toLowerCase()}
          </div>
          <p className="mt-3 font-serif text-[1.05rem] text-[var(--ink-soft)] leading-relaxed max-w-md">
            what you cannot supply for yourself, the {result.dual.nickname.toLowerCase()} carries without
            trying, and the reverse is just as true. of all sixteen, this is the shape that fits against
            your unguarded places. not a promise of a person. a description of a fit.
          </p>
          <div className="mt-4">
            <Flourish />
          </div>
        </div>
      </Card>

      {/* quadra values */}
      <Card className="mb-5">
        <CardHeading eyebrow="your quadra" title={result.quadra.name.toLowerCase()} />
        <p className="font-serif text-[1.05rem] text-[var(--ink-soft)] leading-relaxed">
          {result.quadra.values}
        </p>
      </Card>

      {/* the reading */}
      <Card>
        <CardHeading eyebrow="the reading" title="what this shape of mind is like" />
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
