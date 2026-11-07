import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SecureClient} from 'tinfoil';
// Read-only, synthetic capability discovery. No credentials, writes or provisioning.
// This is not evidence of a working circle. It records the actual release blocker.
test('LIVE Membrane capability receipt, attested read-only OpenAPI discovery', {skip:process.env.RUN_MEMBRANE_CAPABILITY_PROBE!=='1',timeout:90000},async()=>{
 const origin=process.env.MEMBRANE_ORIGIN??'';assert.ok(origin,'set MEMBRANE_ORIGIN');
 const client=new SecureClient({enclaveURL:origin,configRepo:process.env.MEMBRANE_CONFIG_REPO??'wakesync/constellate',transport:'ehbp'});
 await client.ready();assert.equal(client.getVerificationDocument().securityVerified,true);
 const response=await client.fetch(origin+'/openapi.json',{signal:AbortSignal.timeout(30000)});assert.equal(response.status,200);
 const spec=await response.json() as {paths:Record<string,Record<string,unknown>>};
 const routes=Object.entries(spec.paths).flatMap(([path,methods])=>Object.keys(methods).map(method=>method.toUpperCase()+' '+path));
 console.log(JSON.stringify({securityVerified:true,origin,status:response.status,routes,circleSharingEnabled:false,note:'Capability discovery only. Exact scoped read and revocation must be supplied and proven before enabling circles.'}));
});
