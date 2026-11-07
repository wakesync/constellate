import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proveContainer, proveInference, type ContainerClient } from '../tools/track-proof.js';

const config = {url:'https://constellate.demo.containers.tinfoil.dev',repo:'demo/constellate'};
function fakeClient(overrides:Partial<ContainerClient> = {}):ContainerClient {
  return {ready:async()=>{},getVerificationDocument:()=>({securityVerified:true}),
    fetch:async()=>Response.json({ok:true,privateInferenceConfigured:true}),...overrides};
}
test('synthetic inference observation projects away all provider text and metadata',async()=>{
  const receipt = await proveInference(async chart=>{
    assert.equal(chart.calculatedAt,'');assert.equal(chart.version,'synthetic-proof-only');
    return {text:'PRIVATE OUTPUT',model:'PRIVATE MODEL',provider:'tinfoil',verification:'sdk-attested',generatedAt:'PRIVATE DATE'};
  });
  const wire=JSON.stringify(receipt);
  assert.ok(!wire.includes('PRIVATE'));assert.equal(receipt.syntheticInput,true);
  assert.match(receipt.outputSha256,/^[a-f0-9]{64}$/);assert.match(receipt.scope,/not application-container/);
});
test('inference failures do not print provider bodies',async()=>{
  await assert.rejects(proveInference(async()=>{throw Error('PRIVATE TOKEN');}),e=>e instanceof Error && !e.message.includes('PRIVATE') && !('cause' in e));
});
test('container uses verified TLS GET, no credentials, and narrow health projection',async()=>{
  let checked=false;
  const receipt=await proveContainer(config,options=>{
    assert.equal(options.configRepo,config.repo);assert.equal(options.transport,'tls');
    return fakeClient({getVerificationDocument:()=>{checked=true;return {securityVerified:true};},fetch:async(url,init)=>{
      assert.ok(checked);assert.equal(url,`${config.url}/api/health`);assert.equal(init?.method,'GET');
      assert.equal(init?.redirect,'error');assert.equal(init?.headers,undefined);assert.equal(init?.body,undefined);
      return Response.json({ok:true,privateInferenceConfigured:false,secret:'PRIVATE'});
    }});
  });
  assert.equal(receipt.inferenceConfigured,false);assert.ok(!JSON.stringify(receipt).includes('PRIVATE'));
});
test('rejected attestation never dispatches health request',async()=>{
  let sent=false;
  await assert.rejects(proveContainer(config,()=>fakeClient({getVerificationDocument:()=>({securityVerified:false}),fetch:async()=>{sent=true;throw Error();}})));
  assert.equal(sent,false);
});
test('deadline covers initialization and prevents late dispatch',async()=>{
  let sent=false;
  await assert.rejects(proveContainer(config,()=>fakeClient({ready:()=>new Promise(r=>setTimeout(r,30)),fetch:async()=>{sent=true;throw Error();}}),5));
  await new Promise(r=>setTimeout(r,45));assert.equal(sent,false);
});
test('invalid targets cannot instantiate a client',async()=>{
  for(const url of ['http://constellate.demo.containers.tinfoil.dev','https://localhost','https://example.com','https://app.containers.tinfoil.dev.evil.com','https://user:pass@app.containers.tinfoil.dev','https://app.containers.tinfoil.dev/other','https://app.containers.tinfoil.dev?secret=x']) {
    let constructed=false;await assert.rejects(proveContainer({...config,url},()=>{constructed=true;return fakeClient();}));assert.equal(constructed,false);
  }
  await assert.rejects(proveContainer({...config,repo:'https://github.com/demo/repo'}));
});
test('bad, oversized and unexpected health responses fail closed',async()=>{
  for(const response of [new Response('PRIVATE',{status:500}),new Response('x'.repeat(4097)),new Response('not json'),Response.json({ok:false,privateInferenceConfigured:true}),Response.json({ok:true}),Response.json({ok:true,privateInferenceConfigured:'yes'})]) {
    await assert.rejects(proveContainer(config,()=>fakeClient({fetch:async()=>response})),e=>e instanceof Error && !e.message.includes('PRIVATE'));
  }
});
