// Canonical timeframe definitions (ARCHITECTURE §2). Mirrored in web/src/chart/timeframes.js.
// All times are ms since epoch, UTC.

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
// 1970-01-01 was a Thursday; the first Monday 00:00 UTC is 1970-01-05.
const MONDAY_OFFSET = 4 * DAY;

/**
 * @typedef {{ id: string, bybit: string|null, ms: number, label: string,
 *   kind: 'seconds'|'intraday'|'calendar', native: boolean }} Timeframe
 */

/** @type {Timeframe[]} ordered from smallest to largest */
export const TIMEFRAMES = Object.freeze([
  { id: '1s', bybit: null, ms: 1 * SEC, label: '1 second', kind: 'seconds', native: false },
  { id: '5s', bybit: null, ms: 5 * SEC, label: '5 seconds', kind: 'seconds', native: false },
  { id: '15s', bybit: null, ms: 15 * SEC, label: '15 seconds', kind: 'seconds', native: false },
  { id: '30s', bybit: null, ms: 30 * SEC, label: '30 seconds', kind: 'seconds', native: false },
  { id: '1m', bybit: '1', ms: 1 * MIN, label: '1 minute', kind: 'intraday', native: true },
  { id: '3m', bybit: '3', ms: 3 * MIN, label: '3 minutes', kind: 'intraday', native: true },
  { id: '5m', bybit: '5', ms: 5 * MIN, label: '5 minutes', kind: 'intraday', native: true },
  { id: '15m', bybit: '15', ms: 15 * MIN, label: '15 minutes', kind: 'intraday', native: true },
  { id: '30m', bybit: '30', ms: 30 * MIN, label: '30 minutes', kind: 'intraday', native: true },
  { id: '1h', bybit: '60', ms: 1 * HOUR, label: '1 hour', kind: 'intraday', native: true },
  { id: '2h', bybit: '120', ms: 2 * HOUR, label: '2 hours', kind: 'intraday', native: true },
  { id: '4h', bybit: '240', ms: 4 * HOUR, label: '4 hours', kind: 'intraday', native: true },
  { id: '6h', bybit: '360', ms: 6 * HOUR, label: '6 hours', kind: 'intraday', native: true },
  { id: '12h', bybit: '720', ms: 12 * HOUR, label: '12 hours', kind: 'intraday', native: true },
  { id: '1D', bybit: 'D', ms: DAY, label: '1 day', kind: 'intraday', native: true },
  { id: '1W', bybit: 'W', ms: WEEK, label: '1 week', kind: 'calendar', native: true },
  // Nominal length only; month boundaries are calendar aware (see floorTime / nextBarTime).
  { id: '1M', bybit: 'M', ms: 30 * DAY, label: '1 month', kind: 'calendar', native: true },
].map((t) => Object.freeze(t)));

const BY_ID = new Map(TIMEFRAMES.map((t) => [t.id, t]));
const BY_BYBIT = new Map(TIMEFRAMES.filter((t) => t.bybit).map((t) => [t.bybit, t]));

/** Ids of all timeframes, in order. */
export const TF_IDS = Object.freeze(TIMEFRAMES.map((t) => t.id));
/** Timeframes Bybit serves natively (the 13 kline intervals). */
export const NATIVE_TFS = Object.freeze(TIMEFRAMES.filter((t) => t.native).map((t) => t.id));
/** Custom seconds timeframes built from live trades only. */
export const SECOND_TFS = Object.freeze(TIMEFRAMES.filter((t) => t.kind === 'seconds').map((t) => t.id));
/** Timeframes for which footprint history is aggregated from trade dumps. */
export const FOOTPRINT_TFS = Object.freeze(['1m', '3m', '5m', '15m', '30m', '1h']);

// Accept a few common aliases (TradingView style, lowercase day/week).
const ALIASES = new Map([
  ['1', '1m'], ['3', '3m'], ['5', '5m'], ['15', '15m'], ['30', '30m'], ['60', '1h'], ['120', '2h'],
  ['240', '4h'], ['360', '6h'], ['720', '12h'], ['D', '1D'], ['1d', '1D'], ['W', '1W'], ['1w', '1W'],
  ['M', '1M'], ['1H', '1h'], ['2H', '2h'], ['4H', '4h'], ['6H', '6h'], ['12H', '12h'], ['1S', '1s'],
]);

/**
 * Normalise a timeframe id or alias to its canonical id, or return null if unknown.
 * Note: "1m" is one minute and "1M" one month; they are case sensitive.
 * @param {string} tf
 */
export function normalizeTf(tf) {
  if (tf == null) return null;
  const s = String(tf).trim();
  if (BY_ID.has(s)) return s;
  if (ALIASES.has(s)) return ALIASES.get(s);
  return null;
}

/** @param {string} tf */
export function isValidTf(tf) {
  return BY_ID.has(tf);
}

/** @param {string} tf @returns {Timeframe} */
export function getTf(tf) {
  const t = BY_ID.get(tf) || BY_ID.get(normalizeTf(tf));
  if (!t) throw new Error(`Unknown timeframe: ${tf}`);
  return t;
}

/** Nominal bar length in ms (1M is 30 days nominal). */
export function tfToMs(tf) {
  return getTf(tf).ms;
}

/** Bybit kline interval code, or null for seconds timeframes. */
export function tfToBybit(tf) {
  return getTf(tf).bybit;
}

/** Canonical id from a Bybit interval code ("1", "60", "D"...). */
export function bybitToTf(code) {
  const t = BY_BYBIT.get(String(code));
  if (!t) throw new Error(`Unknown Bybit interval: ${code}`);
  return t.id;
}

export function isSecondsTf(tf) {
  return getTf(tf).kind === 'seconds';
}

export function isNativeTf(tf) {
  return getTf(tf).native;
}

/**
 * Floor a timestamp to the open time of the bar containing it.
 * Weekly bars open Monday 00:00 UTC, monthly bars on the 1st 00:00 UTC (Bybit convention).
 * @param {number} t ms
 * @param {string} tf
 */
export function floorTime(t, tf) {
  const def = getTf(tf);
  if (def.id === '1W') return Math.floor((t - MONDAY_OFFSET) / WEEK) * WEEK + MONDAY_OFFSET;
  if (def.id === '1M') {
    const d = new Date(t);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  }
  return Math.floor(t / def.ms) * def.ms;
}

/**
 * Open time of the bar `n` bars after the bar containing `t` (n may be negative).
 * @param {number} t
 * @param {string} tf
 * @param {number} [n=1]
 */
export function addBars(t, tf, n = 1) {
  const def = getTf(tf);
  const base = floorTime(t, tf);
  if (def.id === '1M') {
    const d = new Date(base);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1);
  }
  return base + n * def.ms;
}

/** Open time of the next bar. */
export function nextBarTime(t, tf) {
  return addBars(t, tf, 1);
}

/** Close time (exclusive end) of the bar containing t. */
export function barCloseTime(t, tf) {
  return addBars(t, tf, 1);
}

/**
 * Number of bars whose open time lies in [from, to] (both floored).
 * @param {number} from
 * @param {number} to
 * @param {string} tf
 */
export function barsBetween(from, to, tf) {
  const a = floorTime(from, tf);
  const b = floorTime(to, tf);
  if (b < a) return 0;
  const def = getTf(tf);
  if (def.id === '1M') {
    const da = new Date(a);
    const db = new Date(b);
    return (db.getUTCFullYear() - da.getUTCFullYear()) * 12 + (db.getUTCMonth() - da.getUTCMonth()) + 1;
  }
  return Math.floor((b - a) / def.ms) + 1;
}

/**
 * Open times of all bars from the bar containing `from` up to and including the bar opening at or before `to`.
 * @returns {number[]}
 */
export function barTimes(from, to, tf) {
  const out = [];
  for (let t = floorTime(from, tf); t <= to; t = nextBarTime(t, tf)) out.push(t);
  return out;
}

/** True if `higher` can be built exactly from bars of `lower`. */
export function canResample(lower, higher) {
  const lo = getTf(lower);
  const hi = getTf(higher);
  if (hi.ms < lo.ms) return false;
  if (hi.id === '1M') return lo.ms <= DAY; // months are whole days
  if (hi.id === '1W') return lo.ms <= DAY && (DAY % lo.ms === 0);
  return hi.ms % lo.ms === 0 && (lo.id !== '1W' && lo.id !== '1M');
}

export const MS = Object.freeze({ SEC, MIN, HOUR, DAY, WEEK });
