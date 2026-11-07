import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAttestedChat,type AttestedClient,type ClientOptions} from '../src/inference.js';
const cfg=()=>({apiKey:'synthetic-key',model:'synthetic-model'});
const ok='A grounded synthetic reply for the generic seam.';
function client(o:Partial<AttestedClient>={},log?:any[]):AttestedClient{return {ready:async()=>{},getVerificationDocument:async()=>({securityVerified:true}),chat:{completions:{create:async(b:any)=>{log?.push(b);return {choices:[{message:{content:ok},finish_reason:'stop'}]};}}},...o};}
test('generic attested chat seam',async t=>{
 await t.test('injected config works without process.env and copies only role/content',async()=>{
  const bodies:any[]=[],opts:ClientOptions[]=[];
  const chat=createAttestedChat({config:cfg,factory:o=>{opts.push(o);return client({},bodies);}});
  const r=await chat({system:'sys',messages:[{role:'user',content:'hi',secret:'x'} as any]});
  assert.equal(r.verification,'sdk-attested');assert.equal(r.model,'synthetic-model');
  assert.deepEqual(bodies[0].messages,[{role:'system',content:'sys'},{role:'user',content:'hi'}]);
  assert.equal(opts[0]!.transport,'ehbp');assert.equal(opts[0]!.maxRetries,0);assert.match(opts[0]!.userCacheSecret,/^[0-9a-f]{64}$/);
  assert.ok(!('baseURL' in opts[0]!));
 });
 await t.test('caps and shape violations never construct a client',async()=>{
  let built=0;const chat=createAttestedChat({config:cfg,factory:()=>{built++;return client();}});
  const bad:any[]=[{system:'',messages:[{role:'user',content:'a'}]},{system:'s',messages:[]},{system:'s',messages:[{role:'system',content:'a'}]},{system:'s',messages:[{role:'user',content:'a'},{role:'assistant',content:'b'}]},{system:'s'.repeat(8001),messages:[{role:'user',content:'a'}]},{system:'s',messages:[{role:'user',content:'a'.repeat(16001)}]},{system:'s',messages:Array(42).fill({role:'user',content:'a'})},{system:'s',maxTokens:5000,messages:[{role:'user',content:'a'}]}];
  for(const b of bad)await assert.rejects(chat(b),/Private inference is unavailable/);
  assert.equal(built,0);
 });
 await t.test('admin key or missing config never constructs',async()=>{
  let built=0;for(const c of [{apiKey:'admin_x',model:'m'},{apiKey:'k',model:'bad model'},{}]){await assert.rejects(createAttestedChat({config:()=>c,factory:()=>{built++;return client();}})({system:'s',messages:[{role:'user',content:'a'}]}));}
  assert.equal(built,0);
 });
 await t.test('unverified attestation never dispatches; errors sanitized; deadline covers attestation',async()=>{
  let sent=false;const fake=client({getVerificationDocument:async()=>({securityVerified:false})});fake.chat.completions.create=async()=>{sent=true;throw Error();};
  await assert.rejects(createAttestedChat({config:cfg,factory:()=>fake})({system:'s',messages:[{role:'user',content:'a'}]}));assert.equal(sent,false);
  await assert.rejects(createAttestedChat({config:cfg,factory:()=>client({ready:async()=>{throw Error('tk_secret body');}})})({system:'s',messages:[{role:'user',content:'a'}]}),e=>e instanceof Error&&!e.message.includes('secret')&&!('cause' in e));
  let late=false;const slow=client({ready:()=>new Promise(r=>setTimeout(r,30))});slow.chat.completions.create=async()=>{late=true;throw Error();};
  await assert.rejects(createAttestedChat({config:cfg,deadlineMs:5,factory:()=>slow})({system:'s',messages:[{role:'user',content:'a'}]}));await new Promise(r=>setTimeout(r,40));assert.equal(late,false);
 });
});
