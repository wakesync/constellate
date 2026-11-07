import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {createRemoteMembrane} from '../src/membrane-remote.js';

// In-process fake of the server contract (app/shares.py), verifying HMAC identity like the container does.
const SECRET='synthetic-swarm-secret-0001';
function fakeServer(){
  const shares=new Map<string,{owner:string;context:string;text:string;readers:Set<string>}>();let n=0;const log:any[]=[];
  const fetcher=async(url:string,init:RequestInit)=>{
    const h=init.headers as Record<string,string>;const want=createHmac('sha256',SECRET).update(`${h['X-Swarm-User']}.${h['X-Swarm-Ts']}`).digest('hex');
    if(want!==h['X-Swarm-Sig'])return new Response('{}',{status:401});
    const user=h['X-Swarm-User']!;const path=new URL(url).pathname;log.push([init.method,path,user]);
    const j=(s:number,b:unknown)=>new Response(JSON.stringify(b),{status:s});
    if(init.method==='POST'&&path==='/shares'){const b=JSON.parse(String(init.body));const id='shr_'+(++n);shares.set(id,{owner:user,context:b.context,text:b.text,readers:new Set(b.readers)});return j(200,{id});}
    const id=decodeURIComponent(path.split('/')[2]!);const s=shares.get(id);
    if(init.method==='GET'){if(!s||(s.owner!==user&&!s.readers.has(user)))return j(404,{});return j(200,{id,owner:s.owner,context:s.context,text:s.text});}
    if(init.method==='DELETE'){if(s&&s.owner!==user)return j(404,{});shares.delete(id);return j(200,{id,revoked:true});}
    return j(405,{});
  };
  return {fetcher,shares,log};
}
const mk=(f:any)=>createRemoteMembrane({origin:'https://membrane.example',configRepo:'wakesync/hivemind',secret:SECRET,namespace:'cst',fetcher:f});

test('remote membrane share/read/revoke against server contract',async()=>{
  const s=fakeServer();const m=mk(s.fetcher);
  const {id}=await m.share('con_1','fx_ada','Ada summary',['fx_bram']);
  assert.equal(s.shares.get(id)!.owner,'cst:fx_ada');assert.deepEqual([...s.shares.get(id)!.readers],['cst:fx_bram']);
  assert.equal(await m.read('con_1','fx_ada','fx_bram',id),'Ada summary');
  await assert.rejects(m.read('con_1','fx_ada','fx_dev',id));      // not a reader
  await assert.rejects(m.read('con_2','fx_ada','fx_bram',id));     // wrong circle context
  await assert.rejects(m.read('con_1','fx_bram','fx_bram',id));    // wrong owner claimed
  await m.revoke('con_1','fx_ada',id);await m.revoke('con_1','fx_ada',id); // idempotent
  await assert.rejects(m.read('con_1','fx_ada','fx_bram',id));
  assert.deepEqual(s.log.find(l=>l[0]==='GET')![2],'cst:fx_bram');  // reads signed as the reader, not owner/admin
});
test('remote membrane fails closed and sanitizes',async()=>{
  const m=mk(async()=>{throw Error('tk_secret leaked in transport error');});
  await assert.rejects(m.share('c','a',"x",['b']),e=>e instanceof Error&&!e.message.includes('secret'));
  const bad=mk(async()=>new Response('{}',{status:500}));await assert.rejects(bad.revoke('c','a','shr_1'));
  assert.throws(()=>createRemoteMembrane({origin:'http://insecure',configRepo:'r',secret:SECRET,namespace:'cst'}));
  assert.throws(()=>createRemoteMembrane({origin:'https://m.example',configRepo:'r',secret:'short',namespace:'cst'}));
});
