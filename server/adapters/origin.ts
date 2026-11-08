import express from 'express';
import {timingSafeEqual} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createApp} from '../src/server.js';
import {createCompatRouter,assertPreviewDb,createFakeMembrane} from '../src/compat.js';
import {remoteMembraneFromEnv} from '../src/membrane-remote.js';

// Only attach the child app after authenticating the dedicated Pages worker.
// The worker overwrites x-constellate-client-ip from Cloudflare's client IP.
export function protectedOrigin(app:express.Express,token:string){
 if(!token||token.length<32)throw new Error('Origin secret required');
 const expected=Buffer.from(token);
 const gateway=express();gateway.disable('x-powered-by');
 gateway.use((req,res,next)=>{
  const supplied=Buffer.from(req.get('x-constellate-origin-secret')??'');
  if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected)){res.status(403).end();return;}
  delete req.headers['x-constellate-origin-secret'];
  // No XFF translation or loopback proxy trust: the child validates the single IP.
  delete req.headers['x-forwarded-for'];
  next();
 });
 gateway.use(app);return gateway;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const token=process.env.ORIGIN_PROXY_SECRET;
 if(!token||token.length<32)throw new Error('Origin secret required');
 const {app}=await createApp({dbPath:process.env.DB_PATH!,baseURL:process.env.APP_URL!,secret:process.env.BETTER_AUTH_SECRET!,trustedClientIpHeader:true,membrane:remoteMembraneFromEnv()});
 let root:express.Express=app;
 // Circle-first compat API (docs/CIRCLE-INTEGRATION.md), synthetic fixtures only, own DB.
 if(process.env.PREVIEW_FIXTURES==='1'){
  const dbPath=process.env.PREVIEW_DB_PATH!;assertPreviewDb(dbPath);const fake=process.env.PREVIEW_FAKE_MEMBRANE==='1';
  const {router}=createCompatRouter({dbPath,origin:process.env.APP_URL!,secureCookie:true,membrane:remoteMembraneFromEnv()??(fake?createFakeMembrane():undefined),membraneLabel:remoteMembraneFromEnv()?'configured':fake?'fake':undefined});
  root=express();root.disable('x-powered-by');root.use('/api/compat',router);root.use(app);
 }
 protectedOrigin(root,token).listen(Number(process.env.PORT??3490),'127.0.0.1');
}
