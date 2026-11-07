import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { HeroShell } from "../components/AppShell";
import { ButtonInk, ButtonLink, Card, Field, InlineMessage } from "../components/ui";
import { Asterism, Flourish, IconArrowRight, IconCheck } from "../components/svg";
import { ChartWheel } from "../components/ChartWheel";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { PlaceLookup } from "../lib/types";

type Step = "name" | "date" | "time" | "place" | "confirm";

export default function Onboarding() {
  const [step, setStep] = useState<Step>("name");
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [unknownTime, setUnknownTime] = useState(false);
  const [place, setPlace] = useState<PlaceLookup | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [previewChart, setPreviewChart] = useState<Awaited<ReturnType<typeof api.getChart>> | null>(null);
  const nav = useNavigate();
  const { refresh } = useAuth();

  useEffect(() => { setErr(null); }, [step]);

  const order: Step[] = ["name", "date", "time", "place", "confirm"];
  const idx = order.indexOf(step);

  function next() { setStep(order[Math.min(idx + 1, order.length - 1)]); }
  function back() { setStep(order[Math.max(idx - 1, 0)]); }

  function canAdvance(): boolean {
    if (step === "name") return name.trim().length > 0;
    if (step === "date") return /^\d{4}-\d{2}-\d{2}$/.test(date);
    if (step === "time") return unknownTime || /^\d{2}:\d{2}/.test(time);
    if (step === "place") return !!place;
    return true;
  }

  async function loadPreview() {
    try {
      const c = await api.getChart();
      setPreviewChart(c);
    } catch { /* */ }
  }

  async function onConfirm() {
    if (!date || !place) return;
    setSubmitting(true); setErr(null);
    try {
      const dt = unknownTime ? `${date}T12:00:00` : `${date}T${time}:00`;
      // Persist the chosen display name (collected in step one) before saving birth data.
      if (name.trim()) {
        try {
          await api.updateProfile(name.trim());
        } catch {
          /* non-fatal: name update can be retried later */
        }
      }
      await api.saveBirthData({
        date_local: dt,
        timezone: place.timezone,
        place_name: place.place_name,
        latitude: place.latitude,
        longitude: place.longitude,
        exact_time_unknown: unknownTime,
      });
      await loadPreview();
      await refresh();
      // Stay on confirm screen to show mini chart before navigating.
      setTimeout(() => nav("/app/home", { replace: true }), 1600);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "could not save");
      setSubmitting(false);
    }
  }

  return (
    <HeroShell>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="flex-1 flex flex-col"
      >
        <div className="text-center mb-4">
          <div className="eyebrow">
            chapter one · {idx + 1} of {order.length}
          </div>
          <h1 className="display-title mt-2">your birth</h1>
        </div>

        {/* progress hairline */}
        <div className="w-full h-px bg-[rgba(169,138,61,0.2)] rounded-full overflow-hidden mb-6">
          <motion.div
            className="h-full"
            style={{ background: "var(--gold)" }}
            animate={{ width: `${((idx + 1) / order.length) * 100}%` }}
            transition={{ duration: 0.4 }}
          />
        </div>

        <Card className="w-full">
          {err && <InlineMessage variant="err" className="mb-4">{err}</InlineMessage>}

          <AnimatePresence mode="wait">
            {step === "name" && (
              <StepFrame key="name" prompt="what should we call you?" hint="any name is fine. used only inside your constellations.">
                <Field label="name">
                  <input
                    autoFocus
                    type="text"
                    className="field"
                    placeholder="e.g. iris, august, your full name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoComplete="name"
                  />
                </Field>
              </StepFrame>
            )}

            {step === "date" && (
              <StepFrame key="date" prompt="when were you born?" hint="local calendar date. we'll figure the rest out.">
                <Field label="date">
                  <input
                    autoFocus
                    type="date"
                    className="field tabular"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                  />
                </Field>
              </StepFrame>
            )}

            {step === "time" && (
              <StepFrame key="time" prompt="and the time?" hint="exact time gives your ascendant and houses. unknown is fine.">
                <Field label="time">
                  <input
                    autoFocus
                    type="time"
                    className="field tabular"
                    disabled={unknownTime}
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                  />
                </Field>
                <label htmlFor="unknown-time" className="flex items-center gap-3 mt-1 cursor-pointer min-h-[44px]">
                  <span
                    aria-hidden="true"
                    className="inline-flex items-center justify-center w-5 h-5 rounded-sm border"
                    style={{
                      borderColor: unknownTime ? "var(--oxblood)" : "rgba(74,63,48,0.4)",
                      background: unknownTime ? "var(--oxblood)" : "transparent",
                      color: "var(--parchment)",
                    }}
                  >
                    {unknownTime && <IconCheck size={14} />}
                  </span>
                  <input
                    id="unknown-time"
                    type="checkbox"
                    className="sr-only"
                    checked={unknownTime}
                    onChange={(e) => setUnknownTime(e.target.checked)}
                  />
                  <span className="font-serif italic text-[var(--ink-soft)]">
                    exact time unknown
                  </span>
                </label>
                {unknownTime && (
                  <p className="text-xs font-serif italic text-[var(--ink-faint)] mt-2">
                    the chart will hold most of itself together. the rising and houses will be uncertain.
                  </p>
                )}
              </StepFrame>
            )}

            {step === "place" && (
              <StepFrame key="place" prompt="where in the world?" hint="city, country. we'll pin the latitude and longitude.">
                <PlaceField selected={place} onSelect={setPlace} />
              </StepFrame>
            )}

            {step === "confirm" && (
              <StepFrame key="confirm" prompt="does this look right?" hint="you can rewrite this later. nothing here is permanent.">
                <ul className="space-y-2 text-[0.98rem] mt-2">
                  <Row k="name" v={name || "·"} />
                  <Row k="date" v={date} />
                  <Row k="time" v={unknownTime ? "unknown · noon assumed" : time} />
                  <Row k="place" v={place?.place_name ?? "·"} />
                  <Row k="zone" v={place?.timezone ?? "·"} />
                </ul>

                {previewChart && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 1 }}
                    className="mt-5 flex flex-col items-center"
                  >
                    <Flourish />
                    <p className="mt-2 mb-2 font-serif italic text-[var(--ink-faint)] text-sm">
                      a first sketch of your sky
                    </p>
                    <ChartWheel chart={previewChart.chart} size={220} />
                  </motion.div>
                )}
              </StepFrame>
            )}
          </AnimatePresence>

          <div className="mt-6 flex items-center justify-between gap-3">
            {idx > 0 ? (
              <ButtonLink onClick={back}>← back</ButtonLink>
            ) : <span />}

            {step !== "confirm" ? (
              <ButtonInk onClick={next} disabled={!canAdvance()}>
                continue <IconArrowRight />
              </ButtonInk>
            ) : (
              <ButtonInk onClick={onConfirm} disabled={submitting || !place}>
                {submitting ? "drawing your chart..." : "this is me"}
              </ButtonInk>
            )}
          </div>
        </Card>

        <div className="mt-8 flex justify-center">
          <Asterism size={64} />
        </div>
      </motion.div>
    </HeroShell>
  );
}

function StepFrame({
  children, prompt, hint,
}: { children: React.ReactNode; prompt: string; hint?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.35 }}
    >
      <h2 className="font-serif text-xl lowercase tracking-wide mb-1">{prompt}</h2>
      {hint && <p className="text-sm font-serif italic text-[var(--ink-faint)] mb-4">{hint}</p>}
      {children}
    </motion.div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <li className="flex items-baseline gap-3">
      <span className="eyebrow w-14 shrink-0">{k}</span>
      <span className="font-serif text-[1.05rem]">{v}</span>
    </li>
  );
}

function PlaceField({
  selected, onSelect,
}: { selected: PlaceLookup | null; onSelect: (p: PlaceLookup | null) => void }) {
  const [q, setQ] = useState(selected?.place_name ?? "");
  const [opts, setOpts] = useState<PlaceLookup[]>([]);
  const [loading, setLoading] = useState(false);
  const debounced = useDebounced(q, 220);

  useEffect(() => {
    let cancelled = false;
    if (!debounced || debounced.length < 2) { setOpts([]); return; }
    if (selected && selected.place_name === debounced) return;
    setLoading(true);
    api.placesLookup(debounced).then((r) => {
      if (!cancelled) setOpts(r);
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [debounced, selected]);

  return (
    <div>
      <Field label="city">
        <input
          autoFocus
          type="text"
          className="field"
          placeholder="boulder, kyoto, lisbon..."
          value={q}
          onChange={(e) => { setQ(e.target.value); onSelect(null); }}
          autoComplete="off"
          spellCheck={false}
        />
      </Field>

      {(opts.length > 0 || loading || (debounced.length >= 2 && !selected)) && !selected && (
        <div
          role="listbox"
          aria-label="place results"
          className="border-l border-[rgba(169,138,61,0.4)] pl-3 -mt-3 mb-3 space-y-1"
        >
          {loading && <div className="h-4 w-24 ink-shimmer" aria-label="searching" />}
          {!loading && opts.length === 0 && debounced.length >= 2 && (
            <p className="font-serif italic text-[var(--ink-faint)] py-2">
              no place by that name. try another spelling, or the nearest city.
            </p>
          )}
          {opts.map((p) => (
            <button
              key={`${p.latitude}-${p.longitude}`}
              type="button"
              role="option"
              aria-selected="false"
              onClick={() => { onSelect(p); setQ(p.place_name); setOpts([]); }}
              className="block w-full text-left font-serif italic text-[var(--ink-soft)] hover:text-[var(--oxblood)] py-2 min-h-[44px]"
            >
              {p.place_name}
            </button>
          ))}
        </div>
      )}

      {selected && (
        <div className="text-xs text-[var(--ink-faint)] mt-1 font-serif italic">
          {selected.latitude.toFixed(3)}°, {selected.longitude.toFixed(3)}° · {selected.timezone}
        </div>
      )}
    </div>
  );
}

function useDebounced<T>(v: T, ms: number): T {
  const [out, setOut] = useState(v);
  useEffect(() => {
    const id = setTimeout(() => setOut(v), ms);
    return () => clearTimeout(id);
  }, [v, ms]);
  return out;
}

const _useMemo = useMemo; void _useMemo;
