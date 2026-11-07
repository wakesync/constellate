// Starts the REAL Membrane service (membrane/app, FastAPI) on loopback for offline tests.
// No model, no network, no enclave: LLM disabled, synthetic secret, temp sqlite.
// Python: $MEMBRANE_PYTHON, else membrane/.venv/bin/python, else python3. Needs membrane/requirements.txt
// (fastapi, uvicorn, httpx, numpy, pydantic). If unavailable, callers skip with a clear reason.
import {spawn,spawnSync,type ChildProcess} from 'node:child_process';
import {existsSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:net';

const MEMBRANE_DIR=resolve(dirname(fileURLToPath(import.meta.url)),'../../../membrane');
export const SERVICE_SECRET='synthetic-membrane-test-secret-0001';

function python():string|null{
 const candidates=[process.env.MEMBRANE_PYTHON,join(MEMBRANE_DIR,'.venv/bin/python'),'python3'].filter(Boolean) as string[];
 for(const py of candidates){if(py.includes('/')&&!existsSync(py))continue;const r=spawnSync(py,['-c','import fastapi,uvicorn,httpx,numpy,pydantic'],{stdio:'ignore'});if(r.status===0)return py;}
 return null;
}
const freePort=()=>new Promise<number>((ok,bad)=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const p=(s.address() as any).port;s.close(()=>ok(p));});s.on('error',bad);});

export interface MembraneService {origin:string;secret:string;stop():Promise<void>}
export function membraneServiceUnavailable():string|false{return python()?false:'Membrane service deps not installed (pip install -r membrane/requirements.txt or set MEMBRANE_PYTHON)';}

export async function startMembraneService():Promise<MembraneService>{
 const py=python();if(!py)throw new Error('python with membrane deps not found');
 const port=await freePort();const dir=mkdtempSync(join(tmpdir(),'membrane-svc-'));
 const child:ChildProcess=spawn(py,['-m','uvicorn','app.main:app','--host','127.0.0.1','--port',String(port),'--log-level','warning'],{cwd:MEMBRANE_DIR,
  env:{PATH:process.env.PATH??'',HOME:process.env.HOME??dir,DB_PATH:join(dir,'membrane.db'),SWARM_SECRET:SERVICE_SECRET,LLM_ENABLED:'0',ROUTER_DEMO:'0',ENCLAVE_URL:'',STRIPE_KEY:'',PYTHONDONTWRITEBYTECODE:'1'},stdio:['ignore','ignore','pipe']});
 let stderr='';child.stderr!.on('data',d=>{stderr+=String(d);});
 const origin=`http://127.0.0.1:${port}`;
 const deadline=Date.now()+20_000;
 for(;;){
  if(child.exitCode!==null)throw new Error('membrane service exited: '+stderr.slice(-400));
  try{const r=await fetch(origin+'/healthz');if(r.ok)break;}catch{}
  if(Date.now()>deadline){child.kill('SIGKILL');throw new Error('membrane service did not start: '+stderr.slice(-400));}
  await new Promise(r=>setTimeout(r,150));
 }
 return {origin,secret:SERVICE_SECRET,async stop(){child.kill('SIGTERM');await new Promise(r=>{if(child.exitCode!==null)r(null);else child.once('exit',r);});rmSync(dir,{recursive:true,force:true});}};
}
