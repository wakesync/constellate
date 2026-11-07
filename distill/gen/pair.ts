// Deterministic pair features (shared elements/signs + major aspects between
// personal planets). Same rules as the circle edge in server/src/compat.ts,
// plus a stable theme vocabulary the circle graph also uses, so distilled
// readings and circle memory speak the same language.
export type Placement = {body: string; sign: string; degree: number; longitude: number};
export const RELATIONSHIPS = ['friend', 'roommate', 'collaborator', 'family', 'romantic'] as const;

const ELEMENT: Record<string, string> = {Aries:'fire',Leo:'fire',Sagittarius:'fire',Taurus:'earth',Virgo:'earth',Capricorn:'earth',Gemini:'air',Libra:'air',Aquarius:'air',Cancer:'water',Scorpio:'water',Pisces:'water'};
const ASPECTS = [{n:'conjunct',d:0,h:true},{n:'sextile',d:60,h:true},{n:'square',d:90,h:false},{n:'trine',d:120,h:true},{n:'opposite',d:180,h:false}];
const PERSONAL = ['Sun','Moon','Mercury','Venus','Mars'];
// Planet -> life-area theme. Small closed vocabulary on purpose (graph nodes).
export const THEME_OF: Record<string, string> = {Sun:'identity', Moon:'emotional needs', Mercury:'communication', Venus:'affection and values', Mars:'conflict and drive'};

export function pairFeatures(a: Placement[], b: Placement[]) {
  const by = (p: Placement[], n: string) => p.find(x => x.body === n);
  const shared: string[] = [];
  for (const body of ['Sun', 'Moon', 'Venus', 'Mars']) {
    const x = by(a, body), y = by(b, body); if (!x || !y) continue;
    if (x.sign === y.sign) shared.push(`both ${body} in ${x.sign}`);
    else if (ELEMENT[x.sign] === ELEMENT[y.sign]) shared.push(`${body}s both ${ELEMENT[x.sign]}`);
  }
  const aspects: {label: string; harmonious: boolean; orb: number}[] = [];
  for (const p of PERSONAL) for (const q of PERSONAL) {
    const x = by(a, p), y = by(b, q); if (!x || !y) continue;
    const sep = Math.abs(((x.longitude - y.longitude + 540) % 360) - 180);
    const lim = p === 'Sun' || q === 'Sun' || p === 'Moon' || q === 'Moon' ? 6 : 4;
    const asp = ASPECTS.find(s => Math.abs(sep - s.d) <= lim);
    if (asp) aspects.push({label: `${p} ${asp.n} ${q}`, harmonious: asp.h, orb: Math.round(Math.abs(sep - asp.d) * 10) / 10});
  }
  aspects.sort((m, n) => m.orb - n.orb);
  const top = aspects.slice(0, 8);
  const themes = [...new Set(top.flatMap(x => x.label.split(/ (?:conjunct|sextile|square|trine|opposite) /).map(b => THEME_OF[b]!)))];
  return {shared, aspects: top, themes};
}
