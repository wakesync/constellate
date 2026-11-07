import type Database from 'better-sqlite3';
import {randomUUID} from 'node:crypto';

// A reservation counts a provider attempt, even on error: a timeout does not
// prove the provider did not bill it. Never refund or reclaim daily counters.
export interface ReadingLimits {perUserDaily:number; globalDaily:number; leaseMs:number}
export const DEFAULT_READING_LIMITS:ReadingLimits={perUserDaily:5,globalDaily:100,leaseMs:120_000};
export function readingLimitsFromEnv():ReadingLimits{
 const integer=(key:string,fallback:number)=>{const raw=process.env[key];if(raw===undefined)return fallback;if(!/^\d+$/.test(raw)||!Number.isSafeInteger(Number(raw)))throw new Error(`Invalid ${key}`);return Number(raw);};
 return {...DEFAULT_READING_LIMITS,perUserDaily:integer('READINGS_PER_USER_DAY',5),globalDaily:integer('PROVIDER_DAILY_REQUEST_CAP',100)};
}
export class ReadingLimitError extends Error{
 constructor(public reason:'busy'|'user'|'global',public retryAfter:number){super(reason);}
}
export function createReadingLimiter(db:Database.Database,limits:ReadingLimits=DEFAULT_READING_LIMITS,now=Date.now){
 for(const [key,value] of Object.entries(limits))if(!Number.isSafeInteger(value)||value<0||(key==='leaseMs'&&value<120_000))throw new Error(`Invalid reading limit ${key}`);
 db.exec(`CREATE TABLE IF NOT EXISTS reading_usage(day TEXT NOT NULL, scope TEXT NOT NULL, attempts INTEGER NOT NULL CHECK(attempts>=0), PRIMARY KEY(day,scope));
 CREATE TABLE IF NOT EXISTS reading_lease(userId TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE, token TEXT NOT NULL, expiresAt INTEGER NOT NULL);`);
 const reserve=db.transaction((uid:string)=>{
  const instant=now();const day=new Date(instant).toISOString().slice(0,10);const untilReset=Math.max(1,Math.ceil((Date.parse(day+'T00:00:00Z')+86_400_000-instant)/1000));
  const lease=db.prepare('SELECT expiresAt FROM reading_lease WHERE userId=?').get(uid) as {expiresAt:number}|undefined;
  if(lease&&lease.expiresAt>instant)throw new ReadingLimitError('busy',Math.ceil((lease.expiresAt-instant)/1000));
  const count=(scope:string)=>(db.prepare('SELECT attempts FROM reading_usage WHERE day=? AND scope=?').get(day,scope) as {attempts:number}|undefined)?.attempts??0;
  if(count('user:'+uid)>=limits.perUserDaily)throw new ReadingLimitError('user',untilReset);
  if(count('global')>=limits.globalDaily)throw new ReadingLimitError('global',untilReset);
  const token=randomUUID();
  db.prepare('INSERT INTO reading_lease(userId,token,expiresAt) VALUES(?,?,?) ON CONFLICT(userId) DO UPDATE SET token=excluded.token,expiresAt=excluded.expiresAt').run(uid,token,instant+limits.leaseMs);
  const increment=db.prepare('INSERT INTO reading_usage(day,scope,attempts) VALUES(?,?,1) ON CONFLICT(day,scope) DO UPDATE SET attempts=attempts+1');
  increment.run(day,'user:'+uid);increment.run(day,'global');
  // Bounded metadata, no birth details, email, prompts, or reading text.
  db.prepare('DELETE FROM reading_usage WHERE day<?').run(new Date(instant-7*86_400_000).toISOString().slice(0,10));
  db.prepare('DELETE FROM reading_lease WHERE expiresAt<=?').run(instant);
  return token;
 });
 return {
  reserve:(uid:string)=>reserve.immediate(uid),
  release:(uid:string,token:string)=>{db.prepare('DELETE FROM reading_lease WHERE userId=? AND token=?').run(uid,token);},
  owns:(uid:string,token:string)=>Boolean(db.prepare('SELECT 1 FROM reading_lease WHERE userId=? AND token=? AND expiresAt>?').get(uid,token,now())),
  eraseUser:(uid:string)=>{db.prepare('DELETE FROM reading_usage WHERE scope=?').run('user:'+uid);},
 };
}
