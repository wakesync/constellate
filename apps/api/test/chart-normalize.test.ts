// normalizeChart sidereal passthrough .
// Run: npx tsx apps/api/test/chart-normalize.test.ts   (from repo root)
//
// Production path: GET /me/chart (and the charts embedded in synastry views)
// serve the web client through normalizeChart in src/lib/chart.ts. Before this
// change the mapper silently DROPPED every sidereal-only key the astro sidecar
// emits (nakshatra per planet, ascendant nakshatra, ayanamsa, house_system,
// zodiac marker), so the web could never render vedic furniture. These tests
// FAIL on the pre-change tree (the keys are absent from the mapped output) and
// pass after.
//
// Frame-isolation invariant guarded here too: a TROPICAL chart mapped through
// normalizeChart must be byte-identical to the pre-change mapper's output --
// no new keys, ever.

import { normalizeChart } from "../src/lib/chart";

let failures = 0;
let checks = 0;
function ok(cond: boolean, msg: string) {
  checks++;
  if (!cond) {
    failures++;
    console.error("  FAIL:", msg);
  }
}

// Synthetic fixtures mirroring the astro sidecar's real shapes
// (docs/SIDEREAL.md section 3). NO real birth data.
const tropicalRaw = {
  engine: "swiss-ephemeris (moshier)",
  planets: [
    { name: "Sun", sign: "Leo", sign_degree: 10.5, absolute_degree: 130.5, house: 11, retrograde: false },
    { name: "Moon", sign: "Virgo", sign_degree: 3.2, absolute_degree: 153.2, house: 12, retrograde: false },
  ],
  ascendant: { sign: "Libra", sign_degree: 5.0, absolute_degree: 185.0 },
  midheaven: { sign: "Cancer", sign_degree: 12.0, absolute_degree: 102.0 },
  houses: [
    { house: 1, sign: "Libra", degree: 5.0, absolute_degree: 185.0 },
    { house: 2, sign: "Scorpio", degree: 2.0, absolute_degree: 212.0 },
  ],
};

const siderealRaw = {
  ...tropicalRaw,
  zodiac: "sidereal",
  house_system: "whole_sign",
  ayanamsa: { mode: "LAHIRI", value_deg: 24.1234 },
  planets: [
    {
      name: "Sun", sign: "Cancer", sign_degree: 16.4, absolute_degree: 106.4, house: 10, retrograde: false,
      nakshatra: { name: "Pushya", index: 8, pada: 4, degree_in_nakshatra: 12.9 },
    },
    {
      name: "Moon", sign: "Leo", sign_degree: 9.1, absolute_degree: 129.1, house: 11, retrograde: false,
      nakshatra: { name: "Magha", index: 10, pada: 3, degree_in_nakshatra: 9.1 },
    },
  ],
  ascendant: {
    sign: "Virgo", sign_degree: 10.9, absolute_degree: 160.9,
    nakshatra: { name: "Hasta", index: 13, pada: 1, degree_in_nakshatra: 0.9 },
  },
  houses: [
    { house: 1, sign: "Virgo", degree: 0.0, absolute_degree: 150.0 },
    { house: 2, sign: "Libra", degree: 0.0, absolute_degree: 180.0 },
  ],
};

// ---- sidereal passthrough ---------------------------------------------------
{
  const c = normalizeChart(siderealRaw);
  ok(c.zodiac === "sidereal", "sidereal chart carries the zodiac marker");
  ok(c.house_system === "whole_sign", "sidereal chart carries house_system whole_sign");
  ok(c.ayanamsa?.mode === "LAHIRI" && Math.abs((c.ayanamsa?.value_deg ?? 0) - 24.1234) < 1e-9,
    "ayanamsa mode + value pass through");
  const sun = c.planets.find((p) => p.name === "Sun");
  ok(sun?.nakshatra?.name === "Pushya" && sun?.nakshatra?.pada === 4 && sun?.nakshatra?.index === 8,
    "planet nakshatra {name,index,pada} passes through");
  const moon = c.planets.find((p) => p.name === "Moon");
  ok(moon?.nakshatra?.name === "Magha", "moon nakshatra passes through");
  ok(c.ascendant_nakshatra?.name === "Hasta" && c.ascendant_nakshatra?.pada === 1,
    "ascendant nakshatra passes through");
  ok(Array.isArray(c.houses) && c.houses[0] === 150.0 && c.houses[1] === 180.0,
    "whole-sign cusps (sign boundaries) pass through as longitudes");
}

// ---- tropical byte-identity -------------------------------------------------
{
  const c = normalizeChart(tropicalRaw);
  // Recreate what the PRE-CHANGE mapper emitted, key for key.
  const preChange = {
    planets: [
      { name: "Sun", sign: "Leo", house: 11, degree: 10.5, longitude: 130.5, retrograde: false },
      { name: "Moon", sign: "Virgo", house: 12, degree: 3.2, longitude: 153.2, retrograde: false },
    ],
    angles: { ascendant: 185.0, midheaven: 102.0 },
    houses: [185.0, 212.0],
  };
  ok(JSON.stringify(c) === JSON.stringify(preChange),
    "tropical output is byte-identical to the pre-change mapper (no new keys)");
  ok(!("zodiac" in c) && !("ayanamsa" in c) && !("house_system" in c) && !("ascendant_nakshatra" in c),
    "tropical chart carries ZERO sidereal keys");
  ok(c.planets.every((p) => !("nakshatra" in p)), "tropical planets carry no nakshatra key");
}

// ---- malformed sidecar payloads never crash --------------------------------
{
  const weird = normalizeChart({ zodiac: "sidereal", planets: [{ name: "Sun", nakshatra: { pada: 2 } }], ascendant: { nakshatra: {} } });
  ok(weird.zodiac === "sidereal", "marker survives sparse payloads");
  ok(weird.planets[0].nakshatra === undefined, "nameless nakshatra is dropped, not fabricated");
  ok(weird.ascendant_nakshatra === undefined, "empty ascendant nakshatra is dropped");
}

console.log(`\n${checks} checks, ${failures} failures`);
if (failures > 0) process.exit(1);
