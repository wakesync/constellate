import express from 'express';
import {createCompatRouter, assertPreviewDb, createFakeMembrane} from './compat.js';

// Synthetic-fixture preview backend for the existing React frontend. Never point at prod data.
if (process.env.PREVIEW_FIXTURES !== '1') throw new Error('Set PREVIEW_FIXTURES=1 (synthetic fixtures only)');
const dbPath = process.env.PREVIEW_DB_PATH ?? 'data/constellate-preview.sqlite';
assertPreviewDb(dbPath);
const origin = process.env.PREVIEW_ORIGIN;
if (!origin || !/^https?:\/\/[^/]+$/.test(origin)) throw new Error('PREVIEW_ORIGIN must be the exact frontend origin');
const fake = process.env.PREVIEW_FAKE_MEMBRANE === '1';
const {router} = createCompatRouter({dbPath, origin, membrane: fake ? createFakeMembrane() : undefined, membraneLabel: fake ? 'fake' : undefined, secureCookie: origin.startsWith('https://')});
const app = express(); app.disable('x-powered-by');
app.set('trust proxy', ['127.0.0.1/32','::1/128']);
app.use((_req,res,next)=>{res.set({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});next();});
app.get('/compat/healthz', (_req,res)=>res.json({ok:true, fixtures:true, membrane: fake?'fake':'unconfigured'}));
app.use('/compat', router);
const port = Number(process.env.PORT ?? 3410);
app.listen(port, '127.0.0.1', ()=>console.log(`constellate preview compat on ${port}`));
