// Shared types. Mirror API surface from ARCHITECTURE.md.

export type PlanetName =
  | "Sun"
  | "Moon"
  | "Mercury"
  | "Venus"
  | "Mars"
  | "Jupiter"
  | "Saturn"
  | "Uranus"
  | "Neptune"
  | "Pluto";

export type ZodiacSign =
  | "Aries" | "Taurus" | "Gemini" | "Cancer" | "Leo" | "Virgo"
  | "Libra" | "Scorpio" | "Sagittarius" | "Capricorn" | "Aquarius" | "Pisces";

// The zodiac lens (docs/SIDEREAL.md). Tropical = the seasonal sky
// (the default, anchored to the march equinox). Sidereal = the fixed-star sky
// (the vedic frame, Lahiri ayanamsa by default).
export type ZodiacSystem = "tropical" | "sidereal";

// One of the 27 lunar mansions of the sidereal sky. Present on every planet
// and the ascendant of a sidereal chart; never present on tropical charts.
export interface Nakshatra {
  name: string;
  index: number;               // 1..27, 1 = ashwini
  pada: number;                // 1..4
  degree_in_nakshatra: number; // 0..13.333
}

export interface PlanetPlacement {
  name: PlanetName | string;
  sign: ZodiacSign | string;
  house: number;
  degree: number;       // 0..29.999 within sign
  longitude: number;    // 0..360 ecliptic longitude
  retrograde?: boolean;
  nakshatra?: Nakshatra; // sidereal charts only
}

export interface ChartAngles {
  ascendant: number;    // longitude in degrees
  midheaven: number;
}

export interface NatalChart {
  planets: PlanetPlacement[];
  angles: ChartAngles;
  houses?: number[];    // 12 house cusps (longitudes)
  // Sidereal-only furniture. A tropical chart carries NONE of these keys
  // (frame-isolation invariant, docs/SIDEREAL.md section 3).
  zodiac?: "sidereal";
  house_system?: string;           // "whole_sign" on sidereal charts
  ayanamsa?: { mode: string; value_deg: number };
  ascendant_nakshatra?: Nakshatra;
}

export interface Aspect {
  a: string;            // planet name
  b: string;
  type: "conjunction" | "opposition" | "trine" | "square" | "sextile" | "quincunx" | string;
  orb: number;
  harmonic: "harmonious" | "harsh" | "neutral";
}

export interface User {
  id: string;
  email: string;
  display_name: string | null;
  has_birth_data: boolean;
  // Private. Returned only by /me, never on ConstellationMember.
  sexual_orientation?: string | null;
  relational_preference?: string | null;
  // The zodiac lens preference: which sky charts are read under. A VIEW
  // preference, not a fork of the truth. Optional for older API responses.
  zodiac_system?: ZodiacSystem;
}

export type RelationshipKind = "roommate" | "collaborator" | "friend" | "romantic" | "family";

export interface PairContext {
  relationship: RelationshipKind | null;
  set_by: string | null;
  updated_at: number | null;
}

export interface BirthData {
  date_local: string;       // ISO 8601 local
  timezone: string;
  place_name: string;
  latitude: number;
  longitude: number;
  exact_time_unknown?: boolean;
}

export interface Constellation {
  id: string;
  name: string;
  creator_id: string;
  invite_token: string;
  member_count: number;
  created_at: number;
}

export interface ConstellationMember {
  id: string;
  display_name: string | null;
  role: "creator" | "member" | string;
  joined_at: number;
  has_birth_data?: boolean;
}

export interface JournalEntry {
  id: string;
  user_id: string;
  user_name?: string | null;
  constellation_id: string | null;
  constellation_name?: string | null;
  body: string;
  written_at: number;
  transit_snapshot?: { line: string } | null;
}

// eliza in the circle (lane 0008)
export interface ElizaMessage {
  id: string;
  user_id: string | null;   // null => eliza spoke
  role: "user" | "eliza";
  body: string;
  created_at: number;
}
export interface ElizaReply {
  user_message: { id: string; created_at: number };
  eliza: ElizaMessage | null;   // null => she stayed quiet
  quiet_reason?: string;
  degraded?: boolean;
}

export interface SkyToday {
  date: string;
  chart: NatalChart;          // transit chart for today
  lines: string[];            // 2-3 LLM transit lines
  prompt: string;             // single journaling prompt
  reflection?: string;        // full reflection text
  degraded?: boolean;         // true when served the non-AI fallback
}

export interface SynastryReport {
  user_a: { id: string; display_name: string | null; chart: NatalChart | null };
  user_b: { id: string; display_name: string | null; chart: NatalChart | null };
  aspects: Aspect[];
  narrative: string;
  generated_at: number;
  degraded?: boolean;
  // lens the pair would cast under right now (declared context + preferences)
  current_lens?: RelationshipLens;
  // which generation this narrative is, and where it sits in pair history
  generation?: SynastryGenerationMeta;
}

export type RelationshipLens = RelationshipKind | "unspecified";

export interface SynastryGenerationMeta {
  id: string;
  lens: RelationshipLens;
  // Which sky the reading was cast under. Generations are permanent; old
  // readings never silently change frame. Optional for older API responses.
  zodiac_system?: ZodiacSystem;
  generated_at: number;
  generated_by?: string | null;
  degraded: boolean;
  active: boolean;
  index: number; // 1-based, oldest = 1
  total: number;
}

export interface SynastryGenerationList {
  generations: SynastryGenerationMeta[];
  total: number;
  current_lens: RelationshipLens;
  active_zodiac?: ZodiacSystem;
}

export interface PlaceLookup {
  place_name: string;
  latitude: number;
  longitude: number;
  timezone: string;
}

export type AcgLineKind = "MC" | "IC" | "ASC" | "DSC";

export interface AcgLine {
  planet: PlanetName | string;
  kind: AcgLineKind;
  coordinates: [number, number][]; // [lng, lat] pairs, GeoJSON order
}

export interface Astrocartography {
  generated_at: string;
  lines: AcgLine[];
  interpretations: Record<string, Record<string, string>>; // planet -> kind -> meaning
  cached_at?: number;
}

// ---- Human Design ----------------------------------------------------------

export type HdCenterName =
  | "Head" | "Ajna" | "Throat" | "G" | "Heart"
  | "Sacral" | "Solar Plexus" | "Spleen" | "Root";

export interface HdCenter {
  name: HdCenterName;
  defined: boolean;
}

export interface HdChannel {
  key: string;              // e.g. "20-34"
  name: string;             // e.g. "Charisma"
  gates: [number, number];
  centers: [string, string];
}

export interface HdGateActivation {
  planet: string;
  lon: number;
  gate: number;
  line: number;
  color?: number;
  tone?: number;
  base?: number;
}

export interface HdProfile {
  personality_line: number;
  design_line: number;
  label: string;            // "5/1"
  name: string;             // "Heretic / Investigator"
}

export interface HdIncarnationCross {
  label: string;
  gates: number[];          // [p_sun, p_earth, d_sun, d_earth]
}

export type HdType =
  | "Generator" | "Manifesting Generator" | "Manifestor"
  | "Projector" | "Reflector";

export type HdAuthority =
  | "Emotional" | "Sacral" | "Splenic" | "Ego"
  | "Self-Projected" | "Mental" | "Lunar";

export interface HumanDesign {
  type: HdType;
  strategy: string;
  authority: HdAuthority;
  profile: HdProfile;
  definition: "None" | "Single" | "Split" | "Triple Split" | "Quadruple Split";
  signature: string;
  not_self: string;
  incarnation_cross: HdIncarnationCross;
  design_datetime_utc: string;
  centers: HdCenter[];
  channels: HdChannel[];
  gates: {
    personality: HdGateActivation[];
    design: HdGateActivation[];
  };
  open_centers: string[];
  defined_count: number;
  // Alternate-lens framing, present ONLY on sidereal payloads: HD canon is
  // tropical (Ra Uru Hu built the wheel on the tropical zodiac); the sidereal
  // reading is a community-explored alternate lens. Tropical payloads carry
  // none of these keys.
  zodiac?: "sidereal";
  lens?: "alternate";
  canon?: "tropical";
  ayanamsa?: { mode: string; value_deg: number; design_value_deg?: number };
}

export interface HumanDesignResponse {
  hd: HumanDesign;
  birth: BirthData | null;
  zodiac_system?: ZodiacSystem;
}

// ---- Gene Keys -------------------------------------------------------------

export interface GkSphere {
  gate: number;
  line: number;
  sphere: string;
  source: string;
}

export interface GkKey {
  gate: number;
  line: number;
  shadow: string;
  gift: string;
  siddhi: string;
  codon_ring?: string;
}

export interface GeneKeys {
  activation: {
    lifes_work: GkSphere;
    evolution: GkSphere;
    radiance: GkSphere;
    purpose: GkSphere;
  };
  venus?: Record<string, GkSphere>;
  pearl?: Record<string, GkSphere>;
  keys: GkKey[];
  // Alternate-lens framing, sidereal payloads only (see HumanDesign note;
  // Rudd correlates the hexagram wheel to the tropical zodiac).
  zodiac?: "sidereal";
  lens?: "alternate";
  canon?: "tropical";
  ayanamsa?: { mode: string; value_deg: number; design_value_deg?: number };
}

export interface GeneKeysResponse {
  gk: GeneKeys;
  birth: BirthData | null;
  zodiac_system?: ZodiacSystem;
}

// ---- Enneagram -------------------------------------------------------------

export interface EnneagramQuestion {
  id: string;
  text: string;
}

export interface EnneagramTypeScore {
  type: number;             // 1..9
  score: number;            // 0..1
}

export interface EnneagramResult {
  primary: { type: number; name: string; score: number };
  wing: { type: number; label: string };
  tritype?: number[];
  scores: EnneagramTypeScore[];
  center: "Heart" | "Head" | "Body";
  instinct: "sp" | "so" | "sx" | null;
  completed_at: number;
}

export interface EnneagramState {
  result: EnneagramResult | null;
  answered: number;
  total: number;
}

// ---- Socionics -------------------------------------------------------------

export interface SocionicsQuestion {
  id: string;
  text: string;
}

export type SocionicsElement = "Ne" | "Ni" | "Se" | "Si" | "Te" | "Ti" | "Fe" | "Fi";
export type SocionicsBlock = "Ego" | "Super-Ego" | "Super-Id" | "Id";

export interface ModelAPosition {
  position: number;         // 1..8
  role: string;             // Leading, Creative, Role, Vulnerable, ...
  block: SocionicsBlock;
  element: SocionicsElement;
  element_name: string;
  meaning: string;
}

export interface SocionicsTypeScore {
  code: string;
  score: number;            // 0..1
}

export interface SocionicsResult {
  type: { code: string; mbti_style: string; nickname: string; alias: string };
  confidence: number;
  quadra: { name: string; values: string };
  model_a: ModelAPosition[];
  dichotomies: { extraversion: number; intuition: number; logic: number; irrationality: number };
  scores: SocionicsTypeScore[];
  runner_up: { code: string; score: number } | null;
  dual: { code: string; mbti_style: string; nickname: string };
  completed_at: number;
}

export interface SocionicsState {
  result: SocionicsResult | null;
  answered: number;
  total: number;
}

export type SocionicsRelationKind =
  | "Identity" | "Duality" | "Activity" | "Mirror" | "Semi-Duality" | "Mirage"
  | "Look-a-like" | "Kindred" | "Contrary" | "Super-Ego" | "Quasi-Identity"
  | "Conflict" | "Benefit" | "Supervision";

export interface SocionicsRelation {
  kind: SocionicsRelationKind;
  direction: "benefactor" | "beneficiary" | "supervisor" | "supervisee" | null;
  symmetric: boolean;
  title: string;
  blurb: string;
}

export interface SocionicsRelationResponse {
  me: { id: string; type: string; nickname: string | null };
  other: { id: string; display_name: string | null; type: string; nickname: string | null };
  relation: SocionicsRelation;
}

// ---- Convergence -----------------------------------------------------------

export type ConvergenceSource =
  | "astro" | "human_design" | "gene_keys" | "enneagram" | "socionics";

export interface ConvergenceEvidence {
  source: ConvergenceSource;
  evidence: string;
  value: number;
  weight: number;
}

export interface Convergence {
  axis: string;
  label: string;
  direction: string;
  value: number;
  strength: number;   // 0..1
  sources: ConvergenceSource[];
  evidence: ConvergenceEvidence[];
}

export interface Tension {
  axis: string;
  label: string;
  strength: number;   // 0..1
  poles: [ConvergenceEvidence, ConvergenceEvidence];
  question: string;
}

export type ConvergenceCoverage = Record<ConvergenceSource, boolean>;

export interface ConvergenceResult {
  convergences: Convergence[];
  tensions: Tension[];
  coverage: ConvergenceCoverage;
  axes_touched: number;
  computed_at: number;
}

// ---- Harmony (deterministic pair score over convergence results) -----------

export type HarmonyBand = "in step" | "fair weather" | "mixed sky" | "crosswinds" | "charged";

export interface HarmonyAgreement {
  axis: string;
  label: string;
  direction: string;
  weight: number;
}

export interface HarmonyTension {
  axis: string;
  label: string;
  a_direction: string;
  b_direction: string;
  weight: number;
}

export interface HarmonyResult {
  score: number;       // 0..100
  band: HarmonyBand;
  confidence: number;  // 0..1
  shared_axes: number;
  engines?: number;    // distinct deterministic sources behind the shared axes (may lag on older API)
  agreements: HarmonyAgreement[];
  tensions: HarmonyTension[];
  mech_agreements?: MechEvidenceItem[];
  mech_tensions?: MechEvidenceItem[];
}

export interface MechEvidenceItem {
  source: "human_design" | "gene_keys" | "socionics";
  label: string;
  weight: number;
}

// ---- Mechanical pair layer (lib/pair on the API) ---------------------------

export type ConnectionChannelClass = "electromagnetic" | "companionship" | "dominance" | "compromise";

export interface ConnectionChannel {
  key: string;
  name: string;
  gates: [number, number];
  centers: [string, string];
  class: ConnectionChannelClass;
  dominant: "a" | "b" | null;
  a_gates: number[];
  b_gates: number[];
}

export interface ConnectionChart {
  channels: ConnectionChannel[];
  counts: Record<ConnectionChannelClass, number>;
  composite_centers: string[];
  a_open_defined_by_b: string[];
  b_open_defined_by_a: string[];
  defined_together: number;
}

export interface GkProgrammingPartnerLink {
  a_sphere: string;
  a_gate: number;
  b_sphere: string;
  b_gate: number;
  a_triad: { shadow: string; gift: string; siddhi: string } | null;
  b_triad: { shadow: string; gift: string; siddhi: string } | null;
}

export interface GkSharedKey {
  gate: number;
  a_spheres: string[];
  b_spheres: string[];
  triad: { shadow: string; gift: string; siddhi: string } | null;
}

export interface SocionicsPairFact {
  a_type: string;
  b_type: string;
  relation: {
    kind: string;
    direction: "benefactor" | "beneficiary" | "supervisor" | "supervisee" | null;
    symmetric: boolean;
    title: string;
    blurb: string;
  };
}

export interface EnneagramPairFact {
  a_type: number;
  b_type: number;
  a_wing: string | null;
  b_wing: string | null;
  same_type: boolean;
  centers: { a: string | null; b: string | null; same: boolean };
  harmonic: { a: string | null; b: string | null; same: boolean };
  hornevian: { a: string | null; b: string | null; same: boolean };
}

export interface PairMechanics {
  connection: ConnectionChart | null;
  gene_keys: { programming_partners: GkProgrammingPartnerLink[]; shared_keys: GkSharedKey[] } | null;
  socionics: SocionicsPairFact | null;
  enneagram: EnneagramPairFact | null;
}

export interface HarmonyPairResponse {
  harmony: HarmonyResult | null;
  framing: string;     // "house harmony" | "working harmony" | "harmony" ...
  verdict?: string | null; // deterministic blunt one-liner, no LLM (may lag on older API)
  relationship_context: RelationshipKind | "unspecified";
  mechanics?: PairMechanics; // may lag on older API
  mechanics_sides?: {
    a: { id: string; display_name: string | null };
    b: { id: string; display_name: string | null };
  };
}

// ---- Circle graph (constellation view) --------------------------------------

export interface GraphMemberHighlight {
  label: string;
  kind: "hd" | "placement";
}

export interface CircleGraphMember {
  id: string;
  display_name: string | null;
  has_birth_data: boolean;
  highlights: GraphMemberHighlight[];
}

export interface CircleGraphSharedTrait {
  kind: string;
  token: string;
  label: string;
  weight: number;
}

export interface CircleGraphAspect {
  label: string;
  harmonious: boolean;
}

export interface CircleGraphEdge {
  a: string;
  b: string;
  shared: CircleGraphSharedTrait[];
  aspects: CircleGraphAspect[];
  harmony: {
    score: number;
    band: HarmonyBand;
    confidence: number;
    engines?: number;
    shared_axes: number;
  } | null;
  harmony_framing: string;
  verdict?: string | null;
}

export interface CircleGraphResponse {
  members: CircleGraphMember[];
  edges: CircleGraphEdge[];
  computed_at: number;
}
