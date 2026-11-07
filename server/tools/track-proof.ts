import { createHash, randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SecureClient } from 'tinfoil';
import { generateReading } from '../src/inference.js';
import type { Chart, InferenceResult } from '../src/contracts.js';

// Synthetic placements, not calculated from any person's birth data.
function syntheticChart(): Chart {
  return {version:'synthetic-proof-only',calculatedAt:'',timeKnown:false,limitations:[],
    placements:[{body:'Sun',longitude:10,sign:'Aries',degree:10}]};
}
const SAFE_ERROR = 'Track proof failed. Check configuration, availability and attestation privately.';
export interface ContainerClient {
  ready(): Promise<void>;
  getVerificationDocument(): {securityVerified: boolean};
  fetch: typeof fetch;
}
type ContainerFactory = (options: {enclaveURL:string;configRepo:string;transport:'tls';userCacheSecret:string}) => ContainerClient;

export async function proveInference(infer:(chart:Chart)=>Promise<InferenceResult> = generateReading) {
  const start = performance.now();
  try {
    const result = await infer(syntheticChart());
    if (result.provider !== 'tinfoil' || result.verification !== 'sdk-attested' || !result.text.trim()) throw Error();
    return {schemaVersion:1,kind:'hosted-inference-observation',observedAt:new Date().toISOString(),
      durationMs:Math.round(performance.now()-start),sdkAttested:true,syntheticInput:true,
      outputCharacters:result.text.length,outputSha256:createHash('sha256').update(result.text).digest('hex'),
      scope:'Hosted inference only; not application-container attestation, revenue, or track eligibility.'};
  } catch { throw new Error(SAFE_ERROR); }
}

export async function proveContainer(
  config:{url:string;repo:string},
  factory:ContainerFactory = options => new SecureClient(options),
  deadlineMs = 30_000,
) {
  const start = performance.now();
  const controller = new AbortController();
  let timer:ReturnType<typeof setTimeout>|undefined;
  try {
    const url = new URL(config.url);
    // A deliberately narrow read-only proof, not a general URL fetcher. Custom
    // domains can use the canonical container hostname for this demonstration.
    if (url.protocol !== 'https:' || url.username || url.password || url.port ||
        url.pathname !== '/' || url.search || url.hash ||
        !/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.containers\.tinfoil\.dev$/i.test(url.hostname) ||
        !/^[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/.test(config.repo) ||
        !Number.isFinite(deadlineMs) || deadlineMs <= 0) throw Error();
    const client = factory({enclaveURL:url.origin,configRepo:config.repo,transport:'tls',userCacheSecret:randomBytes(32).toString('hex')});
    const work = async () => {
      await client.ready();
      if (controller.signal.aborted || client.getVerificationDocument().securityVerified !== true) throw Error();
      const response = await client.fetch(`${url.origin}/api/health`, {method:'GET',redirect:'error',signal:controller.signal});
      if (!response.ok || controller.signal.aborted) throw Error();
      // Bound even an attested application's response; never echo its contents.
      const reader = response.body?.getReader();
      if (!reader) throw Error();
      let text = ''; let bytes = 0; const decoder = new TextDecoder();
      try {
        while (true) {
          const {done,value} = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > 4096 || controller.signal.aborted) throw Error();
          text += decoder.decode(value,{stream:true});
        }
        text += decoder.decode();
      } finally { await reader.cancel().catch(()=>{}); reader.releaseLock(); }
      const health:unknown = JSON.parse(text);
      if (!health || typeof health !== 'object' || !('ok' in health) || health.ok !== true ||
          !('privateInferenceConfigured' in health) || typeof health.privateInferenceConfigured !== 'boolean' || controller.signal.aborted) throw Error();
      return {schemaVersion:1,kind:'application-container-observation',observedAt:new Date().toISOString(),
        durationMs:Math.round(performance.now()-start),containerOrigin:url.origin,configRepo:config.repo,
        sdkAttested:true,transport:'tls',healthOk:true,inferenceConfigured:health.privateInferenceConfigured,
        scope:'Attested app health only; not a live reading, persistence audit, browser privacy proof, revenue, or eligibility decision.'};
    };
    const deadline = new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error());},deadlineMs);});
    return await Promise.race([work(),deadline]);
  } catch { throw new Error(SAFE_ERROR); }
  finally {if(timer) clearTimeout(timer);}
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const mode = process.argv[2];
    if (process.argv.length !== 3 || !['inference','container'].includes(mode ?? '')) throw Error();
    const receipt = mode === 'inference' ? await proveInference() : await proveContainer({
      url:process.env.TINFOIL_CONTAINER_URL ?? '',repo:process.env.TINFOIL_CONFIG_REPO ?? '',
    });
    console.log(JSON.stringify(receipt,null,2));
  } catch {console.error(SAFE_ERROR);process.exitCode=1;}
}
