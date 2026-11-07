// Zodiac lens web surface (docs/SIDEREAL.md, P3 lane L4).
// Run: npx tsx apps/web/test/zodiac-lens.test.tsx   (from repo root)
//
// Production path: these tests render the REAL route components prod executes
// (src/routes/Chart.tsx, src/routes/HumanDesign.tsx, src/routes/GeneKeys.tsx)
// via react-dom/server with a seeded react-query cache, exactly the data
// shapes GET /me/chart, /me/humandesign, /me/genekeys return. No seam
// harness: the assertions are against the rendered HTML of the actual pages.
//
// Fail-before/pass-after: on the pre-change tree these components have no
// sidereal rendering at all (no nakshatra column, no lens toggle, no
// alternate-lens note) and lib/zodiac.ts does not exist, so every behavioral
// assertion below fails there. The tropical-identity assertions encode the
// frame-isolation invariant: with a tropical chart the pages must render NO
// sidereal furniture.
//
// All fixture data is SYNTHETIC. No real birth data anywhere.

import React from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import Chart from "../src/routes/Chart";
import HumanDesign from "../src/routes/HumanDesign";
import GeneKeys from "../src/routes/GeneKeys";
import Synastry from "../src/routes/Synastry";
import { LensRevealBody, AlternateLensNote } from "../src/components/ZodiacLens";
import {
  computeLensShift,
  formatNakshatra,
  signFromLongitude,
  ayanamsaLabel,
  parseShift,
  serializeShift,
  LENS_NEUTRAL_COPY,
} from "../src/lib/zodiac";
import type { HumanDesign as Hd, NatalChart, User } from "../src/lib/types";

let failures = 0;
let checks = 0;
function ok(cond: boolean, msg: string) {
  checks++;
  if (!cond) {
    failures++;
    console.error("  FAIL:", msg);
  }
}

// ---------------------------------------------------------------------------
// fixtures (synthetic)
// ---------------------------------------------------------------------------

const USER: User = {
  id: "u_test",
  email: "test@constellate.local",
  display_name: "test wanderer",
  has_birth_data: true,
  zodiac_system: "tropical",
};

const BIRTH = {
  date_local: "1990-06-15T14:30:00",
  timezone: "America/New_York",
  place_name: "Test City",
  latitude: 40.7,
  longitude: -74.0,
};

function planet(name: string, lon: number, house: number, nakshatra?: { name: string; index: number; pada: number }) {
  const signs = ["Aries","Taurus","Gemini","Cancer","Leo","Virgo","Libra","Scorpio","Sagittarius","Capricorn","Aquarius","Pisces"];
  return {
    name,
    sign: signs[Math.floor((lon % 360) / 30)],
    house,
    degree: lon % 30,
    longitude: lon,
    retrograde: false,
    ...(nakshatra ? { nakshatra: { ...nakshatra, degree_in_nakshatra: 5.3 } } : {}),
  };
}

// Tropical frame: Sun in Leo, Moon in Virgo, asc Libra.
const TROPICAL_CHART: NatalChart = {
  planets: [planet("Sun", 130.5, 11), planet("Moon", 155.2, 12), planet("Mercury", 120.1, 10)],
  angles: { ascendant: 185.0, midheaven: 102.0 },
  houses: [185.0, 212.0, 245.0, 282.0, 315.0, 344.0, 5.0, 32.0, 65.0, 102.0, 135.0, 164.0],
};

// Sidereal frame (~24 deg back): Sun Cancer/Pushya, Moon Leo/Magha, asc Virgo/Hasta.
const SIDEREAL_CHART: NatalChart = {
  planets: [
    planet("Sun", 106.4, 10, { name: "Pushya", index: 8, pada: 4 }),
    planet("Moon", 131.1, 11, { name: "Magha", index: 10, pada: 3 }),
    planet("Mercury", 96.0, 10, { name: "Punarvasu", index: 7, pada: 4 }),
  ],
  angles: { ascendant: 160.9, midheaven: 78.0 },
  houses: [150.0, 180.0, 210.0, 240.0, 270.0, 300.0, 330.0, 0.0, 30.0, 60.0, 90.0, 120.0],
  zodiac: "sidereal",
  house_system: "whole_sign",
  ayanamsa: { mode: "LAHIRI", value_deg: 24.1234 },
  ascendant_nakshatra: { name: "Hasta", index: 13, pada: 1, degree_in_nakshatra: 0.9 },
};

function hdFixture(sidereal: boolean): Hd {
  return {
    type: sidereal ? "Manifesting Generator" : "Manifestor",
    strategy: sidereal ? "to respond" : "to inform",
    authority: sidereal ? "Sacral" : "Emotional",
    profile: sidereal
      ? { personality_line: 2, design_line: 4, label: "2/4", name: "Hermit / Opportunist" }
      : { personality_line: 5, design_line: 1, label: "5/1", name: "Heretic / Investigator" },
    definition: "Single",
    signature: "peace",
    not_self: "anger",
    incarnation_cross: { label: "right angle cross of testing", gates: [1, 2, 3, 4] },
    design_datetime_utc: "1990-03-17T02:00:00Z",
    centers: [{ name: "Sacral", defined: sidereal }],
    channels: [],
    gates: { personality: [], design: [] },
    open_centers: [],
    defined_count: sidereal ? 5 : 4,
    ...(sidereal
      ? { zodiac: "sidereal" as const, lens: "alternate" as const, canon: "tropical" as const, ayanamsa: { mode: "LAHIRI", value_deg: 24.1234 } }
      : {}),
  };
}

const GK_TROPICAL = {
  activation: {
    lifes_work: { gate: 12, line: 2, sphere: "Life's Work", source: "personality_sun" },
    evolution: { gate: 11, line: 2, sphere: "Evolution", source: "personality_earth" },
    radiance: { gate: 20, line: 4, sphere: "Radiance", source: "design_sun" },
    purpose: { gate: 34, line: 4, sphere: "Purpose", source: "design_earth" },
  },
  keys: [
    { gate: 12, line: 2, shadow: "Vanity", gift: "Discrimination", siddhi: "Purity" },
    { gate: 11, line: 2, shadow: "Obscurity", gift: "Idealism", siddhi: "Light" },
    { gate: 20, line: 4, shadow: "Superficiality", gift: "Self-Assurance", siddhi: "Presence" },
    { gate: 34, line: 4, shadow: "Force", gift: "Strength", siddhi: "Majesty" },
  ],
};
const GK_SIDEREAL = {
  ...GK_TROPICAL,
  zodiac: "sidereal" as const,
  lens: "alternate" as const,
  canon: "tropical" as const,
  ayanamsa: { mode: "LAHIRI", value_deg: 24.1234 },
};

// ---------------------------------------------------------------------------
// render helper: seed the REAL query keys the routes read, render via SSR.
// Effects never fire under renderToString, so seeded data is what renders.
// ---------------------------------------------------------------------------

function renderRoute(
  el: React.ReactElement,
  seed: Array<[unknown[], unknown]>,
): string {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  qc.setQueryData(["me"], USER);
  for (const [key, data] of seed) qc.setQueryData(key, data);
  return renderToString(
    <MemoryRouter>
      <QueryClientProvider client={qc}>{el}</QueryClientProvider>
    </MemoryRouter>,
  );
}

// ---------------------------------------------------------------------------
// 1. pure lens logic
// ---------------------------------------------------------------------------
console.log("lens logic");
{
  ok(signFromLongitude(130.5) === "leo" && signFromLongitude(106.4) === "cancer", "signFromLongitude maps both frames");
  ok(signFromLongitude(359.9) === "pisces" && signFromLongitude(0) === "aries", "boundaries");
  ok(formatNakshatra({ name: "Purva Bhadrapada", index: 25, pada: 2, degree_in_nakshatra: 5.2 }) === "purva bhadrapada · pada 2", "nakshatra formatting");
  ok(ayanamsaLabel("FAGAN_BRADLEY") === "fagan-bradley" && ayanamsaLabel(undefined) === "lahiri", "ayanamsa label");

  const shift = computeLensShift(TROPICAL_CHART, SIDEREAL_CHART, hdFixture(false), hdFixture(true));
  const sun = shift.items.find((i) => i.label === "sun");
  ok(sun?.from === "leo" && sun?.to === "cancer" && sun?.changed === true, "sun shift leo -> cancer detected");
  const moon = shift.items.find((i) => i.label === "moon");
  ok(moon?.from === "virgo" && moon?.to === "leo" && moon?.changed === true, "moon shift detected");
  const rising = shift.items.find((i) => i.label === "rising");
  ok(rising?.from === "libra" && rising?.to === "virgo" && rising?.changed === true, "rising shift from angles");
  ok(shift.moon_nakshatra === "magha · pada 3", "moon nakshatra surfaces in the reveal");
  ok(shift.rising_nakshatra === "hasta · pada 1", "ascendant nakshatra surfaces");
  ok(shift.hd?.type.from === "manifestor" && shift.hd?.type.to === "manifesting generator" && shift.hd?.type.changed === true, "hd type flip detected");
  ok(shift.hd?.profile.from === "5/1" && shift.hd?.profile.to === "2/4", "hd profile flip detected");
  ok(shift.ayanamsa === "lahiri", "reveal names the ayanamsa");

  // unchanged placements say so
  const same = computeLensShift(TROPICAL_CHART, { ...SIDEREAL_CHART, planets: [planet("Sun", 130.5, 11)], angles: TROPICAL_CHART.angles }, null, null);
  const sameSun = same.items.find((i) => i.label === "sun");
  ok(sameSun?.changed === false, "a placement that holds its sign reads changed=false");
  ok(same.hd === null, "no HD payloads -> no hd section, nothing invented");

  // missing frames: diff what exists, never fabricate
  const partial = computeLensShift(null, SIDEREAL_CHART, null, hdFixture(true));
  ok(partial.items.length === 0, "missing tropical chart -> no sign rows fabricated");
  ok(partial.hd === null, "one-sided HD -> no hd diff");
  ok(partial.moon_nakshatra === "magha · pada 3", "sidereal-only data still surfaces nakshatra");

  // round-trip persistence
  const parsed = parseShift(serializeShift(shift));
  ok(parsed !== null && parsed.items.length === shift.items.length && parsed.hd?.type.to === "manifesting generator", "shift serialize/parse round-trips");
  ok(parseShift("not json") === null && parseShift(null) === null, "garbage parses to null");
}

// ---------------------------------------------------------------------------
// 2. the comparison reveal (editorial moment)
// ---------------------------------------------------------------------------
console.log("comparison reveal");
{
  const shift = computeLensShift(TROPICAL_CHART, SIDEREAL_CHART, hdFixture(false), hdFixture(true));
  const html = renderToString(<LensRevealBody shift={shift} to="sidereal" />);
  ok(html.includes("leo") && html.includes("cancer"), "reveal shows the sun's move");
  ok(html.includes("manifestor") && html.includes("manifesting generator"), "reveal shows the hd type move");
  ok(html.includes("lahiri"), "reveal names lahiri");
  ok(html.includes("magha"), "reveal carries the moon's mansion");
  ok(html.includes("fixed-star sky") && html.includes("seasonal"), "editorial framing: seasonal vs fixed-star sky");
  ok(html.includes(LENS_NEUTRAL_COPY.slice(0, 30)), "neutral stance copy present");
  ok(!/more (accurate|true|real|correct)/i.test(html), "copy never claims one sky is truer");
  ok(html.includes("alternate lens") && html.includes("not a correction"), "hd/gk canon framing honest, not dismissive");

  // flip back direction reads sidereal -> tropical
  const back = renderToString(<LensRevealBody shift={shift} to="tropical" />);
  ok(back.includes("seasonal sky"), "flip-back names the seasonal sky");
}

// ---------------------------------------------------------------------------
// 3. Chart route: tropical identity + sidereal furniture
// ---------------------------------------------------------------------------
console.log("chart route, both skies");
{
  const tropical = renderRoute(<Chart />, [
    [["chart"], { chart: TROPICAL_CHART, birth: BIRTH }],
    [["chart", "reading", "dual-sky"], { text: "both anchors preserve the same watchfulness.", reading_mode: "dual_sky" }],
  ]);
  ok(!tropical.includes("nakshatra"), "tropical chart renders NO nakshatra column");
  ok(!tropical.includes("whole-sign"), "tropical chart renders no whole-sign label");
  ok(!tropical.includes("ayanamsa"), "tropical chart renders no ayanamsa line");
  ok(!tropical.includes("mansion"), "tropical chart renders no mansion block");
  ok(tropical.includes("the sky you read under"), "the lens toggle is present on the chart page");
  ok(tropical.includes("tropical · seasonal") && tropical.includes("sidereal · fixed stars"), "both lens options offered");
  ok(tropical.includes("the sky on the day you arrived"), "tropical keeps the original subtitle");
  ok(tropical.includes("what survives the change of anchor") && tropical.includes("both anchors preserve"), "dual-sky narrative renders even in tropical view");

  const sidereal = renderRoute(<Chart />, [
    [["chart"], { chart: SIDEREAL_CHART, birth: BIRTH }],
    [["chart", "reading", "dual-sky"], { text: "both anchors preserve the same watchfulness.", reading_mode: "dual_sky" }],
  ]);
  ok(sidereal.includes("nakshatra"), "sidereal chart renders the nakshatra column");
  ok(sidereal.includes("pushya") && sidereal.includes("magha"), "planet nakshatras render");
  ok(sidereal.includes("lahiri ayanamsa"), "lahiri label shown on the sidereal view");
  ok(sidereal.includes("whole-sign houses"), "whole-sign house label shown");
  ok(sidereal.includes("the moon&#x27;s mansion") || sidereal.includes("the moon's mansion"), "moon's mansion block renders prominently");
  ok(sidereal.includes("magha · pada 3"), "moon nakshatra + pada rendered");
  ok(sidereal.includes("hasta · pada 1"), "ascendant nakshatra rendered");
  ok(sidereal.includes("fixed stars"), "sidereal subtitle names the fixed-star sky");
  ok(sidereal.includes("seasonal sky + fixed-star sky"), "dual-sky reading provenance remains visible in sidereal view");
}

// ---------------------------------------------------------------------------
// 4. Human Design route: alternate-lens framing
// ---------------------------------------------------------------------------
console.log("human design route, both skies");
{
  const seedT: Array<[unknown[], unknown]> = [
    [["humandesign"], { hd: hdFixture(false), birth: BIRTH }],
    [["humandesign", "reading"], { text: "a reading." }],
  ];
  const tropical = renderRoute(<HumanDesign />, seedT);
  ok(!tropical.includes("alternate lens"), "tropical HD carries NO alternate-lens note");
  ok(tropical.includes("manifestor"), "tropical HD renders its type");
  ok(tropical.includes("the sky you read under"), "lens toggle present on the design page");
  ok(tropical.includes("tropical canon + fixed-star alternate"), "HD reading names canon and alternate provenance");

  const seedS: Array<[unknown[], unknown]> = [
    [["humandesign"], { hd: hdFixture(true), birth: BIRTH }],
    [["humandesign", "reading"], { text: "a reading." }],
  ];
  const sidereal = renderRoute(<HumanDesign />, seedS);
  ok(sidereal.includes("alternate lens"), "sidereal HD carries the alternate-lens note");
  ok(sidereal.includes("ra uru hu") && sidereal.includes("tropical"), "note names the founder and the canon");
  ok(sidereal.includes("lahiri"), "note names the ayanamsa lineage");
  ok(!/(merely|just a|not valid|wrong)/.test(sidereal), "framing is honest, not dismissive");
}

// ---------------------------------------------------------------------------
// 5. Gene Keys route: alternate-lens framing
// ---------------------------------------------------------------------------
console.log("gene keys route, both skies");
{
  const tropical = renderRoute(<GeneKeys />, [
    [["genekeys"], { gk: GK_TROPICAL, birth: BIRTH }],
    [["genekeys", "reading"], { text: "a reading." }],
  ]);
  ok(!tropical.includes("alternate lens"), "tropical GK carries NO alternate-lens note");
  ok(tropical.includes("the sky you read under"), "lens toggle present on the keys page");
  ok(tropical.includes("tropical canon + fixed-star alternate"), "GK reading names canon and alternate provenance");

  const sidereal = renderRoute(<GeneKeys />, [
    [["genekeys"], { gk: GK_SIDEREAL, birth: BIRTH }],
    [["genekeys", "reading"], { text: "a reading." }],
  ]);
  ok(sidereal.includes("alternate lens"), "sidereal GK carries the alternate-lens note");
  ok(sidereal.includes("richard rudd"), "note names rudd's tropical stance");
}

// ---------------------------------------------------------------------------
// 6. standalone AlternateLensNote copy
// ---------------------------------------------------------------------------
{
  const hd = renderToString(<AlternateLensNote system="humandesign" />);
  const gk = renderToString(<AlternateLensNote system="genekeys" />);
  ok(hd.includes("canon") && gk.includes("canon"), "both notes name the canon");
  ok(hd.includes("flip back any time") && gk.includes("flip back any time"), "the lens stays reversible in the copy");
}

// ---------------------------------------------------------------------------
// 7. synastry active reading follows the selected sky, while history keeps both
// ---------------------------------------------------------------------------
{
  const renderSynastry = (zodiac: "tropical" | "sidereal", narrative: string) => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    qc.setQueryData(["me"], { ...USER, zodiac_system: zodiac });
    qc.setQueryData(["synastry", "u_other", zodiac], {
      user_a: { id: USER.id, display_name: USER.display_name, chart: null },
      user_b: { id: "u_other", display_name: "other", chart: null },
      aspects: [], narrative, degraded: false, current_lens: "friend",
      generation: { id: `syng_${zodiac}`, index: 1, total: 1, lens: "friend", generated_at: 1_700_000_000, degraded: false, zodiac_system: zodiac, active: true },
    });
    qc.setQueryData(["synastry-gens", "u_other", zodiac], {
      current_lens: "friend", active_zodiac: zodiac, total: 2,
      generations: [
        { id: "syng_sidereal", index: 2, total: 2, lens: "friend", generated_at: 1_700_000_001, degraded: false, zodiac_system: "sidereal", active: zodiac === "sidereal" },
        { id: "syng_tropical", index: 1, total: 2, lens: "friend", generated_at: 1_700_000_000, degraded: false, zodiac_system: "tropical", active: zodiac === "tropical" },
      ],
    });
    return renderToString(
      <MemoryRouter initialEntries={["/app/synastry/u_other"]}>
        <QueryClientProvider client={qc}>
          <Routes><Route path="/app/synastry/:otherUserId" element={<Synastry />} /></Routes>
        </QueryClientProvider>
      </MemoryRouter>,
    );
  };

  const tropical = renderSynastry("tropical", "TROPICAL ACTIVE COPY");
  const sidereal = renderSynastry("sidereal", "SIDEREAL ACTIVE COPY");
  ok(tropical.includes("TROPICAL ACTIVE COPY") && !tropical.includes("SIDEREAL ACTIVE COPY"), "synastry tropical preference renders tropical-keyed active reading");
  ok(sidereal.includes("SIDEREAL ACTIVE COPY") && sidereal.includes("cast under the sidereal sky"), "synastry sidereal preference renders sidereal-keyed active reading with provenance");
  ok(tropical.includes("sidereal sky") && tropical.includes("tropical sky"), "synastry drawer keeps both skies visible regardless of active sky");
}

console.log(`\n${checks} checks, ${failures} failures`);
if (failures > 0) process.exit(1);
