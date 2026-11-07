import {test} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type {AddressInfo} from 'node:net';
import {createCompatRouter, createFakeMembrane, assertPreviewDb} from '../src/compat.js';
import type {AttestedChat} from '../src/inference.js';

const ORIGIN = 'https://preview.example';
async function boot(opts:{chat?:AttestedChat; membrane?:boolean} = {}){
  const calls:any[] = [];
  const chat: AttestedChat = opts.chat ?? (async req => { calls.push(req); return {text:`synthetic reply ${calls.length} grounded in placements`, provider:'tinfoil', model:'m', verification:'sdk-attested', generatedAt:new Date().toISOString()}; });
  const {router} = createCompatRouter({dbPath:':memory:', origin:ORIGIN, chat, membrane: opts.membrane ? createFakeMembrane() : undefined, membraneLabel: opts.membrane ? 'fake' : undefined, limits:{perUserDaily:50, globalDaily:500, leaseMs:120_000}});
  const app = express(); app.use('/compat', router);
  const server = app.listen(0, '127.0.0.1'); await new Promise(r=>server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/compat`;
  const as = async (fixture:string) => {
    const r = await fetch(base+'/preview/session', {method:'POST', headers:{'content-type':'application/json', origin:ORIGIN}, body:JSON.stringify({fixture_id:fixture})});
    assert.equal(r.status, 200); const cookie = r.headers.get('set-cookie')!.split(';')[0]!;
    return async (path:string, method='GET', body?:unknown) => { const res = await fetch(base+path, {method, headers:{cookie, origin:ORIGIN, 'content-type':'application/json'}, body: body===undefined?undefined:JSON.stringify(body)}); const text = await res.text(); return {status:res.status, json: text ? JSON.parse(text) : null}; };
  };
  return {as, base, calls, close:()=>server.close()};
}

test('preview DB guard', ()=>{ assert.throws(()=>assertPreviewDb('data/constellate.sqlite')); assertPreviewDb('data/constellate-preview.sqlite'); });

test('existing-shape circle endpoints, isolation and graph', async t => {
  const s = await boot(); t.after(s.close);
  assert.equal((await fetch(s.base+'/me')).status, 401);
  const ada = await s.as('fx_ada'), dev = await s.as('fx_dev'), cyd = await s.as('fx_cyd');
  const mine = (await ada('/me/constellations')).json; assert.equal(mine.length, 2);
  const kitchen = mine.find((c:any)=>c.name==='Kitchen Table'); assert.equal(kitchen.member_count, 3); assert.ok(kitchen.invite_token.length >= 32);
  assert.equal((await dev(`/constellations/${kitchen.id}`)).status, 404);
  assert.equal((await dev(`/constellations/${kitchen.id}/graph`)).json.code, 'CONSTELLATION_NOT_FOUND');
  const members = (await ada(`/constellations/${kitchen.id}/members`)).json; assert.deepEqual(members.map((m:any)=>m.role), ['creator','member','member']);
  const g = (await ada(`/constellations/${kitchen.id}/graph`)).json;
  assert.equal(g.members.length, 3); assert.equal(g.edges.length, 3);
  const ab = g.edges.find((e:any)=>[e.a,e.b].sort().join()==='fx_ada,fx_bram'); assert.equal(ab.harmony_framing, 'house harmony'); assert.equal(ab.harmony, null);
  assert.ok(!JSON.stringify(g).match(/1996|07:15|America\//));
  const joined = await dev('/constellations/join', 'POST', {invite_token:kitchen.invite_token}); assert.equal(joined.status, 200); assert.equal(joined.json.member_count, 4);
  assert.equal((await dev('/constellations/join', 'POST', {invite_token:kitchen.invite_token})).json.member_count, 4);
  assert.equal((await dev('/constellations/join', 'POST', {invite_token:'x'.repeat(32)})).json.code, 'INVITE_NOT_FOUND');
  const created = (await cyd('/constellations', 'POST', {name:'New'})).json; assert.equal(created.creator_id, 'fx_cyd'); assert.equal(created.member_count, 1);
  assert.equal((await cyd('/pairs/fx_bram/context', 'PUT', {relationship:'friend'})).json.relationship, 'friend');
  assert.equal((await dev('/pairs/fx_bram/context')).json.relationship, null);
  const r = await fetch(s.base+'/constellations', {method:'POST', headers:{origin:'https://evil.example','content-type':'application/json'}, body:'{}'}); assert.equal(r.status, 403);
  assert.equal((await ada(`/constellations/${kitchen.id}/eliza`)).json.code, 'NOT_IN_PREVIEW');
});

test('private agent is owner-only and fails closed', async t => {
  let down = false;
  const s = await boot({chat: async req => { if (down) throw Error('provider tk_secret'); return {text:'synthetic grounded reply about your Sun', provider:'tinfoil', model:'m', verification:'sdk-attested', generatedAt:''}; }}); t.after(s.close);
  const ada = await s.as('fx_ada'), bram = await s.as('fx_bram');
  const r = await ada('/me/agent', 'POST', {body:'what does my moon mean?'}); assert.equal(r.status, 200); assert.equal(r.json.messages.length, 2); assert.equal(r.json.reply.verification, 'sdk-attested');
  assert.equal((await bram('/me/agent')).json.messages.length, 0);
  down = true; const f = await ada('/me/agent', 'POST', {body:'again'}); assert.equal(f.status, 503); assert.ok(!JSON.stringify(f.json).includes('secret'));
  assert.equal((await ada('/me/agent')).json.messages.length, 2);
  assert.equal((await ada('/me/agent', 'DELETE')).status, 204); assert.equal((await ada('/me/agent')).json.messages.length, 0);
});

test('agent context never includes birth date/time/place', async t => {
  const s = await boot(); t.after(s.close); const ada = await s.as('fx_ada');
  await ada('/me/agent', 'POST', {body:'hi'}); assert.ok(!JSON.stringify(s.calls).match(/1996-04-02|07:15|New_York|calculatedAt/));
});

test('membrane shares, consent, revocation, frozen membership, agent interaction', async t => {
  const s = await boot({membrane:true}); t.after(s.close);
  const ada = await s.as('fx_ada'), bram = await s.as('fx_bram'), dev = await s.as('fx_dev');
  const kitchen = (await ada('/me/constellations')).json.find((c:any)=>c.name==='Kitchen Table');
  const p = `/constellations/${kitchen.id}`;
  assert.equal((await ada(p+'/shares/me', 'PUT', {summary:'Ada likes mornings'})).status, 400);
  assert.equal((await ada(p+'/agents/interact', 'POST', {message:'hello'})).json.code, 'SHARE_REQUIRED');
  assert.equal((await ada(p+'/shares/me', 'PUT', {summary:'Ada likes mornings', consent:true})).json.membrane, 'fake');
  const view = (await bram(p+'/shares')).json; assert.equal(view.shares[0].summary, undefined);
  assert.equal((await dev('/constellations/join', 'POST', {invite_token:kitchen.invite_token})).json.code, 'MEMBERSHIP_FROZEN');
  await bram(p+'/shares/me', 'PUT', {summary:'Bram builds at night', consent:true});
  const before = s.calls.length;
  const it = await ada(p+'/agents/interact', 'POST', {message:'how do we split chores?'}); assert.equal(it.status, 200);
  assert.deepEqual(it.json.turns.map((x:any)=>x.agent_for), ['fx_ada','fx_bram']); assert.equal(it.json.persisted, false);
  const ctx = JSON.stringify(s.calls.slice(before)); assert.ok(ctx.includes('Bram builds at night')); assert.ok(!ctx.match(/1994-10-19|Amsterdam/));
  assert.equal((await bram(p+'/shares/me', 'DELETE')).status, 204);
  assert.equal((await ada(p+'/agents/interact', 'POST', {message:'again'})).json.code, 'SHARE_REQUIRED');
  assert.equal((await dev(p+'/shares')).status, 404);
});

test('membrane unconfigured never claims a share', async t => {
  const s = await boot(); t.after(s.close); const ada = await s.as('fx_ada');
  const k = (await ada('/me/constellations')).json[0];
  const r = await ada(`/constellations/${k.id}/shares/me`, 'PUT', {summary:'x', consent:true}); assert.equal(r.json.code, 'MEMBRANE_UNAVAILABLE');
  assert.equal((await ada(`/constellations/${k.id}/shares`)).json.membrane, 'unconfigured');
  assert.equal((await ada(`/constellations/${k.id}/shares`)).json.shares.length, 0);
});
