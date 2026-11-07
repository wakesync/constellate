// Synthetic chart + relationship-pair generator for distillation.
//
// Every person here is synthetic: a seeded PRNG picks a birth instant and an
// IANA zone, then the SAME production ephemeris (server/src/chart.ts, Astronomy
// Engine) computes the placements. No real person's data is used or derivable.
// The output carries only what the reading prompt is allowed to see
// (placements + timeKnown), never the synthetic birth date/time/zone, so the
// student learns the exact input shape the private router sends in production.
//
// Usage (from repo root):
//   server/node_modules/.bin/tsx distill/gen/generate.ts --n 2000 --seed 7 --out distill/data/inputs.jsonl
//   flags: --n rows, --seed int, --pairs-ratio 0..1 (default 0.5), --heldout-ratio 0..1 (default 0.1)
import {writeFileSync, mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {calculateChart} from '../../server/src/chart.js';
import {pairFeatures, RELATIONSHIPS, type Placement} from './pair.js';

const ZONES = ['Etc/UTC','America/New_York','America/Chicago','America/Denver','America/Los_Angeles','America/Sao_Paulo','America/Mexico_City','Europe/London','Europe/Berlin','Europe/Madrid','Africa/Lagos','Africa/Nairobi','Asia/Kolkata','Asia/Tokyo','Asia/Singapore','Australia/Sydney','Pacific/Auckland'];
const NAMES = ['ada','bram','rowan','mara','teo','juno','ilse','kai','noor','pim','soren','wren','zia','oli','lev','tamsin'];

export function rng(seed: number) {
  // mulberry32: deterministic, so a dataset is reproducible from (n, seed).
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function syntheticPerson(r: () => number) {
  // 1940..2010, uniform by day. 12% unknown birth time, like real onboarding.
  for (;;) {
    const day = Math.floor(r() * 25567) + Math.floor((Date.UTC(1940, 0, 1)) / 86400000);
    const date = new Date(day * 86400000).toISOString().slice(0, 10);
    const known = r() > 0.12;
    const time = known ? `${String(Math.floor(r() * 24)).padStart(2, '0')}:${String(Math.floor(r() * 60)).padStart(2, '0')}` : null;
    const timeZone = ZONES[Math.floor(r() * ZONES.length)]!;
    try {
      const chart = calculateChart({date, time, timeZone, latitude: null, longitude: null, consent: true});
      return {timeKnown: chart.timeKnown, placements: chart.placements.map(p => ({body: p.body, sign: p.sign, degree: Math.round(p.degree * 100) / 100, longitude: Math.round(p.longitude * 100) / 100}))};
    } catch { /* DST gap/overlap: draw again */ }
  }
}

export type Row =
  | {id: string; split: 'train'|'heldout'; task: 'natal'; input: {placements: Placement[]; timeKnown: boolean}}
  | {id: string; split: 'train'|'heldout'; task: 'pair'; input: {a: {name: string; placements: Placement[]; timeKnown: boolean}; b: {name: string; placements: Placement[]; timeKnown: boolean}; relationship: string; romanticOptIn: boolean; features: ReturnType<typeof pairFeatures>; priorThemes: string[]}};

export function generate(n: number, seed: number, pairsRatio = 0.5, heldoutRatio = 0.1): Row[] {
  const r = rng(seed); const rows: Row[] = [];
  for (let i = 0; i < n; i++) {
    const split = r() < heldoutRatio ? 'heldout' : 'train';
    const id = `syn-${seed}-${String(i).padStart(5, '0')}`;
    if (r() >= pairsRatio) { rows.push({id, split, task: 'natal', input: syntheticPerson(r)}); continue; }
    const a = syntheticPerson(r), b = syntheticPerson(r);
    const relationship = RELATIONSHIPS[Math.floor(r() * RELATIONSHIPS.length)]!;
    // Romantic framing only when both opted in, mirroring the product rule.
    const romanticOptIn = relationship === 'romantic';
    const features = pairFeatures(a.placements, b.placements);
    // ~30% of pairs carry prior themes so the student learns to use circle memory.
    const priorThemes = r() < 0.3 ? features.themes.slice(0, 2) : [];
    const na = NAMES[Math.floor(r() * NAMES.length)]!; let nb = NAMES[Math.floor(r() * NAMES.length)]!; if (nb === na) nb = NAMES[(NAMES.indexOf(na) + 1) % NAMES.length]!;
    rows.push({id, split, task: 'pair', input: {a: {name: na, ...a}, b: {name: nb, ...b}, relationship, romanticOptIn, features, priorThemes}});
  }
  return rows;
}

function arg(name: string, dflt: string) { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1]! : dflt; }
if (import.meta.url === `file://${process.argv[1]}`) {
  const out = arg('out', 'distill/data/inputs.jsonl');
  const rows = generate(Number(arg('n', '20')), Number(arg('seed', '7')), Number(arg('pairs-ratio', '0.5')), Number(arg('heldout-ratio', '0.1')));
  mkdirSync(dirname(out), {recursive: true});
  writeFileSync(out, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  console.log(`wrote ${rows.length} rows (${rows.filter(r => r.task === 'pair').length} pairs, ${rows.filter(r => r.split === 'heldout').length} heldout) -> ${out}`);
}
