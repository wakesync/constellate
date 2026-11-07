// Permissioned circle knowledge graph. Synthetic members only, offline.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {createSqliteCircleGraph, extractThemes} from '../src/circle-graph.js';
import {createCogneeCircleGraph} from '../src/circle-graph-cognee.js';
import {createApp} from '../src/server.js';
import type {Membrane} from '../src/circles.js';
import type {Conversation} from '../src/conversation.js';

const ADA = 'Ada plans the house routine and likes to talk things through. CANARY-ADA-1';
const BRAM = 'Bram is a night owl builder who needs space. CANARY-BRAM-2';

test('unit: graph only holds approved summaries; readings store themes + provenance, never text', async () => {
  const g = createSqliteCircleGraph(new Database(':memory:'));
  await g.addShare('c1', 'ada', 'shr_a', ADA);
  await assert.rejects(g.recordReading('c1', ['ada', 'bram'], 'r0', ['communication'], ['shr_a']), /not grounded/);
  await assert.rejects(g.recordReading('c1', ['ada', 'bram'], 'r0', ['communication'], ['shr_a', 'shr_forged']), /not grounded/);
  await g.addShare('c1', 'bram', 'shr_b', BRAM);
  await g.recordReading('c1', ['bram', 'ada'], 'r1', ['communication', 'independence', 'made-up theme'], ['shr_a', 'shr_b']);
  const s = await g.snapshot('c1');
  assert.deepEqual(s.members, ['ada', 'bram']);
  assert.deepEqual(s.summaries.map(x => x.text).sort(), [ADA, BRAM].sort());
  assert.deepEqual(s.readings, [{readingId: 'r1', pair: ['ada', 'bram'], themes: ['communication', 'independence'], sources: ['shr_a', 'shr_b']}]);
  assert.ok(s.themes.some(t => t.theme === 'structure and routine' && t.members.join() === 'ada'));
  // Circles are isolated.
  assert.deepEqual((await g.snapshot('c2')).members, []);
  assert.deepEqual(await g.priorThemes('c2', 'ada', 'bram'), []);
});

test('unit: second reading for the same pair receives the first reading\'s themes, most recurring first', async () => {
  const g = createSqliteCircleGraph(new Database(':memory:'));
  await g.addShare('c1', 'ada', 'shr_a', ADA); await g.addShare('c1', 'bram', 'shr_b', BRAM); await g.addShare('c1', 'rowan', 'shr_r', 'Rowan paints and loves adventure.');
  assert.deepEqual(await g.priorThemes('c1', 'ada', 'bram'), []);
  await g.recordReading('c1', ['ada', 'bram'], 'r1', ['communication', 'conflict and drive'], ['shr_a', 'shr_b']);
  await g.recordReading('c1', ['ada', 'bram'], 'r2', ['communication'], ['shr_a', 'shr_b']);
  await g.recordReading('c1', ['ada', 'rowan'], 'r3', ['creativity'], ['shr_a', 'shr_r']);
  assert.deepEqual(await g.priorThemes('c1', 'bram', 'ada'), ['communication', 'conflict and drive']);
  assert.deepEqual(await g.priorThemes('c1', 'ada', 'rowan'), ['creativity']);
});

test('unit: revoke removes the summary, every reading that drew on it, and orphan themes', async () => {
  const g = createSqliteCircleGraph(new Database(':memory:'));
  await g.addShare('c1', 'ada', 'shr_a', ADA); await g.addShare('c1', 'bram', 'shr_b', BRAM); await g.addShare('c1', 'rowan', 'shr_r', 'Rowan paints and loves adventure.');
  await g.recordReading('c1', ['ada', 'bram'], 'r1', ['communication'], ['shr_a', 'shr_b']);
  await g.recordReading('c1', ['bram', 'rowan'], 'r2', ['creativity'], ['shr_b', 'shr_r']);
  await g.revokeShare('c1', 'ada');
  const s = await g.snapshot('c1');
  assert.ok(!JSON.stringify(s).includes('CANARY-ADA-1'));
  assert.ok(!s.members.includes('ada'));
  assert.deepEqual(s.readings.map(r => r.readingId), ['r2']);
  assert.ok(!s.themes.some(t => t.members.includes('ada')));
  assert.deepEqual(await g.priorThemes('c1', 'ada', 'bram'), []);
  await g.forgetMember('bram');
  assert.deepEqual((await g.snapshot('c1')).members, ['rowan']);
  assert.deepEqual((await g.snapshot('c1')).readings, []);
});

test('unit: theme extraction is a closed deterministic vocabulary', () => {
  assert.deepEqual(extractThemes('You two clash over chores but talk it out.'), ['communication', 'conflict and drive', 'structure and routine']);
  assert.deepEqual(extractThemes('zzz'), []);
});

// ---- end to end through the HTTP API, with a test-double Membrane
const result = {text: 'Synthetic agent turn about communication and needing space.', provider: 'tinfoil' as const, model: 'test-double', verification: 'sdk-attested' as const, generatedAt: '2000-01-01T00:00:00Z'};
async function setup(converse: Conversation) {
  const remote = new Map<string, {summary: string; peers: string[]}>();
  const membrane: Membrane = {
    async share(c, owner, summary, peers) { const id = `shr_${owner.slice(0, 8)}${remote.size}`; remote.set(id, {summary, peers}); return {id}; },
    async read(c, owner, reader, id) { const r = remote.get(id); if (!r) throw Error('denied'); return r.summary; },
    async revoke(c, owner, id) { remote.delete(id); },
  };
  const origin = 'http://localhost:3498';
  const rt = await createApp({dbPath: ':memory:', baseURL: origin, secret: 'test-secret-not-for-deployment-12345678', limits: {perUserDaily: 30, globalDaily: 60, leaseMs: 120000}, infer: async () => result, membrane, converse});
  const server = rt.app.listen(0, '127.0.0.1'); await new Promise<void>(r => server.once('listening', r)); const port = (server.address() as any).port;
  const request = (path: string, method = 'GET', body?: unknown, cookie = '') => fetch(`http://127.0.0.1:${port}/api${path}`, {method, headers: {Origin: origin, 'Content-Type': 'application/json', Cookie: cookie, Connection: 'close'}, body: body === undefined ? undefined : JSON.stringify(body)});
  const signup = async (email: string) => { const r = await request('/auth/sign-up/email', 'POST', {name: 'Synthetic', email, password: 'synthetic-password-123'}); assert.equal(r.status, 200); return r.headers.getSetCookie().map(c => c.split(';')[0]).join('; '); };
  return {...rt, request, signup, close: async () => { await new Promise<void>(r => server.close(() => r())); rt.db.close(); }};
}

test('api: graph is fed only by active shares, second interaction receives first one\'s themes, revoke drops it', async () => {
  const calls: string[] = [];
  const s = await setup(async (context) => { calls.push(context); return result; });
  try {
    const ada = await s.signup('graph-ada@example.test'), bram = await s.signup('graph-bram@example.test'), eve = await s.signup('graph-eve@example.test');
    const {circle} = await (await s.request('/circles', 'POST', {name: 'Synthetic circle'}, ada)).json(); const base = `/circles/${circle.id}`;
    await s.request('/circles/join', 'POST', {inviteCode: circle.inviteCode, consent: true}, bram);
    assert.equal((await s.request(base + '/memory', 'GET', undefined, eve)).status, 404);
    assert.equal((await s.request(base + '/shares', 'POST', {summary: ADA, consent: true}, ada)).status, 201);
    assert.equal((await s.request(base + '/shares', 'POST', {summary: BRAM, consent: true}, bram)).status, 201);
    // Private reading text never enters: create a reading + chat, they must not show up.
    await s.request('/profile', 'PUT', {date: '2000-01-01', time: '12:00', timeZone: 'UTC', latitude: null, longitude: null, consent: true}, ada);
    await s.request('/readings', 'POST', {}, ada);
    const m0 = (await (await s.request(base + '/memory', 'GET', undefined, ada)).json()).memory;
    assert.equal(m0.summaries.length, 2);
    assert.equal(m0.summaries.find((x: any) => x.text)?.text, ADA); // own text only
    assert.ok(!JSON.stringify(m0).includes('CANARY-BRAM-2'));
    assert.ok(!JSON.stringify(m0).includes(result.text));

    const first = await (await s.request(base + '/interact', 'POST', {message: 'Where do we meet?'}, ada)).json();
    assert.deepEqual(first.memory.priorThemes, []);
    assert.ok(first.memory.themes.includes('communication'));
    assert.ok(!calls[0]!.includes('priorCircleThemes'));
    const second = await (await s.request(base + '/interact', 'POST', {message: 'And now?'}, bram)).json();
    assert.deepEqual(new Set(second.memory.priorThemes), new Set(first.memory.themes));
    assert.ok(JSON.parse(calls[2]!).priorCircleThemes.includes('communication'));

    assert.equal((await s.request(base + '/shares/me', 'DELETE', undefined, ada)).status, 204);
    const m1 = (await (await s.request(base + '/memory', 'GET', undefined, bram)).json()).memory;
    assert.equal(m1.members.length, 1);
    assert.equal(m1.summaries.length, 1);
    assert.equal(m1.readings.length, 0);
    assert.ok(!JSON.stringify(m1).includes('CANARY-ADA-1'));
  } finally { await s.close(); }
});

test('cognee adapter: sends share ids not text, signs per member, fails closed', async () => {
  const seen: {url: string; init: RequestInit}[] = [];
  let status = 200;
  const g = createCogneeCircleGraph({origin: 'https://membrane.example.test', secret: 'x'.repeat(32), namespace: 'cst', fetcher: async () => async (url, init) => { seen.push({url, init}); return new Response(JSON.stringify({ok: true, themes: ['communication']}), {status}); }});
  await g.addShare('c1', 'ada', 'shr_abcdefgh', ADA);
  assert.equal(seen[0]!.url, 'https://membrane.example.test/circle-graph/cst%3Ac1/summaries');
  assert.ok(!String(seen[0]!.init.body).includes('CANARY'));
  assert.equal((seen[0]!.init.headers as any)['X-Swarm-User'], 'cst:ada');
  assert.deepEqual(await g.priorThemes('c1', 'ada', 'bram'), ['communication']);
  status = 503; await assert.rejects(g.priorThemes('c1', 'ada', 'bram'));
  assert.throws(() => createCogneeCircleGraph({origin: 'https://x', secret: 'short', namespace: 'cst', fetcher: async () => fetch}));
});
