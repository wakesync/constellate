import type {Express,Request,Response,NextFunction} from 'express';
import type Database from 'better-sqlite3';
import {randomUUID,randomBytes} from 'node:crypto';
import {z} from 'zod';
import {ReadingLimitError,createReadingLimiter} from './limits.js';
import {generateConversation,type Conversation,type Message} from './conversation.js';
import {extractThemes,type CircleGraph} from './circle-graph.js';

// Production adapter must implement real scoped remote authorization. A local ACL
// is defense in depth, never evidence that Membrane granted or revoked anything.
export interface Membrane {
 share(circleId:string,ownerId:string,summary:string,peerIds:string[]):Promise<{id:string}>;
 read(circleId:string,ownerId:string,readerId:string,id:string):Promise<string>;
 revoke(circleId:string,ownerId:string,id:string):Promise<void>;
}
export function mountCircles(app:Express,db:Database.Database,limiter:ReturnType<typeof createReadingLimiter>,options:{converse?:Conversation;membrane?:Membrane;graph?:CircleGraph}={}){
 const converse=options.converse??generateConversation;
 db.exec(`CREATE TABLE IF NOT EXISTS conversation(readingId TEXT PRIMARY KEY REFERENCES reading(id) ON DELETE CASCADE,userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS circle(id TEXT PRIMARY KEY,name TEXT NOT NULL,inviteCode TEXT NOT NULL UNIQUE,createdAt TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS circle_member(circleId TEXT REFERENCES circle(id) ON DELETE CASCADE,userId TEXT REFERENCES user(id) ON DELETE CASCADE,PRIMARY KEY(circleId,userId));
 CREATE TABLE IF NOT EXISTS circle_share(circleId TEXT NOT NULL,userId TEXT NOT NULL,summary TEXT NOT NULL,remoteId TEXT,revision TEXT NOT NULL,status TEXT NOT NULL,PRIMARY KEY(circleId,userId),FOREIGN KEY(circleId,userId) REFERENCES circle_member(circleId,userId) ON DELETE CASCADE);`);
 const wrap=(fn:(req:Request,res:Response)=>Promise<void>|void)=>(req:Request,res:Response,next:NextFunction)=>Promise.resolve().then(()=>fn(req,res)).catch(e=>{
  if(e instanceof z.ZodError){res.status(400).json({error:'Invalid request or missing explicit consent'});return;}
  if(e instanceof ReadingLimitError){res.set('Retry-After',String(e.retryAfter));res.status(429).json({error:'Private inference limit reached or another request is running'});return;}
  next(e);
 });
 const uid=(res:Response)=>res.locals.user.id as string;
 const member=(circleId:string,userId:string)=>Boolean(db.prepare('SELECT 1 FROM circle_member WHERE circleId=? AND userId=?').get(circleId,userId));
 const members=(circleId:string)=>(db.prepare('SELECT userId FROM circle_member WHERE circleId=? ORDER BY userId').all(circleId) as {userId:string}[]).map(r=>r.userId);
 const reading=(id:string,userId:string)=>db.prepare('SELECT data FROM reading WHERE id=? AND userId=?').get(id,userId) as {data:string}|undefined;
 const history=(id:string,userId:string):Message[]=>{const row=db.prepare('SELECT data FROM conversation WHERE readingId=? AND userId=?').get(id,userId) as {data:string}|undefined;return row?JSON.parse(row.data):[];};
 app.get('/api/readings/:id/chat',(req,res)=>{const id=String(req.params.id);if(!reading(id,uid(res))){res.status(404).json({error:'Reading not found'});return;}res.json({messages:history(id,uid(res))});});
 app.post('/api/readings/:id/chat',wrap(async(req,res)=>{
  const id=String(req.params.id),userId=uid(res),row=reading(id,userId);if(!row){res.status(404).json({error:'Reading not found'});return;}
  const {message}=z.object({message:z.string().trim().min(1).max(2000)}).strict().parse(req.body);
  const previous=history(id,userId);if(previous.length>=20){res.status(409).json({error:'This reading conversation has reached its ten-turn limit'});return;}
  const token=limiter.reserve(userId);
  try{
   // Only the saved interpretation, never chart.calculatedAt or raw birth profile.
   const reply=await converse(JSON.parse(row.data).text,[...previous,{role:'user',content:message}]);
   if(!reading(id,userId)||!limiter.owns(userId,token)){res.status(409).json({error:'Reading changed or was deleted; reply discarded'});return;}
   const messages:Message[]=[...previous,{role:'user',content:message},{role:'assistant',content:reply.text}];
   db.prepare('INSERT INTO conversation(readingId,userId,data) VALUES(?,?,?) ON CONFLICT(readingId) DO UPDATE SET data=excluded.data').run(id,userId,JSON.stringify(messages));res.json({messages,reply});
  }catch{res.status(503).json({error:'Private inference unavailable. No reply saved. Attempt counts toward the daily limit.'});}finally{limiter.release(userId,token);}
 }));
 const view=(id:string,userId:string)=>{
  const c=db.prepare('SELECT * FROM circle WHERE id=?').get(id) as any;
  return {...c,members:members(id).map(id=>({id,isYou:id===userId,name:(db.prepare('SELECT name FROM user WHERE id=?').get(id) as {name:string}|undefined)?.name??'member'})),shares:(db.prepare('SELECT userId,status,summary FROM circle_share WHERE circleId=?').all(id) as any[]).map(s=>({userId:s.userId,status:s.status,...(s.userId===userId?{summary:s.summary}:{})})),membraneConfigured:Boolean(options.membrane)};
 };
 app.get('/api/circles',(_req,res)=>{const rows=db.prepare('SELECT circleId FROM circle_member WHERE userId=?').all(uid(res)) as {circleId:string}[];res.json({circles:rows.map(r=>view(r.circleId,uid(res))),membraneConfigured:Boolean(options.membrane)});});
 app.post('/api/circles',wrap((req,res)=>{const {name}=z.object({name:z.string().trim().min(1).max(80)}).strict().parse(req.body);const id=randomUUID();db.transaction(()=>{db.prepare('INSERT INTO circle VALUES(?,?,?,?)').run(id,name,randomBytes(18).toString('base64url'),new Date().toISOString());db.prepare('INSERT INTO circle_member VALUES(?,?)').run(id,uid(res));})();res.status(201).json({circle:view(id,uid(res))});}));
 app.post('/api/circles/join',wrap((req,res)=>{const {inviteCode}=z.object({inviteCode:z.string().min(20).max(100),consent:z.literal(true)}).strict().parse(req.body);const row=db.prepare('SELECT id FROM circle WHERE inviteCode=?').get(inviteCode) as {id:string}|undefined;if(!row){res.status(404).json({error:'Invitation not found'});return;}
  // Freeze membership after any share, so late joiners never silently inherit grants.
  if(!member(row.id,uid(res))&&db.prepare('SELECT 1 FROM circle_share WHERE circleId=?').get(row.id)){res.status(409).json({error:'Circle membership is frozen after sharing begins. Create a new circle.'});return;}
  if(members(row.id).length>=8&&!member(row.id,uid(res))){res.status(409).json({error:'Circle is full'});return;}
  db.prepare('INSERT OR IGNORE INTO circle_member VALUES(?,?)').run(row.id,uid(res));res.json({circle:view(row.id,uid(res))});
 }));
 app.use('/api/circles/:id',(req,res,next)=>{if(!member(String(req.params.id),uid(res))){res.status(404).json({error:'Circle not found'});return;}next();});
 // Circle memory board: themes + provenance. Other members' summary text stays hidden, like the circle view.
 app.get('/api/circles/:id/memory',wrap(async(req,res)=>{if(!options.graph){res.status(503).json({error:'Circle memory is not configured'});return;}const s=await options.graph.snapshot(String(req.params.id));res.json({memory:{...s,summaries:s.summaries.map(x=>({shareId:x.shareId,memberId:x.memberId,themes:x.themes,...(x.memberId===uid(res)?{text:x.text}:{})}))}});}));
 app.get('/api/circles/:id',(req,res)=>{res.json({circle:view(String(req.params.id),uid(res))});});
 app.post('/api/circles/:id/shares',wrap(async(req,res)=>{
  const id=String(req.params.id),userId=uid(res);const {summary}=z.object({summary:z.string().min(1).max(1500),consent:z.literal(true)}).strict().parse(req.body);
  if(!summary.trim()){res.status(400).json({error:'Summary cannot be blank'});return;}
  if(!options.membrane){res.status(503).json({error:'Membrane is not configured. Nothing was shared.'});return;}
  const peers=members(id).filter(p=>p!==userId);if(!peers.length){res.status(409).json({error:'At least two authenticated circle members are required'});return;}
  if(db.prepare('SELECT 1 FROM circle_share WHERE circleId=? AND userId=?').get(id,userId)){res.status(409).json({error:'Revoke the existing share before sharing again'});return;}
  const revision=randomUUID();db.prepare('INSERT INTO circle_share VALUES(?,?,?,NULL,?,?)').run(id,userId,summary,revision,'pending');
  try{const remote=await options.membrane.share(id,userId,summary,peers);const result=db.prepare("UPDATE circle_share SET remoteId=?,status='active' WHERE circleId=? AND userId=? AND revision=? AND status='pending'").run(remote.id,id,userId,revision);
   if(!result.changes){await options.membrane.revoke(id,userId,remote.id);res.status(409).json({error:'Share was cancelled'});return;}
   // Circle graph learns ONLY from a share Membrane confirmed active. Best effort: never blocks sharing.
   if(options.graph)await options.graph.addShare(id,userId,remote.id,summary).catch(()=>{});
   res.status(201).json({circle:view(id,userId)});
  }catch{db.prepare("UPDATE circle_share SET status='failed' WHERE circleId=? AND userId=? AND revision=?").run(id,userId,revision);res.status(503).json({error:'Membrane sharing failed. No peer access is enabled in this app.'});}
 }));
 app.delete('/api/circles/:id/shares/me',wrap(async(req,res)=>{
  const id=String(req.params.id),userId=uid(res);const share=db.prepare('SELECT remoteId,status FROM circle_share WHERE circleId=? AND userId=?').get(id,userId) as {remoteId:string|null;status:string}|undefined;
  if(!share){res.status(204).end();return;}
  if(share.status==='pending'){res.status(409).json({error:'Sharing is in progress. Retry revocation when it completes.'});return;}
  db.prepare("UPDATE circle_share SET status='revoked',revision=? WHERE circleId=? AND userId=?").run(randomUUID(),id,userId);
  if(!options.membrane){res.status(503).json({error:'Local access blocked; remote revocation not confirmed'});return;}
  // Graph drop first: derived themes stop being usable even if remote revoke must be retried.
  if(options.graph)await options.graph.revokeShare(id,userId).catch(()=>{});
  try{if(share.remoteId)await options.membrane.revoke(id,userId,share.remoteId);db.prepare('DELETE FROM circle_share WHERE circleId=? AND userId=?').run(id,userId);res.status(204).end();}catch{res.status(503).json({error:'Local access blocked; remote revocation not confirmed. Retry revocation.'});}
 }));
 app.post('/api/circles/:id/interact',wrap(async(req,res)=>{
  const id=String(req.params.id),userId=uid(res);const {message}=z.object({message:z.string().trim().min(1).max(1000)}).strict().parse(req.body);
  if(!options.membrane){res.status(503).json({error:'Membrane is not configured. No agent interaction occurred.'});return;}
  const shares=db.prepare("SELECT userId,summary,remoteId,revision FROM circle_share WHERE circleId=? AND status='active' ORDER BY userId").all(id) as {userId:string;summary:string;remoteId:string;revision:string}[];
  if(shares.length<2||!shares.some(s=>s.userId===userId)){res.status(403).json({error:'Two members must each approve a summary before their agents can interact'});return;}
  const current=()=>shares.every(s=>Boolean(db.prepare("SELECT 1 FROM circle_share WHERE circleId=? AND userId=? AND revision=? AND status='active'").get(id,s.userId,s.revision)));
  const tokens:{userId:string;token:string}[]=[];
  try{
   // Each agent executes a separate attested call with only remotely authorized
   // summaries. Caller pays for every completion, not the passive circle member.
   const turns=[];
   // Memory across runs: what earlier readings for this same pair surfaced (themes only, from approved shares).
   const pair=[shares[0]!.userId,shares[1]!.userId] as [string,string];
   const priorThemes=options.graph?await options.graph.priorThemes(id,pair[0],pair[1]).catch(()=>[] as string[]):[];
   for(const agent of shares.slice(0,2)){
    if(!current())throw Error('revoked');const approved=[];
    for(const owner of shares){const text=await options.membrane.read(id,owner.userId,agent.userId,owner.remoteId);if(text!==owner.summary)throw Error('summary integrity');approved.push({memberId:owner.userId,summary:text});}
    if(!current())throw Error('revoked');const token=limiter.reserve(userId);tokens.push({userId,token});
    const result=await converse(JSON.stringify({agentFor:agent.userId,approvedSummaries:approved,priorAgentTurn:turns.at(-1)?.text??null,...(priorThemes.length?{priorCircleThemes:priorThemes}:{})}),[{role:'user',content:message}]);
    if(!current()||!limiter.owns(userId,token))throw Error('revoked');turns.push({agentFor:agent.userId,...result});limiter.release(userId,token);
   }
   let themes:string[]=[];
   if(options.graph&&current()){themes=extractThemes(turns.map(t=>t.text).join('\n'));await options.graph.recordReading(id,pair,randomUUID(),themes,shares.slice(0,2).map(s=>s.remoteId)).catch(()=>{});}
   res.json({turns,transport:'membrane',persisted:false,...(options.graph?{memory:{priorThemes,themes}}:{})});
  }catch(e){if(e instanceof ReadingLimitError)throw e;res.status(503).json({error:'Authorized agent interaction unavailable or access revoked. No interaction saved.'});}finally{for(const t of tokens)limiter.release(t.userId,t.token);}
 }));
 return {async revokeUser(userId:string){
  const shares=db.prepare('SELECT circleId,remoteId,status FROM circle_share WHERE userId=?').all(userId) as {circleId:string;remoteId:string|null;status:string}[];
  if(shares.some(s=>s.status==='pending'))throw Error('Sharing in progress');
  db.prepare("UPDATE circle_share SET status='revoked',revision=? WHERE userId=?").run(randomUUID(),userId);
  for(const share of shares){if(share.remoteId){if(!options.membrane)throw Error('Remote revocation unavailable');await options.membrane.revoke(share.circleId,userId,share.remoteId);}}
  if(options.graph){for(const share of shares)await options.graph.revokeShare(share.circleId,userId).catch(()=>{});await options.graph.forgetMember(userId).catch(()=>{});}
  db.prepare('DELETE FROM circle_share WHERE userId=?').run(userId);
 }};
}
