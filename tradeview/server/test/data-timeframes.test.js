import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TIMEFRAMES, NATIVE_TFS, SECOND_TFS, tfToMs, tfToBybit, bybitToTf, floorTime, addBars, nextBarTime,
  barsBetween, barTimes, normalizeTf, isSecondsTf, canResample,
} from '../src/data/timeframes.js';

test('timeframe table matches the contract', () => {
  assert.deepEqual(NATIVE_TFS, ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '1D', '1W', '1M']);
  assert.deepEqual(SECOND_TFS, ['1s', '5s', '15s', '30s']);
  assert.equal(TIMEFRAMES.length, 17);
  const bybit = Object.fromEntries(NATIVE_TFS.map((t) => [t, tfToBybit(t)]));
  assert.deepEqual(bybit, { '1m': '1', '3m': '3', '5m': '5', '15m': '15', '30m': '30', '1h': '60', '2h': '120', '4h': '240', '6h': '360', '12h': '720', '1D': 'D', '1W': 'W', '1M': 'M' });
  assert.equal(tfToBybit('5s'), null);
  assert.equal(tfToMs('1m'), 60000);
  assert.equal(tfToMs('4h'), 4 * 3600000);
  assert.equal(tfToMs('15s'), 15000);
  assert.equal(bybitToTf('240'), '4h');
  assert.equal(bybitToTf('D'), '1D');
  assert.throws(() => tfToMs('7m'));
});

test('normalizeTf handles aliases and keeps 1m vs 1M distinct', () => {
  assert.equal(normalizeTf('1m'), '1m');
  assert.equal(normalizeTf('1M'), '1M');
  assert.equal(normalizeTf('60'), '1h');
  assert.equal(normalizeTf('D'), '1D');
  assert.equal(normalizeTf('1d'), '1D');
  assert.equal(normalizeTf('4H'), '4h');
  assert.equal(normalizeTf('bogus'), null);
  assert.ok(isSecondsTf('30s'));
  assert.ok(!isSecondsTf('1m'));
});

test('floorTime for intraday and seconds timeframes', () => {
  const t = Date.UTC(2025, 2, 14, 13, 47, 29, 512); // Fri 2025-03-14 13:47:29.512
  assert.equal(floorTime(t, '1s'), Date.UTC(2025, 2, 14, 13, 47, 29));
  assert.equal(floorTime(t, '5s'), Date.UTC(2025, 2, 14, 13, 47, 25));
  assert.equal(floorTime(t, '15m'), Date.UTC(2025, 2, 14, 13, 45));
  assert.equal(floorTime(t, '4h'), Date.UTC(2025, 2, 14, 12));
  assert.equal(floorTime(t, '12h'), Date.UTC(2025, 2, 14, 12));
  assert.equal(floorTime(t, '1D'), Date.UTC(2025, 2, 14));
});

test('weekly bars open Monday 00:00 UTC', () => {
  const fri = Date.UTC(2025, 2, 14, 13); // Friday
  assert.equal(floorTime(fri, '1W'), Date.UTC(2025, 2, 10)); // Monday
  const mon = Date.UTC(2025, 2, 10, 0, 0, 0);
  assert.equal(floorTime(mon, '1W'), mon);
  const sun = Date.UTC(2025, 2, 16, 23, 59, 59);
  assert.equal(floorTime(sun, '1W'), Date.UTC(2025, 2, 10));
  assert.equal(new Date(floorTime(Date.UTC(1970, 0, 3), '1W')).getUTCDay(), 1);
  assert.equal(nextBarTime(fri, '1W'), Date.UTC(2025, 2, 17));
});

test('monthly bars are calendar aware', () => {
  assert.equal(floorTime(Date.UTC(2024, 1, 29, 18), '1M'), Date.UTC(2024, 1, 1));
  assert.equal(nextBarTime(Date.UTC(2024, 0, 31), '1M'), Date.UTC(2024, 1, 1));
  assert.equal(addBars(Date.UTC(2024, 11, 15), '1M', 1), Date.UTC(2025, 0, 1));
  assert.equal(addBars(Date.UTC(2024, 0, 15), '1M', -2), Date.UTC(2023, 10, 1));
  assert.equal(barsBetween(Date.UTC(2024, 0, 5), Date.UTC(2024, 11, 5), '1M'), 12);
});

test('addBars, barsBetween and barTimes', () => {
  const t0 = Date.UTC(2025, 0, 1);
  assert.equal(addBars(t0 + 1234, '1h', 3), t0 + 3 * 3600000);
  assert.equal(addBars(t0, '1m', -1), t0 - 60000);
  assert.equal(barsBetween(t0, t0 + 59 * 60000, '1m'), 60);
  assert.equal(barsBetween(t0 + 10, t0, '1m'), 1);
  assert.equal(barsBetween(t0 + 120000, t0, '1m'), 0);
  assert.deepEqual(barTimes(t0 + 30000, t0 + 180000, '1m'), [t0, t0 + 60000, t0 + 120000, t0 + 180000]);
});

test('canResample', () => {
  assert.ok(canResample('1m', '5m'));
  assert.ok(canResample('1h', '1D'));
  assert.ok(canResample('1D', '1W'));
  assert.ok(canResample('1D', '1M'));
  assert.ok(!canResample('3m', '5m'));
  assert.ok(!canResample('1h', '1m'));
  assert.ok(!canResample('1W', '1M'));
});
