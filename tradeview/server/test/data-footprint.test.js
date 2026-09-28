import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bucketPrice, tickDecimals, footprintTick, tradesToFootprint, FootprintAggregator, rowsToBars, barToRows,
  inferTick, mergeBars,
} from '../src/data/footprint.js';

const T0 = Date.UTC(2025, 5, 2, 10, 0, 0);

test('bucketPrice floors to the tick grid without float noise', () => {
  assert.equal(bucketPrice(60012.37, 0.5), 60012);
  assert.equal(bucketPrice(60012.5, 0.5), 60012.5);
  assert.equal(bucketPrice(0.30000000000000004, 0.1), 0.3);
  assert.equal(bucketPrice(1.2345, 0.001), 1.234);
  assert.equal(bucketPrice(0.000012345, 0.0000001), 0.0000123);
  assert.equal(bucketPrice(99.99, 10), 90);
  assert.equal(tickDecimals(0.0000001), 7);
  assert.equal(tickDecimals(0.25), 2);
  assert.equal(tickDecimals(5), 0);
});

test('footprintTick picks nice integer multiples of tickSize', () => {
  assert.equal(footprintTick(60000, 0.1), 10); // ~2 bps of 60k = 12 -> 10
  assert.equal(footprintTick(3000, 0.01), 0.5); // 0.6 -> 0.5
  assert.equal(footprintTick(0.5, 0.0001), 0.0001);
  assert.equal(footprintTick(60000, 0.1, 5), 0.5); // explicit multiplier
  assert.equal(footprintTick(60000, 0.1, '20'), 2);
  const t = footprintTick(2650.37, 0.01);
  assert.ok(Math.abs(t / 0.01 - Math.round(t / 0.01)) < 1e-9, 'multiple of tick size');
});

test('tradesToFootprint: Buy = ask volume, Sell = bid volume, poc and delta', () => {
  const trades = [
    { t: T0 + 1000, p: 100.2, q: 2, side: 'Buy' },
    { t: T0 + 2000, p: 100.7, q: 1, side: 'Sell' },
    { t: T0 + 3000, p: 100.4, q: 5, side: 'Sell' },
    { t: T0 + 4000, p: 101.1, q: 1.5, side: 'Buy' },
    { t: T0 + 61000, p: 101.9, q: 4, side: 'Buy' },
  ];
  const bars = tradesToFootprint(trades, '1m', 0.5);
  assert.equal(bars.length, 2);
  const [b] = bars;
  assert.equal(b.t, T0);
  assert.equal(b.tick, 0.5);
  assert.deepEqual(b.levels, [
    { p: 100, bid: 5, ask: 2 },
    { p: 100.5, bid: 1, ask: 0 },
    { p: 101, bid: 0, ask: 1.5 },
  ]);
  assert.equal(b.poc, 100);
  assert.equal(b.delta, 2 + 1.5 - 5 - 1);
  assert.deepEqual(bars[1], { t: T0 + 60000, levels: [{ p: 101.5, bid: 0, ask: 4 }], poc: 101.5, delta: 4, tick: 0.5 });
});

test('aggregator accumulates across calls and prunes', () => {
  const a = new FootprintAggregator('1m', 1);
  a.add({ t: T0 + 5, p: 10.5, q: 1, side: 'Buy' });
  a.add({ t: T0 + 60005, p: 11.2, q: 1, side: 'Sell' });
  a.add({ t: T0 + 7, p: 10.9, q: 2, side: 'Buy' });
  assert.equal(a.size, 2);
  assert.deepEqual(a.bar(T0).levels, [{ p: 10, bid: 0, ask: 3 }]);
  a.prune(T0 + 60000);
  assert.equal(a.size, 1);
  assert.equal(a.take(T0 + 60000).delta, -1);
  assert.equal(a.size, 0);
  assert.throws(() => new FootprintAggregator('1m', 0));
});

test('rows <-> bars round trip, re-bucketing and tick inference', () => {
  const bars = tradesToFootprint([
    { t: T0, p: 50.1, q: 1, side: 'Buy' },
    { t: T0, p: 50.35, q: 2, side: 'Sell' },
    { t: T0, p: 50.62, q: 3, side: 'Buy' },
  ], '1m', 0.25);
  const rows = barToRows(bars[0]);
  assert.equal(rows.length, 3);
  assert.deepEqual(rowsToBars(rows, 0.25), bars);
  assert.equal(inferTick(rows), 0.25);
  const coarse = rowsToBars(rows, 0.5);
  assert.deepEqual(coarse[0].levels, [{ p: 50, bid: 2, ask: 1 }, { p: 50.5, bid: 0, ask: 3 }]);
});

test('mergeBars adds level volumes', () => {
  const a = { t: T0, levels: [{ p: 1, bid: 1, ask: 2 }], poc: 1, delta: 1, tick: 1 };
  const b = { t: T0, levels: [{ p: 1, bid: 1, ask: 0 }, { p: 2, bid: 0, ask: 9 }], poc: 2, delta: 8, tick: 1 };
  const m = mergeBars(a, b);
  assert.deepEqual(m.levels, [{ p: 1, bid: 2, ask: 2 }, { p: 2, bid: 0, ask: 9 }]);
  assert.equal(m.poc, 2);
  assert.equal(m.delta, 9);
});
