import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../src/server.js';
import type {Membrane} from '../src/circles.js';
import type {Conversation} from '../src/conversation.js';
const result={text:'Synthetic reflective test response, not real inference.',provider:'tinfoil' as const,model:'test-double',verification:'sdk-attested' as const,generatedAt:'2000-01-01T00:00:00Z'};
const birth={date:'2000-01-01',time:'12:00',timeZone:'UTC',latitude:null,longitude:null,consent:true};
async function setup(membrane?:Membrane,converse?:Conversation){
 const origin='http://localhost:3497';const runtime=await createApp({dbPath:':memory:',baseURL:origin,secret:'test-secret-not-for-deployment-12345678',limits:{perUserDaily:30,globalDaily:60,leaseMs:120000},infer:async()=>result,membrane,converse:converse??(async()=>result)});
 const server=runtime.app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const port=(server.address() as any).port;
 const request=(path:string,method='GET',body?:unknown,cookie='')=>fetch(`http://127.0.0.1:${port}/api${path}`,{method,headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie,Connection:'close'},body:body===undefined?undefined:JSON.stringify(body)});
 const signup=async(email:string)=>{const r=await request('/auth/sign-up/email','POST',{name:'Synthetic',email,password:'synthetic-password-123'});assert.equal(r.status,200);return r.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');};
 return {...runtime,request,signup,close:async()=>{await new Promise<void>(r=>server.close(()=>r()));runtime.db.close();}};
}
test('grounded private chat isolates users, persists thread, cascades deletion and fails closed',async()=>{
 const calls:any[]=[];let fail=false;const s=await setup(undefined,async(context,messages)=>{calls.push({context,messages});if(fail)throw Error('secret provider body');return result;});
 try{const alice=await s.signup('chat-alice@example.test'),bob=await s.signup('chat-bob@example.test');
 await s.request('/profile','PUT',birth,alice);const r=await s.request('/readings','POST',{},alice);const {reading}=await r.json();const path=`/readings/${reading.id}/chat`;
 assert.equal((await s.request(path)).status,401);assert.equal((await s.request(path,'GET',undefined,bob)).status,404);assert.equal((await s.request(path,'POST',{message:'Hi'},bob)).status,404);
 const reply=await s.request(path,'POST',{message:'What might I reflect on?'},alice);assert.equal(reply.status,200);assert.equal((await reply.json()).messages.length,2);
 assert.equal(calls[0].context,result.text);assert.ok(!JSON.stringify(calls).includes(birth.date));
 await s.request(path,'POST',{message:'Can you ask me a question?'},alice);assert.equal(calls[1].messages.length,3);assert.equal((await(await s.request(path,'GET',undefined,alice)).json()).messages.length,4);
 fail=true;assert.equal((await s.request(path,'POST',{message:'Try'},alice)).status,503);assert.equal((await(await s.request(path,'GET',undefined,alice)).json()).messages.length,4);
 await s.request(`/readings/${reading.id}`,'DELETE',undefined,alice);assert.equal(s.db.prepare<[],{n:number}>('SELECT count(*) n FROM conversation').get()!.n,0);
 }finally{await s.close();}
});
test('unconfigured production Membrane never reports successful sharing or interaction',async()=>{
 const s=await setup();try{const alice=await s.signup('closed-alice@example.test');const {circle}=await(await s.request('/circles','POST',{name:'Test circle'},alice)).json();
 assert.equal(circle.membraneConfigured,false);assert.equal((await s.request(`/circles/${circle.id}/shares`,'POST',{summary:'Exact preview',consent:true},alice)).status,503);
 assert.equal((await s.request(`/circles/${circle.id}/interact`,'POST',{message:'Reflect'},alice)).status,503);assert.equal(s.db.prepare<[],{n:number}>('SELECT count(*) n FROM circle_share').get()!.n,0);
 }finally{await s.close();}
});
test('TEST DOUBLE only: explicit summaries, two independent calls, denial before grant, revocation, nonmember isolation',async()=>{
 const remote=new Map<string,{owner:string;summary:string;peers:string[]}>();const reads:any[]=[];const calls:any[]=[];let revokeFails=false;
 const membrane:Membrane={async share(circle,owner,summary,peers){const id=`${circle}:${owner}`;remote.set(id,{owner,summary,peers});return {id};},async read(circle,owner,reader,id){const record=remote.get(id);if(!record||(!record.peers.includes(reader)&&reader!==record.owner))throw Error('denied');reads.push({owner,reader});return record.summary;},async revoke(circle,owner,id){if(revokeFails)throw Error('offline');remote.delete(id);}};
 const s=await setup(membrane,async(context,messages)=>{calls.push({context,messages});return result;});
 try{const alice=await s.signup('circle-alice@example.test'),bob=await s.signup('circle-bob@example.test'),eve=await s.signup('circle-eve@example.test');
 const {circle}=await(await s.request('/circles','POST',{name:'Synthetic circle'},alice)).json();const base=`/circles/${circle.id}`;assert.deepEqual(circle.members.map((m:any)=>[m.isYou,m.name]),[[true,'Synthetic']]);assert.ok(!JSON.stringify(circle).includes('@example.test'));
 assert.equal((await s.request(base,'GET',undefined,eve)).status,404);
 assert.equal((await s.request(base+'/shares','POST',{summary:'Alice approved exactly.',consent:true},alice)).status,409);
 assert.equal((await s.request('/circles/join','POST',{inviteCode:circle.inviteCode},bob)).status,400);
 assert.equal((await s.request('/circles/join','POST',{inviteCode:circle.inviteCode,consent:true},bob)).status,200);
 assert.equal((await s.request(base+'/interact','POST',{message:'Reflect'},alice)).status,403);
 assert.equal((await s.request(base+'/shares','POST',{summary:'Alice approved exactly.',consent:false},alice)).status,400);
 assert.equal((await s.request(base+'/shares','POST',{summary:'Alice approved exactly.',consent:true},alice)).status,201);
 assert.equal((await s.request('/circles/join','POST',{inviteCode:circle.inviteCode,consent:true},eve)).status,409);
 assert.equal((await s.request(base+'/interact','POST',{message:'Reflect'},alice)).status,403);
 assert.equal((await s.request(base+'/shares','POST',{summary:'Bob approved exactly.',consent:true},bob)).status,201);
 const bobView=await(await s.request(base,'GET',undefined,bob)).json();assert.ok(!JSON.stringify(bobView).includes('Alice approved exactly.'));
 const response=await s.request(base+'/interact','POST',{message:'Where might our reflections meet?'},alice);assert.equal(response.status,200);const output=await response.json();assert.equal(output.turns.length,2);assert.notEqual(output.turns[0].agentFor,output.turns[1].agentFor);assert.equal(calls.length,2);assert.equal(reads.length,4);assert.ok(calls[1].context.includes(result.text));
 revokeFails=true;assert.equal((await s.request(base+'/shares/me','DELETE',undefined,alice)).status,503);assert.equal((await s.request(base+'/interact','POST',{message:'Reflect'},bob)).status,403);
 revokeFails=false;assert.equal((await s.request(base+'/shares/me','DELETE',undefined,alice)).status,204);assert.equal(remote.size,1);
 assert.equal((await s.request('/account','DELETE',undefined,bob)).status,204);assert.equal(remote.size,0);
 }finally{await s.close();}
});
test('deletion while chat inference is pending never resurrects a thread',async()=>{
 let release!:()=>void,entered!:()=>void;const started=new Promise<void>(r=>entered=r),gate=new Promise<void>(r=>release=r);
 const s=await setup(undefined,async()=>{entered();await gate;return result;});try{const alice=await s.signup('race-alice@example.test');await s.request('/profile','PUT',birth,alice);const {reading}=await(await s.request('/readings','POST',{},alice)).json();const pending=s.request(`/readings/${reading.id}/chat`,'POST',{message:'Reflect'},alice);await started;await s.request(`/readings/${reading.id}`,'DELETE',undefined,alice);release();assert.equal((await pending).status,409);assert.equal(s.db.prepare<[],{n:number}>('SELECT count(*) n FROM conversation').get()!.n,0);}finally{release();await s.close();}
});
