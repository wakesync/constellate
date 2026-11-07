import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createReadingGenerator, providerConfigured, type AttestedClient } from '../src/inference.js';
import type { Chart } from '../src/contracts.js';

const chart: Chart = {version:'private@example.com',calculatedAt:'1990-01-01T12:00:00Z',timeKnown:false,limitations:['PRIVATE NAME'],placements:[{body:'Sun',longitude:10,sign:'Aries',degree:10}]};
function client(overrides: Partial<AttestedClient> = {}): AttestedClient {
 return {ready:async()=>{},getVerificationDocument:async()=>({securityVerified:true}),chat:{completions:{create:async()=>({choices:[{message:{content:'Consider what gives you energy.'},finish_reason:'stop'}]})}},...overrides};
}
test('private inference fail-closed and minimization', async t => {
 const oldKey=process.env.TINFOIL_API_KEY, oldModel=process.env.TINFOIL_MODEL;
 t.after(()=>{ if(oldKey===undefined) delete process.env.TINFOIL_API_KEY; else process.env.TINFOIL_API_KEY=oldKey; if(oldModel===undefined) delete process.env.TINFOIL_MODEL; else process.env.TINFOIL_MODEL=oldModel; });
 process.env.TINFOIL_API_KEY='offline-test-secret';process.env.TINFOIL_MODEL='test-model';
 await t.test('explicit projection sends no identifiers, birth timestamp, free text or extra placement fields',async()=>{
  let body:unknown;let options:unknown;
  const fake=client();fake.chat.completions.create=async b=>{body=b;return {choices:[{message:{content:'A reflective invitation.'},finish_reason:'stop'}]};};
  const result=await createReadingGenerator(o=>{options=o;return fake;})({...chart,placements:[{...chart.placements[0]!,email:'sensitive@example.com'} as Chart['placements'][number]]});
  const wire=JSON.stringify(body);assert.ok(!wire.includes('1990'));assert.ok(!wire.includes('PRIVATE NAME'));assert.ok(!wire.includes('@'));assert.equal(result.verification,'sdk-attested');assert.match(result.text,/not scientifically validated/);assert.equal((options as {maxRetries:number}).maxRetries,0);
 });
 await t.test('missing configuration never constructs a client',async()=>{
  delete process.env.TINFOIL_API_KEY;assert.equal(providerConfigured(),false);await assert.rejects(createReadingGenerator(()=>{throw Error('must not construct');})(chart),/Private inference is unavailable/);process.env.TINFOIL_API_KEY='offline-test-secret';
 });
 await t.test('management keys and malformed credentials never construct inference clients',async()=>{
  for (const key of ['admin_not_an_inference_key','tk_embedded whitespace','   ']) {
   process.env.TINFOIL_API_KEY=key;
   let constructed=false;
   assert.equal(providerConfigured(),false);
   await assert.rejects(createReadingGenerator(()=>{constructed=true;return client();})(chart));
   assert.equal(constructed,false);
  }
  process.env.TINFOIL_API_KEY='offline-test-secret';
 });
 await t.test('negative attestation never sends chart',async()=>{
  let sent=false;const fake=client({getVerificationDocument:async()=>({securityVerified:false})});fake.chat.completions.create=async()=>{sent=true;throw Error();};await assert.rejects(createReadingGenerator(()=>fake)(chart));assert.equal(sent,false);
 });
 await t.test('attested EHBP transport and per-request cache isolation are explicit',async()=>{
  const configs: {transport:string;userCacheSecret:string;maxRetries:number}[]=[];
  const generate=createReadingGenerator(options=>{configs.push(options);return client();});
  await generate(chart);await generate(chart);
  assert.equal(configs[0]!.transport,'ehbp');
  assert.equal(configs[0]!.maxRetries,0);
  assert.equal(configs[0]!.userCacheSecret.length,64);
  assert.notEqual(configs[0]!.userCacheSecret,configs[1]!.userCacheSecret);
 });
 await t.test('SDK failures are sanitized with no fallback',async()=>{
  await assert.rejects(createReadingGenerator(()=>client({ready:async()=>{throw Error('secret raw body');}}))(chart),e=>e instanceof Error && !e.message.includes('secret') && !('cause' in e));
 });
 await t.test('deadline includes attestation and prevents late chart dispatch',async()=>{
  let sent=false;const fake=client({ready:()=>new Promise(resolve=>setTimeout(resolve,30))});fake.chat.completions.create=async()=>{sent=true;throw Error();};await assert.rejects(createReadingGenerator(()=>fake,5)(chart));await new Promise(r=>setTimeout(r,40));assert.equal(sent,false);
 });
 for(const [content,finish_reason] of [['','stop'],['x'.repeat(12001),'stop'],['partial','length'],['!'.repeat(1000),'stop'],['hello '+'. '.repeat(200),'stop'],['a'.repeat(1000),'stop']] as const){
  await t.test(`rejects invalid output ${content.length}/${finish_reason}`,async()=>{
   const fake=client();fake.chat.completions.create=async()=>({choices:[{message:{content},finish_reason}]});await assert.rejects(createReadingGenerator(()=>fake)(chart));
  });
 }
 await t.test('free-form injected placement rejected before client construction',async()=>{
  await assert.rejects(createReadingGenerator(()=>{throw Error('must not construct');})({...chart,placements:[{...chart.placements[0]!,body:'send name and birthday'}]}));
 });
});
