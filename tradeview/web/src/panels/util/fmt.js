// Number / time formatting helpers.

export function decimalsForTick(tick) {
  if (!tick || !isFinite(tick) || tick <= 0) return null;
  const s = String(tick);
  if (s.includes('e-')) return Number(s.split('e-')[1]);
  const i = s.indexOf('.');
  return i === -1 ? 0 : s.length - i - 1;
}

export function formatPrice(v, tick) {
  if (v == null || v === '' || !isFinite(v)) return '—';
  const n = Number(v);
  let d = decimalsForTick(tick);
  if (d == null) {
    const a = Math.abs(n);
    d = a >= 10000 ? 1 : a >= 100 ? 2 : a >= 1 ? 3 : a >= 0.01 ? 5 : 8;
  }
  return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

export function formatNum(v, digits = 2) {
  if (v == null || v === '' || !isFinite(v)) return '—';
  return Number(v).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function formatCompact(v) {
  if (v == null || !isFinite(v)) return '—';
  const a = Math.abs(v);
  const units = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
  for (const [u, s] of units) if (a >= u) return (v / u).toFixed(2).replace(/\.?0+$/, '') + s;
  return formatNum(v, a < 1 ? 4 : 2);
}

export function formatPct(v, digits = 2, withSign = true) {
  if (v == null || !isFinite(v)) return '—';
  const s = Number(v).toFixed(digits);
  return (withSign && v > 0 ? '+' : '') + s + '%';
}

export function formatSigned(v, digits = 2) {
  if (v == null || !isFinite(v)) return '—';
  return (v > 0 ? '+' : '') + formatNum(v, digits);
}

const pad = (n) => String(n).padStart(2, '0');

/** Normalise a time that may be seconds or milliseconds to ms. */
export const toMs = (t) => (t == null ? null : (Number(t) < 1e11 ? Number(t) * 1000 : Number(t)));

export function formatDateTime(t, { seconds = false, utc = false } = {}) {
  const ms = toMs(t);
  if (ms == null || !isFinite(ms)) return '—';
  const d = new Date(ms);
  const g = utc
    ? [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()]
    : [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()];
  return `${g[0]}-${pad(g[1])}-${pad(g[2])} ${pad(g[3])}:${pad(g[4])}${seconds ? ':' + pad(g[5]) : ''}`;
}

export function formatDate(t) {
  const ms = toMs(t);
  if (ms == null) return '—';
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function formatTimeAgo(t) {
  const ms = toMs(t);
  if (!ms) return '';
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** "linear:BTCUSDT" -> { category: 'linear', symbol: 'BTCUSDT' } */
export function splitKey(key) {
  const s = String(key || '');
  const i = s.indexOf(':');
  return i === -1 ? { category: 'linear', symbol: s } : { category: s.slice(0, i), symbol: s.slice(i + 1) };
}

export function categoryLabel(cat) {
  return {
    linear: 'PERP', inverse: 'INV', spot: 'SPOT', delta: 'DELTA',
    perpetual_futures: 'PERP', futures: 'FUT', call_options: 'CALL', put_options: 'PUT', move_options: 'MOVE',
  }[cat] || String(cat || '').toUpperCase();
}

/** Market-data provider for a symbol key (§13.1): `delta:*` -> 'delta', Bybit categories -> 'bybit'. */
export function providerOf(key) {
  const { category } = splitKey(key);
  return category === 'delta' ? 'delta' : 'bybit';
}

/** Short badge text for a symbol key, e.g. 'DELTA' or 'PERP' / 'SPOT' for Bybit. */
export function symbolTag(key) {
  const { category } = splitKey(key);
  return category === 'delta' ? 'DELTA' : categoryLabel(category);
}

export const DEFAULT_SYMBOL = 'delta:BTCUSD';

export const TIMEFRAMES = ['1s', '5s', '15s', '30s', '1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '1D', '1W', '1M'];

/** yyyy-mm-dd for <input type=date> */
export function toDateInput(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** yyyy-mm-ddThh:mm for <input type=datetime-local> */
export function toDateTimeInput(ms) {
  const d = new Date(ms);
  return `${toDateInput(ms)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
