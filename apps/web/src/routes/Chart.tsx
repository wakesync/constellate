import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Card, CardHeading, Shimmer, EmptyState, ErrorState } from "../components/ui";
import { RecordNav } from "../components/RecordNav";
import { ChartWheel } from "../components/ChartWheel";
import { Asterism, Flourish } from "../components/svg";
import { api, ApiError, errorCopy } from "../lib/api";
import { degreeStr, planetGlyph, signGlyph } from "../lib/format";
import { PrimerButton } from "../components/Primer";
import { ZodiacLens } from "../components/ZodiacLens";
import { ayanamsaLabel, formatNakshatra } from "../lib/zodiac";

export default function Chart() {
  const q = useQuery({ queryKey: ["chart"], queryFn: () => api.getChart() });
  const reading = useQuery({
    queryKey: ["chart", "reading", "dual-sky"],
    queryFn: () => api.chartReading(),
    enabled: !!q.data?.chart,
    staleTime: Infinity,
  });
  const sidereal = q.data?.chart?.zodiac === "sidereal";

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
          your natal chart
        <PrimerButton primer="chart" /></h1>
        <p className="font-serif italic text-[var(--ink-soft)] mt-1">
          {sidereal
            ? "the same arrival, measured against the fixed stars. the sky of the vedic tradition."
            : "the sky on the day you arrived. nothing made it happen. it just remembers."}
        </p>
      </motion.header>

      {q.isLoading && (
        <Card>
          <div className="flex flex-col items-center gap-3">
            <Shimmer className="h-64 w-64 rounded-full" />
            <Shimmer className="h-3 w-2/3" />
            <Shimmer className="h-3 w-1/2" />
          </div>
        </Card>
      )}

      {q.data?.chart && (
        <>
          <Card className="mb-5">
            <div className="flex flex-col items-center">
              <ChartWheel chart={q.data.chart} size={320} ariaLabel="your natal chart wheel" />
              {q.data.birth && (
                <div className="mt-4 text-center">
                  <Flourish />
                  <div className="mt-3 font-serif italic text-[var(--ink-soft)] text-[0.98rem]">
                    {formatBirthLine(q.data.birth.date_local)} · {q.data.birth.place_name}
                  </div>
                </div>
              )}
              {sidereal && (
                <div className="mt-2 eyebrow text-center">
                  {`sidereal · ${ayanamsaLabel(q.data.chart.ayanamsa?.mode)} ayanamsa · whole-sign houses`}
                </div>
              )}
            </div>
          </Card>

          <Card className="mb-5">
            <CardHeading eyebrow="placements" title="where everything was" />
            <div className="overflow-x-auto -mx-2">
              <table className="w-full text-sm">
                <thead>
                  <tr className="eyebrow text-left">
                    <th className="font-medium py-2 pl-2">planet</th>
                    <th className="font-medium py-2">sign</th>
                    {sidereal && <th className="font-medium py-2">nakshatra</th>}
                    <th className="font-medium py-2">house</th>
                    <th className="font-medium py-2 pr-2 text-right">degree</th>
                  </tr>
                </thead>
                <tbody>
                  {q.data.chart.planets.map((p) => (
                    <tr key={p.name} className="border-t border-[rgba(169,138,61,0.22)]">
                      <td className="py-2.5 pl-2">
                        <span className="font-serif text-[1.05rem]" style={{ color: "var(--ink)" }}>
                          {planetGlyph(p.name)}
                        </span>
                        <span className="ml-2 lowercase">{p.name}</span>
                        {p.retrograde && (
                          <span className="ml-1.5 text-[var(--oxblood)] font-serif italic text-xs">℞</span>
                        )}
                      </td>
                      <td className="py-2.5">
                        <span className="font-serif text-[1rem] text-[var(--gold)]">{signGlyph(p.sign)}</span>
                        <span className="ml-2 lowercase">{p.sign}</span>
                      </td>
                      {sidereal && (
                        <td className="py-2.5 lowercase font-serif text-[0.95rem] text-[var(--ink-soft)]">
                          {p.nakshatra ? (
                            <>
                              {p.nakshatra.name.toLowerCase()}
                              <span className="text-[var(--ink-faint)] text-xs ml-1">· {p.nakshatra.pada}</span>
                            </>
                          ) : "·"}
                        </td>
                      )}
                      <td className="py-2.5 tabular text-[var(--ink-soft)]">
                        {p.house}
                      </td>
                      <td className="py-2.5 pr-2 text-right tabular text-[var(--ink-soft)]">
                        {degreeStr(p.degree)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {sidereal && (
              <p className="mt-3 font-serif italic text-[0.85rem] text-[var(--ink-faint)]">
                each nakshatra is one of the twenty-seven lunar mansions of the fixed-star
                sky, 13°20′ each, four padas apiece. the moon's mansion is the spine of a
                vedic reading.
              </p>
            )}
          </Card>

          <Card className="mb-5">
            <CardHeading eyebrow="both skies" title="what survives the change of anchor" />
            {reading.isLoading && (
              <div className="space-y-2.5">
                <Shimmer className="h-3 w-full" />
                <Shimmer className="h-3 w-11/12" />
                <Shimmer className="h-3 w-5/6" />
              </div>
            )}
            {reading.data && (
              <div className="space-y-4 font-serif text-[1.05rem] text-[var(--ink-soft)] leading-relaxed">
                {reading.data.text.split("\n\n").map((para, i) => <p key={i} className={i === 0 ? "drop-cap" : ""}>{para}</p>)}
              </div>
            )}
            {reading.isError && <p className="font-serif italic text-[var(--ink-faint)]">the two skies are quiet for now. the placements still stand.</p>}
            <p className="eyebrow mt-5">seasonal sky + fixed-star sky · read together</p>
          </Card>

          <Card>
            <CardHeading eyebrow="three things to know" title="the big three" />
            <Insights chart={q.data.chart} />
            {sidereal && <SiderealMoon chart={q.data.chart} />}
          </Card>
        </>
      )}

      {/* A 404 (no birth data) is an empty state; anything else is an error. */}
      {!q.isLoading && q.isError && (q.error instanceof ApiError && q.error.status === 404 ? (
        <Card>
          <EmptyState
            asterism={<Asterism size={80} />}
            lines={["no chart yet.", "complete onboarding and we'll draw it."]}
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

      {!q.isLoading && !q.isError && !q.data?.chart && (
        <Card>
          <EmptyState
            asterism={<Asterism size={80} />}
            lines={["no chart yet.", "complete onboarding and we'll draw it."]}
          />
        </Card>
      )}
    </>
  );
}

function formatBirthLine(iso: string): string {
  // iso like 2001-01-01T12:00:00. render lowercase serif date
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, {
      year: "numeric", month: "long", day: "numeric",
    }).toLowerCase();
  } catch {
    return iso;
  }
}

function Insights({ chart }: { chart: import("../lib/types").NatalChart }) {
  const sun = chart.planets.find((p) => p.name === "Sun");
  const moon = chart.planets.find((p) => p.name === "Moon");
  // Determine rising sign from ascendant longitude.
  const ascSign = (() => {
    const idx = Math.floor(((chart.angles?.ascendant ?? 0) % 360) / 30);
    return ["aries","taurus","gemini","cancer","leo","virgo","libra","scorpio","sagittarius","capricorn","aquarius","pisces"][idx];
  })();

  const items = [
    {
      label: "sun",
      sign: sun?.sign.toLowerCase() ?? "·",
      copy: sunCopy(sun?.sign ?? ""),
    },
    {
      label: "moon",
      sign: moon?.sign.toLowerCase() ?? "·",
      copy: moonCopy(moon?.sign ?? ""),
    },
    {
      label: "rising",
      sign: ascSign,
      copy: risingCopy(ascSign),
    },
  ];

  return (
    <ul className="space-y-5">
      {items.map((it) => (
        <li key={it.label}>
          <div className="flex items-baseline gap-3">
            <span className="eyebrow w-14 shrink-0">{it.label}</span>
            <span className="font-serif text-[1.15rem] lowercase">{it.sign}</span>
          </div>
          <p className="font-serif italic text-[var(--ink-soft)] leading-snug mt-1 pl-[4.25rem]">
            {it.copy}
          </p>
        </li>
      ))}
    </ul>
  );
}

// The vedic spine: the moon's mansion, shown prominently under the big three
// whenever the fixed-star sky is on. The ascendant's mansion rides along when
// the birth time supports one.
function SiderealMoon({ chart }: { chart: import("../lib/types").NatalChart }) {
  const moon = chart.planets.find((p) => p.name === "Moon");
  if (!moon?.nakshatra) return null;
  const asc = chart.ascendant_nakshatra;
  return (
    <div className="mt-6 pt-5" style={{ borderTop: "1px solid rgba(169,138,61,0.25)" }}>
      <div className="eyebrow mb-1">the moon's mansion</div>
      <div className="font-serif text-[1.35rem] lowercase leading-tight">
        {formatNakshatra(moon.nakshatra)}
      </div>
      <p className="font-serif italic text-[0.92rem] text-[var(--ink-soft)] leading-snug mt-1">
        in the vedic tradition the moon's nakshatra, not the sun sign, is where a
        reading begins. this is the sky the moon actually stood in, one mansion of
        twenty-seven.
      </p>
      {asc && (
        <p className="font-serif italic text-[0.88rem] text-[var(--ink-faint)] mt-2">
          your ascendant rises in {formatNakshatra(asc)}.
        </p>
      )}
    </div>
  );
}

function sunCopy(sign: string): string {
  const map: Record<string, string> = {
    Aries: "the part of you that moves first and explains later.",
    Taurus: "the part of you that builds slow and keeps what it makes.",
    Gemini: "the part of you that thinks out loud and rarely the same thing twice.",
    Cancer: "the part of you that remembers where everyone left their things.",
    Leo: "the part of you that turns on a light when you walk in.",
    Virgo: "the part of you that fixes small things while no one watches.",
    Libra: "the part of you that listens for the second voice in any room.",
    Scorpio: "the part of you that knows what's underneath, often before you do.",
    Sagittarius: "the part of you that needs the horizon visible.",
    Capricorn: "the part of you that quietly carries weight no one asked you to.",
    Aquarius: "the part of you that does it the way it should be done, not the way it's done.",
    Pisces: "the part of you that returns to water when nothing else makes sense.",
  };
  return map[sign] ?? "the central engine, however it runs.";
}

function moonCopy(sign: string): string {
  const map: Record<string, string> = {
    Aries: "you feel things quickly and rarely apologize for the speed.",
    Taurus: "you settle into a feeling like a chair you intend to keep.",
    Gemini: "you understand most things faster than you can say them.",
    Cancer: "you keep an interior weather report no one else can read.",
    Leo: "your feelings would like to be witnessed, even by you.",
    Virgo: "you tend to your own moods like a small careful garden.",
    Libra: "you feel what's between people before you feel your own.",
    Scorpio: "you don't do small feelings. there is no surface here.",
    Sagittarius: "you escape into bigger questions when small ones get too close.",
    Capricorn: "you compose yourself even in private, sometimes especially then.",
    Aquarius: "you keep some distance from your own heart, which is a kind of love too.",
    Pisces: "you absorb. you have always absorbed.",
  };
  return map[sign] ?? "the way feelings actually feel from inside.";
}

function risingCopy(sign: string): string {
  const map: Record<string, string> = {
    aries: "you walk in like you have something to do.",
    taurus: "people sense you arrive before they see you.",
    gemini: "you greet a room the way someone tunes an instrument.",
    cancer: "you check the temperature of a room before stepping in.",
    leo: "you light a room without intending to.",
    virgo: "you scan the surroundings, quietly cataloging.",
    libra: "you adjust to the room and the room adjusts to you.",
    scorpio: "you arrive at the edges first. you watch.",
    sagittarius: "you bring a doorway with you wherever you go.",
    capricorn: "you arrive composed, even when you aren't.",
    aquarius: "you arrive at a slight angle to everyone else.",
    pisces: "you blur into a room before you fully enter it.",
  };
  return map[sign] ?? "the face the world meets first.";
}
