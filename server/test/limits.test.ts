import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase} from '../src/db.js';
import {createReadingLimiter,ReadingLimitError} from '../src/limits.js';

test('persistent atomic reservations enforce sequential user quota and shared provider cap',()=>{
 const dir=mkdtempSync(join(tmpdir(),'constellate-limits-'));const path=join(dir,'limits.sqlite');
 let a=openDatabase(path);a.exec("CREATE TABLE user(id TEXT PRIMARY KEY); INSERT INTO user VALUES('alice'),('bob'),('carol')");
 const b=openDatabase(path);let now=Date.parse('2026-11-07T12:00:00Z');const limits={perUserDaily:2,globalDaily:3,leaseMs:120_000};
 const setup=(db:typeof a)=>createReadingLimiter(db,limits,()=>now);
 let first=setup(a);const second=setup(b);
 const rejects=(action:()=>unknown,reason:string)=>assert.throws(action,e=>e instanceof ReadingLimitError&&e.reason===reason&&e.retryAfter>0);
 try{
  const token=first.reserve('alice');rejects(()=>second.reserve('alice'),'busy');
  // Busy rejections must not spend another global or per-user attempt.
  first.release('alice',token);const next=second.reserve('alice');second.release('alice',next);
  rejects(()=>first.reserve('alice'),'user');
  const bob=first.reserve('bob');first.release('bob',bob);
  rejects(()=>second.reserve('carol'),'global');
  a.close();a=openDatabase(path);first=setup(a);
  rejects(()=>first.reserve('alice'),'user');rejects(()=>first.reserve('carol'),'global');
  first.eraseUser('alice');
  assert.equal(a.prepare("SELECT 1 FROM reading_usage WHERE scope='user:alice'").get(),undefined);
  rejects(()=>first.reserve('alice'),'global'); // deletion cannot refund shared budget
  now+=86_400_000;
  assert.ok(first.reserve('carol')); // UTC reset restores both budgets.
 }finally{a.close();b.close();rmSync(dir,{recursive:true,force:true});}
});

test('crashed reservations recover by lease expiry without refunding possibly billed work',()=>{
 const dir=mkdtempSync(join(tmpdir(),'constellate-crash-'));const path=join(dir,'limits.sqlite');
 let db=openDatabase(path);db.exec("CREATE TABLE user(id TEXT PRIMARY KEY); INSERT INTO user VALUES('alice')");
 let now=Date.parse('2026-11-07T23:59:00Z');const limits={perUserDaily:2,globalDaily:3,leaseMs:120_000};
 let limiter=createReadingLimiter(db,limits,()=>now);const stale=limiter.reserve('alice');db.close();
 db=openDatabase(path);limiter=createReadingLimiter(db,limits,()=>now);
 try{
  assert.throws(()=>limiter.reserve('alice'),ReadingLimitError);
  now+=60_001; // Day rollover alone cannot bypass an active lease.
  assert.throws(()=>limiter.reserve('alice'),ReadingLimitError);
  now+=60_000;const live=limiter.reserve('alice');
  assert.equal(limiter.owns('alice',stale),false);limiter.release('alice',stale);
  assert.equal(limiter.owns('alice',live),true);limiter.release('alice',live);
  const another=limiter.reserve('alice');limiter.release('alice',another);
  assert.throws(()=>limiter.reserve('alice'),e=>e instanceof ReadingLimitError&&e.reason==='user');
  assert.equal((db.prepare("SELECT attempts FROM reading_usage WHERE day='2026-11-07' AND scope='global'").get() as {attempts:number}).attempts,1);
  // A foreign-key failure must roll back every increment.
  assert.throws(()=>limiter.reserve('missing-user'));
  assert.equal((db.prepare("SELECT attempts FROM reading_usage WHERE day='2026-11-08' AND scope='global'").get() as {attempts:number}).attempts,2);
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
