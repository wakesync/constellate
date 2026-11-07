// Cognee-backed CircleGraph: talks to the permissioned circle graph routes in
// membrane/app/circle_graph.py (self-hosted cognee inside the Membrane enclave).
//
// Same identity + transport as membrane-remote.ts: per-user HMAC signature and
// an attested fetcher (tinfoil SecureClient in production, injectable in tests).
// The enclave, not this adapter, enforces the rules: it reads summary text from
// the exact-share table by share id (so only approved, still-active shares can
// enter), purges on revoke, and only answers pair members.
//
// Fails closed: any remote error throws. circles.ts treats graph failures as
// "no prior themes" for reads and never blocks a revoke on the graph.
import {createHmac} from 'node:crypto';
import type {CircleGraph, CircleGraphSnapshot} from './circle-graph.js';

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;
export interface CogneeCircleGraphOptions {
  origin: string;
  secret: string;
  namespace: string;
  fetcher: () => Promise<Fetcher>;
  timeoutMs?: number;
}
export class CircleGraphError extends Error { constructor() { super('Circle graph unavailable'); this.name = 'CircleGraphError'; } }

const ID = /^[A-Za-z0-9_.:@-]{1,64}$/;

export function createCogneeCircleGraph(o: CogneeCircleGraphOptions): CircleGraph {
  if (!/^https?:\/\/[^/]+$/.test(o.origin) || !o.secret || o.secret.length < 16 || !/^[a-z0-9]{1,8}$/.test(o.namespace)) throw new Error('Invalid circle graph configuration');
  const uid = (u: string) => { const v = `${o.namespace}:${u}`; if (!ID.test(v)) throw new CircleGraphError(); return v; };
  const ctx = (c: string) => { const v = `${o.namespace}:${c}`; if (!/^[A-Za-z0-9_.:@-]{1,96}$/.test(v)) throw new CircleGraphError(); return encodeURIComponent(v); };
  const sign = (user: string) => { const ts = String(Math.floor(Date.now() / 1000)); return {'X-Swarm-User': user, 'X-Swarm-Ts': ts, 'X-Swarm-Sig': createHmac('sha256', o.secret).update(`${user}.${ts}`).digest('hex')}; };
  const call = async (as: string, method: string, path: string, body?: unknown) => {
    let r: Response;
    try {
      const f = await o.fetcher();
      r = await f(o.origin + path, {method, headers: {...sign(as), ...(body ? {'Content-Type': 'application/json'} : {})}, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(o.timeoutMs ?? 20_000)});
    } catch { throw new CircleGraphError(); }
    if (r.status !== 200) throw new CircleGraphError();
    return r.json().catch(() => { throw new CircleGraphError(); });
  };
  return {
    async addShare(circleId, memberId, shareId) {
      // Text is NOT sent: the enclave reads it from the approved exact share.
      await call(uid(memberId), 'POST', `/circle-graph/${ctx(circleId)}/summaries`, {share_id: shareId});
    },
    async revokeShare(circleId, memberId) {
      await call(uid(memberId), 'DELETE', `/circle-graph/${ctx(circleId)}/members/${encodeURIComponent(uid(memberId))}`);
    },
    async recordReading(circleId, pair, readingId, themes, sources) {
      await call(uid(pair[0]), 'POST', `/circle-graph/${ctx(circleId)}/readings`, {reading_id: readingId, pair: pair.map(uid), themes, sources});
    },
    async priorThemes(circleId, a, b, limit = 5) {
      const q = new URLSearchParams({a: uid(a), b: uid(b), limit: String(limit)});
      const j = await call(uid(a), 'GET', `/circle-graph/${ctx(circleId)}/prior-themes?${q}`);
      if (!Array.isArray(j?.themes) || j.themes.some((t: unknown) => typeof t !== 'string')) throw new CircleGraphError();
      return j.themes;
    },
    async snapshot(circleId) {
      throw Object.assign(new CircleGraphError(), {hint: `snapshot is per-caller on the enclave: GET /circle-graph/${circleId}`});
    },
    async forgetMember() {
      // Per-circle revokeShare is called for every circle by circles.ts.revokeUser,
      // and the enclave also purges lazily once the exact shares are deleted.
    },
  } satisfies CircleGraph as CircleGraph;
}

/** Snapshot as seen by one member (the enclave filters by that member's grants). */
export async function cogneeSnapshotAs(o: CogneeCircleGraphOptions, circleId: string, memberId: string): Promise<CircleGraphSnapshot> {
  const f = await o.fetcher();
  const user = `${o.namespace}:${memberId}`; const ts = String(Math.floor(Date.now() / 1000));
  const r = await f(`${o.origin}/circle-graph/${encodeURIComponent(`${o.namespace}:${circleId}`)}`, {method: 'GET', headers: {'X-Swarm-User': user, 'X-Swarm-Ts': ts, 'X-Swarm-Sig': createHmac('sha256', o.secret).update(`${user}.${ts}`).digest('hex')}});
  if (r.status !== 200) throw new CircleGraphError();
  const j = await r.json();
  const strip = (v: string) => v.startsWith(o.namespace + ':') ? v.slice(o.namespace.length + 1) : v;
  return {circleId, members: j.members.map(strip), summaries: j.summaries.map((s: any) => ({shareId: s.shareId, memberId: strip(s.memberId), text: s.text ?? '', themes: s.themes})),
    themes: j.themes.map((t: any) => ({...t, members: t.members.map(strip)})), readings: j.readings.map((r: any) => ({...r, pair: r.pair.map(strip)}))};
}
