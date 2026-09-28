import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tradesToCandles, resampleCandles, CandleBuilder, toPublicCandle } from '../src/data/aggregate.js';

const T0 = Date.UTC(2025, 5, 2, 10, 0, 0);

const trades = [
  { t: T0 + 100, p: 100, q: 1, side: 'Buy' },
  { t: T0 + 2500, p: 102, q: 2, side: 'Sell' },
  { t: T0 + 4999, p: 99, q: 1, side: 'Buy' },
  { t: T0 + 5000, p: 101, q: 3, side: 'Buy' },
  { t: T0 + 16000, p: 98, q: 0.5, side: 'Sell' },
];

test('tradesToCandles builds 5s candles with OHLCV', () => {
  const c = tradesToCandles(trades, '5s');
  assert.equal(c.length, 3);
  assert.deepEqual(toPublicCandle(c[0]), { t: T0, o: 100, h: 102, l: 99, c: 99, v: 4 });
  assert.deepEqual(toPublicCandle(c[1]), { t: T0 + 5000, o: 101, h: 101, l: 101, c: 101, v: 3 });
  assert.deepEqual(toPublicCandle(c[2]), { t: T0 + 15000, o: 98, h: 98, l: 98, c: 98, v: 0.5 });
  assert.equal(c[0].qv, 100 + 204 + 99);
});

test('tradesToCandles is order independent (sorts by time)', () => {
  const shuffled = [trades[3], trades[0], trades[4], trades[2], trades[1]];
  assert.deepEqual(tradesToCandles(shuffled, '1m'), tradesToCandles(trades, '1m'));
  const [m] = tradesToCandles(trades, '1m');
  assert.equal(m.o, 100);
  assert.equal(m.c, 98);
  assert.equal(m.v, 7.5);
});

test('resampleCandles 1m -> 5m and 1D -> 1W (Monday open)', () => {
  const ones = Array.from({ length: 12 }, (_, i) => ({ t: T0 + i * 60000, o: 10 + i, h: 20 + i, l: 5 + i, c: 11 + i, v: 1 }));
  const five = resampleCandles(ones, '5m', '1m');
  assert.equal(five.length, 3);
  assert.deepEqual(toPublicCandle(five[0]), { t: T0, o: 10, h: 24, l: 5, c: 15, v: 5 });
  assert.deepEqual(toPublicCandle(five[2]), { t: T0 + 600000, o: 20, h: 31, l: 15, c: 22, v: 2 });

  // 2025-06-01 is a Sunday; the following Monday is 2025-06-02.
  const days = Array.from({ length: 9 }, (_, i) => ({ t: Date.UTC(2025, 5, 1 + i), o: i, h: i + 1, l: i - 1, c: i + 0.5, v: 10 }));
  const weeks = resampleCandles(days, '1W', '1D');
  assert.deepEqual(weeks.map((w) => w.t), [Date.UTC(2025, 4, 26), Date.UTC(2025, 5, 2), Date.UTC(2025, 5, 9)]);
  assert.equal(weeks[1].v, 70);
  assert.equal(weeks[1].o, 1);
  assert.equal(weeks[1].c, 7.5);
  assert.throws(() => resampleCandles(ones, '5m', '3m'));
});

test('CandleBuilder rolls bars and closes on wall clock', () => {
  const b = new CandleBuilder('5s');
  let r = b.add(trades[0]);
  assert.equal(r.closed, null);
  b.add(trades[1]);
  b.add(trades[2]);
  r = b.add(trades[3]);
  assert.equal(r.closed.t, T0);
  assert.equal(r.closed.c, 99);
  assert.equal(r.candle.t, T0 + 5000);
  // A late trade for a closed bar is ignored.
  r = b.add({ t: T0 + 1000, p: 500, q: 1, side: 'Buy' });
  assert.equal(r.candle.h, 101);
  assert.equal(b.closeIfDue(T0 + 9999), null);
  const closed = b.closeIfDue(T0 + 10000);
  assert.equal(closed.t, T0 + 5000);
  assert.equal(b.current, null);
});
