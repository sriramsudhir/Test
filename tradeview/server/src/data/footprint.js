// Footprint (bid/ask volume per price level) aggregation.
// Bybit trade side is the taker side: "Buy" = aggressive buyer lifting the offer = ASK volume,
// "Sell" = aggressive seller hitting the bid = BID volume.
import { floorTime, getTf } from './timeframes.js';

/**
 * @typedef {{ p: number, bid: number, ask: number }} FootprintLevel
 * @typedef {{ t: number, levels: FootprintLevel[], poc: number|null, delta: number, tick: number }} FootprintBar
 * @typedef {{ t: number, p: number, q: number, side: 'Buy'|'Sell' }} Trade
 */

/** Number of decimals needed to represent a tick size exactly. */
export function tickDecimals(tick) {
  if (!(tick > 0)) return 8;
  const s = String(tick);
  if (s.includes('e-')) {
    const [m, e] = s.split('e-');
    return Number(e) + (m.split('.')[1]?.length ?? 0);
  }
  return s.split('.')[1]?.length ?? 0;
}

/** Round to the given decimals without float noise. */
export function roundTo(x, decimals) {
  return Number(x.toFixed(Math.min(Math.max(decimals, 0), 15)));
}

/**
 * Bucket a price to the lower edge of its tick bucket.
 * @param {number} price
 * @param {number} tick
 */
export function bucketPrice(price, tick) {
  if (!(tick > 0)) return price;
  // Small epsilon absorbs float error for prices that sit exactly on a bucket edge.
  const n = Math.floor(price / tick + 1e-9);
  return roundTo(n * tick, tickDecimals(tick));
}

const NICE = [1, 2, 2.5, 5];

/** Nearest (in log space) value of the form 1/2/2.5/5 x 10^k. */
function niceRound(x) {
  if (!(x > 0)) return 1;
  const exp = Math.floor(Math.log10(x));
  let best = 1;
  let bestErr = Infinity;
  for (let e = exp - 1; e <= exp + 1; e++) {
    for (const n of NICE) {
      const v = n * 10 ** e;
      const err = Math.abs(Math.log(v / x));
      if (err < bestErr) {
        bestErr = err;
        best = v;
      }
    }
  }
  return best;
}

/**
 * Pick a footprint bucket size: instrument tickSize times an integer multiplier so that a bucket is
 * roughly `targetBps` basis points of price (default 2 bps, e.g. BTC ~ 60000 with tick 0.1 -> 10).
 * @param {number} price reference price
 * @param {number} tickSize instrument tick size
 * @param {number|'auto'|string} [mult='auto'] explicit multiplier or 'auto'
 * @param {number} [targetBps=2]
 * @returns {number} bucket size in price units
 */
export function footprintTick(price, tickSize, mult = 'auto', targetBps = 2) {
  const ts = tickSize > 0 ? tickSize : 0.01;
  const dec = tickDecimals(ts);
  const m = Number(mult);
  if (mult !== 'auto' && Number.isFinite(m) && m >= 1) return roundTo(ts * Math.round(m), dec);
  if (!(price > 0)) return ts;
  const raw = (price * targetBps) / 10000 / ts;
  // Multiplier must be an integer so buckets align with the tick grid.
  const k = Math.max(1, Math.round(niceRound(raw)));
  return roundTo(ts * k, dec);
}

/**
 * Accumulates trades into footprint bars for one timeframe. Handles trades in any order.
 */
export class FootprintAggregator {
  /**
   * @param {string} tf
   * @param {number} tick bucket size in price units
   */
  constructor(tf, tick) {
    getTf(tf);
    if (!(tick > 0)) throw new Error('footprint tick must be > 0');
    this.tf = tf;
    this.tick = tick;
    /** @type {Map<number, Map<number, {bid:number, ask:number}>>} */
    this.bars = new Map();
  }

  /** @param {Trade} tr @returns {number} bar open time */
  add(tr) {
    const t = floorTime(tr.t, this.tf);
    let levels = this.bars.get(t);
    if (!levels) {
      levels = new Map();
      this.bars.set(t, levels);
    }
    const p = bucketPrice(tr.p, this.tick);
    let lv = levels.get(p);
    if (!lv) {
      lv = { bid: 0, ask: 0 };
      levels.set(p, lv);
    }
    if (isBuy(tr.side)) lv.ask += tr.q;
    else lv.bid += tr.q;
    return t;
  }

  /** @param {number} t @returns {FootprintBar|null} */
  bar(t) {
    const levels = this.bars.get(t);
    return levels ? buildBar(t, levels, this.tick) : null;
  }

  /** Remove and return a bar. */
  take(t) {
    const b = this.bar(t);
    this.bars.delete(t);
    return b;
  }

  /** Drop bars older than `t`. */
  prune(t) {
    for (const k of this.bars.keys()) if (k < t) this.bars.delete(k);
  }

  /** @returns {FootprintBar[]} ascending */
  toBars() {
    return [...this.bars.keys()].sort((a, b) => a - b).map((t) => this.bar(t));
  }

  get size() {
    return this.bars.size;
  }
}

function isBuy(side) {
  return side === 'Buy' || side === 'buy' || side === 'BUY' || side === 'B';
}

/**
 * @param {number} t
 * @param {Map<number, {bid:number, ask:number}>} levels
 * @param {number} tick
 * @returns {FootprintBar}
 */
function buildBar(t, levels, tick) {
  const out = [];
  let delta = 0;
  let poc = null;
  let pocVol = -1;
  const dec = tickDecimals(tick) + 2;
  for (const [p, lv] of [...levels.entries()].sort((a, b) => a[0] - b[0])) {
    const bid = roundTo(lv.bid, 10);
    const ask = roundTo(lv.ask, 10);
    out.push({ p, bid, ask });
    delta += ask - bid;
    const vol = bid + ask;
    if (vol > pocVol) {
      pocVol = vol;
      poc = p;
    }
  }
  return { t, levels: out, poc, delta: roundTo(delta, Math.max(dec, 8)), tick };
}

/**
 * Build footprint bars from a batch of trades.
 * @param {Trade[]} trades
 * @param {string} tf
 * @param {number} tick bucket size
 * @returns {FootprintBar[]}
 */
export function tradesToFootprint(trades, tf, tick) {
  const agg = new FootprintAggregator(tf, tick);
  for (const tr of trades) agg.add(tr);
  return agg.toBars();
}

/**
 * Convert DB rows (`{ t, price, bid_v, ask_v }`) into footprint bars. If rows were stored with a finer
 * tick than requested, levels are re-bucketed to `tick`.
 * @param {{t:number, price:number, bid_v:number, ask_v:number}[]} rows
 * @param {number} [tick] bucket size; inferred from the smallest price gap if omitted
 * @returns {FootprintBar[]}
 */
export function rowsToBars(rows, tick) {
  const effTick = tick > 0 ? tick : inferTick(rows);
  const bars = new Map();
  for (const r of rows) {
    let levels = bars.get(r.t);
    if (!levels) {
      levels = new Map();
      bars.set(r.t, levels);
    }
    const p = effTick > 0 ? bucketPrice(r.price, effTick) : r.price;
    let lv = levels.get(p);
    if (!lv) {
      lv = { bid: 0, ask: 0 };
      levels.set(p, lv);
    }
    lv.bid += r.bid_v;
    lv.ask += r.ask_v;
  }
  return [...bars.keys()].sort((a, b) => a - b).map((t) => buildBar(t, bars.get(t), effTick));
}

/** Flatten a footprint bar into DB rows. */
export function barToRows(bar) {
  return bar.levels.map((lv) => ({ t: bar.t, price: lv.p, bid_v: lv.bid, ask_v: lv.ask }));
}

/** Smallest positive gap between distinct prices within a bar (fallback 0). */
export function inferTick(rows) {
  const byT = new Map();
  for (const r of rows) {
    if (!byT.has(r.t)) byT.set(r.t, []);
    byT.get(r.t).push(r.price);
  }
  let best = Infinity;
  for (const prices of byT.values()) {
    prices.sort((a, b) => a - b);
    for (let i = 1; i < prices.length; i++) {
      const d = prices[i] - prices[i - 1];
      if (d > 1e-12 && d < best) best = d;
    }
  }
  if (!Number.isFinite(best)) return 0;
  // Snap to a clean decimal to remove float noise.
  const dec = Math.max(0, -Math.floor(Math.log10(best)) + 2);
  return roundTo(best, dec);
}

/**
 * Merge two footprint bars with the same open time (e.g. persisted history + live accumulation).
 * @param {FootprintBar} a
 * @param {FootprintBar} b
 */
export function mergeBars(a, b) {
  const levels = new Map();
  for (const bar of [a, b]) {
    for (const lv of bar.levels) {
      const p = bucketPrice(lv.p, a.tick);
      const cur = levels.get(p) || { bid: 0, ask: 0 };
      cur.bid += lv.bid;
      cur.ask += lv.ask;
      levels.set(p, cur);
    }
  }
  return buildBar(a.t, levels, a.tick);
}
