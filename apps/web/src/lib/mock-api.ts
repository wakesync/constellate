// Mock client used when the real API returns 404 or is offline.
// Lets the UI demo end-to-end without backend.

import type {
  User,
  BirthData,
  NatalChart,
  Constellation,
  ConstellationMember,
  JournalEntry,
  SkyToday,
  SynastryReport,
  PlaceLookup,
  Astrocartography,
  AcgLine,
  HumanDesign,
  GeneKeys,
  EnneagramQuestion,
  EnneagramResult,
  EnneagramState,
  SocionicsQuestion,
  SocionicsResult,
  SocionicsState,
  SocionicsRelationResponse,
  ConvergenceResult,
  ElizaMessage,
  ElizaReply,
  HarmonyPairResponse,
  CircleGraphResponse,
} from "./types";

const NOW = () => Date.now();

const MOCK_USER: User = {
  id: "u_mock_self",
  email: "you@constellate.local",
  display_name: "wanderer",
  has_birth_data: false,
};

const MOCK_BIRTH: BirthData = {
  date_local: "1993-08-14T03:22:00",
  timezone: "America/Denver",
  place_name: "Boulder, Colorado",
  latitude: 40.015,
  longitude: -105.27,
};

function mockNatal(seed = 0): NatalChart {
  // Deterministic-ish placeholder positions. Real charts come from kerykeion.
  const planets = [
    "Sun", "Moon", "Mercury", "Venus", "Mars",
    "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto",
  ];
  const signs = [
    "Aries","Taurus","Gemini","Cancer","Leo","Virgo",
    "Libra","Scorpio","Sagittarius","Capricorn","Aquarius","Pisces",
  ];
  const out = planets.map((p, i) => {
    const lon = (seed * 11 + i * 31.7 + i * i * 1.3) % 360;
    const signIdx = Math.floor(lon / 30);
    const deg = lon % 30;
    return {
      name: p,
      sign: signs[signIdx],
      house: ((i + seed) % 12) + 1,
      degree: deg,
      longitude: lon,
      retrograde: i === 4 || i === 7,
    };
  });
  return {
    planets: out,
    angles: { ascendant: (seed * 13.7) % 360, midheaven: (seed * 13.7 + 270) % 360 },
  };
}

const MOCK_CHART = mockNatal(7);

// Deterministic mock astrocartography. Uses the real line geometry (MC meridian,
// ASC/DSC rising/setting curves) over fabricated RA/Dec so the map demos without
// the backend. Not ephemeris-accurate, just shaped correctly.
const ACG_PLANETS = [
  "Sun", "Moon", "Mercury", "Venus", "Mars",
  "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto",
];

function norm180(deg: number): number {
  return ((deg + 180) % 360 + 360) % 360 - 180;
}

function splitAntimeridian(points: [number, number][]): [number, number][][] {
  const segs: [number, number][][] = [];
  let cur: [number, number][] = [];
  let prev: number | null = null;
  for (const [lng, lat] of points) {
    if (prev !== null && Math.abs(lng - prev) > 180) {
      if (cur.length >= 2) segs.push(cur);
      cur = [];
    }
    cur.push([lng, lat]);
    prev = lng;
  }
  if (cur.length >= 2) segs.push(cur);
  return segs;
}

function mockAcg(seed = 7): Astrocartography {
  const gst = (seed * 53.7) % 360;
  const lines: AcgLine[] = [];
  ACG_PLANETS.forEach((planet, i) => {
    const ra = (seed * 11 + i * 36.3) % 360;
    const dec = 23.4 * Math.sin(((ra + i * 19) * Math.PI) / 180); // -23.4..23.4
    const lonMc = norm180(ra - gst);
    const lonIc = norm180(lonMc + 180);
    lines.push({ planet, kind: "MC", coordinates: [[lonMc, -85], [lonMc, 85]] });
    lines.push({ planet, kind: "IC", coordinates: [[lonIc, -85], [lonIc, 85]] });
    const asc: [number, number][] = [];
    const dsc: [number, number][] = [];
    const tanDec = Math.tan((dec * Math.PI) / 180);
    for (let phi = -70; phi <= 70; phi += 2) {
      const val = -Math.tan((phi * Math.PI) / 180) * tanDec;
      if (val < -1 || val > 1) continue;
      const H = (Math.acos(val) * 180) / Math.PI;
      asc.push([norm180(ra - H - gst), phi]);
      dsc.push([norm180(ra + H - gst), phi]);
    }
    for (const seg of splitAntimeridian(asc)) lines.push({ planet, kind: "ASC", coordinates: seg });
    for (const seg of splitAntimeridian(dsc)) lines.push({ planet, kind: "DSC", coordinates: seg });
  });
  return {
    generated_at: new Date().toISOString(),
    lines,
    interpretations: MOCK_ACG_INTERP,
  };
}

const MOCK_ACG_INTERP: Record<string, Record<string, string>> = {
  Sun: {
    MC: "where you are seen for what you already are.",
    IC: "where you return to the root of yourself.",
    ASC: "where you arrive more vividly. the self steps forward here.",
    DSC: "where you find yourself in the mirror of others.",
  },
  Moon: {
    MC: "where your inner weather becomes visible.",
    IC: "where you feel most at home, or most undefended.",
    ASC: "where feeling arrives before thought.",
    DSC: "where closeness comes easily and quietly.",
  },
  Venus: {
    MC: "where you are seen as worth keeping.",
    IC: "where pleasure becomes domestic.",
    ASC: "where you are easier to be near.",
    DSC: "where attraction does its quiet arithmetic.",
  },
  Mars: {
    MC: "where you are known by what you push for.",
    IC: "where the heat lives underneath.",
    ASC: "where you move first and explain later.",
    DSC: "where friction meets you in other people.",
  },
};

const MOCK_CONSTELLATIONS: Constellation[] = [
  {
    id: "c_inner",
    name: "the inner circle",
    creator_id: "u_mock_self",
    invite_token: "moth-lantern-vellum",
    member_count: 4,
    created_at: NOW() - 86_400_000 * 12,
  },
  {
    id: "c_thursday",
    name: "thursday letters",
    creator_id: "u_other",
    invite_token: "ink-fern-quiet",
    member_count: 3,
    created_at: NOW() - 86_400_000 * 3,
  },
];

const MOCK_MEMBERS: Record<string, ConstellationMember[]> = {
  c_inner: [
    { id: "u_mock_self", display_name: "wanderer", role: "creator", joined_at: NOW() - 86_400_000 * 12 },
    { id: "u_iris", display_name: "iris", role: "member", joined_at: NOW() - 86_400_000 * 11 },
    { id: "u_august", display_name: "august", role: "member", joined_at: NOW() - 86_400_000 * 10 },
    { id: "u_solen", display_name: "solen", role: "member", joined_at: NOW() - 86_400_000 * 4 },
  ],
  c_thursday: [
    { id: "u_mock_self", display_name: "wanderer", role: "member", joined_at: NOW() - 86_400_000 * 3 },
    { id: "u_marlowe", display_name: "marlowe", role: "creator", joined_at: NOW() - 86_400_000 * 30 },
    { id: "u_pell", display_name: "pell", role: "member", joined_at: NOW() - 86_400_000 * 21 },
  ],
};

const MOCK_ENTRIES: JournalEntry[] = [
  {
    id: "j1",
    user_id: "u_mock_self",
    user_name: "wanderer",
    constellation_id: null,
    body: "the kitchen smelled like cardamom this morning and i remembered the apartment on bleecker. nothing else, just that.",
    written_at: NOW() - 1000 * 60 * 60 * 6,
    transit_snapshot: { line: "Moon waxing in Cancer · still water, slow tide" },
  },
  {
    id: "j2",
    user_id: "u_iris",
    user_name: "iris",
    constellation_id: "c_inner",
    constellation_name: "the inner circle",
    body: "wrote the letter. didn't send it. felt the same as sending it, maybe more.",
    written_at: NOW() - 1000 * 60 * 60 * 30,
    transit_snapshot: { line: "Mercury square Saturn · the right words, gently withheld" },
  },
  {
    id: "j3",
    user_id: "u_mock_self",
    user_name: "wanderer",
    constellation_id: "c_inner",
    constellation_name: "the inner circle",
    body: "three hours at the river. i forgot what i was anxious about by the time i walked home, which is not the same as solving anything.",
    written_at: NOW() - 1000 * 60 * 60 * 54,
    transit_snapshot: { line: "Venus trine Neptune · long horizons, soft edges" },
  },
];

const MOCK_SKY: SkyToday = {
  date: new Date().toISOString().slice(0, 10),
  chart: mockNatal(NOW() % 200),
  lines: [
    "Sun trine Moon · the kind of day to write something down",
    "Mercury in Virgo · the small list, sharpened",
    "Venus square Saturn · soft thing, firm boundary",
  ],
  prompt: "what did you notice today that no one else would have?",
};

const MOCK_PLACES: PlaceLookup[] = [
  { place_name: "Boulder, Colorado, USA", latitude: 40.015, longitude: -105.27, timezone: "America/Denver" },
  { place_name: "Boulder Creek, California, USA", latitude: 37.126, longitude: -122.122, timezone: "America/Los_Angeles" },
  { place_name: "Brooklyn, New York, USA", latitude: 40.6782, longitude: -73.9442, timezone: "America/New_York" },
  { place_name: "Berlin, Germany", latitude: 52.52, longitude: 13.405, timezone: "Europe/Berlin" },
  { place_name: "Bristol, United Kingdom", latitude: 51.4545, longitude: -2.5879, timezone: "Europe/London" },
  { place_name: "Lisbon, Portugal", latitude: 38.7223, longitude: -9.1393, timezone: "Europe/Lisbon" },
  { place_name: "Mexico City, Mexico", latitude: 19.4326, longitude: -99.1332, timezone: "America/Mexico_City" },
  { place_name: "Kyoto, Japan", latitude: 35.0116, longitude: 135.7681, timezone: "Asia/Tokyo" },
  { place_name: "Reykjavík, Iceland", latitude: 64.1466, longitude: -21.9426, timezone: "Atlantic/Reykjavik" },
];

// ---- Human Design mock ----------------------------------------------------

const MOCK_HD: HumanDesign = {
  type: "Manifesting Generator",
  strategy: "wait to respond, then inform",
  authority: "Emotional",
  profile: {
    personality_line: 5,
    design_line: 1,
    label: "5/1",
    name: "Heretic / Investigator",
  },
  definition: "Split",
  signature: "satisfaction",
  not_self: "frustration",
  incarnation_cross: {
    label: "Right Angle Cross of the Sleeping Phoenix",
    gates: [55, 59, 9, 16],
  },
  design_datetime_utc: "1993-05-17T14:08:00Z",
  centers: [
    { name: "Head", defined: false },
    { name: "Ajna", defined: false },
    { name: "Throat", defined: true },
    { name: "G", defined: true },
    { name: "Heart", defined: false },
    { name: "Sacral", defined: true },
    { name: "Solar Plexus", defined: true },
    { name: "Spleen", defined: false },
    { name: "Root", defined: true },
  ],
  channels: [
    { key: "20-34", name: "Charisma", gates: [20, 34], centers: ["Throat", "Sacral"] },
    { key: "10-20", name: "Awakening", gates: [10, 20], centers: ["G", "Throat"] },
    { key: "59-6", name: "Mating", gates: [59, 6], centers: ["Sacral", "Solar Plexus"] },
    { key: "53-42", name: "Maturation", gates: [53, 42], centers: ["Root", "Sacral"] },
    { key: "7-31", name: "The Alpha", gates: [7, 31], centers: ["G", "Throat"] },
  ],
  gates: {
    personality: [
      { planet: "Sun", lon: 233.4, gate: 55, line: 5 },
      { planet: "Earth", lon: 53.4, gate: 59, line: 5 },
      { planet: "Moon", lon: 112.2, gate: 53, line: 1 },
      { planet: "Mercury", lon: 244.9, gate: 20, line: 3 },
    ],
    design: [
      { planet: "Sun", lon: 145.1, gate: 9, line: 1 },
      { planet: "Earth", lon: 325.1, gate: 16, line: 1 },
      { planet: "Moon", lon: 61.7, gate: 34, line: 2 },
      { planet: "Mercury", lon: 158.0, gate: 7, line: 4 },
    ],
  },
  open_centers: ["Head", "Ajna", "Heart", "Spleen"],
  defined_count: 5,
};

// ---- Gene Keys mock -------------------------------------------------------

const MOCK_GK: GeneKeys = {
  activation: {
    lifes_work: { gate: 55, line: 5, sphere: "Life's Work", source: "personality Sun" },
    evolution: { gate: 59, line: 5, sphere: "Evolution", source: "personality Earth" },
    radiance: { gate: 9, line: 1, sphere: "Radiance", source: "design Sun" },
    purpose: { gate: 16, line: 1, sphere: "Purpose", source: "design Earth" },
  },
  keys: [
    { gate: 55, line: 5, shadow: "Victimization", gift: "Freedom", siddhi: "Freedom", codon_ring: "Ring of the Whirlwind" },
    { gate: 59, line: 5, shadow: "Dishonesty", gift: "Intimacy", siddhi: "Transparency", codon_ring: "Ring of Union" },
    { gate: 9, line: 1, shadow: "Inertia", gift: "Determination", siddhi: "Invincibility", codon_ring: "Ring of Light" },
    { gate: 16, line: 1, shadow: "Indifference", gift: "Versatility", siddhi: "Mastery", codon_ring: "Ring of Water" },
  ],
};

// ---- Enneagram mock -------------------------------------------------------

const MOCK_ENNEA_QUESTIONS: EnneagramQuestion[] = [
  { id: "q1", text: "i hold myself to a standard most people would find exhausting." },
  { id: "q2", text: "i notice what other people need before they ask." },
  { id: "q3", text: "how i am seen matters more to me than i usually admit." },
  { id: "q4", text: "i feel most like myself when something is a little melancholy." },
  { id: "q5", text: "i would rather observe from a distance than be pulled in." },
  { id: "q6", text: "i scan for what could go wrong, almost without meaning to." },
  { id: "q7", text: "i keep my options open so nothing can trap me." },
  { id: "q8", text: "i would rather be in control than be controlled." },
  { id: "q9", text: "i keep the peace even when it costs me my own position." },
  { id: "q10", text: "i correct small wrongs that others walk past." },
  { id: "q11", text: "being needed is close to how i feel loved." },
  { id: "q12", text: "i measure a day by what i managed to accomplish in it." },
];

const MOCK_ENNEA_RESULT: EnneagramResult = {
  primary: { type: 4, name: "The Individualist", score: 0.82 },
  wing: { type: 5, label: "4w5" },
  tritype: [4, 5, 1],
  scores: [
    { type: 1, score: 0.54 },
    { type: 2, score: 0.38 },
    { type: 3, score: 0.31 },
    { type: 4, score: 0.82 },
    { type: 5, score: 0.71 },
    { type: 6, score: 0.44 },
    { type: 7, score: 0.29 },
    { type: 8, score: 0.36 },
    { type: 9, score: 0.47 },
  ],
  center: "Heart",
  instinct: "sp",
  completed_at: NOW(),
};

// ---- Socionics mock -------------------------------------------------------

const MOCK_SOC_QUESTIONS: SocionicsQuestion[] = [
  { id: "s01", text: "i widen a plan by adding people to it, not by narrowing it down." },
  { id: "s09", text: "i am pulled toward what a thing could become more than what it is." },
  { id: "s18", text: "i need a system to be internally consistent before i trust it." },
  { id: "s25", text: "i keep my options open and dislike closing them too early." },
  { id: "s13", text: "i notice the physical state of a room, the light, the comfort, the wear." },
  { id: "s21", text: "i track how close or distant i feel to each person i know." },
  { id: "s10", text: "i sense where events are heading before there is evidence." },
  { id: "s22", text: "i tend to the emotional temperature of a group as if it were my job." },
  { id: "s02", text: "i would rather act on the world than watch how it settles." },
  { id: "s17", text: "i judge a plan by whether it works, not by how it feels." },
  { id: "s05", text: "i refill by being alone, not by being among people." },
  { id: "s35", text: "i am the one who names the possibility no one else saw." },
];

// A real ILE (Seeker / Don Quixote) Model A stack: Ne Ti Se Fi Si Fe Ni Te.
const MOCK_SOC_RESULT: SocionicsResult = {
  type: { code: "ILE", mbti_style: "ENTp", nickname: "Seeker", alias: "Don Quixote" },
  confidence: 0.68,
  quadra: {
    name: "Alpha",
    values: "warmth and open inquiry. ideas for their own sake, comfort freely shared, a room where anyone can wonder aloud. Ne, Si, Fe, Ti. play, not power.",
  },
  model_a: [
    { position: 1, role: "Leading", block: "Ego", element: "Ne", element_name: "intuition of possibilities", meaning: "the base program. the lens you see the world through without effort." },
    { position: 2, role: "Creative", block: "Ego", element: "Ti", element_name: "structural logic", meaning: "the tool. used flexibly to act on what the base perceives." },
    { position: 3, role: "Role", block: "Super-Ego", element: "Se", element_name: "force / volitional sensing", meaning: "the mask. tried on in public, tiring to sustain." },
    { position: 4, role: "Vulnerable", block: "Super-Ego", element: "Fi", element_name: "relational ethics", meaning: "the point of least resistance. pressure here is felt as pain." },
    { position: 5, role: "Suggestive", block: "Super-Id", element: "Si", element_name: "comfort / sensory experience", meaning: "the dual-seeking hunger. what you love to receive." },
    { position: 6, role: "Mobilizing", block: "Super-Id", element: "Fe", element_name: "ethics of emotions", meaning: "the activating function. energizing when it is fed." },
    { position: 7, role: "Ignoring", block: "Id", element: "Ni", element_name: "intuition of time", meaning: "strong but unvalued. the road not taken, on purpose." },
    { position: 8, role: "Demonstrative", block: "Id", element: "Te", element_name: "business logic / efficiency", meaning: "strong and effortless, done in the background." },
  ],
  dichotomies: { extraversion: 0.62, intuition: 0.74, logic: 0.58, irrationality: 0.66 },
  scores: [
    { code: "ILE", score: 0.94 }, { code: "LII", score: 0.83 }, { code: "IEE", score: 0.71 },
    { code: "SLE", score: 0.62 }, { code: "EIE", score: 0.55 }, { code: "ESE", score: 0.5 },
    { code: "SEI", score: 0.47 }, { code: "ILI", score: 0.44 }, { code: "LIE", score: 0.41 },
    { code: "LSI", score: 0.38 }, { code: "IEI", score: 0.35 }, { code: "SEE", score: 0.32 },
    { code: "ESI", score: 0.28 }, { code: "LSE", score: 0.24 }, { code: "SLI", score: 0.2 },
    { code: "EII", score: 0.17 },
  ],
  runner_up: { code: "LII", score: 0.83 },
  dual: { code: "SEI", mbti_style: "ISFp", nickname: "Mediator" },
  completed_at: NOW(),
};

// A populated convergence result: three engines agreeing that this person is
// responsive (initiation), a porous-sensitivity convergence, and a real tension
// on conflict posture with its question. Enough to exercise every UI branch.
const MOCK_CONVERGENCE: ConvergenceResult = {
  convergences: [
    {
      axis: "initiation",
      label: "initiation and response",
      direction: "responsive",
      value: -0.72,
      strength: 0.83,
      sources: ["human_design", "enneagram", "socionics"],
      evidence: [
        { source: "human_design", evidence: "your sacral is defined, so your energy answers rather than initiates. it lights up in response, not from a standing start.", value: -0.7, weight: 0.9 },
        { source: "enneagram", evidence: "as a nine, you go along rather than push. you can lose your own agenda in everyone else's.", value: -0.5, weight: 0.5 },
        { source: "socionics", evidence: "as SEI, you lead with an introverted element, taking the world in before acting. you respond more than you initiate.", value: -0.6, weight: 0.44 },
      ],
    },
    {
      axis: "sensitivity",
      label: "sensitivity to environment",
      direction: "porous",
      value: 0.61,
      strength: 0.64,
      sources: ["astro", "human_design", "enneagram"],
      evidence: [
        { source: "astro", evidence: "a water sun (Pisces) is traditionally the most porous to mood and undercurrent in a room.", value: 0.4, weight: 0.25 },
        { source: "human_design", evidence: "you carry 5 open centers, so you are deeply porous. the world's pressures pass through you and can feel like your own.", value: 0.8, weight: 0.8 },
        { source: "enneagram", evidence: "as a four, you are drawn to what is beautiful and melancholy, attuned to what others miss.", value: 0.4, weight: 0.4 },
      ],
    },
    {
      axis: "head_heart",
      label: "head and heart",
      direction: "leads with feeling",
      value: 0.58,
      strength: 0.6,
      sources: ["enneagram", "socionics", "astro"],
      evidence: [
        { source: "enneagram", evidence: "as a four, feeling leads. depth, longing, and mood are the water you swim in.", value: 0.75, weight: 0.7 },
        { source: "socionics", evidence: "as SEI, you lead with an ethical element: the feeling and the relationship land before the logic.", value: 0.5, weight: 0.5 },
        { source: "astro", evidence: "your sun is in Pisces, a water sign, which leans toward leading with feeling and emotional current.", value: 0.45, weight: 0.25 },
      ],
    },
  ],
  tensions: [
    {
      axis: "conflict",
      label: "conflict posture",
      strength: 0.58,
      poles: [
        { source: "enneagram", evidence: "as a nine, you avoid conflict and smooth it over. you merge with others' wants to keep the peace.", value: -0.8, weight: 0.75 },
        { source: "human_design", evidence: "a defined will center gives you steady standing-your-ground energy; you can hold a line under pressure without straining.", value: 0.4, weight: 0.45 },
      ],
      question: "when it matters most, do you press or do you smooth. and who taught you that.",
    },
    {
      axis: "structure",
      label: "structure and improvisation",
      strength: 0.41,
      poles: [
        { source: "socionics", evidence: "as SEI, an irrational (perceiving) lead keeps you flexible and improvisational, letting the shape emerge.", value: -0.5, weight: 0.45 },
        { source: "human_design", evidence: "you have single definition: one connected whole, a consistent self-contained way of running that holds its own shape.", value: 0.35, weight: 0.4 },
      ],
      question: "does the plan free you or trap you. be honest about the last time each was true.",
    },
  ],
  coverage: { astro: true, human_design: true, gene_keys: true, enneagram: true, socionics: true },
  axes_touched: 9,
  computed_at: 1753400000,
};

// In-memory mutable state for the demo session.
const state = {
  authed: false,
  user: { ...MOCK_USER },
  birth: null as BirthData | null,
  constellations: [...MOCK_CONSTELLATIONS],
  members: { ...MOCK_MEMBERS },
  entries: [...MOCK_ENTRIES],
  enneaAnswers: {} as Record<string, number>,
  enneaResult: null as EnneagramResult | null,
  socAnswers: {} as Record<string, number>,
  socResult: null as SocionicsResult | null,
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export const mock = {
  isAuthed() {
    if (typeof localStorage !== "undefined") {
      return localStorage.getItem("constellate.mock.authed") === "1";
    }
    return state.authed;
  },
  setAuthed(v: boolean) {
    state.authed = v;
    if (typeof localStorage !== "undefined") {
      if (v) localStorage.setItem("constellate.mock.authed", "1");
      else localStorage.removeItem("constellate.mock.authed");
    }
  },

  async passkeyLogin(): Promise<User> {
    await sleep(700);
    state.user.has_birth_data = !!loadLS("birth");
    this.setAuthed(true);
    return state.user;
  },
  async passkeyRegister(email: string): Promise<User> {
    await sleep(900);
    state.user = { ...state.user, email, has_birth_data: false };
    this.setAuthed(true);
    return state.user;
  },
  async logout() {
    await sleep(120);
    this.setAuthed(false);
  },

  async me(): Promise<User> {
    await sleep(120);
    const birth = loadLS("birth");
    return { ...state.user, has_birth_data: !!birth };
  },

  async saveBirth(b: BirthData): Promise<void> {
    await sleep(550);
    state.birth = b;
    saveLS("birth", b);
    state.user.has_birth_data = true;
  },

  async getChart(): Promise<{ chart: NatalChart; birth: BirthData | null }> {
    await sleep(280);
    const birth = (state.birth ?? loadLS("birth")) as BirthData | null;
    return { chart: MOCK_CHART, birth };
  },

  async skyToday(): Promise<SkyToday> {
    await sleep(220);
    return MOCK_SKY;
  },

  async constellations(): Promise<Constellation[]> {
    await sleep(180);
    const saved = (loadLS("constellations") as Constellation[] | null) ?? state.constellations;
    return saved;
  },
  async constellation(id: string): Promise<Constellation | null> {
    await sleep(160);
    const all = await this.constellations();
    return all.find((c) => c.id === id) ?? null;
  },
  async constellationMembers(id: string): Promise<ConstellationMember[]> {
    await sleep(160);
    return state.members[id] ?? [];
  },
  async createConstellation(name: string): Promise<Constellation> {
    await sleep(420);
    const id = "c_" + Math.random().toString(36).slice(2, 8);
    const token = ["moth","lantern","vellum","ink","fern","quiet","river","plum","compass"]
      .sort(() => Math.random() - 0.5).slice(0, 3).join("-");
    const c: Constellation = {
      id,
      name,
      creator_id: state.user.id,
      invite_token: token,
      member_count: 1,
      created_at: NOW(),
    };
    const all = await this.constellations();
    const next = [c, ...all];
    saveLS("constellations", next);
    state.constellations = next;
    state.members[id] = [{
      id: state.user.id,
      display_name: state.user.display_name,
      role: "creator",
      joined_at: NOW(),
    }];
    return c;
  },
  async joinByToken(token: string): Promise<Constellation> {
    await sleep(420);
    const all = await this.constellations();
    const found = all.find((c) => c.invite_token === token);
    if (found) return found;
    // pretend we joined a new one
    const c: Constellation = {
      id: "c_join_" + token.slice(0, 4),
      name: "a quiet group",
      creator_id: "u_unknown",
      invite_token: token,
      member_count: 2,
      created_at: NOW(),
    };
    const next = [c, ...all];
    saveLS("constellations", next);
    state.constellations = next;
    return c;
  },

  async journal(params?: { constellation_id?: string }): Promise<JournalEntry[]> {
    await sleep(180);
    const local = (loadLS("entries") as JournalEntry[] | null) ?? [];
    const all = [...local, ...state.entries].sort((a, b) => b.written_at - a.written_at);
    if (params?.constellation_id) {
      return all.filter((e) => e.constellation_id === params.constellation_id);
    }
    return all.filter((e) => e.user_id === state.user.id || e.constellation_id);
  },
  async createEntry(body: string, constellation_id: string | null): Promise<JournalEntry> {
    await sleep(280);
    const entry: JournalEntry = {
      id: "j_" + Math.random().toString(36).slice(2, 8),
      user_id: state.user.id,
      user_name: state.user.display_name,
      constellation_id,
      constellation_name: constellation_id
        ? (state.constellations.find((c) => c.id === constellation_id)?.name ?? null)
        : null,
      body,
      written_at: NOW(),
      transit_snapshot: { line: MOCK_SKY.lines[0] },
    };
    const local = (loadLS("entries") as JournalEntry[] | null) ?? [];
    saveLS("entries", [entry, ...local]);
    return entry;
  },

  // eliza in the circle (lane 0008). A small scripted thread so the surface
  // renders and feels alive under VITE_USE_MOCK=1, including the killer question.
  async elizaMessages(constellation_id: string): Promise<ElizaMessage[]> {
    await sleep(200);
    const saved = loadLS(`eliza:${constellation_id}`) as ElizaMessage[] | null;
    if (saved && saved.length) return saved;
    const seed: ElizaMessage[] = [
      { id: "e_seed1", user_id: null, role: "eliza", body: "i am here. ask me about a chart, or about two of you and the space between.", created_at: NOW() - 3600 },
    ];
    saveLS(`eliza:${constellation_id}`, seed);
    return seed;
  },

  async elizaSend(constellation_id: string, body: string): Promise<ElizaReply> {
    await sleep(900);
    const now = NOW();
    const userMsg: ElizaMessage = { id: "e_u_" + Math.random().toString(36).slice(2, 8), user_id: state.user.id, role: "user", body, created_at: now };
    const lc = body.toLowerCase();
    let reply =
      "i would be guessing if i answered that from nothing, and i do not guess about your chart. ask me to pull something and i will read only what is there.";
    if (/fight|conflict|same thing|argue/.test(lc)) {
      reply =
        "your socionics base is Se and theirs is Ti, and your intertype relation is one where one of you moves and the other measures. your human design has you completing a channel they do not hold alone, so the same wire that connects also pulls. the shared entries circle the same shape: you move fast, they need to think. it is not a flaw in either of you, it is two shapes meeting.";
    } else if (/human design|authority|generator|projector/.test(lc)) {
      reply = "you are a Generator with Sacral authority. the yes and no live in your body before they reach your head.";
    } else if (/gene key|convergence/.test(lc)) {
      reply = "that reading has not been computed yet in this circle. once it is there i will look, and only say what is actually in it.";
    }
    const elizaMsg: ElizaMessage = { id: "e_a_" + Math.random().toString(36).slice(2, 8), user_id: null, role: "eliza", body: reply, created_at: now + 1 };
    const prior = (loadLS(`eliza:${constellation_id}`) as ElizaMessage[] | null) ?? [];
    saveLS(`eliza:${constellation_id}`, [...prior, userMsg, elizaMsg]);
    return { user_message: { id: userMsg.id, created_at: now }, eliza: elizaMsg };
  },

  async synastry(other_user_id: string): Promise<SynastryReport> {
    await sleep(700);
    return {
      user_a: { id: state.user.id, display_name: state.user.display_name, chart: mockNatal(7) },
      user_b: { id: other_user_id, display_name: MOCK_MEMBERS.c_inner.find((m) => m.id === other_user_id)?.display_name ?? "iris", chart: mockNatal(19) },
      aspects: [
        { a: "Sun", b: "Moon", type: "trine", orb: 2.1, harmonic: "harmonious" },
        { a: "Venus", b: "Mars", type: "square", orb: 1.4, harmonic: "harsh" },
        { a: "Mercury", b: "Mercury", type: "conjunction", orb: 0.8, harmonic: "harmonious" },
        { a: "Saturn", b: "Sun", type: "opposition", orb: 3.2, harmonic: "harsh" },
        { a: "Moon", b: "Neptune", type: "sextile", orb: 1.7, harmonic: "harmonious" },
        { a: "Mars", b: "Pluto", type: "trine", orb: 0.9, harmonic: "harmonious" },
      ],
      narrative:
        "you arrive in each other's lives the way certain books arrive on certain afternoons. there is, between you, a quiet recognition that has nothing to do with similarity. your suns are in conversation, not agreement, and the conversation is the point.\n\nthe Venus square Mars is real, and worth saying out loud: a productive friction, a heat that wants to make something rather than burn the kitchen down. mercury meeting mercury is the part neither of you will mention because it feels too obvious, the way two people who think in the same shape will sometimes finish each other's lists.\n\nsaturn shows up here too. it usually does, when something is going to last. saturn is not punishment, it is the slow architecture by which two people who could merely have liked each other instead choose to build something that holds weight.\n\nthe chart did not make this happen. it just remembers it happened.",
      generated_at: NOW(),
    };
  },

  async astrocartography(): Promise<Astrocartography> {
    await sleep(420);
    return mockAcg(7);
  },

  async humandesign(): Promise<{ hd: HumanDesign; birth: BirthData | null }> {
    await sleep(320);
    const birth = (state.birth ?? loadLS("birth")) as BirthData | null;
    return { hd: MOCK_HD, birth };
  },

  async genekeys(): Promise<{ gk: GeneKeys; birth: BirthData | null }> {
    await sleep(320);
    const birth = (state.birth ?? loadLS("birth")) as BirthData | null;
    return { gk: MOCK_GK, birth };
  },

  async hdReading(): Promise<{ text: string }> {
    await sleep(500);
    return {
      text:
        "you are built to respond, not to initiate. the world brings things to your door and something in your body answers before your mind has a say. when you honor that, the work moves fast and it satisfies. when you force a door open with your mind, you meet the same frustration again and again, and mistake it for the world being difficult.\n\nthe emotional authority asks only one thing of you: do not decide in the first wave. sleep on it. what feels certain at night rarely feels the same by morning, and the truth lives somewhere in that difference. the 5/1 profile means people project onto you, hope onto you, and none of it is really about you. you keep your footing by knowing the thing underneath before you ever step out to be seen.",
    };
  },

  async gkReading(): Promise<{ text: string }> {
    await sleep(500);
    return {
      text:
        "the gene keys are not a diagnosis. they are a contemplation you return to. the shadow is not a flaw to be removed, it is the low frequency of the same energy whose high note is the gift. you do not defeat the shadow. you warm it until it turns.\n\nyour life's work moves through the fear of being controlled toward a freedom that has nothing to prove. sit with each of these the way you would sit with a line of poetry you do not fully understand yet. the understanding arrives sideways, months later, on an ordinary afternoon.",
    };
  },

  async enneagramQuestions(): Promise<{ questions: EnneagramQuestion[] }> {
    await sleep(200);
    return { questions: MOCK_ENNEA_QUESTIONS };
  },

  async enneagramState(): Promise<EnneagramState> {
    await sleep(180);
    const saved = (loadLS("ennea") as { answers: Record<string, number>; result: EnneagramResult | null } | null);
    if (saved) {
      state.enneaAnswers = saved.answers ?? {};
      state.enneaResult = saved.result ?? null;
    }
    return {
      result: state.enneaResult,
      answered: Object.keys(state.enneaAnswers).length,
      total: MOCK_ENNEA_QUESTIONS.length,
    };
  },

  async enneagramSave(answers: Record<string, number>): Promise<EnneagramState> {
    await sleep(200);
    state.enneaAnswers = { ...state.enneaAnswers, ...answers };
    const complete = Object.keys(state.enneaAnswers).length >= MOCK_ENNEA_QUESTIONS.length;
    if (complete) state.enneaResult = { ...MOCK_ENNEA_RESULT, completed_at: NOW() };
    saveLS("ennea", { answers: state.enneaAnswers, result: state.enneaResult });
    return {
      result: state.enneaResult,
      answered: Object.keys(state.enneaAnswers).length,
      total: MOCK_ENNEA_QUESTIONS.length,
    };
  },

  async enneagramReset(): Promise<void> {
    await sleep(160);
    state.enneaAnswers = {};
    state.enneaResult = null;
    saveLS("ennea", { answers: {}, result: null });
  },

  async enneagramReading(): Promise<{ text: string }> {
    await sleep(500);
    return {
      text:
        "type four is the sense that something essential is missing, and the long romance with that absence. it is not sadness for its own sake. it is a hunger for the real thing, the unrepeatable thing, and an allergy to the ordinary substitute. your gift is that you can sit with feeling that other people flee, and make something honest out of it.\n\nthe four-wing-five leans inward and quiet, a private and self-contained way of feeling. the five is close behind, so the withdrawal is real: you retreat to understand before you return to feel. watch for the story that your longing makes you separate. it does not. it is only the shape of your attention.",
    };
  },

  async socionicsQuestions(): Promise<{ questions: SocionicsQuestion[] }> {
    await sleep(200);
    return { questions: MOCK_SOC_QUESTIONS };
  },

  async socionicsState(): Promise<SocionicsState> {
    await sleep(180);
    const saved = (loadLS("soc") as { answers: Record<string, number>; result: SocionicsResult | null } | null);
    if (saved) {
      state.socAnswers = saved.answers ?? {};
      state.socResult = saved.result ?? null;
    }
    return {
      result: state.socResult,
      answered: Object.keys(state.socAnswers).length,
      total: MOCK_SOC_QUESTIONS.length,
    };
  },

  async socionicsSave(answers: Record<string, number>): Promise<SocionicsState> {
    await sleep(200);
    state.socAnswers = { ...state.socAnswers, ...answers };
    const complete = Object.keys(state.socAnswers).length >= MOCK_SOC_QUESTIONS.length;
    if (complete) state.socResult = { ...MOCK_SOC_RESULT, completed_at: NOW() };
    saveLS("soc", { answers: state.socAnswers, result: state.socResult });
    return {
      result: state.socResult,
      answered: Object.keys(state.socAnswers).length,
      total: MOCK_SOC_QUESTIONS.length,
    };
  },

  async socionicsReset(): Promise<void> {
    await sleep(160);
    state.socAnswers = {};
    state.socResult = null;
    saveLS("soc", { answers: {}, result: null });
  },

  async socionicsReading(): Promise<{ text: string }> {
    await sleep(500);
    return {
      text:
        "you live among possibilities. Ne, the intuition of what could be, is the lens you wear without trying, and everything arrives to you as an option, a branch, a thing that might become another thing. underneath it runs a private logic, Ti, that quietly sorts the branches into a structure only you can quite see. you open doors for a living, even when no one asked.\n\nthe soft place is Fi, the ledger of closeness. the exact distance between you and another person is the one thing the possibility-mind cannot compute, and pressure there is felt as a real ache. what you reach for, quietly, is Si, the body's ease, comfort you are not very good at making for yourself and love when someone else brings it into the room.\n\nyour dual is the Mediator, SEI, whose whole gift is that ease, laid down exactly where you go unguarded. this is not a promise of a person. it is a description of a fit. hold the type lightly. a quiz is a weak instrument, and the Analyst sits close behind you.",
    };
  },

  async socionicsRelation(other_user_id: string): Promise<SocionicsRelationResponse> {
    await sleep(400);
    // ILE (self) vs SEI (dual) for a warm demo.
    return {
      me: { id: state.user.id, type: "ILE", nickname: "Seeker" },
      other: {
        id: other_user_id,
        display_name: MOCK_MEMBERS.c_inner.find((m) => m.id === other_user_id)?.display_name ?? "iris",
        type: "SEI",
        nickname: "Mediator",
      },
      relation: {
        kind: "Duality",
        direction: null,
        symmetric: true,
        title: "your dual",
        blurb: "the completing one. what you cannot supply for yourself, they carry without trying, and the reverse is just as true. the rarest ease. two halves that were cut from the same whole.",
      },
    };
  },

  async convergence(): Promise<ConvergenceResult> {
    await sleep(320);
    return MOCK_CONVERGENCE;
  },

  async convergenceReading(): Promise<{ text: string }> {
    await sleep(520);
    return {
      text:
        "three of the five keep pointing the same way: you answer the world more than you start it. your design says the sacral waits to respond, your type goes along to keep the peace, your socionics lead takes the room in before it acts. that is not passivity. it is a shape. you are built to meet what arrives, and you are most yourself when something real has come to meet you.\n\nunderneath that, a quieter agreement: you are porous. the mood of a room passes through you, and much of what you feel there was never yours to carry.\n\nand then the interesting part, where the systems disagree. your type would rather smooth a conflict than have it. your design carries a will that can hold a hard line without flinching. both are true, and they do not want the same thing. so the question, and sit with it: when it matters most, do you press or do you smooth. and who taught you that.",
    };
  },

  async placesLookup(q: string): Promise<PlaceLookup[]> {
    await sleep(180);
    const lower = q.trim().toLowerCase();
    if (!lower) return [];
    return MOCK_PLACES.filter((p) =>
      p.place_name.toLowerCase().includes(lower),
    ).slice(0, 6);
  },

  async harmonyPair(other_user_id: string): Promise<HarmonyPairResponse> {
    await sleep(240);
    // deterministic-ish per member so different pairs read differently in dev.
    const seed = other_user_id.split("").reduce((a, ch) => a + ch.charCodeAt(0), 0);
    const score = 38 + (seed % 47); // 38..84
    const band = score >= 78 ? "in step" : score >= 62 ? "fair weather" : score >= 48 ? "mixed sky" : "crosswinds";
    return {
      harmony: {
        score,
        band,
        confidence: 0.72,
        shared_axes: 4,
        engines: 5,
        agreements: [
          { axis: "initiation", label: "initiation and response", direction: "responsive", weight: 0.51 },
          { axis: "sensitivity", label: "sensitivity to environment", direction: "porous", weight: 0.34 },
        ],
        tensions: [
          { axis: "conflict", label: "conflict posture", a_direction: "avoids and smooths", b_direction: "meets it head on", weight: 0.27 },
        ],
      },
      framing: "house harmony",
      verdict: "you agree on pace and differ on how you fight.",
      relationship_context: "roommate",
    };
  },

  async circleGraph(constellation_id: string): Promise<CircleGraphResponse> {
    await sleep(320);
    const members = (state.members[constellation_id] ?? MOCK_MEMBERS.c_inner).map((m, i) => ({
      id: m.id,
      display_name: m.display_name,
      has_birth_data: true,
      highlights: [
        { label: ["generator", "projector", "manifestor", "reflector"][i % 4], kind: "hd" as const },
        { label: ["emotional authority", "sacral authority", "splenic authority"][i % 3], kind: "hd" as const },
        { label: ["sun in pisces", "sun in leo", "sun in libra", "sun in taurus"][i % 4], kind: "placement" as const },
        { label: ["moon in cancer", "moon in aries", "moon in virgo"][i % 3], kind: "placement" as const },
      ],
    }));
    const edges: CircleGraphResponse["edges"] = [];
    const sorted = [...members].sort((a, b) => (a.id < b.id ? -1 : 1));
    for (let i = 0; i < sorted.length; i += 1) {
      for (let j = i + 1; j < sorted.length; j += 1) {
        const seed = (i * 7 + j * 13) % 10;
        const score = 34 + ((i * 17 + j * 29) % 53);
        edges.push({
          a: sorted[i].id,
          b: sorted[j].id,
          shared: [
            { kind: "channel", token: "channel:20-34", label: "the 20-34 channel · charisma", weight: 3 },
            { kind: "placement", token: "planet_sign:Moon:Cancer", label: "moon in cancer", weight: 1.6 },
            { kind: "gate", token: "gate:34", label: "gate 34", weight: 1.1 },
            { kind: "open_center", token: "center:Head", label: "open head", weight: 0.8 },
          ].slice(0, 1 + (seed % 4)),
          aspects: [
            { label: "moon trine venus", harmonious: true },
            { label: "mars square sun", harmonious: false },
          ].slice(0, 1 + (seed % 2)),
          harmony: {
            score,
            band: score >= 78 ? "in step" : score >= 62 ? "fair weather" : score >= 48 ? "mixed sky" : score >= 34 ? "crosswinds" : "charged",
            confidence: 0.6 + (seed % 4) * 0.1,
            engines: 5,
            shared_axes: 4,
          },
          harmony_framing: "house harmony",
          verdict: "you agree on pace and differ on how you fight.",
        });
      }
    }
    return { members, edges, computed_at: NOW() };
  },
};

function loadLS<T = unknown>(key: string): T | null {
  if (typeof localStorage === "undefined") return null;
  const v = localStorage.getItem("constellate.mock." + key);
  if (!v) return null;
  try { return JSON.parse(v) as T; } catch { return null; }
}

function saveLS(key: string, val: unknown) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem("constellate.mock." + key, JSON.stringify(val));
}
