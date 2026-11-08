import {Body, Ecliptic, GeoVector, MoonPhase} from 'astronomy-engine';
import {publicPrompt} from './router.js';
import type {PublicCopy, PublicLane} from './darkbloom.js';

// Today's sky: public, identical for every visitor. Positions come from the
// local ephemeris (chart-math lane). Only the prose goes to the public lane,
// and its prompt holds sign names and whole degrees, nothing else. No date,
// no user, no chart. Cached per UTC day so the provider sees one call a day.

const SIGNS = ['Aries','Taurus','Gemini','Cancer','Leo','Virgo','Libra','Scorpio','Sagittarius','Capricorn','Aquarius','Pisces'] as const;
const BODIES = [Body.Sun, Body.Moon, Body.Mercury, Body.Venus, Body.Mars, Body.Jupiter, Body.Saturn] as const;
const SIGN_TONE: Record<(typeof SIGNS)[number], string> = {
  Aries:'initiative and directness', Taurus:'steadiness and the body', Gemini:'curiosity and conversation', Cancer:'home and tenderness',
  Leo:'warmth and self-expression', Virgo:'craft and care for detail', Libra:'balance and partnership', Scorpio:'depth and honesty',
  Sagittarius:'perspective and adventure', Capricorn:'structure and patience', Aquarius:'community and new ideas', Pisces:'imagination and rest',
};
const SYSTEM = 'You write short, warm, general astrology copy for a public daily page. Astrology is reflection and entertainment, not prediction. Use only the sky positions given. Do not address any individual, do not mention any calendar date, and give no medical, financial or relationship directives. 90-140 words, plain text, two short paragraphs.';

export interface SkyPosition { body: string; sign: (typeof SIGNS)[number]; degree: number }
export interface TodaySky { day: string; positions: SkyPosition[]; moonPhase: string }
export interface TransitsToday extends TodaySky { copy: PublicCopy }

function phaseName(angle: number): string {
  const names = ['new moon','waxing crescent','first quarter','waxing gibbous','full moon','waning gibbous','last quarter','waning crescent'];
  return names[Math.floor(((angle + 22.5) % 360) / 45)]!;
}

/** Local ephemeris only. Noon UTC of the given day so the result is stable all day. */
export function skyFor(day: string): TodaySky {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('bad day');
  const instant = new Date(`${day}T12:00:00Z`);
  const positions = BODIES.map(body => {
    const lon = ((Ecliptic(GeoVector(body, instant, true)).elon % 360) + 360) % 360;
    return {body, sign: SIGNS[Math.floor(lon / 30)]!, degree: Math.floor(lon % 30)};
  });
  return {day, positions, moonPhase: phaseName(MoonPhase(instant))};
}

/** The exact user prompt sent to the public lane. Sign names + whole degrees only. */
export function transitPromptText(sky: TodaySky): string {
  return `Sky positions: ${sky.positions.map(p => `${p.body} ${p.degree} degrees ${p.sign}`).join('; ')}. The Moon is a ${sky.moonPhase}. Write today's general sky note.`;
}

/** Deterministic, non-AI copy. Used whenever the public lane is off or fails. */
export function transitTemplate(sky: TodaySky): string {
  const sun = sky.positions.find(p => p.body === 'Sun')!, moon = sky.positions.find(p => p.body === 'Moon')!;
  const mercury = sky.positions.find(p => p.body === 'Mercury')!, venus = sky.positions.find(p => p.body === 'Venus')!, mars = sky.positions.find(p => p.body === 'Mars')!;
  return `The Sun is in ${sun.sign}, a season of ${SIGN_TONE[sun.sign]}. The Moon, a ${sky.moonPhase}, moves through ${moon.sign}, colouring the day with ${SIGN_TONE[moon.sign]}.\n\n`
    + `Mercury in ${mercury.sign} shapes how we talk, Venus in ${venus.sign} how we soften, and Mars in ${mars.sign} how we push. Take what resonates as a prompt for reflection, not a forecast.`;
}

export function createTransitService(lane: PublicLane, now: () => number = Date.now) {
  const cache = new Map<string, Promise<TransitsToday>>();
  return {
    async today(): Promise<TransitsToday> {
      const day = new Date(now()).toISOString().slice(0, 10);
      let hit = cache.get(day);
      if (!hit) {
        for (const k of cache.keys()) if (k !== day) cache.delete(k);
        hit = (async () => {
          const sky = skyFor(day);
          const prompt = publicPrompt('daily-transits', SYSTEM, transitPromptText(sky));
          const copy = await lane.generate(prompt, transitTemplate(sky));
          return {...sky, copy};
        })();
        cache.set(day, hit);
        // A template answer caused by a provider hiccup should not stick for the whole day.
        hit.then(r => { if (r.copy.source === 'template' && r.copy.reason === 'provider-error') cache.delete(day); }, () => cache.delete(day));
      }
      return hit;
    },
  };
}
