// Tracks 2.4 + 2.5 end to end, offline: the real Express app + the REAL Membrane service (membrane/app)
// on loopback. Only the model is a test double. All accounts and birth data are synthetic.
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../src/server.js';
import {createRemoteMembrane,membraneModeFromEnv,remoteMembraneFromEnv} from '../src/membrane-remote.js';
import {countCitations} from '../src/cooperation.js';
import type {Conversation} from '../src/conversation.js';
import {startMembraneService,membraneServiceUnavailable,type MembraneService} from './helpers/membrane-service.js';

const skip=membraneServiceUnavailable();
const BIRTH={date:'1996-04-02',time:'07:15',timeZone:'America/New_York',latitude:40.1234,longitude:-73.5678,consent:true};
const CHAT_CANARY='CHAT-CANARY-8812 my private worry about the move';
const result=(text:string)=>({text,provider:'tinfoil' as const,model:'test-double',verification:'sdk-attested' as const,generatedAt:'2000-01-01T00:00:00Z'});
let svc:MembraneService;
before(async()=>{if(!skip)svc=await startMembraneService();});
after(async()=>{await svc?.stop();});

// Membrane transport that records every byte sent to the service, then forwards to the real one.
function recordingMembrane(){
 const sent:string[]=[];
 const membrane=createRemoteMembrane({origin:svc.origin,configRepo:'example/membrane-config',secret:svc.secret,namespace:'cst',insecureLoopback:true,
  fetcher:async(url,init)=>{sent.push(`${init.method} ${url} ${JSON.stringify(init.headers)} ${init.body??''}`);return fetch(url,init);}});
 return {membrane,sent};
}

async function setup(){
 const {membrane,sent}=recordingMembrane();const prompts:{context:string;messages:any[]}[]=[];
 const converse:Conversation=async(context,messages)=>{prompts.push({context,messages});
  // Deterministic stand-in for the model: cite each supplied contribution label once.
  const labels=[...context.matchAll(/"label":"([A-H])"/g)].map(m=>m[1]);
  if(context.startsWith('Write a short circle-level'))return result(`Your circle leans on steadiness this week ${labels.map(l=>`[${l}]`).join(' ')}.`);
  return result('Synthetic reflective reply.');};
 const origin='http://localhost:3601';
 const rt=await createApp({dbPath:':memory:',baseURL:origin,secret:'synthetic-secret-not-for-deployment-123456',limits:{perUserDaily:50,globalDaily:100,leaseMs:120000},infer:async()=>result('Synthetic natal reading.'),membrane,converse});
 const server=rt.app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const port=(server.address() as any).port;
 const req=async(path:string,method='GET',body?:unknown,cookie='')=>{const r=await fetch(`http://127.0.0.1:${port}/api${path}`,{method,headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie,Connection:'close'},body:body===undefined?undefined:JSON.stringify(body)});const text=await r.text();return {status:r.status,json:text?JSON.parse(text):null};};
 const signup=async(name:string)=>{const r=await fetch(`http://127.0.0.1:${port}/api/auth/sign-up/email`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({name,email:`${name.toLowerCase()}@example.test`,password:'synthetic-password-123'})});assert.equal(r.status,200);return r.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');};
 return {...rt,req,signup,sent,prompts,membrane,close:async()=>{await new Promise<void>(r=>server.close(()=>r()));rt.db.close();}};
}
async function circleOf3(s:Awaited<ReturnType<typeof setup>>){
 const ada=await s.signup('Ada'),bram=await s.signup('Bram'),cyd=await s.signup('Cyd');
 const ids:Record<string,string>={};for(const [n,c] of Object.entries({ada,bram,cyd}))ids[n]=(await s.req('/me','GET',undefined,c)).json.user.id;
 const {circle}=(await s.req('/circles','POST',{name:'Kitchen Table'},ada)).json;
 for(const c of [bram,cyd])assert.equal((await s.req('/circles/join','POST',{inviteCode:circle.inviteCode,consent:true},c)).status,200);
 return {ada,bram,cyd,ids,cid:circle.id as string};
}

test('adapter against the real Membrane service: grantee reads, non-grantee denied, revoke blocks future reads',{skip},async()=>{
 const {membrane,sent}=recordingMembrane();
 const {id}=await membrane.share('circle_1','u_ada','Ada approved: steady mornings.',['u_bram']);
 assert.equal(await membrane.read('circle_1','u_ada','u_bram',id),'Ada approved: steady mornings.');
 await assert.rejects(membrane.read('circle_1','u_ada','u_cyd',id));        // not the grantee
 await assert.rejects(membrane.read('circle_2','u_ada','u_bram',id));       // wrong circle context
 await assert.rejects(membrane.read('circle_1','u_cyd','u_bram',id));       // forged owner claim
 await membrane.revoke('circle_1','u_ada',id);
 await assert.rejects(membrane.read('circle_1','u_ada','u_bram',id));       // revoked
 await assert.rejects(membrane.read('circle_1','u_ada','u_ada',id));        // gone for the owner too (hard delete)
 // Per-member namespaces + signed per-user identity: each call is signed as exactly one cst:<user>.
 assert.ok(sent.every(l=>/"X-Swarm-User":"cst:u_[a-z]+"/.test(l)&&/"X-Swarm-Sig":"[0-9a-f]{64}"/.test(l)));
 assert.ok(sent.find(l=>l.startsWith('GET')&&l.includes('cst:u_cyd')));
 // A wrong secret cannot impersonate a member.
 const forged=createRemoteMembrane({origin:svc.origin,configRepo:'x/y',secret:'not-the-service-secret-000',namespace:'cst',insecureLoopback:true});
 await assert.rejects(forged.share('circle_1','u_ada','x',['u_bram']));
});

test('503 gate: off when MEMBRANE_ORIGIN unset, removed when set; loopback HTTP only with explicit dev opt-in',()=>{
 assert.equal(remoteMembraneFromEnv({}),undefined);assert.equal(membraneModeFromEnv({}),'unconfigured');
 const env={MEMBRANE_ORIGIN:'http://127.0.0.1:9',MEMBRANE_SWARM_SECRET:'synthetic-secret-abcdef'};
 assert.throws(()=>remoteMembraneFromEnv(env));                                                    // no opt-in: plain HTTP refused
 assert.equal(membraneModeFromEnv({...env,MEMBRANE_INSECURE_LOOPBACK:'1'}),'local-unattested');
 assert.throws(()=>remoteMembraneFromEnv({...env,MEMBRANE_INSECURE_LOOPBACK:'1',NODE_ENV:'production'}));
 assert.throws(()=>createRemoteMembrane({origin:'http://membrane.example:80',configRepo:'x/y',secret:'synthetic-secret-abcdef',namespace:'cst',insecureLoopback:true}));
 assert.equal(membraneModeFromEnv({MEMBRANE_ORIGIN:'https://membrane.example',MEMBRANE_SWARM_SECRET:'synthetic-secret-abcdef'}),'attested');
 assert.ok(remoteMembraneFromEnv({MEMBRANE_ORIGIN:'https://membrane.example',MEMBRANE_SWARM_SECRET:'synthetic-secret-abcdef'}));
});

test('circle-wide share works end to end through real Membrane once configured',{skip},async()=>{
 const s=await setup();try{const {ada,bram,cid}=await circleOf3(s);
  assert.equal((await s.req(`/circles/${cid}`,'GET',undefined,ada)).json.circle.membraneConfigured,true);
  assert.equal((await s.req(`/circles/${cid}/shares`,'POST',{summary:'Ada: I recharge alone before hard talks.',consent:true},ada)).status,201);
  assert.equal((await s.req(`/circles/${cid}/shares`,'POST',{summary:'Bram: night owl, direct.',consent:true},bram)).status,201);
  const r=await s.req(`/circles/${cid}/interact`,'POST',{message:'Where do we meet?'},ada);assert.equal(r.status,200);assert.equal(r.json.transport,'membrane');
  assert.equal((await s.req(`/circles/${cid}/shares/me`,'DELETE',undefined,ada)).status,204);
  assert.equal((await s.req(`/circles/${cid}/interact`,'POST',{message:'Again?'},bram)).status,403);
 }finally{await s.close();}
});

test('grants are exact and per member; circle reading uses only approved shares, attributes them, never carries raw data',{skip},async()=>{
 const s=await setup();try{const {ada,bram,cyd,ids,cid}=await circleOf3(s);const base=`/circles/${cid}`;
  // Private context that must never cross: birth profile, a reading, a private chat.
  assert.equal((await s.req('/profile','PUT',BIRTH,bram)).status,200);
  const {reading}=(await s.req('/readings','POST',{},bram)).json;
  assert.equal((await s.req(`/readings/${reading.id}/chat`,'POST',{message:CHAT_CANARY},bram)).status,200);

  // Consent required, only real members, never yourself.
  assert.equal((await s.req(base+'/grants','POST',{summary:'x',to:ids.ada},bram)).status,400);
  assert.equal((await s.req(base+'/grants','POST',{summary:'x',to:ids.bram,consent:true},bram)).status,404);
  assert.equal((await s.req(base+'/grants','POST',{summary:'x',to:'not-a-member',consent:true},bram)).status,404);
  // No grants for Ada yet -> no circle reading.
  assert.equal((await s.req(base+'/circle-reading','POST',{question:'Our week?'},ada)).status,403);

  const BRAM_FOR_ADA='Bram: Mars in Gemini energy, I talk things out fast. Give me a beat to cool off.';
  const BRAM_FOR_CYD='Bram (for Cyd): I like quiet studio hours.';
  const CYD_FOR_BRAM='Cyd: I go quiet when overwhelmed.';
  const ADA_OWN='Ada: I am a morning person and plan the week on Sundays.';
  const g1=(await s.req(base+'/grants','POST',{summary:BRAM_FOR_ADA,to:ids.ada,consent:true},bram));assert.equal(g1.status,201);
  assert.equal((await s.req(base+'/grants','POST',{summary:BRAM_FOR_CYD,to:ids.cyd,consent:true},bram)).status,201);
  assert.equal((await s.req(base+'/grants','POST',{summary:CYD_FOR_BRAM,to:ids.bram,consent:true},cyd)).status,201);
  assert.equal((await s.req(base+'/grants','POST',{summary:ADA_OWN,to:ids.bram,consent:true},ada)).status,201);
  assert.equal((await s.req(base+'/grants','POST',{summary:'dup',to:ids.ada,consent:true},bram)).status,409);
  // Grantee sees grant metadata, never the text outside a reading; owner sees own text.
  const adaGrants=(await s.req(base+'/grants','GET',undefined,ada)).json.grants;
  assert.ok(!JSON.stringify(adaGrants).includes(BRAM_FOR_ADA));assert.ok(JSON.stringify(adaGrants).includes(ADA_OWN));

  const before=s.prompts.length;
  const cr=await s.req(base+'/circle-reading','POST',{question:'What is our circle like this week?'},ada);assert.equal(cr.status,201,JSON.stringify(cr.json));
  const prompt=s.prompts.slice(before).map(p=>p.context+JSON.stringify(p.messages)).join('\n');
  // Ada's reading sees exactly: Bram's grant TO ADA + Ada's own. Not Bram->Cyd, not Cyd->Bram.
  assert.ok(prompt.includes(BRAM_FOR_ADA));assert.ok(prompt.includes(ADA_OWN));
  assert.ok(!prompt.includes(BRAM_FOR_CYD));assert.ok(!prompt.includes(CYD_FOR_BRAM));
  // Attribution: per member, labelled, with citations counted from the synthesis.
  const att=cr.json.reading.attribution;assert.deepEqual(att.map((a:any)=>[a.memberId,a.label]).sort(),[[ids.ada,'A'],[ids.bram,'B']].sort());
  assert.ok(att.every((a:any)=>a.citations===1&&a.grantIds.length===1&&/^[0-9a-f]{64}$/.test(a.sha256s[0])));
  assert.ok(!att.some((a:any)=>a.memberId===ids.cyd));
  // Raw birth data / placements / reading / chat never in the shared payload (Membrane wire) or the reading prompt.
  const wire=s.sent.join('\n');
  for(const needle of [BIRTH.date,'07:15','America/New_York','40.1234','-73.5678',CHAT_CANARY,'Synthetic natal reading','"longitude"','"placements"','"calculatedAt"']){
   assert.ok(!wire.includes(needle),'membrane wire leaked '+needle);assert.ok(!prompt.includes(needle),'prompt leaked '+needle);}
  // Membrane only ever received the exact approved texts.
  const posted=s.sent.filter(l=>l.startsWith('POST')).map(l=>JSON.parse(l.slice(l.indexOf(' {"context"')+1)).text).sort();
  assert.deepEqual(posted,[ADA_OWN,BRAM_FOR_ADA,BRAM_FOR_CYD,CYD_FOR_BRAM].sort());

  // Board: whose context moved the reading. Counts only, no texts, visible to every member.
  const board=(await s.req(base+'/board','GET',undefined,cyd)).json;assert.equal(board.readings,1);
  const row=(id:string)=>board.board.find((b:any)=>b.memberId===id);
  assert.equal(row(ids.bram).citations,1);assert.equal(row(ids.bram).readingsMoved,1);assert.equal(row(ids.ada).readingsContributed,1);
  assert.equal(row(ids.cyd).readingsContributed,0);assert.equal(row(ids.bram).activeGrants,2);
  const boardText=JSON.stringify(board);for(const t of [BRAM_FOR_ADA,ADA_OWN,BRAM_FOR_CYD,CYD_FOR_BRAM,cr.json.reading.text])assert.ok(!boardText.includes(t));
  // Reading text is private to the requester.
  assert.equal((await s.req(base+'/circle-readings','GET',undefined,ada)).json.readings.length,1);
  assert.equal((await s.req(base+'/circle-readings','GET',undefined,bram)).json.readings.length,0);
  // Non-member sees nothing.
  const eve=await s.signup('Eve');assert.equal((await s.req(base+'/board','GET',undefined,eve)).status,404);

  // Revoke Bram -> Ada: Membrane deletes it; the next reading for Ada can't use it.
  assert.equal((await s.req(`${base}/grants/${g1.json.grant.id}`,'DELETE',undefined,ada)).status,404);   // only the owner revokes
  assert.equal((await s.req(`${base}/grants/${g1.json.grant.id}`,'DELETE',undefined,bram)).status,204);
  await assert.rejects(s.membrane.read(cid,ids.bram,ids.ada,g1.json.grant.id));
  assert.equal((await s.req(base+'/circle-reading','POST',{question:'Again?'},ada)).status,403);
  // Bram's reading still works from Cyd's and Ada's grants to Bram.
  const br=await s.req(base+'/circle-reading','POST',{question:'Us?'},bram);assert.equal(br.status,201);
  assert.deepEqual(br.json.reading.attribution.map((a:any)=>a.memberId).sort(),[ids.ada,ids.bram,ids.cyd].sort());
 }finally{await s.close();}
});

test('a revoked grant is denied by Membrane itself, even if the app row were stale',{skip},async()=>{
 const s=await setup();try{const {bram,ada,ids,cid}=await circleOf3(s);const base=`/circles/${cid}`;
  const g=(await s.req(base+'/grants','POST',{summary:'Bram: short and kind.',to:ids.ada,consent:true},bram)).json.grant;
  const remoteId=(s.db.prepare('SELECT remoteId FROM circle_grant WHERE id=?').get(g.id) as any).remoteId;
  await s.membrane.revoke(cid,ids.bram,remoteId);  // revoked out-of-band, app still says active
  assert.equal((await s.req(base+'/circle-reading','POST',{question:'Week?'},ada)).status,503);
  assert.equal((s.db.prepare('SELECT COUNT(*) n FROM circle_reading').get() as any).n,0);
 }finally{await s.close();}
});

test('account deletion revokes grants made by and to the user in Membrane',{skip},async()=>{
 const s=await setup();try{const {bram,ada,ids,cid}=await circleOf3(s);const base=`/circles/${cid}`;
  await s.req(base+'/grants','POST',{summary:'Bram: hi.',to:ids.ada,consent:true},bram);
  await s.req(base+'/grants','POST',{summary:'Ada: hello.',to:ids.bram,consent:true},ada);
  const remotes=(s.db.prepare('SELECT ownerId,granteeId,remoteId FROM circle_grant').all() as any[]);
  assert.equal((await s.req('/account','DELETE',undefined,bram)).status,204);
  for(const r of remotes)await assert.rejects(s.membrane.read(cid,r.ownerId,r.ownerId,r.remoteId));
  assert.equal((s.db.prepare('SELECT COUNT(*) n FROM circle_grant').get() as any).n,0);
 }finally{await s.close();}
});

test('unconfigured Membrane: grants and circle readings fail closed, board still answers with zeros',async()=>{
 const origin='http://localhost:3602';const rt=await createApp({dbPath:':memory:',baseURL:origin,secret:'synthetic-secret-not-for-deployment-123456',converse:async()=>result('x')});
 const server=rt.app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const port=(server.address() as any).port;
 try{const h=(c='')=>({Origin:origin,'Content-Type':'application/json',Cookie:c});
  const r=await fetch(`http://127.0.0.1:${port}/api/auth/sign-up/email`,{method:'POST',headers:h(),body:JSON.stringify({name:'Ada',email:'ada@example.test',password:'synthetic-password-123'})});const c=r.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');
  const {circle}=await(await fetch(`http://127.0.0.1:${port}/api/circles`,{method:'POST',headers:h(c),body:JSON.stringify({name:'Solo'})})).json();
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/circles/${circle.id}/circle-reading`,{method:'POST',headers:h(c),body:JSON.stringify({question:'Hi?'})})).status,503);
  const b=await(await fetch(`http://127.0.0.1:${port}/api/circles/${circle.id}/board`,{headers:h(c)})).json();assert.equal(b.membraneConfigured,false);assert.equal(b.readings,0);
 }finally{await new Promise<void>(r=>server.close(()=>r()));rt.db.close();}
});

test('citation counting',()=>{
 assert.equal(countCitations('a [A] b [A, B] c [B]','A'),2);assert.equal(countCitations('[AB] [a]','A'),0);
});
