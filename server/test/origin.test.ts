import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../src/server.js';
import {protectedOrigin} from '../adapters/origin.js';

test('origin gate authenticates before accepting narrow client identity',async()=>{
 const origin='http://localhost:3514';const token='synthetic-origin-secret-12345678901234567890';
 const runtime=await createApp({dbPath:':memory:',baseURL:origin,secret:'synthetic-auth-secret-12345678901234567890',trustedClientIpHeader:true});
 const server=protectedOrigin(runtime.app,token).listen(3514,'127.0.0.1');
 try{
  const request=(secret:string,ip:string,email:string)=>fetch('http://127.0.0.1:3514/api/auth/sign-up/email',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Connection:'close','x-constellate-origin-secret':secret,'x-constellate-client-ip':ip,'x-forwarded-for':'198.51.100.99'},body:JSON.stringify({name:'Synthetic',email,password:'synthetic-password-1234'})});
  for(const bad of ['', 'wrong', 'é'.repeat(token.length)])assert.equal((await request(bad,'198.51.100.10','bad@example.test')).status,403);
  assert.equal((runtime.db.prepare('SELECT COUNT(*) AS n FROM session').get() as {n:number}).n,0);
  assert.equal((await request(token,'198.51.100.10','valid@example.test')).status,200);
  assert.equal((runtime.db.prepare('SELECT ipAddress FROM session').get() as {ipAddress:string}).ipAddress,'198.51.100.10');
  assert.equal((await request(token,'198.51.100.11, 198.51.100.12','invalid@example.test')).status,200);
  assert.equal((runtime.db.prepare("SELECT ipAddress FROM session JOIN user ON user.id=session.userId WHERE user.email='invalid@example.test'").get() as {ipAddress:string}).ipAddress,'127.0.0.1');
 }finally{await new Promise<void>(r=>server.close(()=>r()));runtime.db.close();}
});
