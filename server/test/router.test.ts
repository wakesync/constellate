import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ROUTING_TABLE, classify, assertRoutable, publicPrompt, findBirthFields, assertMinimizedChart, tagPrivate, createModelRouter, PrivacyRouteError, selectPlacements} from '../src/router.js';
import {createPublicLane, DARKBLOOM_BASE_URL, type PublicLane} from '../src/darkbloom.js';
import {createTransitService, skyFor, transitPromptText, transitTemplate} from '../src/transits.js';
import {createReadingGenerator, createAttestedChat, PrivateInferenceError, type AttestedClient} from '../src/inference.js';
import {createConversationGenerator} from '../src/conversation.js';
import {calculateChart} from '../src/chart.js';
import {createApp} from '../src/server.js';

// All offline. Providers are fakes; fetch is a recorder. Birth data is synthetic.
const birth = {date: '1987-10-02', time: '05:17', timeZone: 'Europe/Lisbon', latitude: 38.7223, longitude: -9.1393, consent: true as const};
const BIRTH_NEEDLES = ['1987', '10-02', '05:17', 'Europe/Lisbon', 'Lisbon', '38.7223', '-9.1393', 'calculatedAt', 'timeZone', 'latitude'];
const ok = 'A grounded synthetic reflection about the current sky.';
const pubCfg = () => ({apiKey: 'synthetic-public-key', model: 'synthetic/public-model'});
function recorder(content = ok, status = 200) {
  const calls: {url: string; init: RequestInit}[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({url, init});
    return new Response(JSON.stringify({choices: [{message: {content}, finish_reason: 'stop'}]}), {status});
  }) as unknown as typeof fetch;
  return {calls, fetch: f};
}
function attestedClient(log: unknown[] = []): AttestedClient {
  return {ready: async () => {}, getVerificationDocument: async () => ({securityVerified: true}),
    chat: {completions: {create: async b => { log.push(b); return {choices: [{message: {content: ok}, finish_reason: 'stop'}]}; }}}};
}

test('routing table', async t => {
  await t.test('private kinds go to the enclave, public kinds to darkbloom, chart math stays local', () => {
    for (const k of ['reading', 'reading-chat', 'synastry', 'agent-memory', 'agent-exchange']) assert.deepEqual(classify(k), {kind: k, sensitivity: 'private', route: 'tinfoil-enclave'});
    for (const k of ['daily-transits', 'sign-overview']) assert.deepEqual(classify(k), {kind: k, sensitivity: 'public', route: 'darkbloom'});
    assert.deepEqual(classify('chart-math'), {kind: 'chart-math', sensitivity: 'local', route: 'local-ephemeris'});
  });
  await t.test('unknown, prototype and lookalike kinds default to private', () => {
    for (const k of ['', 'transits', 'Daily-Transits', '__proto__', 'constructor', 'toString', 'hasOwnProperty', 'daily-transits ']) assert.equal(classify(k).route, 'tinfoil-enclave', k);
  });
  await t.test('every public row is darkbloom, every private row is attested, table is frozen', () => {
    for (const [k, v] of Object.entries(ROUTING_TABLE)) {
      if (v.sensitivity === 'private') assert.equal(v.route, 'tinfoil-enclave', k);
      if (v.sensitivity === 'public') assert.equal(v.route, 'darkbloom', k);
    }
    assert.ok(Object.isFrozen(ROUTING_TABLE));
  });
});

test('no-fallback guard', async t => {
  await t.test('private-tagged payloads never pass a non-attested route', () => {
    const req = tagPrivate({system: 'sys', messages: [{role: 'user', content: 'Sun in Aries'}]});
    assert.throws(() => assertRoutable('darkbloom', req), PrivacyRouteError);
    assert.doesNotThrow(() => assertRoutable('tinfoil-enclave', req));
  });
  await t.test('unbranded payloads, even innocuous ones, never pass a non-attested route', () => {
    for (const p of [{kind: 'daily-transits', system: 'a', user: 'b'}, 'plain string', null, undefined, 42]) assert.throws(() => assertRoutable('darkbloom', p), PrivacyRouteError);
  });
  await t.test('the local lane never calls a model', () => {
    assert.throws(() => assertRoutable('local-ephemeris', publicPrompt('daily-transits', 'sys', 'Sun 10 degrees Aries')), PrivacyRouteError);
  });
  await t.test('public prompts for private kinds cannot be built', () => {
    for (const k of ['reading', 'reading-chat', 'agent-memory', 'chart-math'] as const) assert.throws(() => publicPrompt(k, 's', 'u'), PrivacyRouteError);
  });
  await t.test('private failure propagates; public lane is never touched', async () => {
    const pub = recorder();
    const lane = createPublicLane({fetch: pub.fetch, config: pubCfg});
    let publicCalls = 0;
    const spy: PublicLane = {configured: () => true, generate: async (...a) => { publicCalls++; return lane.generate(...a); }};
    const failing = createAttestedChat({config: () => ({apiKey: 'synthetic-key', model: 'm'}), factory: () => ({...attestedClient(), getVerificationDocument: async () => ({securityVerified: false})})});
    const router = createModelRouter({attested: failing, publicLane: spy});
    await assert.rejects(router.private('reading', {system: 's', messages: [{role: 'user', content: 'Sun in Aries'}]}), PrivateInferenceError);
    // Unknown kind is private too, and fails the same way.
    await assert.rejects(router.private('something-new', {system: 's', messages: [{role: 'user', content: 'x'}]}), PrivateInferenceError);
    assert.equal(publicCalls, 0); assert.equal(pub.calls.length, 0);
  });
  await t.test('router refuses to send private kinds or local work down the public lane', async () => {
    const pub = recorder();
    const router = createModelRouter({attested: async () => { throw Error('unused'); }, publicLane: createPublicLane({fetch: pub.fetch, config: pubCfg})});
    for (const k of ['reading', 'agent-memory', 'chart-math', 'unknown-kind']) await assert.rejects(router.public(k as never, 's', 'Sun 10 degrees Aries', 't'), PrivacyRouteError);
    await assert.rejects(router.private('chart-math', {system: 's', messages: [{role: 'user', content: 'x'}]}), PrivacyRouteError);
    assert.equal(pub.calls.length, 0);
  });
  await t.test('a request offered to the enclave is private forever, even after the enclave fails', async () => {
    const req = {system: 's', messages: [{role: 'user' as const, content: 'Sun in Aries'}]};
    const failing = createAttestedChat({config: () => undefined});
    await assert.rejects(failing(req), PrivateInferenceError);
    assert.throws(() => assertRoutable('darkbloom', req), /private payload/);
  });
  await t.test('real reading and chat generators produce enclave-only requests', async () => {
    const sdk: unknown[] = [];
    await createReadingGenerator(() => attestedClient(sdk), 1000, () => ({apiKey: 'synthetic-key', model: 'm'}))(calculateChart(birth));
    await createConversationGenerator(() => attestedClient(sdk), 1000, () => ({apiKey: 'synthetic-key', model: 'm'}))('reading text', [{role: 'user', content: 'hi'}]);
    assert.equal(sdk.length, 2);
  });
});

test('minimization', async t => {
  await t.test('reading payload is exactly placements + timeKnown, nothing from birth input', async () => {
    const bodies: {messages: {content: string}[]}[] = [];
    const gen = createReadingGenerator(() => attestedClient(bodies as unknown[]), 1000, () => ({apiKey: 'synthetic-key', model: 'm'}));
    await gen(calculateChart(birth));
    const user = JSON.parse(bodies[0]!.messages[1]!.content);
    assert.deepEqual(Object.keys(user).sort(), ['placements', 'timeKnown']);
    for (const p of user.placements) assert.deepEqual(Object.keys(p).sort(), ['body', 'degree', 'longitude', 'sign']);
    const wire = JSON.stringify(bodies[0]);
    for (const needle of BIRTH_NEEDLES) assert.ok(!wire.includes(needle), `leaked ${needle}`);
  });
  await t.test('assertMinimizedChart rejects any extra field', () => {
    const base = {placements: [{body: 'Sun', longitude: 10, sign: 'Aries', degree: 10}], timeKnown: true};
    assert.doesNotThrow(() => assertMinimizedChart(base));
    for (const bad of [
      {...base, date: '1987-10-02'}, {...base, calculatedAt: '1987-10-02T04:17:00Z'}, {...base, timeZone: 'Europe/Lisbon'},
      {...base, placements: [{...base.placements[0], latitude: 38.7}]}, {placements: base.placements},
      {...base, placements: [{...base.placements[0], sign: '1987-10-02'}]}, {...base, placements: [{...base.placements[0], body: 'x@y.example'}]},
      [], null, 'str',
    ]) assert.throws(() => assertMinimizedChart(bad), PrivacyRouteError);
  });
  await t.test('selectPlacements keeps only what a reading needs', () => {
    const c = calculateChart(birth);
    assert.deepEqual(selectPlacements(c.placements, ['Sun', 'Moon', 'Venus']).map(p => p.body), ['Sun', 'Moon', 'Venus']);
    assert.equal(selectPlacements(c.placements, 'all').length, 10);
  });
});

test('leak regression: birth fields never reach public prompts', async t => {
  await t.test('scanner catches dates, times, zones, coordinates, emails and chart keys', () => {
    for (const s of ['born 1987', '1987-10-02', '02/10/1987', 'October 2, 1987', 'at 05:17', '6am', 'Europe/Lisbon', 'UTC+1', '38.7223', 'a@b.example', 'my birthday', '"latitude": 3', 'calculatedAt: x', 'Rising sign', JSON.stringify(birth), JSON.stringify(calculateChart(birth))])
      assert.ok(findBirthFields(s).length > 0, s);
  });
  await t.test('publicPrompt refuses any prompt carrying birth fields', () => {
    for (const leak of BIRTH_NEEDLES.slice(0, 7).concat(JSON.stringify(birth), JSON.stringify(calculateChart(birth))))
      assert.throws(() => publicPrompt('daily-transits', 'sys', `Sun 10 degrees Aries. ${leak}`), PrivacyRouteError, leak);
  });
  await t.test('today prompt is sign names and whole degrees only, for every day of a sample year', () => {
    for (let d = 0; d < 366; d += 7) {
      const day = new Date(Date.UTC(2026, 0, 1) + d * 86_400_000).toISOString().slice(0, 10);
      const sky = skyFor(day);
      const text = transitPromptText(sky);
      assert.deepEqual(findBirthFields(text), [], text);
      assert.deepEqual(findBirthFields(transitTemplate(sky)), [], day);
      assert.ok(!text.includes(day.slice(0, 4)) && !text.includes(day));
      assert.match(text, /^Sky positions: ([A-Z][a-z]+ \d{1,2} degrees [A-Z][a-z]+; )+[A-Z][a-z]+ \d{1,2} degrees [A-Z][a-z]+\. The Moon is a [a-z ]+\. Write today's general sky note\.$/);
    }
  });
  await t.test('exact darkbloom wire body is checked, has no user data, and goes to the documented endpoint', async () => {
    const pub = recorder();
    const svc = createTransitService(createPublicLane({fetch: pub.fetch, config: pubCfg}), () => Date.parse('2026-11-07T15:00:00Z'));
    const r = await svc.today();
    assert.equal(r.copy.source, 'darkbloom'); assert.equal(r.copy.text, ok);
    assert.equal(pub.calls.length, 1);
    const {url, init} = pub.calls[0]!;
    assert.equal(url, `${DARKBLOOM_BASE_URL}/chat/completions`);
    assert.equal(DARKBLOOM_BASE_URL, 'https://api.darkbloom.dev/v1');
    assert.equal(init.redirect, 'error');
    const body = String(init.body);
    assert.deepEqual(findBirthFields(JSON.parse(body).messages.map((m: {content: string}) => m.content).join('\n')), []);
    for (const needle of [...BIRTH_NEEDLES, '2026', '11-07', 'cookie', 'session']) assert.ok(!body.toLowerCase().includes(needle.toLowerCase()), needle);
  });
  await t.test('city and person names are refused even without a pattern hit', () => {
    for (const leak of ['Sun 10 degrees Aries near Lisbon', 'Sun 10 degrees Aries for Rowan']) assert.throws(() => publicPrompt('daily-transits', 's', leak), PrivacyRouteError, leak);
  });
  await t.test('versioned model ids do not trip the wire guard', async () => {
    const pub = recorder();
    const lane = createPublicLane({fetch: pub.fetch, config: () => ({apiKey: 'synthetic-public-key', model: 'vendor/model-235b-2507'})});
    assert.equal((await lane.generate(publicPrompt('sign-overview', 's', 'Aries overview'), 't')).source, 'darkbloom');
    assert.equal(JSON.parse(String(pub.calls[0]!.init.body)).model, 'vendor/model-235b-2507');
  });
  await t.test('a template carrying birth data is refused too', async () => {
    const lane = createPublicLane({config: () => undefined});
    await assert.rejects(lane.generate(publicPrompt('daily-transits', 's', 'Sun 10 degrees Aries'), 'born 1987-10-02'), PrivacyRouteError);
  });
});

test('public lane', async t => {
  await t.test('keyless: deterministic typed template, no network', async () => {
    let called = false;
    const lane = createPublicLane({fetch: (async () => { called = true; throw Error(); }) as unknown as typeof fetch, config: () => ({})});
    assert.equal(lane.configured(), false);
    const svc = createTransitService(lane, () => Date.parse('2026-11-07T15:00:00Z'));
    const a = await svc.today(), b = await svc.today();
    assert.equal(a.copy.source, 'template'); assert.equal(a.copy.model, null);
    assert.equal(a.copy.source === 'template' && a.copy.reason, 'unconfigured');
    assert.equal(a.copy.text, transitTemplate(skyFor('2026-11-07')));
    assert.equal(a, b); assert.equal(called, false);
  });
  await t.test('provider errors degrade to template and are not cached for the day', async () => {
    let n = 0;
    const flaky = (async () => { n++; if (n === 1) return new Response('upstream echo synthetic-public-key', {status: 500}); return new Response(JSON.stringify({choices: [{message: {content: ok}, finish_reason: 'stop'}]})); }) as unknown as typeof fetch;
    const svc = createTransitService(createPublicLane({fetch: flaky, config: pubCfg}), () => Date.parse('2026-11-07T15:00:00Z'));
    const first = await svc.today();
    assert.equal(first.copy.source, 'template'); assert.ok(!first.copy.text.includes('synthetic-public-key'));
    await new Promise(r => setImmediate(r));
    assert.equal((await svc.today()).copy.source, 'darkbloom');
  });
  await t.test('bad outputs, thrown fetch and daily cap fall back', async () => {
    for (const content of ['', '!'.repeat(500), 'x'.repeat(5000)]) {
      const svc = createTransitService(createPublicLane({fetch: recorder(content).fetch, config: pubCfg}), () => 0);
      assert.equal((await svc.today()).copy.source, 'template', content.slice(0, 5));
    }
    const thrower = createPublicLane({fetch: (async () => { throw Error('network'); }) as unknown as typeof fetch, config: pubCfg});
    assert.equal((await thrower.generate(publicPrompt('daily-transits', 's', 'Sun 10 degrees Aries'), 't')).source, 'template');
    const capped = createPublicLane({fetch: recorder().fetch, config: pubCfg, dailyCap: 1});
    const p = publicPrompt('sign-overview', 's', 'Aries overview');
    assert.equal((await capped.generate(p, 't')).source, 'darkbloom');
    const second = await capped.generate(p, 't');
    assert.equal(second.source === 'template' && second.reason, 'budget');
  });
  await t.test('cache rolls over per UTC day', async () => {
    let now = Date.parse('2026-11-07T23:00:00Z');
    const svc = createTransitService(createPublicLane({config: () => undefined}), () => now);
    const a = await svc.today(); now += 2 * 3_600_000; const b = await svc.today();
    assert.notEqual(a.day, b.day);
  });
});

test('GET /api/transits/today is public, cached and carries no user data', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'constellate-router-'));
  const pub = recorder();
  const runtime = await createApp({dbPath: join(dir, 't.sqlite'), baseURL: 'http://localhost:3498', secret: 'test-secret-only-not-a-deployment-secret-1234',
    publicLane: createPublicLane({fetch: pub.fetch, config: pubCfg}), infer: async () => { throw Error('not used'); }});
  const server = runtime.app.listen(3498, '127.0.0.1');
  try {
    const r = await fetch('http://127.0.0.1:3498/api/transits/today', {headers: {Connection: 'close'}});
    assert.equal(r.status, 200);
    assert.match(r.headers.get('cache-control') ?? '', /public/);
    const {transits} = await r.json();
    assert.equal(transits.copy.sensitivity, 'public'); assert.equal(transits.copy.source, 'darkbloom');
    assert.equal(transits.positions.length, 7);
    await fetch('http://127.0.0.1:3498/api/transits/today', {headers: {Connection: 'close'}});
    assert.equal(pub.calls.length, 1);
    const health = await (await fetch('http://127.0.0.1:3498/api/health', {headers: {Connection: 'close'}})).json();
    assert.equal(health.publicLaneConfigured, true);
    // Authenticated routes still require a session.
    assert.equal((await fetch('http://127.0.0.1:3498/api/me', {headers: {Connection: 'close'}})).status, 401);
  } finally { await new Promise<void>(res => server.close(() => res())); runtime.db.close(); rmSync(dir, {recursive: true, force: true}); }
});
