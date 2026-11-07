import { TinfoilAI } from 'tinfoil';
import type { Chart, InferenceResult } from './contracts.js';
import { assertMinimizedChart, tagPrivate } from './router.js';

// Generic attested-chat seam. Framework-agnostic (Express, Hono, Workers): no
// node:crypto, config is injectable. Uses the hosted Tinfoil SDK router only.
// No baseURL / endpoint override is accepted, so a known-unavailable custom
// endpoint (e.g. our H200 /v1/chat/completions) can never be wired in by config,
// and nothing ever falls back to an unattested provider.

export const DEADLINE_MS = 60_000;
export const SDK_TIMEOUT_MS = 45_000;
export const MAX_OUTPUT = 12_000;
export const MAX_SYSTEM = 8_000;
export const MAX_MESSAGES = 41; // system context + 20 turns
export const MAX_MESSAGE = 16_000;
export const MAX_TOKENS_CAP = 2_000;

const SIGNS = ['Aries','Taurus','Gemini','Cancer','Leo','Virgo','Libra','Scorpio','Sagittarius','Capricorn','Aquarius','Pisces'];
const BODIES = ['Sun','Moon','Mercury','Venus','Mars','Jupiter','Saturn','Uranus','Neptune','Pluto'];
export const DISCLAIMER = 'Astrology is an interpretive practice for reflection and entertainment, not scientifically validated prediction or medical, financial, or diagnostic advice.';
const SYSTEM = `${DISCLAIMER} Write a warm reflective astrology reading of 350-550 words from only the supplied placements. Interpretations are invitations, not facts about a person. Never diagnose, predict events, prescribe treatment, recommend investments, or offer medical, financial or relationship directives. Never invent houses, aspects, ascendant, or other placements. If timeKnown is false, explain all placements are noon estimates, the Moon can vary substantially and signs near boundaries are uncertain. Include three grounded reflection questions. Plain text, short paragraphs.`;

export class PrivateInferenceError extends Error {
  constructor() { super('Private inference is unavailable. Please try again later.'); this.name = 'PrivateInferenceError'; }
}

export interface ProviderConfig { apiKey: string; model: string }
export type ConfigSource = () => Partial<ProviderConfig> | undefined;
const processEnv: ConfigSource = () => ({apiKey: globalThis.process?.env?.TINFOIL_API_KEY, model: globalThis.process?.env?.TINFOIL_MODEL});

export function validConfig(c: Partial<ProviderConfig> | undefined): ProviderConfig | null {
  const key = c?.apiKey?.trim();
  // Management credentials must never be sent to an inference endpoint.
  if (!key || key.startsWith('admin_') || /\s/.test(key) || key.length > 512) return null;
  if (!/^[a-zA-Z0-9._/-]{1,150}$/.test(c?.model ?? '')) return null;
  return {apiKey: key, model: c!.model!};
}
export function providerConfigured(source: ConfigSource = processEnv): boolean { return validConfig(source()) !== null; }

// Narrow seam for offline tests. Production always constructs the attested SDK client.
export interface AttestedClient {
  ready(): Promise<void>;
  getVerificationDocument(): Promise<{securityVerified: boolean}>;
  chat: {completions: {create(body: TinfoilAI.Chat.ChatCompletionCreateParamsNonStreaming, options: {signal: AbortSignal}): Promise<{choices: {message: {content: string | null}; finish_reason?: string}[]}>}};
}
export type ClientOptions = {apiKey: string; timeout: number; maxRetries: number; userCacheSecret: string; transport: 'ehbp'};
export type Factory = (options: ClientOptions) => AttestedClient;

export interface ChatMessage { role: 'user' | 'assistant'; content: string }
export interface ChatRequest { system: string; messages: ChatMessage[]; maxTokens?: number }
export type AttestedChat = (req: ChatRequest) => Promise<InferenceResult>;

function cacheSecret(): string {
  const b = new Uint8Array(32); globalThis.crypto.getRandomValues(b);
  return Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
}
function validRequest(r: ChatRequest): boolean {
  if (!r || typeof r.system !== 'string' || r.system.length < 1 || r.system.length > MAX_SYSTEM) return false;
  if (!Array.isArray(r.messages) || r.messages.length < 1 || r.messages.length > MAX_MESSAGES) return false;
  if (r.messages.some(m => !m || !['user','assistant'].includes(m.role) || typeof m.content !== 'string' || m.content.length < 1 || m.content.length > MAX_MESSAGE)) return false;
  if (r.messages.at(-1)!.role !== 'user') return false;
  if (r.maxTokens !== undefined && (!Number.isInteger(r.maxTokens) || r.maxTokens < 1 || r.maxTokens > MAX_TOKENS_CAP)) return false;
  return true;
}

export function createAttestedChat(opts: {factory?: Factory; deadlineMs?: number; config?: ConfigSource} = {}): AttestedChat {
  const factory = opts.factory ?? (o => new TinfoilAI(o) as unknown as AttestedClient);
  const deadlineMs = opts.deadlineMs ?? DEADLINE_MS;
  const source = opts.config ?? processEnv;
  return async (req) => {
    // Anything offered to the enclave is private from here on: the router refuses
    // this exact object on every non-attested lane, even after a failure here.
    if (req && typeof req === 'object') tagPrivate(req);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    try {
      const cfg = validConfig(source());
      if (!cfg || !validRequest(req)) throw new PrivateInferenceError();
      // Copy only role/content; never spread caller objects across the boundary.
      const messages = [{role:'system' as const, content:req.system}, ...req.messages.map(m => ({role:m.role, content:m.content}))];
      const client = factory({apiKey:cfg.apiKey, timeout:SDK_TIMEOUT_MS, maxRetries:0, userCacheSecret:cacheSecret(), transport:'ehbp'});
      const work = async (): Promise<InferenceResult> => {
        await client.ready();
        if (controller.signal.aborted) throw new PrivateInferenceError();
        if ((await client.getVerificationDocument()).securityVerified !== true) throw new PrivateInferenceError();
        if (controller.signal.aborted) throw new PrivateInferenceError();
        const response = await client.chat.completions.create({model:cfg.model, max_tokens:req.maxTokens ?? 1000, stream:false, messages}, {signal:controller.signal});
        const choice = response.choices[0];
        const text = choice?.message.content?.trim();
        if (!text || text.length > MAX_OUTPUT || choice.finish_reason !== 'stop') throw new PrivateInferenceError();
        // Attestation proves the endpoint, not model quality. Broken GPU output
        // (for example repeated punctuation) is never a successful reply.
        const letters = text.match(/\p{L}/gu)?.length ?? 0;
        if (letters < 10 || letters / text.length < 0.4 || /(.)\1{39}/u.test(text)) throw new PrivateInferenceError();
        // SDK attestation is checked, not inferred from a model's own text.
        return {text, provider:'tinfoil', model:cfg.model, verification:'sdk-attested', generatedAt:new Date().toISOString()};
      };
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {controller.abort(); reject(new PrivateInferenceError());}, deadlineMs);
      });
      return await Promise.race([work(), deadline]);
    } catch {
      // Provider errors may contain request bodies, endpoints or credentials.
      throw new PrivateInferenceError();
    } finally { if (timer) clearTimeout(timer); }
  };
}

function minimalChart(chart: Chart) {
  if (typeof chart.timeKnown !== 'boolean' || !Array.isArray(chart.placements) || chart.placements.length < 1 || chart.placements.length > 10) throw new PrivateInferenceError();
  const seen = new Set<string>();
  const placements = chart.placements.map(p => {
    if (!BODIES.includes(p.body) || !SIGNS.includes(p.sign) || seen.has(p.body) || !Number.isFinite(p.longitude) || p.longitude < 0 || p.longitude >= 360 || !Number.isFinite(p.degree) || p.degree < 0 || p.degree >= 30) throw new PrivateInferenceError();
    seen.add(p.body);
    // Never spread caller data: extra properties can contain birth details or identifiers.
    return {body:p.body, longitude:p.longitude, sign:p.sign, degree:p.degree};
  });
  // calculatedAt is the birth instant in the chart implementation. Never send it,
  // or free-form limitations/version strings, across the inference boundary.
  return {placements, timeKnown:chart.timeKnown};
}

export function createReadingGenerator(factory?: Factory, deadlineMs = DEADLINE_MS, config?: ConfigSource) {
  const chat = createAttestedChat({factory, deadlineMs, config});
  return async (chart: Chart): Promise<InferenceResult> => {
    let payload; try { payload = minimalChart(chart); assertMinimizedChart(payload); } catch { throw new PrivateInferenceError(); }
    // Tagged so the router refuses it on any non-attested lane, whatever its content.
    const r = await chat(tagPrivate({system:SYSTEM, maxTokens:1200, messages:[{role:'user', content:JSON.stringify(payload)}]}));
    return {...r, text:`${DISCLAIMER}\n\n${r.text}`};
  };
}
export const generateReading = createReadingGenerator();
