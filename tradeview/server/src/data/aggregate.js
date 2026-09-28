// Candle aggregation: trades -> candles for any timeframe, and candles -> higher timeframe.
import { floorTime, canResample, getTf } from './timeframes.js';

/**
 * @typedef {{ t: number, o: number, h: number, l: number, c: number, v: number, qv?: number }} Candle
 * @typedef {{ t: number, p: number, q: number, side: 'Buy'|'Sell' }} Trade
 */

/**
 * Build candles from trades. Trades may be in any order; output is ascending by open time.
 * Open/close are taken from the earliest/latest trade (by time, then input order) in each bar.
 * @param {Trade[]} trades
 * @param {string} tf
 * @returns {Candle[]}
 */
export function tradesToCandles(trades, tf) {
  getTf(tf);
  const bars = new Map();
  // Stable sort by time so equal timestamps keep exchange order.
  const sorted = trades.map((tr, i) => [tr, i]).sort((a, b) => a[0].t - b[0].t || a[1] - b[1]);
  for (const [tr] of sorted) {
    const t = floorTime(tr.t, tf);
    let b = bars.get(t);
    if (!b) {
      b = { t, o: tr.p, h: tr.p, l: tr.p, c: tr.p, v: 0, qv: 0 };
      bars.set(t, b);
    }
    if (tr.p > b.h) b.h = tr.p;
    if (tr.p < b.l) b.l = tr.p;
    b.c = tr.p;
    b.v += tr.q;
    b.qv += tr.p * tr.q;
  }
  return [...bars.values()].sort((a, b) => a.t - b.t);
}

/**
 * Resample ascending candles into a higher timeframe (calendar aware for 1W/1M).
 * The last output bar may be partial if the input ends mid-bar.
 * @param {Candle[]} candles ascending
 * @param {string} tf target timeframe
 * @param {string} [fromTf] source timeframe (validated when given)
 * @returns {Candle[]}
 */
export function resampleCandles(candles, tf, fromTf) {
  if (fromTf && !canResample(fromTf, tf)) throw new Error(`Cannot resample ${fromTf} into ${tf}`);
  const out = [];
  let cur = null;
  for (const k of candles) {
    const t = floorTime(k.t, tf);
    if (!cur || cur.t !== t) {
      if (cur) out.push(cur);
      cur = { t, o: k.o, h: k.h, l: k.l, c: k.c, v: k.v, qv: k.qv ?? 0 };
      continue;
    }
    if (k.h > cur.h) cur.h = k.h;
    if (k.l < cur.l) cur.l = k.l;
    cur.c = k.c;
    cur.v += k.v;
    cur.qv += k.qv ?? 0;
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * Incremental candle builder for a single symbol/timeframe fed by live trades.
 * `add(trade)` returns `{ candle, closed }` where `closed` is the previous bar if this trade rolled over.
 */
export class CandleBuilder {
  /** @param {string} tf */
  constructor(tf) {
    getTf(tf);
    this.tf = tf;
    /** @type {Candle|null} */
    this.current = null;
  }

  /**
   * @param {Trade} tr
   * @returns {{ candle: Candle, closed: Candle|null }}
   */
  add(tr) {
    const t = floorTime(tr.t, this.tf);
    let closed = null;
    if (this.current && t < this.current.t) {
      // Late trade for an already closed bar: ignore for OHLC purposes.
      return { candle: this.current, closed: null };
    }
    if (!this.current || t > this.current.t) {
      closed = this.current;
      this.current = { t, o: tr.p, h: tr.p, l: tr.p, c: tr.p, v: 0, qv: 0 };
    }
    const b = this.current;
    if (tr.p > b.h) b.h = tr.p;
    if (tr.p < b.l) b.l = tr.p;
    b.c = tr.p;
    b.v += tr.q;
    b.qv += tr.p * tr.q;
    return { candle: b, closed };
  }

  /**
   * Close the current bar if wall-clock time has moved past its end.
   * @param {number} now
   * @returns {Candle|null} the closed bar, if any
   */
  closeIfDue(now) {
    if (this.current && floorTime(now, this.tf) > this.current.t) {
      const closed = this.current;
      this.current = null;
      return closed;
    }
    return null;
  }
}

/** Strip internal fields: the public Candle JSON is `{ t, o, h, l, c, v }`. */
export function toPublicCandle(k) {
  return { t: k.t, o: k.o, h: k.h, l: k.l, c: k.c, v: k.v };
}
