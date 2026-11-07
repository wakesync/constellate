import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../src/server.js';
import {calculateChart} from '../src/chart.js';
const birth={date:'2000-01-01',time:'12:00',timeZone:'UTC',latitude:null,longitude:null,consent:true as const};
test('chart deterministic, real solar position and invalid times rejected',()=>{
 const a=calculateChart(birth);assert.deepEqual(a,calculateChart(birth));assert.equal(a.placements[0].sign,'Capricorn');assert.ok(Math.abs(a.placements[0].longitude-280.37)<0.1);
 assert.throws(()=>calculateChart({...birth,date:'2000-02-31'}));assert.throws(()=>calculateChart({...birth,date:'2024-03-10',time:'02:30',timeZone:'America/New_York'}));assert.throws(()=>calculateChart({...birth,date:'2024-11-03',time:'01:30',timeZone:'America/New_York'}));assert.equal(calculateChart({...birth,time:null}).timeKnown,false);
});
test('real auth, isolation, persistence, fail-closed and deletion',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'constellate-test-'));const origin='http://localhost:3499';
 // Injected deterministic TEST DOUBLE only. No claim of provider integration.
 let fail=false;
 const setup=()=>createApp({dbPath:join(dir,'test.sqlite'),baseURL:origin,secret:'test-secret-only-not-a-deployment-secret-1234',infer:async()=>{if(fail)throw Error('provider offline');return {text:'TEST DOUBLE',provider:'tinfoil',model:'test-double',verification:'sdk-attested',generatedAt:'2000-01-01T00:00:00Z'};}});
 let runtime=await setup();let server=runtime.app.listen(3499,'127.0.0.1');
 const request=async(path:string,method='GET',body?:unknown,cookie='')=>fetch(`http://127.0.0.1:3499${path}`,{method,headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie,Connection:'close'},body:body===undefined?undefined:JSON.stringify(body)});
 const signup=async(email:string)=>{const r=await request('/api/auth/sign-up/email','POST',{name:'Test',email,password:'synthetic-password-123'});assert.equal(r.status,200);return r.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');};
 try{
 const alice=await signup('alice@example.test');const bob=await signup('bob@example.test');
 assert.equal((await request('/api/me')).status,401);
 assert.equal((await request('/api/profile','PUT',birth,alice)).status,200);
 assert.equal((await request('/api/profile','PUT',{...birth,consent:false},bob)).status,400);
 const generated=await request('/api/readings','POST',{},alice);assert.equal(generated.status,201);const {reading}=await generated.json();
 assert.equal((await request(`/api/readings/${reading.id}`,'GET',undefined,bob)).status,404);
 assert.equal((await request(`/api/readings/${reading.id}`,'DELETE',undefined,bob)).status,404);
 assert.equal((await(await request('/api/readings','GET',undefined,bob)).json()).readings.length,0);
 fail=true;assert.equal((await request('/api/readings','POST',{},alice)).status,503);
 await new Promise<void>(resolve=>server.close(()=>resolve()));runtime.db.close();runtime=await setup();server=runtime.app.listen(3499,'127.0.0.1');
 assert.equal((await(await request('/api/readings','GET',undefined,alice)).json()).readings.length,1);
 assert.equal((await request('/api/auth/sign-out','POST',{},alice)).status,200);assert.equal((await request('/api/me','GET',undefined,alice)).status,401);
 const login=await request('/api/auth/sign-in/email','POST',{email:'alice@example.test',password:'synthetic-password-123'});assert.equal(login.status,200);const cookie=login.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
 assert.equal((await request('/api/profile','DELETE',{},cookie)).status,204);assert.equal((await(await request('/api/readings','GET',undefined,cookie)).json()).readings.length,0);
 assert.equal((await request('/api/account','DELETE',{},cookie)).status,204);assert.equal((await request('/api/me','GET',undefined,cookie)).status,401);
 const csrf=await fetch('http://127.0.0.1:3499/api/profile',{method:'DELETE',headers:{Cookie:bob,Origin:'https://evil.example'}});assert.equal(csrf.status,403);
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));runtime.db.close();rmSync(dir,{recursive:true,force:true});}
});
