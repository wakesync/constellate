import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TinfoilAI } from 'tinfoil';
import { createReadingGenerator, PrivateInferenceError } from '../src/inference.js';
import type { Chart } from '../src/contracts.js';

// Opt in explicitly. No real birth data, key values, or provider errors are logged.
// Load the mode600 server-side inference environment before invoking this test.
const enabled = process.env.RUN_TINFOIL_LIVE === '1';
const chart: Chart = {
  version:'synthetic-live-probe', calculatedAt:'2000-01-01T12:00:00Z',
  timeKnown:false, limitations:[], placements:[
    {body:'Sun',longitude:10,sign:'Aries',degree:10},
    {body:'Moon',longitude:45,sign:'Taurus',degree:15},
    {body:'Mercury',longitude:5,sign:'Aries',degree:5},
  ],
};
test('LIVE official SDK attests and generates synthetic-placement reading', {skip:!enabled}, async () => {
  let verified = false;
  const generate = createReadingGenerator(options => {
    const client = new TinfoilAI(options);
    return {
      ready:() => client.ready(),
      getVerificationDocument:async () => {
        const doc = await client.getVerificationDocument();
        verified = doc.securityVerified === true;
        return doc;
      },
      chat:client.chat,
    };
  });
  const result = await generate(chart);
  assert.equal(verified,true);
  assert.equal(result.provider,'tinfoil');
  assert.equal(result.verification,'sdk-attested');
  assert.equal(result.model,process.env.TINFOIL_MODEL);
  assert.ok(result.text.length > 500,'real reading must be substantive');
  console.log(JSON.stringify({liveInference:'passed',securityVerified:verified,model:result.model,characters:result.text.length,generatedAt:result.generatedAt}));
});

test('LIVE invalid inference credential fails closed without response content', {skip:!enabled}, async () => {
  const original = process.env.TINFOIL_API_KEY;
  try {
    process.env.TINFOIL_API_KEY = 'tk_constellate_intentionally_invalid_live_test';
    await assert.rejects(createReadingGenerator()(chart), error =>
      error instanceof PrivateInferenceError && error.message === 'Private inference is unavailable. Please try again later.' && !('cause' in error));
  } finally {
    if (original === undefined) delete process.env.TINFOIL_API_KEY;
    else process.env.TINFOIL_API_KEY = original;
  }
});
