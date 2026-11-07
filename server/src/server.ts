import express from 'express';
import {toNodeHandler,fromNodeHeaders} from 'better-auth/node';
import {randomUUID} from 'node:crypto';
import {isIP} from 'node:net';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {openDatabase,migrateProduct} from './db.js';
import {createAuth} from './auth.js';
import {mountCircles,type Membrane} from './circles.js';
import {createSqliteCircleGraph,type CircleGraph} from './circle-graph.js';
import type {Conversation} from './conversation.js';
import {birthSchema,type Profile,type Reading,type Chart,type InferenceResult} from './contracts.js';
import {calculateChart} from './chart.js';
import {generateReading,providerConfigured} from './inference.js';
import {createReadingLimiter,readingLimitsFromEnv,ReadingLimitError,type ReadingLimits} from './limits.js';
export async function createApp(options:{dbPath:string;baseURL:string;secret:string;trustedLoopbackProxy?:boolean;trustedClientIpHeader?:boolean;limits?:ReadingLimits;now?:()=>number;converse?:Conversation;membrane?:Membrane;graph?:CircleGraph|false;infer?:(chart:Chart)=>Promise<InferenceResult>}){
 const db=openDatabase(options.dbPath);const auth=await createAuth(db,options.baseURL,options.secret);migrateProduct(db);
 const limiter=createReadingLimiter(db,options.limits??readingLimitsFromEnv(),options.now);
 const app=express();app.disable('x-powered-by');
 // Only the loopback reverse proxy is trusted. Never trust arbitrary proxy hops
 // or accept CF/X-Real-IP headers supplied by a client. Express walks XFF from
 // right to left and stops at the first untrusted hop.
 app.set('trust proxy',options.trustedLoopbackProxy?['127.0.0.1/32','::1/128']:false);
 app.use((req,_res,next)=>{
  const forwarded=req.headers['x-constellate-client-ip'];
  // Explicit opt-in only for an enclosing middleware that has authenticated
  // the origin secret and an edge worker that overwrites this header.
  const verified=options.trustedClientIpHeader&&typeof forwarded==='string'&&isIP(forwarded)?forwarded:undefined;
  req.headers['x-constellate-client-ip']=verified??req.ip??req.socket.remoteAddress??'127.0.0.1';next();
 });
 app.use((_req,res,next)=>{res.set({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"});next();});
 app.use('/api',(req,res,next)=>{if(!['GET','HEAD','OPTIONS'].includes(req.method)&&req.headers.origin!==options.baseURL){res.status(403).json({error:'Request origin rejected'});return;}next();});
 app.all('/api/auth/*splat',toNodeHandler(auth));
 app.use(express.json({limit:'12kb'}));
 app.get('/api/health',(_req,res)=>res.json({ok:true,privateInferenceConfigured:providerConfigured()}));
 app.use('/api',async(req,res,next)=>{const session=await auth.api.getSession({headers:fromNodeHeaders(req.headers)});if(!session){res.status(401).json({error:'Please sign in'});return;}res.locals.user=session.user;res.locals.session=session.session;next();});
 const profile=(uid:string):Profile|null=>{const row=db.prepare('SELECT data FROM profile WHERE userId=?').get(uid) as {data:string}|undefined;return row?JSON.parse(row.data):null;};
 app.get('/api/me',(_req,res)=>res.json({user:res.locals.user,profile:profile(res.locals.user.id),provider:{configured:providerConfigured()}}));
 app.put('/api/profile',(req,res)=>{const parsed=birthSchema.safeParse(req.body);if(!parsed.success){res.status(400).json({error:'Valid birth details and explicit consent are required'});return;}let chart:Chart;try{chart=calculateChart(parsed.data);}catch(e){res.status(400).json({error:(e as Error).message});return;}const p:Profile={birth:parsed.data,chart,updatedAt:new Date().toISOString()};db.prepare('INSERT INTO profile(userId,data,revision) VALUES(?,?,?) ON CONFLICT(userId) DO UPDATE SET data=excluded.data,revision=excluded.revision').run(res.locals.user.id,JSON.stringify(p),randomUUID());res.json({profile:p,chart});});
 app.get('/api/readings',(_req,res)=>{const rows=db.prepare('SELECT data FROM reading WHERE userId=? ORDER BY createdAt DESC').all(res.locals.user.id) as {data:string}[];res.json({readings:rows.map(r=>JSON.parse(r.data))});});
 app.post('/api/readings',async(_req,res)=>{const uid=res.locals.user.id;const snapshot=db.prepare('SELECT data,revision FROM profile WHERE userId=?').get(uid) as {data:string;revision:string}|undefined;const p:Profile|null=snapshot?JSON.parse(snapshot.data):null;if(!p){res.status(400).json({error:'Save your birth details first'});return;}
 let token:string;
 try{token=limiter.reserve(uid);}catch(e){if(e instanceof ReadingLimitError){res.set('Retry-After',String(e.retryAfter));res.status(429).json({error:e.reason==='busy'?'A reading is already being prepared':e.reason==='user'?'Your daily reading limit has been reached. Try again after midnight UTC.':'The daily private inference budget has been reached. Try again after midnight UTC.'});return;}throw e;}
 try{const result=await(options.infer??generateReading)(p.chart);
 // Deletion or profile replacement during inference must not resurrect sensitive records.
 const reading:Reading={...result,id:randomUUID(),chart:p.chart,createdAt:new Date().toISOString()};
 const saved=db.transaction(()=>{const current=db.prepare('SELECT revision FROM profile WHERE userId=?').get(uid) as {revision:string}|undefined;
 if(!current||current.revision!==snapshot!.revision||!limiter.owns(uid,token))return false;
 db.prepare('INSERT INTO reading(id,userId,data,createdAt) VALUES(?,?,?,?)').run(reading.id,uid,JSON.stringify(reading),reading.createdAt);return true;
 }).immediate();
 if(!saved){res.status(409).json({error:'Profile changed. Reading was not saved.'});return;}
 res.status(201).json({reading});
 }catch{res.status(503).json({error:'Private inference is unavailable. No reading was saved. This attempt counts toward the daily limit. Please try again later.'});}finally{limiter.release(uid,token);}});
 app.get('/api/readings/:id',(req,res)=>{const row=db.prepare('SELECT data FROM reading WHERE id=? AND userId=?').get(req.params.id,res.locals.user.id) as {data:string}|undefined;if(!row){res.status(404).json({error:'Reading not found'});return;}res.json({reading:JSON.parse(row.data)});});
 app.delete('/api/readings/:id',(req,res)=>{const r=db.prepare('DELETE FROM reading WHERE id=? AND userId=?').run(req.params.id,res.locals.user.id);res.status(r.changes?204:404).end();});
 const circles=mountCircles(app,db,limiter,{converse:options.converse,membrane:options.membrane,graph:options.graph===false?undefined:(options.graph??createSqliteCircleGraph(db))});
 const clear=db.transaction((uid:string)=>{db.prepare('DELETE FROM reading WHERE userId=?').run(uid);db.prepare('DELETE FROM profile WHERE userId=?').run(uid);});
 app.delete('/api/profile',async(_req,res)=>{try{await circles.revokeUser(res.locals.user.id);}catch{res.status(503).json({error:'Access blocked locally. Remote share revocation must succeed before deletion; please retry.'});return;}clear(res.locals.user.id);res.status(204).end();});
 app.delete('/api/account',async(_req,res)=>{if((options.now??Date.now)()-new Date(res.locals.session.createdAt).getTime()>5*60_000){res.status(403).json({error:'For account deletion, please sign out and sign in again, then retry within five minutes.'});return;}try{await circles.revokeUser(res.locals.user.id);}catch{res.status(503).json({error:'Access blocked locally. Remote share revocation must succeed before deletion; please retry.'});return;}db.transaction(()=>{const uid=res.locals.user.id;clear(uid);limiter.eraseUser(uid);db.prepare('DELETE FROM session WHERE userId=?').run(uid);db.prepare('DELETE FROM account WHERE userId=?').run(uid);db.prepare('DELETE FROM user WHERE id=?').run(uid);})();res.status(204).end();});
 app.use(express.static(resolve('public')));
 app.use((err:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{res.status(500).json({error:'Request could not be completed'});});
 return {app,db,auth};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const port=Number(process.env.PORT??3400);const baseURL=process.env.APP_URL??`http://localhost:${port}`;
 if(process.env.NODE_ENV==='production'&&!baseURL.startsWith('https://'))throw new Error('Production requires HTTPS APP_URL');
 const {app}=await createApp({dbPath:process.env.DB_PATH??'data/constellate.sqlite',baseURL,secret:process.env.BETTER_AUTH_SECRET??'',trustedLoopbackProxy:process.env.TRUST_LOOPBACK_PROXY==='1'});
 app.listen(port,'127.0.0.1',()=>console.log(`Constellate listening on port ${port}`));
}
