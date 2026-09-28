// Delta Exchange resolution mapping (ARCHITECTURE §13.1).
// Native Delta resolutions: 1m 3m 5m 15m 30m 1h 2h 4h 6h 1d 1w (+ 7d, 30d, 2w).
// We derive 12h from 6h, and 1W / 1M from 1d so weekly bars open Monday 00:00 UTC and monthly bars on the
// 1st (the same calendar convention as Bybit and data/timeframes.js), whatever week anchor Delta uses.
import { normalizeTf, bybitToTf, tfToBybit } from '../data/timeframes.js';

/** canonical tf id -> Delta resolution string (native only) */
export const DELTA_RESOLUTIONS = Object.freeze({
  '1m': '1m', '3m': '3m', '5m': '5m', '15m': '15m', '30m': '30m',
  '1h': '1h', '2h': '2h', '4h': '4h', '6h': '6h', '1D': '1d',
});

/** canonical tf id -> native tf it is derived from */
export const DELTA_DERIVED = Object.freeze({ '12h': '6h', '1W': '1D', '1M': '1D' });

const RES_TO_TF = new Map(Object.entries(DELTA_RESOLUTIONS).map(([tf, res]) => [res, tf]));

/** Delta resolution for a canonical tf, or null when the tf is derived / trade-built. */
export function deltaResolution(tf) {
  const id = normalizeTf(tf);
  return (id && DELTA_RESOLUTIONS[id]) || null;
}

/** Canonical tf for a Delta resolution string ("1h" -> "1h", "1d" -> "1D"). */
export function tfFromDeltaResolution(res) {
  return RES_TO_TF.get(String(res).toLowerCase()) ?? null;
}

/** Lower native tf a derived tf is built from, or null. */
export function deltaSourceTf(tf) {
  return DELTA_DERIVED[normalizeTf(tf)] ?? null;
}

/**
 * Map a Bybit-style stream topic (`kline.{bybitCode}.{SYMBOL}` / `publicTrade.{SYMBOL}`) to a Delta channel.
 * @returns {{ name: string, symbol: string, tf?: string }|null}
 */
export function topicToChannel(topic) {
  const parts = String(topic).split('.');
  if (parts[0] === 'publicTrade' && parts.length >= 2) return { name: 'all_trades', symbol: parts.slice(1).join('.') };
  if (parts[0] === 'kline' && parts.length >= 3) {
    let tf;
    try {
      tf = bybitToTf(parts[1]);
    } catch {
      return null;
    }
    const res = DELTA_RESOLUTIONS[tf];
    if (!res) return null;
    return { name: `candlestick_${res}`, symbol: parts.slice(2).join('.'), tf };
  }
  return null;
}

/** Inverse of topicToChannel for candlestick channels. */
export function channelToTopic(name, symbol) {
  if (name === 'all_trades') return `publicTrade.${symbol}`;
  const m = /^candlestick_(.+)$/.exec(name);
  if (!m) return null;
  const tf = tfFromDeltaResolution(m[1]);
  return tf ? `kline.${tfToBybit(tf)}.${symbol}` : null;
}

/** Normalise Delta timestamps (seconds, ms or µs) to ms. */
export function toMs(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return NaN;
  if (n < 1e11) return Math.round(n * 1000);
  if (n < 1e14) return Math.round(n);
  return Math.round(n / 1000);
}
