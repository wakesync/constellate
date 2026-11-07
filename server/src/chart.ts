import { Body, Ecliptic, GeoVector } from 'astronomy-engine';
import { DateTime, IANAZone } from 'luxon';
import { birthSchema, type BirthInput, type Chart } from './contracts.js';

const SIGNS = ['Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo', 'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces'];
const BODIES = [Body.Sun, Body.Moon, Body.Mercury, Body.Venus, Body.Mars, Body.Jupiter, Body.Saturn, Body.Uranus, Body.Neptune, Body.Pluto];
const normalize = (angle: number) => ((angle % 360) + 360) % 360;

/** Tropical, geocentric ecliptic longitudes of date, light-time and aberration corrected.
 * Astronomy Engine supplies the ephemeris; no hash/random/LLM-derived placements.
 * Coordinates are not used for geocentric placements. Houses are deliberately absent.
 */
export function calculateChart(input: BirthInput): Chart {
  const birth = birthSchema.parse(input);
  if (!IANAZone.isValidZone(birth.timeZone)) throw new Error('Use a valid IANA time zone.');
  const year = Number(birth.date.slice(0, 4));
  // Bound the product's supported range, rather than promise unlimited ephemeris accuracy.
  if (year < 1900 || year > 2100) throw new Error('Supported birth dates are 1900 through 2100.');
  const local = DateTime.fromISO(`${birth.date}T${birth.time ?? '12:00'}:00`, { zone: birth.timeZone });
  if (!local.isValid || local.toISODate() !== birth.date || local.toFormat('HH:mm') !== (birth.time ?? '12:00')) {
    throw new Error('Invalid date or nonexistent local time due to a time-zone transition.');
  }
  // Luxon otherwise silently chooses one occurrence of a repeated wall-clock time.
  if (local.getPossibleOffsets().length !== 1) {
    throw new Error('Ambiguous local time due to a time-zone transition. Choose an unambiguous time.');
  }
  const instant = local.toJSDate();
  const limitations = [
    'Tropical zodiac; geocentric ecliptic longitudes of date calculated with Astronomy Engine 2.1.19. Not a sidereal chart.',
    'Ascendant, midheaven, houses, lunar nodes and aspects are not calculated. Birth coordinates do not affect these geocentric placements.',
    'Astrology is for reflection and entertainment, not scientifically validated prediction.',
  ];
  if (birth.time === null) {
    limitations.unshift('Birth time is unknown. All placements are estimates at local noon, not exact natal positions. The Moon can move roughly 15 degrees in a day; any body near a sign boundary may have a different birth sign.');
  }
  return {
    version: 'astronomy-engine-2.1.19/tropical-geocentric-v1',
    // This is the ephemeris evaluation instant, not the wall-clock request time.
    // Keeping it tied to the input makes the entire chart reproducible.
    calculatedAt: instant.toISOString(),
    timeKnown: birth.time !== null,
    placements: BODIES.map(body => {
      const longitude = normalize(Ecliptic(GeoVector(body, instant, true)).elon);
      return { body, longitude, sign: SIGNS[Math.floor(longitude / 30)]!, degree: longitude % 30 };
    }),
    limitations,
  };
}
