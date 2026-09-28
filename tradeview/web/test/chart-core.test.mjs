// Offline unit tests for chart-core pure functions: `node --test web/test/`
import test from 'node:test';
import assert from 'node:assert/strict';
import { floorTime, nextBarTime, normalizeTf, tfToMs, TIMEFRAMES } from '../src/chart/timeframes.js';
import { heikinAshi, renko, rangeBars } from '../src/chart/transforms.js';
import { computeFast } from '../src/chart/indicators/fast.js';
import { applyInputs } from '../src/chart/indicators/IndicatorManager.js';
import { computeProfile } from '../src/chart/footprint/VolumeProfile.js';
import { toFootprintItem } from '../src/chart/footprint/FootprintSeries.js';
import { normalizeTool } from '../src/chart/drawings/tools.js';

const series = (n = 300) => {
  const out = [];
  let p = 100;
  for (let i = 0; i < n; i++) {
    const o = p;
    p += Math.sin(i / 6) * 1.5 + Math.cos(i / 17);
    out.push({ t: i * 60000, o, h: Math.max(o, p) + 0.4, l: Math.min(o, p) - 0.4, c: p, v: 10 + (i % 7) });
  }
  return out;
};

test('timeframes mirror §2 incl. seconds', () => {
  assert.deepEqual(TIMEFRAMES.map((t) => t.id), ['1s', '5s', '15s', '30s', '1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '1D', '1W', '1M']);
  assert.equal(normalizeTf('60'), '1h');
  assert.equal(normalizeTf('D'), '1D');
  assert.equal(tfToMs('4h'), 4 * 3600000);
  const t = Date.UTC(2026, 8, 30, 13, 47, 12); // Wednesday
  assert.equal(floorTime(t, '15m'), Date.UTC(2026, 8, 30, 13, 45));
  assert.equal(floorTime(t, '1W'), Date.UTC(2026, 8, 28)); // Monday
  assert.equal(floorTime(t, '1M'), Date.UTC(2026, 8, 1));
  assert.equal(nextBarTime(t, '1M'), Date.UTC(2026, 9, 1));
  assert.equal(floorTime(t, '5s'), Date.UTC(2026, 8, 30, 13, 47, 10));
});

test('heikin ashi / renko / range bars', () => {
  const c = series();
  const ha = heikinAshi(c);
  assert.equal(ha.length, c.length);
  assert.ok(Math.abs(ha[5].c - (c[5].o + c[5].h + c[5].l + c[5].c) / 4) < 1e-9);
  const r = renko(c, { mode: 'fixed', boxSize: 2 });
  assert.ok(r.bars.length > 10);
  for (let i = 1; i < r.bars.length; i++) {
    assert.ok(r.bars[i].t > r.bars[i - 1].t, 'renko times strictly increasing');
    assert.ok(Math.abs(Math.abs(r.bars[i].c - r.bars[i].o) - 2) < 1e-9, 'brick = box');
  }
  const rb = rangeBars(c, { range: 1.5 });
  for (const b of rb.bars.slice(0, -1)) assert.ok(Math.abs(b.h - b.l - 1.5) < 1e-9, 'range bar spans exactly range');
});

test('fast indicators', () => {
  const c = series();
  const sma = computeFast('sma', c, { length: 10 }).plots.SMA.data;
  const manual = c.slice(-10).reduce((a, b) => a + b.c, 0) / 10;
  assert.ok(Math.abs(sma.at(-1).value - manual) < 1e-9);
  assert.equal(sma[8].value, null);
  const rsi = computeFast('rsi', c, {}).plots.RSI.data.at(-1).value;
  assert.ok(rsi > 0 && rsi < 100);
  const macd = computeFast('macd', c, {});
  assert.deepEqual(Object.keys(macd.plots), ['Histogram', 'MACD', 'Signal']);
  assert.equal(computeFast('bb', c, {}).meta.overlay, true);
});

test('Pine input substitution', () => {
  const src = 'indicator("X")\nlen = input.int(14, "Length")\nsrc = input(close, title="Source")\nmult = input.float(2.0, "StdDev")';
  const out = applyInputs(src, { length: 21, source: 'hl2', StdDev: 2.5 });
  assert.match(out, /len = input\.int\(21, "Length"\)/);
  assert.match(out, /src = input\(hl2, title="Source"\)/);
  assert.match(out, /mult = input\.float\(2\.5, "StdDev"\)/);
});

test('volume profile POC / value area', () => {
  const c = series(200);
  const p = computeProfile(c, null, { rows: 40, valueArea: 0.7 });
  const vaVol = [...Array(p.vaHigh - p.vaLow + 1)].reduce((a, _, i) => a + p.up[p.vaLow + i] + p.dn[p.vaLow + i], 0);
  assert.ok(vaVol >= p.total * 0.7 - 1e-6);
  assert.ok(p.poc >= p.vaLow && p.poc <= p.vaHigh);
  assert.ok(Math.abs(p.total - c.reduce((a, b) => a + b.v, 0)) < 1e-6);
});

test('footprint item derivation', () => {
  const it = toFootprintItem({ t: 60000, o: 10, h: 12, l: 9, c: 11, v: 30 }, { t: 60000, levels: [{ p: 9, bid: 3, ask: 1 }, { p: 10, bid: 5, ask: 9 }, { p: 11, bid: 2, ask: 6 }] });
  assert.equal(it.time, 60);
  assert.equal(it.tick, 1);
  assert.equal(it.poc, 10);
  assert.equal(it.delta, 6);
});

test('drawing tool aliases (agent §7)', () => {
  for (const [a, b] of [['hline', 'horizontal_line'], ['fib', 'fib_retracement'], ['long_position', 'long_position'], ['rectangle', 'rectangle'], ['text', 'text'], ['arrow', 'arrow'], ['ray', 'ray'], ['trendline', 'trendline']]) {
    assert.equal(normalizeTool(a), b);
  }
});
