// Small shared helpers for the intelligence modules (kept local so they do not depend on load order).
const UNIT = { s: 1000, m: 60000, h: 3600000, D: 86400000, W: 604800000, M: 2592000000 };

/** Interval id ('1m','4h','1D','1W','1M','15s') -> milliseconds (1M approximated as 30 days). */
export function tfToMs(tf) {
  const m = /^(\d+)([smhDWM])$/.exec(String(tf || ''));
  if (!m) return 60000;
  return Number(m[1]) * UNIT[m[2]];
}

export const TF_IDS = ['1s', '5s', '15s', '30s', '1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '1D', '1W', '1M'];

export function isTf(tf) {
  return TF_IDS.includes(tf);
}

/** Normalise any candle-ish object to {t,o,h,l,c,v}. */
export function toCandle(k) {
  if (k && 'openTime' in k) return { t: +k.openTime, o: +k.open, h: +k.high, l: +k.low, c: +k.close, v: +(k.volume ?? 0) };
  return { t: +k.t, o: +k.o, h: +k.h, l: +k.l, c: +k.c, v: +(k.v ?? 0) };
}

export function httpError(statusCode, message) {
  const e = new Error(message);
  e.statusCode = statusCode;
  return e;
}
