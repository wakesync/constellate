import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../src/server.js';
const birth={date:'2000-01-01',time:'12:00',timeZone:'UTC',latitude:null,longitude:null,consent:true};
const result={text:'SYNTHETIC TEST ONLY',provider:'tinfoil' as const,model:'test-double',verification:'sdk-attested' as const,generatedAt:'2000-01-01T00:00:00Z'};

test('HTTP limits reject concurrent/sequential work, persist failures, recover, and cannot resurrect deleted profiles',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'constellate-http-'));const origin='http://localhost:3501';
 let now=Date.now();let calls=0;let release!:()=>void;let entered!:()=>void;
 const started=new Promise<void>(r=>entered=r);const blocked=new Promise<void>(r=>release=r);
 const setup=()=>createApp({dbPath:join(dir,'db.sqlite'),baseURL:origin,secret:'synthetic-secret-not-used-in-production-1234',now:()=>now,limits:{perUserDaily:2,globalDaily:3,leaseMs:120_000},infer:async()=>{calls++;if(calls===1){entered();await blocked;return result;}if(calls===2)throw Error('offline');return result;}});
 let runtime=await setup();let server=runtime.app.listen(3501,'127.0.0.1');
 const request=(path:string,method='GET',body:unknown=undefined,cookie='')=>fetch('http://127.0.0.1:3501'+path,{method,headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie,Connection:'close'},body:body===undefined?undefined:JSON.stringify(body)});
 const signup=async(email:string)=>{const r=await request('/api/auth/sign-up/email','POST',{name:'Test',email,password:'synthetic-password-123'});assert.equal(r.status,200);return r.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');};
 try{
  const alice=await signup('alice@example.test');const bob=await signup('bob@example.test');const carol=await signup('carol@example.test');
  for(const c of [alice,bob,carol])assert.equal((await request('/api/profile','PUT',birth,c)).status,200);
  const pending=request('/api/readings','POST',{},alice);await started;
  const busy=await request('/api/readings','POST',{},alice);assert.equal(busy.status,429);assert.ok(Number(busy.headers.get('retry-after'))>0);assert.equal(calls,1);
  assert.equal((await request('/api/profile','DELETE',{},alice)).status,204);
  assert.equal((await request('/api/profile','PUT',birth,alice)).status,200);release();assert.equal((await pending).status,409);
  assert.equal((await request('/api/readings','POST',{},alice)).status,503);
  assert.equal((await request('/api/readings','POST',{},alice)).status,429);assert.equal(calls,2);
  assert.equal((await request('/api/readings','POST',{},bob)).status,201);
  assert.equal((await request('/api/readings','POST',{},carol)).status,429);assert.equal(calls,3);
  await new Promise<void>(r=>server.close(()=>r()));runtime.db.close();runtime=await setup();server=runtime.app.listen(3501,'127.0.0.1');
  assert.equal((await request('/api/readings','POST',{},alice)).status,429);
  assert.equal((await request('/api/readings','POST',{},carol)).status,429);
  now+=86_400_000;assert.equal((await request('/api/readings','POST',{},alice)).status,201);assert.equal(calls,4);
  assert.equal((await request('/api/account','DELETE',{},alice)).status,403); // old login, reauthenticate first
  assert.equal((await request('/api/me','GET',undefined,alice)).status,200);
  assert.equal((await request('/api/readings','GET',undefined,alice).then(r=>r.json())).readings.length,1);
 }finally{release();await new Promise<void>(r=>server.close(()=>r()));runtime.db.close();rmSync(dir,{recursive:true,force:true});}
});

test('untrusted forwarding headers cannot spoof auth identity and every mutation requires exact Origin',async()=>{
 const runtime=await createApp({dbPath:':memory:',baseURL:'http://localhost:3502',secret:'synthetic-secret-not-used-in-production-1234'});
 const server=runtime.app.listen(3502,'127.0.0.1');
 try{
  for(const origin of [undefined,'null','https://evil.example','http://localhost:3502.evil.test']){
   for(const path of ['/api/auth/sign-in/email','/api/auth/sign-up/email','/api/profile','/api/account','/api/readings/any']){
    const r=await fetch('http://127.0.0.1:3502'+path,{method:path.startsWith('/api/auth')?'POST':'DELETE',headers:origin?{Origin:origin}:{}});assert.equal(r.status,403);
   }
  }
  const r=await fetch('http://127.0.0.1:3502/api/auth/sign-up/email',{method:'POST',headers:{Origin:'http://localhost:3502','Content-Type':'application/json','X-Forwarded-For':'198.51.100.5','X-Real-IP':'198.51.100.6','CF-Connecting-IP':'198.51.100.7','X-Constellate-Client-IP':'198.51.100.8'},body:JSON.stringify({name:'Test',email:'proxy@example.test',password:'synthetic-password-123'})});assert.equal(r.status,200);
  const session=runtime.db.prepare('SELECT ipAddress FROM session').get() as {ipAddress:string};assert.equal(session.ipAddress,'127.0.0.1');
 }finally{await new Promise<void>(r=>server.close(()=>r()));runtime.db.close();}
});

test('explicit authenticated-header and loopback proxy modes normalize only narrow trusted inputs',async()=>{
 for(const mode of ['header','loopback'] as const){
  const runtime=await createApp({dbPath:':memory:',baseURL:'http://localhost:3503',secret:'synthetic-secret-not-used-in-production-1234',trustedClientIpHeader:mode==='header',trustedLoopbackProxy:mode==='loopback'});
  const server=runtime.app.listen(3503,'127.0.0.1');
  try{
   // Header mode represents calls already authenticated by the enclosing gate.
   // Loopback mode ignores fake leftmost XFF values beyond the first untrusted hop.
   const headers:Record<string,string>=mode==='header'?{'X-Constellate-Client-IP':'198.51.100.10'}:{'X-Forwarded-For':'198.51.100.99, 198.51.100.10','X-Constellate-Client-IP':'198.51.100.88'};
   const r=await fetch('http://127.0.0.1:3503/api/auth/sign-up/email',{method:'POST',headers:{Origin:'http://localhost:3503','Content-Type':'application/json',Connection:'close',...headers},body:JSON.stringify({name:'Test',email:'proxy@example.test',password:'synthetic-password-123'})});assert.equal(r.status,200);
   assert.equal((runtime.db.prepare('SELECT ipAddress FROM session').get() as {ipAddress:string}).ipAddress,'198.51.100.10');
   if(mode==='header'){
    const invalid=await fetch('http://127.0.0.1:3503/api/auth/sign-up/email',{method:'POST',headers:{Origin:'http://localhost:3503','Content-Type':'application/json',Connection:'close','X-Constellate-Client-IP':'198.51.100.10, 198.51.100.11'},body:JSON.stringify({name:'Test',email:'invalid@example.test',password:'synthetic-password-123'})});assert.equal(invalid.status,200);
    assert.equal((runtime.db.prepare("SELECT ipAddress FROM session JOIN user ON user.id=session.userId WHERE user.email='invalid@example.test'").get() as {ipAddress:string}).ipAddress,'127.0.0.1');
   }
  }finally{await new Promise<void>(r=>server.close(()=>r()));runtime.db.close();}
 }
});
