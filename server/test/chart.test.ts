import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateChart } from '../src/chart.js';
import type { BirthInput } from '../src/contracts.js';

const base: BirthInput = { date: '2000-01-01', time: '12:00', timeZone: 'Etc/UTC', latitude: null, longitude: null, consent: true };
const position = (input: BirthInput, body: string) => calculateChart(input).placements.find(p => p.body === body)!.longitude;
const distance = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

test('J2000 solar longitude matches the standard epoch reference within 0.02 degrees', () => {
  // J2000 apparent geocentric solar longitude ~280.368 degrees.
  // Independent solar reference: Meeus, Astronomical Algorithms, ch. 25,
  // L0=280.46646, M=357.52911, equation of center and apparent correction at T=0.
  assert.ok(distance(position(base, 'Sun'), 280.368) < 0.02);
});

test('NASA 2024 equinox and solstice instants place Sun on tropical boundaries', () => {
  // NASA GSFC SKYCAL 2024 seasons (UTC), rounded to minute:
  // https://eclipse.gsfc.nasa.gov/SKYCAL/SKYCAL.html
  for (const [date, time, longitude] of [
    ['2024-03-20', '03:06', 0], ['2024-06-20', '20:51', 90],
    ['2024-09-22', '12:44', 180], ['2024-12-21', '09:21', 270],
  ] as const) {
    assert.ok(distance(position({ ...base, date, time }, 'Sun'), longitude) < 0.02);
  }
});

test('NASA April 2024 total solar eclipse has Sun and Moon in conjunction', () => {
  // Greatest eclipse 2024-04-08 18:17 UTC, NASA GSFC eclipse catalog.
  // https://eclipse.gsfc.nasa.gov/SEplot/SEplot2001/SE2024Apr08T.GIF
  const input = { ...base, date: '2024-04-08', time: '18:17' };
  assert.ok(distance(position(input, 'Moon'), position(input, 'Sun')) < 0.5);
});

test('all ten real body positions are finite, normalized, and reproducible', () => {
  const chart = calculateChart(base);
  assert.deepEqual(chart, calculateChart(base));
  assert.equal(chart.placements.length, 10);
  for (const p of chart.placements) {
    assert.ok(Number.isFinite(p.longitude) && p.longitude >= 0 && p.longitude < 360);
    assert.ok(p.degree >= 0 && p.degree < 30);
  }
  assert.equal(chart.placements[0]!.sign, 'Capricorn');
  assert.equal(chart.calculatedAt, '2000-01-01T12:00:00.000Z');
});

test('equivalent local instants produce identical positions, including fractional zone offsets', () => {
  const india = calculateChart({ ...base, time: '17:30', timeZone: 'Asia/Kolkata' });
  assert.deepEqual(india.placements, calculateChart(base).placements);
});

test('unknown time explicitly uses noon with uncertainty and never invents angles or houses', () => {
  const chart = calculateChart({ ...base, time: null });
  assert.equal(chart.timeKnown, false);
  assert.deepEqual(chart.placements, calculateChart(base).placements);
  assert.match(chart.limitations.join(' '), /unknown.*noon/);
  assert.match(chart.limitations.join(' '), /Moon/);
  assert.ok(!chart.placements.some(p => /ascendant|house|midheaven/i.test(p.body)));
});

test('rejects invalid calendars, zones, coordinates, unsupported dates and absent consent', () => {
  for (const change of [
    { date: '2023-02-29' }, { date: '2024-04-31' }, { date: '1899-01-01' },
    { date: '2101-01-01' }, { timeZone: 'Mars/Olympus' }, { time: '25:00' },
    { latitude: 91 }, { longitude: 181 }, { consent: false },
  ]) assert.throws(() => calculateChart({ ...base, ...change } as BirthInput));
});

test('DST skipped times and repeated times are rejected instead of silently shifted or guessed', () => {
  assert.throws(() => calculateChart({ ...base, date: '2024-03-10', time: '02:30', timeZone: 'America/New_York' }), /nonexistent/);
  assert.throws(() => calculateChart({ ...base, date: '2024-11-03', time: '01:30', timeZone: 'America/New_York' }), /Ambiguous/);
  assert.equal(calculateChart({ ...base, date: '2024-03-10', time: '03:30', timeZone: 'America/New_York' }).calculatedAt, '2024-03-10T07:30:00.000Z');
});

test('a skipped civil date is not silently accepted for unknown time', () => {
  assert.throws(() => calculateChart({ ...base, date: '2011-12-30', time: null, timeZone: 'Pacific/Apia' }), /nonexistent/);
});
