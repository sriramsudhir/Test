// Canonical timeframes — mirrors server/src/data/timeframes.js (ARCHITECTURE §2).

const S = 1000;
const M = 60 * S;
const H = 60 * M;
const D = 24 * H;

/** @typedef {{ id: string, bybit: string|null, ms: number, label: string, short: string, group: 'seconds'|'minutes'|'hours'|'days', seconds?: boolean }} Timeframe */

/** @type {Timeframe[]} */
export const TIMEFRAMES = [
  { id: '1s', bybit: null, ms: 1 * S, label: '1 second', short: '1s', group: 'seconds', seconds: true },
  { id: '5s', bybit: null, ms: 5 * S, label: '5 seconds', short: '5s', group: 'seconds', seconds: true },
  { id: '15s', bybit: null, ms: 15 * S, label: '15 seconds', short: '15s', group: 'seconds', seconds: true },
  { id: '30s', bybit: null, ms: 30 * S, label: '30 seconds', short: '30s', group: 'seconds', seconds: true },
  { id: '1m', bybit: '1', ms: 1 * M, label: '1 minute', short: '1m', group: 'minutes' },
  { id: '3m', bybit: '3', ms: 3 * M, label: '3 minutes', short: '3m', group: 'minutes' },
  { id: '5m', bybit: '5', ms: 5 * M, label: '5 minutes', short: '5m', group: 'minutes' },
  { id: '15m', bybit: '15', ms: 15 * M, label: '15 minutes', short: '15m', group: 'minutes' },
  { id: '30m', bybit: '30', ms: 30 * M, label: '30 minutes', short: '30m', group: 'minutes' },
  { id: '1h', bybit: '60', ms: 1 * H, label: '1 hour', short: '1h', group: 'hours' },
  { id: '2h', bybit: '120', ms: 2 * H, label: '2 hours', short: '2h', group: 'hours' },
  { id: '4h', bybit: '240', ms: 4 * H, label: '4 hours', short: '4h', group: 'hours' },
  { id: '6h', bybit: '360', ms: 6 * H, label: '6 hours', short: '6h', group: 'hours' },
  { id: '12h', bybit: '720', ms: 12 * H, label: '12 hours', short: '12h', group: 'hours' },
  { id: '1D', bybit: 'D', ms: 1 * D, label: '1 day', short: 'D', group: 'days' },
  { id: '1W', bybit: 'W', ms: 7 * D, label: '1 week', short: 'W', group: 'days' },
  { id: '1M', bybit: 'M', ms: 30 * D, label: '1 month', short: 'M', group: 'days' },
];

export const TF_IDS = TIMEFRAMES.map((t) => t.id);
const BY_ID = new Map(TIMEFRAMES.map((t) => [t.id, t]));
const ALIASES = {
  '1': '1m', '3': '3m', '5': '5m', '15': '15m', '30': '30m', '60': '1h', '120': '2h', '240': '4h',
  '360': '6h', '720': '12h', D: '1D', '1d': '1D', d: '1D', W: '1W', '1w': '1W', w: '1W', M: '1M', '1mo': '1M',
  '1H': '1h', '2H': '2h', '4H': '4h', '6H': '6h', '12H': '12h',
};

export const TF_GROUP_LABELS = { seconds: 'Seconds', minutes: 'Minutes', hours: 'Hours', days: 'Days' };

/** Normalise user/agent supplied interval strings to canonical ids. */
export function normalizeTf(tf) {
  if (tf == null) return null;
  const s = String(tf).trim();
  if (BY_ID.has(s)) return s;
  if (ALIASES[s]) return ALIASES[s];
  const lower = s.toLowerCase();
  if (BY_ID.has(lower)) return lower;
  if (ALIASES[lower]) return ALIASES[lower];
  return null;
}

export function getTimeframe(tf) {
  return BY_ID.get(normalizeTf(tf)) || null;
}

export function isTimeframe(tf) {
  return normalizeTf(tf) != null;
}

export function tfToMs(tf) {
  const t = getTimeframe(tf);
  if (!t) throw new Error(`Unknown timeframe: ${tf}`);
  return t.ms;
}

export function tfToBybit(tf) {
  const t = getTimeframe(tf);
  return t ? t.bybit : null;
}

export function isSecondsTf(tf) {
  const t = getTimeframe(tf);
  return !!(t && t.seconds);
}

export function tfLabel(tf) {
  const t = getTimeframe(tf);
  return t ? t.short : String(tf);
}

const MONDAY_OFFSET = 4 * D; // 1970-01-01 was a Thursday; Bybit weeks start Monday 00:00 UTC

/** Floor a ms timestamp to the open time of the bar containing it. */
export function floorTime(t, tf) {
  const id = normalizeTf(tf);
  if (id === '1M') {
    const d = new Date(t);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  }
  if (id === '1W') {
    const w = 7 * D;
    return t - ((((t - MONDAY_OFFSET) % w) + w) % w);
  }
  const ms = tfToMs(id);
  return t - (((t % ms) + ms) % ms);
}

/** Open time of the bar following the one opening at `t`. */
export function nextBarTime(t, tf) {
  const id = normalizeTf(tf);
  if (id === '1M') {
    const d = new Date(t);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  }
  return floorTime(t, id) + tfToMs(id);
}
