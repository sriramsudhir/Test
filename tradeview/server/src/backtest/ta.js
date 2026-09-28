// Plain-JS technical analysis helpers over number arrays. All return arrays aligned with the input,
// with NaN during warm-up. Semantics match Pine (ta.rma = Wilder smoothing, ta.rsi, ta.atr, ...).

export function sma(src, len) {
  const out = new Array(src.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < src.length; i++) {
    sum += src[i];
    if (i >= len) sum -= src[i - len];
    if (i >= len - 1) out[i] = sum / len;
  }
  return out;
}

export function ema(src, len) {
  const out = new Array(src.length).fill(NaN);
  const a = 2 / (len + 1);
  let prev = NaN;
  let seed = 0;
  for (let i = 0; i < src.length; i++) {
    if (i < len - 1) {
      seed += src[i];
      continue;
    }
    if (i === len - 1) {
      seed += src[i];
      prev = seed / len; // SMA seed like Pine
    } else {
      prev = a * src[i] + (1 - a) * prev;
    }
    out[i] = prev;
  }
  return out;
}

export function rma(src, len) {
  const out = new Array(src.length).fill(NaN);
  const a = 1 / len;
  let prev = NaN;
  let seed = 0;
  let n = 0;
  for (let i = 0; i < src.length; i++) {
    const v = src[i];
    if (Number.isNaN(prev)) {
      if (Number.isNaN(v)) continue;
      seed += v;
      n++;
      if (n === len) {
        prev = seed / len;
        out[i] = prev;
      }
      continue;
    }
    prev = a * v + (1 - a) * prev;
    out[i] = prev;
  }
  return out;
}

export function stdev(src, len) {
  const m = sma(src, len);
  const out = new Array(src.length).fill(NaN);
  for (let i = len - 1; i < src.length; i++) {
    let s = 0;
    for (let j = i - len + 1; j <= i; j++) s += (src[j] - m[i]) ** 2;
    out[i] = Math.sqrt(s / len);
  }
  return out;
}

export function rsi(src, len = 14) {
  const up = new Array(src.length).fill(NaN);
  const dn = new Array(src.length).fill(NaN);
  for (let i = 1; i < src.length; i++) {
    const d = src[i] - src[i - 1];
    up[i] = Math.max(d, 0);
    dn[i] = Math.max(-d, 0);
  }
  const ru = rma(up, len);
  const rd = rma(dn, len);
  return ru.map((u, i) => {
    const d = rd[i];
    if (Number.isNaN(u) || Number.isNaN(d)) return NaN;
    if (d === 0) return 100;
    if (u === 0) return 0;
    return 100 - 100 / (1 + u / d);
  });
}

export function trueRange(candles) {
  return candles.map((k, i) => {
    if (i === 0) return k.h - k.l;
    const pc = candles[i - 1].c;
    return Math.max(k.h - k.l, Math.abs(k.h - pc), Math.abs(k.l - pc));
  });
}

export function atr(candles, len = 14) {
  return rma(trueRange(candles), len);
}

/** Supertrend like ta.supertrend: returns {line, dir} with dir -1 = up-trend, +1 = down-trend. */
export function supertrend(candles, factor = 3, atrLen = 10) {
  const a = atr(candles, atrLen);
  const n = candles.length;
  const line = new Array(n).fill(NaN);
  const dir = new Array(n).fill(NaN);
  let prevUpper = NaN;
  let prevLower = NaN;
  let prevSt = NaN;
  for (let i = 0; i < n; i++) {
    const k = candles[i];
    const hl2 = (k.h + k.l) / 2;
    if (Number.isNaN(a[i])) continue;
    let upper = hl2 + factor * a[i];
    let lower = hl2 - factor * a[i];
    const pc = i > 0 ? candles[i - 1].c : k.c;
    if (!Number.isNaN(prevLower)) lower = lower > prevLower || pc < prevLower ? lower : prevLower;
    if (!Number.isNaN(prevUpper)) upper = upper < prevUpper || pc > prevUpper ? upper : prevUpper;
    let d;
    if (Number.isNaN(prevSt)) d = 1;
    else if (prevSt === prevUpper) d = k.c > upper ? -1 : 1;
    else d = k.c < lower ? 1 : -1;
    const st = d === -1 ? lower : upper;
    line[i] = st;
    dir[i] = d;
    prevUpper = upper;
    prevLower = lower;
    prevSt = st;
  }
  return { line, dir };
}

export function crossover(a, b, i) {
  const bi = Array.isArray(b) ? b[i] : b;
  const bp = Array.isArray(b) ? b[i - 1] : b;
  return i > 0 && a[i] > bi && a[i - 1] <= bp;
}

export function crossunder(a, b, i) {
  const bi = Array.isArray(b) ? b[i] : b;
  const bp = Array.isArray(b) ? b[i - 1] : b;
  return i > 0 && a[i] < bi && a[i - 1] >= bp;
}

export function highest(src, len) {
  return src.map((_, i) => (i < len - 1 ? NaN : Math.max(...src.slice(i - len + 1, i + 1))));
}

export function lowest(src, len) {
  return src.map((_, i) => (i < len - 1 ? NaN : Math.min(...src.slice(i - len + 1, i + 1))));
}

/** z-score of the last value vs the preceding `len` values. */
export function zscoreLast(src, len = 20) {
  const n = src.length;
  if (n < 3) return 0;
  const win = src.slice(Math.max(0, n - 1 - len), n - 1);
  const mean = win.reduce((s, v) => s + v, 0) / win.length;
  const sd = Math.sqrt(win.reduce((s, v) => s + (v - mean) ** 2, 0) / win.length);
  return sd === 0 ? 0 : (src[n - 1] - mean) / sd;
}
