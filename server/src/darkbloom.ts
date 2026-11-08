import {assertRoutable, findBirthFields, PrivacyRouteError, type PublicPrompt} from './router.js';

// Public lane. Darkbloom's OpenAI-compatible consumer API, used only for copy
// that contains zero personal data. Every request passes assertRoutable() with
// the exact wire body before fetch is called.
//
// Keyless by default: without DARKBLOOM_API_KEY + DARKBLOOM_MODEL (or on any
// provider error) the caller gets the deterministic template it supplied,
// typed source:'template'. Falling back is allowed here and only here, because
// nothing in this lane is private. Private work never reaches this file.

export const DARKBLOOM_BASE_URL = 'https://api.darkbloom.dev/v1';
export const PUBLIC_TIMEOUT_MS = 20_000;
export const PUBLIC_MAX_OUTPUT = 4_000;
export const PUBLIC_MAX_TOKENS = 500;

export interface PublicLaneConfig { apiKey: string; model: string }
export type PublicConfigSource = () => Partial<PublicLaneConfig> | undefined;
const processEnv: PublicConfigSource = () => ({apiKey: globalThis.process?.env?.DARKBLOOM_API_KEY, model: globalThis.process?.env?.DARKBLOOM_MODEL});

export function validPublicConfig(c: Partial<PublicLaneConfig> | undefined): PublicLaneConfig | null {
  const key = c?.apiKey?.trim();
  if (!key || /\s/.test(key) || key.length > 512) return null;
  if (!/^[a-zA-Z0-9._:/-]{1,150}$/.test(c?.model ?? '')) return null;
  return {apiKey: key, model: c!.model!};
}
export function publicLaneConfigured(source: PublicConfigSource = processEnv): boolean { return validPublicConfig(source()) !== null; }

export type PublicCopy =
  | {sensitivity: 'public'; route: 'darkbloom'; source: 'darkbloom'; model: string; text: string; generatedAt: string}
  | {sensitivity: 'public'; route: 'darkbloom'; source: 'template'; model: null; text: string; generatedAt: string; reason: 'unconfigured' | 'provider-error' | 'budget'};

export interface PublicLane {
  generate(prompt: PublicPrompt, template: string): Promise<PublicCopy>;
  configured(): boolean;
}

export function createPublicLane(opts: {fetch?: typeof fetch; config?: PublicConfigSource; timeoutMs?: number; now?: () => number; dailyCap?: number} = {}): PublicLane {
  const doFetch = opts.fetch ?? globalThis.fetch;
  const source = opts.config ?? processEnv;
  const timeoutMs = opts.timeoutMs ?? PUBLIC_TIMEOUT_MS;
  const now = opts.now ?? Date.now;
  const dailyCap = opts.dailyCap ?? 50;
  let budgetDay = '', used = 0;
  const template = (text: string, reason: 'unconfigured' | 'provider-error' | 'budget'): PublicCopy =>
    ({sensitivity: 'public', route: 'darkbloom', source: 'template', model: null, text, generatedAt: new Date(now()).toISOString(), reason});
  return {
    configured: () => validPublicConfig(source()) !== null,
    async generate(prompt, fallback) {
      // The fallback is public copy too. Check it with the same scan so a template
      // can never become a side channel either.
      assertRoutable('darkbloom', prompt);
      const fallbackHits = findBirthFields(fallback);
      if (fallbackHits.length) throw new PrivacyRouteError(`public template contains ${fallbackHits.join(',')}`);
      const cfg = validPublicConfig(source());
      if (!cfg) return template(fallback, 'unconfigured');
      const day = new Date(now()).toISOString().slice(0, 10);
      if (day !== budgetDay) { budgetDay = day; used = 0; }
      if (used >= dailyCap) return template(fallback, 'budget');
      // Build the exact body, then guard the exact bytes that will be sent.
      const messages = [{role: 'system', content: prompt.system}, {role: 'user', content: prompt.user}];
      const body = JSON.stringify({model: cfg.model, stream: false, max_tokens: PUBLIC_MAX_TOKENS, messages});
      // Scan the serialized messages that will be on the wire. The model id is
      // operator config (validated above) and may contain digits like a version.
      assertRoutable('darkbloom', prompt, JSON.stringify(messages));
      if (!body.endsWith(JSON.stringify(messages) + '}')) throw new PrivacyRouteError('wire body mismatch');
      used++;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await doFetch(`${DARKBLOOM_BASE_URL}/chat/completions`, {
          method: 'POST', redirect: 'manual', signal: controller.signal, body,
          headers: {'Authorization': `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json'},
        });
        // redirect:'manual' (portable across Node and Workers): a 3xx is a failure, never followed.
        if (!res.ok || res.status >= 300) return template(fallback, 'provider-error');
        const raw = await res.text();
        if (raw.length > 64_000) return template(fallback, 'provider-error');
        const json = JSON.parse(raw) as {choices?: {message?: {content?: unknown}; finish_reason?: unknown}[]};
        const choice = json.choices?.[0];
        const text = typeof choice?.message?.content === 'string' ? choice.message.content.trim() : '';
        const letters = text.match(/\p{L}/gu)?.length ?? 0;
        if (!text || text.length > PUBLIC_MAX_OUTPUT || choice?.finish_reason !== 'stop' || letters < 10 || letters / text.length < 0.4) return template(fallback, 'provider-error');
        return {sensitivity: 'public', route: 'darkbloom', source: 'darkbloom', model: cfg.model, text, generatedAt: new Date(now()).toISOString()};
      } catch (e) {
        if (e instanceof PrivacyRouteError) throw e;
        // Provider errors may echo request bodies or credentials. Never surface them.
        return template(fallback, 'provider-error');
      } finally { clearTimeout(timer); }
    },
  };
}
