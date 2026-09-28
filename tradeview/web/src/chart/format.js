/** Number / time formatting helpers shared by the chart UI. */

export function decimalsOf(step) {
  if (!Number.isFinite(step) || step <= 0) return 2;
  const s = String(step);
  if (s.includes('e-')) return Number(s.split('e-')[1]);
  const i = s.indexOf('.');
  return i < 0 ? 0 : s.length - i - 1;
}

/** Guess a price precision from a sample of candles when instrument info is unavailable. */
export function inferPrecision(candles) {
  let max = 0;
  const n = Math.min(candles.length, 200);
  for (let i = candles.length - n; i < candles.length; i++) {
    const c = candles[i];
    for (const v of [c.o, c.h, c.l, c.c]) {
      const s = String(v);
      const d = s.includes('.') ? s.length - s.indexOf('.') - 1 : 0;
      if (d > max) max = d;
    }
  }
  if (!candles.length) return 2;
  const last = candles[candles.length - 1].c;
  const floor = last >= 1000 ? 1 : last >= 10 ? 2 : last >= 1 ? 3 : last >= 0.01 ? 5 : 8;
  return Math.min(Math.max(max, floor), 8);
}

export function formatPrice(v, precision = 2) {
  if (v == null || !Number.isFinite(v)) return '—';
  return v.toLocaleString('en-US', { minimumFractionDigits: precision, maximumFractionDigits: precision });
}

export function formatCompact(v, digits = 2) {
  if (v == null || !Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (a >= 1e9) return sign + (a / 1e9).toFixed(digits) + 'B';
  if (a >= 1e6) return sign + (a / 1e6).toFixed(digits) + 'M';
  if (a >= 1e3) return sign + (a / 1e3).toFixed(digits) + 'K';
  if (a >= 100) return sign + a.toFixed(0);
  if (a >= 1) return sign + a.toFixed(Math.min(digits, 2));
  if (a === 0) return '0';
  return sign + a.toPrecision(2);
}

/** Very short volume label for footprint cells: 1234 → 1.2K, 12 → 12, 0.034 → .03 */
export function formatCell(v) {
  if (!v) return '0';
  const a = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (a >= 1e6) return sign + (a / 1e6).toFixed(a >= 1e7 ? 0 : 1) + 'M';
  if (a >= 1e4) return sign + (a / 1e3).toFixed(0) + 'K';
  if (a >= 1e3) return sign + (a / 1e3).toFixed(1) + 'K';
  if (a >= 10) return sign + a.toFixed(0);
  if (a >= 1) return sign + a.toFixed(1).replace(/\.0$/, '');
  return sign + a.toFixed(2).replace(/^0/, '');
}

export function formatPercent(v, digits = 2) {
  if (v == null || !Number.isFinite(v)) return '—';
  return (v >= 0 ? '+' : '') + v.toFixed(digits) + '%';
}

export function formatSigned(v, precision = 2) {
  if (v == null || !Number.isFinite(v)) return '—';
  return (v >= 0 ? '+' : '') + formatPrice(v, precision);
}

const pad = (n) => String(n).padStart(2, '0');

export function formatDateTime(ms, withSeconds = false) {
  const d = new Date(ms);
  const s = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  return withSeconds ? `${s}:${pad(d.getUTCSeconds())}` : s;
}

export function formatDate(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Remaining time until bar close, TradingView style (mm:ss, hh:mm:ss, Nd hh:mm). */
export function formatCountdown(ms) {
  if (ms < 0) ms = 0;
  const total = Math.floor(ms / 1000);
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (d > 0) return `${d}d ${pad(h)}:${pad(m)}`;
  if (h > 0) return `${pad(h)}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}

export function formatDuration(ms) {
  const a = Math.abs(ms);
  const m = Math.round(a / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60 ? (m % 60) + 'm' : ''}`.trim();
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24 ? (h % 24) + 'h' : ''}`.trim();
}
