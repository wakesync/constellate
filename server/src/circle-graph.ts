// Permissioned circle knowledge graph (Cognee bounty).
//
// Per circle: member nodes, approved-summary nodes, theme nodes, and reading
// nodes that link a pair of members to the themes that reading surfaced.
//
// Permission rules, enforced by every implementation (see test/circle-graph.test.ts):
//  1. Only APPROVED content enters: a summary is added only after its share is
//     active in Membrane. Readings, chats and charts are never written. A reading
//     contributes only closed-vocabulary theme labels plus which approved shares
//     it drew on (provenance), never its text.
//  2. Revoke removes: dropping a share deletes its summary node, every theme
//     edge it supported, and every reading node that drew on it (and that
//     reading's theme edges). Orphan themes are pruned. A member who has no
//     active share left keeps no node.
//  3. Memory across runs: priorThemes(circle, a, b) returns the themes earlier
//     readings for the same pair surfaced, which the next reading receives.
//
// Implementations: createSqliteCircleGraph (pure TS, offline, default) and
// createCogneeCircleGraph (circle-graph-cognee.ts, talks to the self-hosted
// cognee module in membrane/app/circle_graph.py). Both satisfy this interface.
import type Database from 'better-sqlite3';
import {createHash} from 'node:crypto';

export interface CircleGraphSnapshot {
  circleId: string;
  members: string[];
  summaries: {shareId: string; memberId: string; text: string; themes: string[]}[];
  themes: {theme: string; members: string[]; readings: number; weight: number}[];
  readings: {readingId: string; pair: [string, string]; themes: string[]; sources: string[]}[];
}

export interface CircleGraph {
  /** Call only after the share is active. Idempotent per (circle, shareId). */
  addShare(circleId: string, memberId: string, shareId: string, summary: string): Promise<void>;
  /** Removes the member's summary and everything derived from it in this circle. */
  revokeShare(circleId: string, memberId: string): Promise<void>;
  /** Records which themes a reading for a pair surfaced. `sources` = share ids the reading drew on. */
  recordReading(circleId: string, pair: [string, string], readingId: string, themes: string[], sources: string[]): Promise<void>;
  /** Themes surfaced by earlier readings for this pair, most recurring first. */
  priorThemes(circleId: string, a: string, b: string, limit?: number): Promise<string[]>;
  snapshot(circleId: string): Promise<CircleGraphSnapshot>;
  /** Account deletion: drop the member from every circle graph. */
  forgetMember(memberId: string): Promise<void>;
}

// Closed theme vocabulary. Matches the distill/ pair themes so distilled
// readings and circle memory share one language. Keyword match is deterministic:
// no model ever decides what gets stored.
export const THEMES: Record<string, RegExp> = {
  'communication': /\b(communicat\w*|talk\w*|listen\w*|conversation\w*|mercury|words?|express\w*)\b/i,
  'emotional needs': /\b(emotion\w*|feel\w*|moon|nurtur\w*|comfort\w*|sensitiv\w*|care\w*)\b/i,
  'conflict and drive': /\b(conflict\w*|clash\w*|mars|anger|tension\w*|drive|push\w*|friction)\b/i,
  'affection and values': /\b(venus|affection\w*|values?|warmth|apprecia\w*|generos\w*)\b/i,
  'identity': /\b(identity|sun|self|confiden\w*|purpose|ego)\b/i,
  'structure and routine': /\b(routine\w*|structure\w*|saturn|plan\w*|schedule\w*|discipline|chores?|morning)\b/i,
  'growth and adventure': /\b(growth|jupiter|adventur\w*|explor\w*|travel\w*|optimis\w*)\b/i,
  'creativity': /\b(creativ\w*|art|paint\w*|music|play\w*|imagin\w*|neptune|build\w*)\b/i,
  'independence': /\b(independen\w*|space|freedom|uranus|alone|autonom\w*)\b/i,
};
export function extractThemes(text: string): string[] {
  return Object.entries(THEMES).filter(([, re]) => re.test(text)).map(([t]) => t);
}

const pairKey = (a: string, b: string): [string, string] => (a < b ? [a, b] : [b, a]);
const MAX_SUMMARY = 4000;
const ID = /^[A-Za-z0-9_.:@-]{1,96}$/;
const check = (...ids: string[]) => { for (const id of ids) if (!ID.test(id)) throw new Error('Invalid circle graph id'); };
const known = (themes: string[]) => [...new Set(themes)].filter(t => t in THEMES);

export function createSqliteCircleGraph(db: Database.Database): CircleGraph {
  db.exec(`
  CREATE TABLE IF NOT EXISTS cg_summary(circleId TEXT NOT NULL, memberId TEXT NOT NULL, shareId TEXT NOT NULL, text TEXT NOT NULL, digest TEXT NOT NULL, PRIMARY KEY(circleId, memberId));
  CREATE TABLE IF NOT EXISTS cg_summary_theme(circleId TEXT NOT NULL, memberId TEXT NOT NULL, theme TEXT NOT NULL, PRIMARY KEY(circleId, memberId, theme), FOREIGN KEY(circleId, memberId) REFERENCES cg_summary(circleId, memberId) ON DELETE CASCADE);
  CREATE TABLE IF NOT EXISTS cg_reading(circleId TEXT NOT NULL, readingId TEXT NOT NULL, a TEXT NOT NULL, b TEXT NOT NULL, createdAt TEXT NOT NULL, PRIMARY KEY(circleId, readingId));
  CREATE INDEX IF NOT EXISTS cg_reading_pair ON cg_reading(circleId, a, b);
  CREATE TABLE IF NOT EXISTS cg_reading_theme(circleId TEXT NOT NULL, readingId TEXT NOT NULL, theme TEXT NOT NULL, PRIMARY KEY(circleId, readingId, theme), FOREIGN KEY(circleId, readingId) REFERENCES cg_reading(circleId, readingId) ON DELETE CASCADE);
  CREATE TABLE IF NOT EXISTS cg_reading_source(circleId TEXT NOT NULL, readingId TEXT NOT NULL, shareId TEXT NOT NULL, PRIMARY KEY(circleId, readingId, shareId), FOREIGN KEY(circleId, readingId) REFERENCES cg_reading(circleId, readingId) ON DELETE CASCADE);
  CREATE INDEX IF NOT EXISTS cg_reading_source_share ON cg_reading_source(circleId, shareId);`);
  const dropShare = db.transaction((circleId: string, memberId: string) => {
    const row = db.prepare('SELECT shareId FROM cg_summary WHERE circleId=? AND memberId=?').get(circleId, memberId) as {shareId: string} | undefined;
    // Readings that drew on this share, or that involve this member at all, go too.
    const readings = db.prepare(`SELECT DISTINCT readingId FROM cg_reading WHERE circleId=? AND (a=? OR b=?)
      UNION SELECT readingId FROM cg_reading_source WHERE circleId=? AND shareId=?`).all(circleId, memberId, memberId, circleId, row?.shareId ?? '') as {readingId: string}[];
    for (const r of readings) db.prepare('DELETE FROM cg_reading WHERE circleId=? AND readingId=?').run(circleId, r.readingId);
    db.prepare('DELETE FROM cg_summary WHERE circleId=? AND memberId=?').run(circleId, memberId);
  });
  return {
    async addShare(circleId, memberId, shareId, summary) {
      check(circleId, memberId, shareId);
      if (typeof summary !== 'string' || !summary.trim() || summary.length > MAX_SUMMARY) throw new Error('Invalid summary');
      db.transaction(() => {
        db.prepare('DELETE FROM cg_summary WHERE circleId=? AND memberId=?').run(circleId, memberId);
        db.prepare('INSERT INTO cg_summary VALUES(?,?,?,?,?)').run(circleId, memberId, shareId, summary, createHash('sha256').update(summary).digest('hex'));
        for (const t of extractThemes(summary)) db.prepare('INSERT INTO cg_summary_theme VALUES(?,?,?)').run(circleId, memberId, t);
      })();
    },
    async revokeShare(circleId, memberId) { check(circleId, memberId); dropShare(circleId, memberId); },
    async recordReading(circleId, pair, readingId, themes, sources) {
      check(circleId, readingId, ...pair, ...sources);
      const [a, b] = pairKey(pair[0], pair[1]);
      db.transaction(() => {
        // Provenance gate: every source must be a currently approved summary in
        // this circle, and both members must have one. Otherwise nothing is stored.
        const active = new Set((db.prepare('SELECT shareId FROM cg_summary WHERE circleId=?').all(circleId) as {shareId: string}[]).map(r => r.shareId));
        const members = new Set((db.prepare('SELECT memberId FROM cg_summary WHERE circleId=?').all(circleId) as {memberId: string}[]).map(r => r.memberId));
        if (!sources.length || sources.some(s => !active.has(s)) || !members.has(a) || !members.has(b)) throw new Error('Reading is not grounded in active approved shares');
        db.prepare('INSERT OR IGNORE INTO cg_reading VALUES(?,?,?,?,?)').run(circleId, readingId, a, b, new Date().toISOString());
        for (const t of known(themes)) db.prepare('INSERT OR IGNORE INTO cg_reading_theme VALUES(?,?,?)').run(circleId, readingId, t);
        for (const s of new Set(sources)) db.prepare('INSERT OR IGNORE INTO cg_reading_source VALUES(?,?,?)').run(circleId, readingId, s);
      }).immediate();
    },
    async priorThemes(circleId, x, y, limit = 5) {
      const [a, b] = pairKey(x, y);
      return (db.prepare(`SELECT t.theme, count(*) n, max(r.createdAt) last FROM cg_reading r JOIN cg_reading_theme t USING(circleId, readingId)
        WHERE r.circleId=? AND r.a=? AND r.b=? GROUP BY t.theme ORDER BY n DESC, last DESC, t.theme LIMIT ?`).all(circleId, a, b, limit) as {theme: string}[]).map(r => r.theme);
    },
    async snapshot(circleId) {
      const summaries = (db.prepare('SELECT shareId, memberId, text FROM cg_summary WHERE circleId=? ORDER BY memberId').all(circleId) as {shareId: string; memberId: string; text: string}[])
        .map(s => ({...s, themes: (db.prepare('SELECT theme FROM cg_summary_theme WHERE circleId=? AND memberId=? ORDER BY theme').all(circleId, s.memberId) as {theme: string}[]).map(r => r.theme)}));
      const readings = (db.prepare('SELECT readingId, a, b FROM cg_reading WHERE circleId=? ORDER BY createdAt, readingId').all(circleId) as {readingId: string; a: string; b: string}[]).map(r => ({
        readingId: r.readingId, pair: [r.a, r.b] as [string, string],
        themes: (db.prepare('SELECT theme FROM cg_reading_theme WHERE circleId=? AND readingId=? ORDER BY theme').all(circleId, r.readingId) as {theme: string}[]).map(x => x.theme),
        sources: (db.prepare('SELECT shareId FROM cg_reading_source WHERE circleId=? AND readingId=? ORDER BY shareId').all(circleId, r.readingId) as {shareId: string}[]).map(x => x.shareId),
      }));
      const themeMap = new Map<string, {members: Set<string>; readings: number}>();
      const bump = (t: string) => themeMap.get(t) ?? themeMap.set(t, {members: new Set(), readings: 0}).get(t)!;
      for (const s of summaries) for (const t of s.themes) bump(t).members.add(s.memberId);
      for (const r of readings) for (const t of r.themes) { const e = bump(t); e.readings++; r.pair.forEach(m => e.members.add(m)); }
      const themes = [...themeMap].map(([theme, e]) => ({theme, members: [...e.members].sort(), readings: e.readings, weight: e.members.size + 2 * e.readings}))
        .sort((p, q) => q.weight - p.weight || p.theme.localeCompare(q.theme));
      return {circleId, members: summaries.map(s => s.memberId), summaries, themes, readings};
    },
    async forgetMember(memberId) {
      check(memberId);
      const circles = db.prepare('SELECT DISTINCT circleId FROM cg_summary WHERE memberId=? UNION SELECT circleId FROM cg_reading WHERE a=? OR b=?').all(memberId, memberId, memberId) as {circleId: string}[];
      for (const c of circles) dropShare(c.circleId, memberId);
    },
  };
}
