/**
 * Client-side fast path for common indicators, so they render instantly before the Pine result
 * arrives (and keep working offline). Output mirrors the /api/pine/run shape:
 * { plots: { [name]: { data:[{t,value}], options } }, meta: { title, overlay }, levels? }
 */

const src = (c, source = 'close') => {
  switch (source) {
    case 'open': return c.o;
    case 'high': return c.h;
    case 'low': return c.l;
    case 'hl2': return (c.h + c.l) / 2;
    case 'hlc3': return (c.h + c.l + c.c) / 3;
    case 'ohlc4': return (c.o + c.h + c.l + c.c) / 4;
    default: return c.c;
  }
};

export function smaArr(values, len) {
  const out = new Array(values.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= len) sum -= values[i - len];
    if (i >= len - 1) out[i] = sum / len;
  }
  return out;
}

export function emaArr(values, len) {
  const out = new Array(values.length).fill(NaN);
  const k = 2 / (len + 1);
  let prev = NaN;
  let seed = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (Number.isNaN(v)) continue;
    if (Number.isNaN(prev)) {
      seed += v;
      if (i >= len - 1) {
        prev = seed / len;
        out[i] = prev;
      }
      continue;
    }
    prev = v * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export function rmaArr(values, len) {
  const out = new Array(values.length).fill(NaN);
  let prev = NaN;
  let seed = 0;
  let n = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (Number.isNaN(v)) continue;
    if (Number.isNaN(prev)) {
      seed += v;
      n++;
      if (n === len) {
        prev = seed / len;
        out[i] = prev;
      }
      continue;
    }
    prev = (prev * (len - 1) + v) / len;
    out[i] = prev;
  }
  return out;
}

function stdevArr(values, len, mean) {
  const out = new Array(values.length).fill(NaN);
  for (let i = len - 1; i < values.length; i++) {
    let s = 0;
    for (let j = i - len + 1; j <= i; j++) s += (values[j] - mean[i]) ** 2;
    out[i] = Math.sqrt(s / len);
  }
  return out;
}

const toPlot = (candles, arr, options) => ({
  data: candles.map((c, i) => ({ t: c.t, value: Number.isFinite(arr[i]) ? arr[i] : null })),
  options,
});

const COMPUTE = {
  sma(candles, inp) {
    const len = inp.length ?? 20;
    const v = smaArr(candles.map((c) => src(c, inp.source)), len);
    return { meta: { title: `SMA ${len}`, overlay: true }, plots: { SMA: toPlot(candles, v, { color: inp.color || '#2962ff', linewidth: 2 }) } };
  },
  ema(candles, inp) {
    const len = inp.length ?? 20;
    const v = emaArr(candles.map((c) => src(c, inp.source)), len);
    return { meta: { title: `EMA ${len}`, overlay: true }, plots: { EMA: toPlot(candles, v, { color: inp.color || '#ff9800', linewidth: 2 }) } };
  },
  bb(candles, inp) {
    const len = inp.length ?? 20;
    const mult = inp.mult ?? 2;
    const vals = candles.map((c) => src(c, inp.source));
    const basis = smaArr(vals, len);
    const dev = stdevArr(vals, len, basis);
    const up = basis.map((b, i) => b + mult * dev[i]);
    const lo = basis.map((b, i) => b - mult * dev[i]);
    return {
      meta: { title: `BB ${len} ${mult}`, overlay: true },
      plots: {
        Basis: toPlot(candles, basis, { color: '#ff6d00', linewidth: 1 }),
        Upper: toPlot(candles, up, { color: '#2962ff', linewidth: 1 }),
        Lower: toPlot(candles, lo, { color: '#2962ff', linewidth: 1 }),
      },
      fill: { between: ['Upper', 'Lower'], color: 'rgba(33, 150, 243, 0.08)' },
    };
  },
  vwap(candles) {
    const v = new Array(candles.length).fill(NaN);
    let day = -1;
    let pv = 0;
    let vol = 0;
    for (let i = 0; i < candles.length; i++) {
      const c = candles[i];
      const d = Math.floor(c.t / 86400000);
      if (d !== day) {
        day = d;
        pv = 0;
        vol = 0;
      }
      const tp = (c.h + c.l + c.c) / 3;
      pv += tp * (c.v || 0);
      vol += c.v || 0;
      v[i] = vol > 0 ? pv / vol : tp;
    }
    return { meta: { title: 'VWAP', overlay: true }, plots: { VWAP: toPlot(candles, v, { color: '#e040fb', linewidth: 2 }) } };
  },
  rsi(candles, inp) {
    const len = inp.length ?? 14;
    const vals = candles.map((c) => src(c, inp.source));
    const gains = vals.map((x, i) => (i ? Math.max(x - vals[i - 1], 0) : NaN));
    const losses = vals.map((x, i) => (i ? Math.max(vals[i - 1] - x, 0) : NaN));
    const ag = rmaArr(gains, len);
    const al = rmaArr(losses, len);
    const r = ag.map((g, i) => (Number.isFinite(g) && Number.isFinite(al[i]) ? (al[i] === 0 ? 100 : 100 - 100 / (1 + g / al[i])) : NaN));
    return {
      meta: { title: `RSI ${len}`, overlay: false },
      plots: { RSI: toPlot(candles, r, { color: '#7e57c2', linewidth: 2 }) },
      levels: [{ price: 70, color: '#787b86' }, { price: 50, color: 'rgba(120,123,134,0.5)' }, { price: 30, color: '#787b86' }],
    };
  },
  macd(candles, inp) {
    const fast = inp.fast ?? 12;
    const slow = inp.slow ?? 26;
    const sig = inp.signal ?? 9;
    const vals = candles.map((c) => src(c, inp.source));
    const ef = emaArr(vals, fast);
    const es = emaArr(vals, slow);
    const macd = ef.map((f, i) => f - es[i]);
    const signal = emaArr(macd, sig);
    const hist = macd.map((m, i) => m - signal[i]);
    const histData = candles.map((c, i) => {
      const h = hist[i];
      if (!Number.isFinite(h)) return { t: c.t, value: null };
      const prev = hist[i - 1];
      const rising = Number.isFinite(prev) ? h > prev : true;
      const color = h >= 0 ? (rising ? '#26a69a' : '#b2dfdb') : rising ? '#ffcdd2' : '#ef5350';
      return { t: c.t, value: h, color };
    });
    return {
      meta: { title: `MACD ${fast} ${slow} ${sig}`, overlay: false },
      plots: {
        Histogram: { data: histData, options: { style: 'histogram', color: '#26a69a' } },
        MACD: toPlot(candles, macd, { color: '#2962ff', linewidth: 2 }),
        Signal: toPlot(candles, signal, { color: '#ff6d00', linewidth: 2 }),
      },
      levels: [{ price: 0, color: 'rgba(120,123,134,0.5)' }],
    };
  },
};

COMPUTE.bollinger = COMPUTE.bb;
COMPUTE.boll = COMPUTE.bb;

export function hasFastPath(id) {
  return !!id && Object.prototype.hasOwnProperty.call(COMPUTE, String(id).toLowerCase());
}

export function computeFast(id, candles, inputs = {}) {
  const fn = COMPUTE[String(id).toLowerCase()];
  if (!fn) return null;
  return fn(candles, inputs || {});
}
