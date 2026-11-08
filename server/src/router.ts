import type {AttestedChat, ChatRequest} from './inference.js';
import type {PublicLane, PublicCopy} from './darkbloom.js';
import type {InferenceResult} from './contracts.js';

// Sensitivity router. Every model call in Constellate is classified by the data
// it carries, not by price or latency:
//
//   private  birth details, placements, readings, chats, agent memory, circle
//            exchange. Only ever leaves through the attested Tinfoil enclave
//            (inference.ts). No fallback, ever.
//   public   copy with zero personal data (today's sky, sign overviews). Goes to
//            the Darkbloom OpenAI-compatible API when configured, otherwise a
//            deterministic non-AI template. Never carries anything user-derived.
//   local    chart math. Astronomy Engine, never a model.
//
// Unknown task kinds are private. The guard below is the last check before any
// byte goes to a non-attested route and throws instead of sending.

export type Sensitivity = 'private' | 'public' | 'local';
export type Route = 'tinfoil-enclave' | 'darkbloom' | 'local-ephemeris';

export const ROUTING_TABLE = Object.freeze({
  'chart-math': {sensitivity: 'local', route: 'local-ephemeris'},
  'reading': {sensitivity: 'private', route: 'tinfoil-enclave'},
  'reading-chat': {sensitivity: 'private', route: 'tinfoil-enclave'},
  'synastry': {sensitivity: 'private', route: 'tinfoil-enclave'},
  'agent-memory': {sensitivity: 'private', route: 'tinfoil-enclave'},
  'agent-exchange': {sensitivity: 'private', route: 'tinfoil-enclave'},
  // Full product (apps/api) kinds. Personalized transits use the member's
  // location, so they are private even though "today's sky" sounds public.
  'typology-reading': {sensitivity: 'private', route: 'tinfoil-enclave'},
  'convergence-pair': {sensitivity: 'private', route: 'tinfoil-enclave'},
  'sky-reflection': {sensitivity: 'private', route: 'tinfoil-enclave'},
  'circle-agent': {sensitivity: 'private', route: 'tinfoil-enclave'},
  'daily-transits': {sensitivity: 'public', route: 'darkbloom'},
  'sign-overview': {sensitivity: 'public', route: 'darkbloom'},
} as const satisfies Record<string, {sensitivity: Sensitivity; route: Route}>);
export type TaskKind = keyof typeof ROUTING_TABLE;

export const ATTESTED_ROUTES: ReadonlySet<Route> = new Set<Route>(['tinfoil-enclave']);

/** Unknown or malformed kinds are private. Nothing is public by accident. */
export function classify(kind: string): {kind: string; sensitivity: Sensitivity; route: Route} {
  const entry = Object.hasOwn(ROUTING_TABLE, kind) ? ROUTING_TABLE[kind as TaskKind] : undefined;
  return entry ? {kind, ...entry} : {kind, sensitivity: 'private', route: 'tinfoil-enclave'};
}

export class PrivacyRouteError extends Error {
  constructor(reason: string) { super(`Blocked by privacy router: ${reason}`); this.name = 'PrivacyRouteError'; }
}

// ---------------------------------------------------------------- tagging
// Objects that carried private data are remembered by identity. If one is ever
// handed to the public lane, the guard throws regardless of its content.
const privateTagged = new WeakSet<object>();
const publicBranded = new WeakSet<object>();

export function tagPrivate<T extends object>(value: T): T { privateTagged.add(value); return value; }
export function isTaggedPrivate(value: unknown): boolean {
  return typeof value === 'object' && value !== null && privateTagged.has(value);
}

// ---------------------------------------------------------------- birth-field scan
// Public prompts are built only from sign names, whole degrees and fixed copy.
// Anything shaped like a birth date, time, place, coordinate, identifier or a
// chart field name is refused. Deliberately over-broad: a false positive costs a
// template fallback, a false negative would cost someone's birthday.
const BIRTH_FIELD_PATTERNS: readonly [string, RegExp][] = [
  ['iso-date', /\b\d{4}-\d{1,2}-\d{1,2}/],
  ['slash-date', /\b\d{1,2}[/.]\d{1,2}[/.]\d{2,4}\b/],
  ['written-date', /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(st|nd|rd|th)?,?\s+\d{2,4}\b/i],
  ['year', /\b(19|20|21)\d{2}\b/],
  ['month-day', /\b\d{1,2}-\d{1,2}\b/],
  ['long-number', /\b\d{4,}\b/],
  ['clock-time', /\b([01]?\d|2[0-3]):[0-5]\d\b/],
  ['am-pm-time', /\b\d{1,2}\s?(am|pm)\b/i],
  ['iana-zone', /\b(Africa|America|Antarctica|Asia|Atlantic|Australia|Europe|Indian|Pacific|Etc)\/[A-Za-z_]+/],
  ['utc-offset', /\b(UTC|GMT)\s?[+-]\s?\d/i],
  ['coordinate', /-?\d{1,3}\.\d{3,}/],
  ['email', /[^\s@]+@[^\s@]+\.[^\s@]+/],
  ['birth-word', /\b(birth|born|birthday|natal|ascendant|rising)\b/i],
  ['chart-field', /["']?\b(date|time|timeZone|timezone|latitude|longitude|lat|lng|lon|calculatedAt|placements|timeKnown|email|userId|user_id|name|city|place|location)\b["']?\s*[:=]/i],
];

export function findBirthFields(text: string): string[] {
  return BIRTH_FIELD_PATTERNS.filter(([, re]) => re.test(text)).map(([name]) => name);
}

// ---------------------------------------------------------------- public prompts
// Capitalized words in the user part of a public prompt must be astrology
// vocabulary. A place, person or brand name is a proper noun this rejects,
// which is how a city ("Lisbon") is caught when no pattern could be.
const PUBLIC_PROPER_NOUNS = new Set([
  'Aries','Taurus','Gemini','Cancer','Leo','Virgo','Libra','Scorpio','Sagittarius','Capricorn','Aquarius','Pisces',
  'Sun','Moon','Mercury','Venus','Mars','Jupiter','Saturn','Uranus','Neptune','Pluto',
  'Sky','The','Write','Today','A','An','Overview','Sign','Season',
]);
export function unknownProperNouns(text: string): string[] {
  return [...new Set((text.match(/\p{Lu}[\p{L}'-]*/gu) ?? []).filter(w => !PUBLIC_PROPER_NOUNS.has(w)))];
}

export interface PublicPrompt { readonly kind: TaskKind; readonly system: string; readonly user: string }

/** The only way to build something the public lane will accept. Runs the scan at construction. */
export function publicPrompt(kind: TaskKind, system: string, user: string): PublicPrompt {
  if (classify(kind).sensitivity !== 'public') throw new PrivacyRouteError(`task ${kind} is not public`);
  if (typeof system !== 'string' || typeof user !== 'string' || !system || !user) throw new PrivacyRouteError('empty public prompt');
  const hits = findBirthFields(system + '\n' + user);
  if (hits.length) throw new PrivacyRouteError(`public prompt contains ${hits.join(',')}`);
  if (unknownProperNouns(user).length) throw new PrivacyRouteError('public prompt contains a proper noun outside the astrology vocabulary');
  const p = Object.freeze({kind, system, user});
  publicBranded.add(p);
  return p;
}

/**
 * Last check before a request leaves through `route`. Attested routes pass
 * through (they have their own fail-closed path). For every other route the
 * payload must be a branded public prompt, must not be tagged private, must be
 * a public task kind, and its full wire text must pass the birth-field scan.
 */
export function assertRoutable(route: Route, payload: unknown, wire?: string): void {
  if (ATTESTED_ROUTES.has(route)) return;
  if (route === 'local-ephemeris') throw new PrivacyRouteError('local work never calls a model');
  if (isTaggedPrivate(payload)) throw new PrivacyRouteError('private payload to non-attested route');
  if (typeof payload !== 'object' || payload === null || !publicBranded.has(payload)) throw new PrivacyRouteError('unbranded payload to non-attested route');
  const p = payload as PublicPrompt;
  if (classify(p.kind).route !== route) throw new PrivacyRouteError(`task ${p.kind} is not routed to ${route}`);
  const hits = findBirthFields(wire ?? p.system + '\n' + p.user);
  if (hits.length) throw new PrivacyRouteError(`wire body contains ${hits.join(',')}`);
  if (unknownProperNouns(p.user).length) throw new PrivacyRouteError('public prompt contains a proper noun outside the astrology vocabulary');
}

// ---------------------------------------------------------------- minimization
const MIN_PLACEMENT_KEYS = ['body', 'degree', 'longitude', 'sign'];

/**
 * Asserts a private reading payload is exactly {placements:[{body,longitude,sign,degree}], timeKnown}.
 * Throws on any extra key (birth date, time, zone, coordinates, calculatedAt, ids, free text).
 */
export function assertMinimizedChart(payload: unknown): void {
  const fail = (why: string) => { throw new PrivacyRouteError(`reading payload not minimized: ${why}`); };
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) fail('not an object');
  const obj = payload as Record<string, unknown>;
  const keys = Object.keys(obj).sort().join(',');
  if (keys !== 'placements,timeKnown') fail(`keys ${keys}`);
  if (typeof obj.timeKnown !== 'boolean') fail('timeKnown');
  if (!Array.isArray(obj.placements) || obj.placements.length < 1 || obj.placements.length > 10) fail('placements');
  for (const p of obj.placements as unknown[]) {
    if (typeof p !== 'object' || p === null) fail('placement');
    const k = Object.keys(p as object).sort().join(',');
    if (k !== MIN_PLACEMENT_KEYS.join(',')) fail(`placement keys ${k}`);
    const {body, sign, longitude, degree} = p as Record<string, unknown>;
    if (typeof body !== 'string' || typeof sign !== 'string' || typeof longitude !== 'number' || typeof degree !== 'number') fail('placement types');
  }
  // No raw birth fields anywhere in the serialized form either.
  const wire = JSON.stringify(payload);
  // ('year' is not checked here: longitudes like 10.1999 would false-positive.)
  for (const name of ['iso-date', 'clock-time', 'iana-zone', 'email'] as const) {
    const re = BIRTH_FIELD_PATTERNS.find(([n]) => n === name)![1];
    if (re.test(wire)) fail(name);
  }
}

// Raw birth/identity keys that must never survive minimization in structured
// evidence. Mirrors the product minimizer's omit list; asserted, not trusted.
export const RAW_BIRTH_KEYS: ReadonlySet<string> = new Set(['input', 'birth', 'birth_data', 'date_local', 'date_utc', 'birth_date', 'birth_time', 'latitude', 'longitude', 'lat', 'lng', 'timezone', 'timeZone', 'tz', 'place_name', 'email', 'design_datetime_utc', 'calculatedAt']);

/** Throws if any nested object (including JSON-in-string) still carries a raw birth key. */
export function assertNoRawBirthKeys(value: unknown, depth = 0): void {
  if (depth > 64) throw new PrivacyRouteError('evidence too deep to verify');
  if (Array.isArray(value)) { for (const v of value) assertNoRawBirthKeys(v, depth + 1); return; }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (RAW_BIRTH_KEYS.has(k)) throw new PrivacyRouteError(`evidence still carries ${k}`);
      assertNoRawBirthKeys(v, depth + 1);
    }
    return;
  }
  if (typeof value === 'string' && /^[\[{]/.test(value.trim())) {
    let parsed: unknown; try { parsed = JSON.parse(value); } catch { return; }
    assertNoRawBirthKeys(parsed, depth + 1);
  }
}

/** Keep only the bodies a given reading needs. Everything else is dropped before the enclave. */
export function selectPlacements<P extends {body: string}>(placements: P[], needs: readonly string[] | 'all'): P[] {
  return needs === 'all' ? placements : placements.filter(p => needs.includes(p.body));
}

// ---------------------------------------------------------------- dispatch
// One seam every model call can go through. Private kinds only ever reach the
// attested chat; its failure propagates (PrivateInferenceError), never a retry
// elsewhere. Public kinds only ever reach the public lane.

export interface ModelRouter {
  private(kind: string, req: ChatRequest): Promise<InferenceResult>;
  public(kind: TaskKind, system: string, user: string, template: string): Promise<PublicCopy>;
}
export function createModelRouter(lanes: {attested: AttestedChat; publicLane: PublicLane}): ModelRouter {
  return {
    async private(kind, req) {
      const c = classify(kind);
      if (c.sensitivity === 'local') throw new PrivacyRouteError('local work never calls a model');
      // A public kind may still go private (stricter is always allowed). The reverse never.
      tagPrivate(req);
      return lanes.attested(req);
    },
    async public(kind, system, user, template) {
      const c = classify(kind);
      if (c.sensitivity !== 'public') throw new PrivacyRouteError(`task ${kind} is ${c.sensitivity}`);
      return lanes.publicLane.generate(publicPrompt(kind, system, user), template);
    },
  };
}
