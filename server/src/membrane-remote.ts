// Real remote Membrane adapter: exact scoped shares on the attested Membrane container.
// Server side: membrane/app/shares.py in this repo.
//   POST /shares {context,text,readers}  GET /shares/{id}  DELETE /shares/{id}
// Transport: tinfoil SecureClient (attestation verified against configRepo, EHBP).
// Identity: per-user HMAC(SWARM_SECRET, user.ts), the container's existing scheme. The app holds
// SWARM_SECRET and signs as the specific owner/reader, never as a global admin.
import {SecureClient} from 'tinfoil';
import {createHmac} from 'node:crypto';
import type {Membrane} from './circles.js';

export class MembraneError extends Error { constructor(){super('Membrane unavailable');this.name='MembraneError';} }

type Fetcher = (url:string, init:RequestInit)=>Promise<Response>;
export interface RemoteMembraneOptions {
  origin:string;            // e.g. https://<your-membrane>.containers.tinfoil.dev
  configRepo:string;        // public Tinfoil config repo, e.g. <org>/<membrane-config>
  secret:string;            // SWARM_SECRET of that container
  namespace:string;         // prefixes user ids, e.g. 'cst' -> cst:fx_ada
  timeoutMs?:number;
  fetcher?:Fetcher;         // test seam; production uses attested SecureClient.fetch
}

const ID = /^[A-Za-z0-9_.:@-]{1,64}$/;

export function createRemoteMembrane(o:RemoteMembraneOptions):Membrane {
  if(!/^https:\/\/[^/]+$/.test(o.origin)||!o.configRepo||!o.secret||o.secret.length<16||!/^[a-z0-9]{1,8}$/.test(o.namespace))throw new Error('Invalid Membrane configuration');
  const timeoutMs=o.timeoutMs??20_000;
  let fetcher:Promise<Fetcher>|undefined=o.fetcher?Promise.resolve(o.fetcher):undefined;
  const attested=()=>fetcher??=(async()=>{
    const c=new SecureClient({enclaveURL:o.origin,configRepo:o.configRepo,transport:'ehbp'} as any);
    await c.ready();
    if((c as any).getVerificationDocument().securityVerified!==true)throw new MembraneError();
    return (url:string,init:RequestInit)=>c.fetch(url,init);
  })().catch(e=>{fetcher=undefined;throw e;});
  const uid=(u:string)=>{const v=`${o.namespace}:${u}`;if(!ID.test(v))throw new MembraneError();return v;};
  const ctx=(circleId:string)=>{const v=`${o.namespace}:${circleId}`;if(!/^[A-Za-z0-9_.:@-]{1,96}$/.test(v))throw new MembraneError();return v;};
  const sign=(user:string)=>{const ts=String(Math.floor(Date.now()/1000));return {'X-Swarm-User':user,'X-Swarm-Ts':ts,'X-Swarm-Sig':createHmac('sha256',o.secret).update(`${user}.${ts}`).digest('hex')};};
  const call=async(as:string,method:string,path:string,body?:unknown)=>{
    try{
      const f=await attested();
      const r=await f(o.origin+path,{method,headers:{...sign(as),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(timeoutMs)});
      const json=await r.json().catch(()=>null);
      return {status:r.status,json};
    }catch{throw new MembraneError();}
  };
  return {
    async share(circleId,ownerId,summary,peerIds){
      const r=await call(uid(ownerId),'POST','/shares',{context:ctx(circleId),text:summary,readers:peerIds.map(uid)});
      if(r.status!==200||typeof r.json?.id!=='string')throw new MembraneError();
      return {id:r.json.id};
    },
    async read(circleId,ownerId,readerId,id){
      const r=await call(uid(readerId),'GET','/shares/'+encodeURIComponent(id));
      // Remote is authoritative: owner, context must match what we asked for.
      if(r.status!==200||r.json?.owner!==uid(ownerId)||r.json?.context!==ctx(circleId)||typeof r.json?.text!=='string')throw new MembraneError();
      return r.json.text;
    },
    async revoke(_circleId,ownerId,id){
      const r=await call(uid(ownerId),'DELETE','/shares/'+encodeURIComponent(id));
      if(r.status!==200||r.json?.revoked!==true)throw new MembraneError();
    },
  };
}

export function remoteMembraneFromEnv(env:Record<string,string|undefined>=process.env):Membrane|undefined{
  if(!env.MEMBRANE_ORIGIN||!env.MEMBRANE_SWARM_SECRET)return undefined;
  return createRemoteMembrane({origin:env.MEMBRANE_ORIGIN,configRepo:env.MEMBRANE_CONFIG_REPO??'wakesync/constellate',secret:env.MEMBRANE_SWARM_SECRET,namespace:env.MEMBRANE_NAMESPACE??'cst'});
}
