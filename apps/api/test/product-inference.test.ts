import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TinfoilAI } from '../../../server/node_modules/tinfoil/dist/index.js';
import { productInference, productInferenceConfigured } from '../src/lib/inference.js';
import { generateNarrative } from '../src/lib/narrative.js';
import { chat } from '../src/lib/eliza/agent.js';
import type { Env } from '../src/types.js';

const env = { TINFOIL_API_KEY: 'synthetic-inference-key', TINFOIL_MODEL: 'synthetic-model' } as Env;

test('full product shares attested transport and fails closed', async t => {
  const ready = Object.getOwnPropertyDescriptor(TinfoilAI.prototype, 'ready')!;
  const verification = Object.getOwnPropertyDescriptor(TinfoilAI.prototype, 'getVerificationDocument')!;
  const chatDescriptor = Object.getOwnPropertyDescriptor(TinfoilAI.prototype, 'chat')!;
  let verified = true;
  let body: any;
  let sent = 0;
  let text = 'An invented reflective paragraph, grounded in synthetic evidence.';
  let finish = 'stop';
  Object.defineProperty(TinfoilAI.prototype, 'ready', { ...ready, value: async () => {} });
  Object.defineProperty(TinfoilAI.prototype, 'getVerificationDocument', { ...verification, value: async () => ({ securityVerified: verified }) });
  Object.defineProperty(TinfoilAI.prototype, 'chat', { configurable: true, get: () => ({ completions: { create: async (b: any) => {
    body = b; sent++;
    return { choices: [{ message: { content: text }, finish_reason: finish }] };
  } } }) });
  t.after(() => {
    Object.defineProperty(TinfoilAI.prototype, 'ready', ready);
    Object.defineProperty(TinfoilAI.prototype, 'getVerificationDocument', verification);
    Object.defineProperty(TinfoilAI.prototype, 'chat', chatDescriptor);
  });

  await t.test('configuration is explicit and management credentials rejected', () => {
    assert.equal(productInferenceConfigured({} as Env), false);
    assert.equal(productInferenceConfigured({ ...env, TINFOIL_API_KEY: 'admin_synthetic' }), false);
    assert.equal(productInferenceConfigured(env), true);
  });
  await t.test('all nested structured evidence is minimized before the SDK', async () => {
    const result = await productInference(env, { system: 'Use only evidence.', messages: [{ role: 'user', content: JSON.stringify({
      input: { date: '2001-01-01', time: '12:00' }, email: 'synthetic@example.test',
      design_datetime_utc: '2000-10-01', latitude: 12.34,
      placements: [{ sign: 'Aries', degree: 10 }],
      transcript: [{ role: 'tool', content: JSON.stringify({ birth: { date: '2001-01-01' }, type: 'Generator' }) }],
    }) }] });
    assert.equal(result.verification, 'sdk-attested');
    assert.equal(body.model, env.TINFOIL_MODEL);
    const wire = body.messages[1].content;
    for (const fragment of ['2001-01-01', '2000-10-01', 'example.test', '12.34']) assert.ok(!wire.includes(fragment));
    assert.ok(wire.includes('Generator') && wire.includes('Aries'));
  });
  await t.test('narratives retain relationship gate, never fail over', async () => {
    const args = { env, system: 'Reflect.', user: '{}', relationshipContext: 'roommate' as const, fallback: 'Local non-AI copy.' };
    const good = await generateNarrative(args);
    assert.equal(good.degraded, false);
    assert.match(body.messages[0].content, /romantic or sexual framing is forbidden/);
    verified = false;
    const before = sent;
    assert.deepEqual(await generateNarrative(args), { text: args.fallback, degraded: true });
    assert.equal(sent, before, 'unverified requests send no prompt');
    assert.deepEqual(await generateNarrative({ ...args, env: {} as Env }), { text: args.fallback, degraded: true });
    assert.equal(sent, before);
    verified = true;
  });
  await t.test('circle tools and final replies go through the same seam', async () => {
    const messages = [{ role: 'system' as const, content: 'Use scoped tools.' }, { role: 'user' as const, content: 'Read the synthetic chart.' }];
    text = JSON.stringify({ calls: [{ name: 'get_chart', args: { member: 'rowan' } }] });
    const proposal = await chat(env, messages, true);
    assert.equal(proposal?.message?.tool_calls?.[0].function.name, 'get_chart');
    assert.equal(body.model, env.TINFOIL_MODEL);
    assert.equal(await chat(env, messages, false), null, 'tool calls forbidden on wrap-up');
    text = JSON.stringify({ calls: [{ name: 'not_a_registered_tool', args: {} }] });
    assert.equal(await chat(env, messages, true), null);
    text = JSON.stringify({ reply: 'A final reflective answer with no invented typology.' });
    assert.match((await chat(env, messages, false))?.message?.content ?? '', /reflective answer/);
    finish = 'length';
    assert.equal(await chat(env, messages, false), null, 'partial completion fails closed');
    finish = 'stop'; verified = false;
    const before = sent;
    assert.equal(await chat(env, messages, true), null);
    assert.equal(sent, before);
  });
});
