import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createConversationGenerator} from '../src/conversation.js';
import type {AttestedClient} from '../src/inference.js';
test('conversation attests before dispatch, isolates cache and fails closed without provider fallback',async()=>{
 const oldKey=process.env.TINFOIL_API_KEY,oldModel=process.env.TINFOIL_MODEL;process.env.TINFOIL_API_KEY='synthetic-test-key';process.env.TINFOIL_MODEL='synthetic-model';
 try{
  let verified=false,requests=0;const options:any[]=[];const bodies:any[]=[];
  const client:AttestedClient={async ready(){},async getVerificationDocument(){return {securityVerified:verified};},chat:{completions:{async create(body){requests++;bodies.push(body);return {choices:[{message:{content:'A synthetic grounded response for testing only.'},finish_reason:'stop'}]};}}}};
  const generate=createConversationGenerator(o=>{options.push(o);return client;});
  await assert.rejects(generate('Saved reading',[{role:'user',content:'What does this mean?'}]));assert.equal(requests,0);
  verified=true;await generate('Saved reading',[{role:'user',content:'What does this mean?'}]);await generate('Saved reading',[{role:'user',content:'A followup'}]);assert.equal(requests,2);assert.equal(options[1].transport,'ehbp');assert.equal(options[1].maxRetries,0);assert.notEqual(options[1].userCacheSecret,options[2].userCacheSecret);assert.ok(bodies[0].messages[1].content.includes('Saved reading'));
  delete process.env.TINFOIL_API_KEY;await assert.rejects(generate('Saved reading',[]));assert.equal(options.length,3);
 }finally{if(oldKey===undefined)delete process.env.TINFOIL_API_KEY;else process.env.TINFOIL_API_KEY=oldKey;if(oldModel===undefined)delete process.env.TINFOIL_MODEL;else process.env.TINFOIL_MODEL=oldModel;}
});
