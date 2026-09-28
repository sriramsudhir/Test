// Builtin JS strategies. Each produces per-bar boolean signal arrays evaluated on bar close:
// { longEntry, longExit, shortEntry, shortExit }. The engine fills them at the next bar's open.
import { ema, sma, rsi, supertrend, stdev, crossover, crossunder, highest, lowest } from './ta.js';

const closes = (candles) => candles.map((k) => k.c);
const empty = (n) => ({
  longEntry: new Array(n).fill(false),
  longExit: new Array(n).fill(false),
  shortEntry: new Array(n).fill(false),
  shortExit: new Array(n).fill(false),
});

export const BUILTIN_STRATEGIES = {
  ema_cross: {
    name: 'EMA Cross',
    description: 'Long when the fast EMA crosses above the slow EMA, short on the opposite cross (always in the market).',
    params: { fast: { type: 'int', default: 9, min: 1 }, slow: { type: 'int', default: 21, min: 2 } },
    signals(candles, p) {
      const c = closes(candles);
      const f = ema(c, p.fast);
      const s = ema(c, p.slow);
      const sig = empty(c.length);
      for (let i = 1; i < c.length; i++) {
        const up = crossover(f, s, i);
        const dn = crossunder(f, s, i);
        sig.longEntry[i] = up;
        sig.shortExit[i] = up;
        sig.shortEntry[i] = dn;
        sig.longExit[i] = dn;
      }
      return sig;
    },
  },
  sma_cross: {
    name: 'SMA Cross',
    description: 'Golden/death cross of two simple moving averages.',
    params: { fast: { type: 'int', default: 50, min: 1 }, slow: { type: 'int', default: 200, min: 2 } },
    signals(candles, p) {
      const c = closes(candles);
      const f = sma(c, p.fast);
      const s = sma(c, p.slow);
      const sig = empty(c.length);
      for (let i = 1; i < c.length; i++) {
        const up = crossover(f, s, i);
        const dn = crossunder(f, s, i);
        sig.longEntry[i] = sig.shortExit[i] = up;
        sig.shortEntry[i] = sig.longExit[i] = dn;
      }
      return sig;
    },
  },
  rsi_mean_reversion: {
    name: 'RSI Mean Reversion',
    description: 'Long when RSI crosses up through the oversold level, exit when RSI crosses above the exit level. Optional mirrored shorts.',
    params: {
      length: { type: 'int', default: 14, min: 2 },
      oversold: { type: 'float', default: 30 },
      overbought: { type: 'float', default: 70 },
      exitLevel: { type: 'float', default: 55 },
      shorts: { type: 'bool', default: false },
    },
    signals(candles, p) {
      const c = closes(candles);
      const r = rsi(c, p.length);
      const sig = empty(c.length);
      for (let i = 1; i < c.length; i++) {
        sig.longEntry[i] = crossover(r, p.oversold, i);
        sig.longExit[i] = crossover(r, p.exitLevel, i);
        if (p.shorts) {
          sig.shortEntry[i] = crossunder(r, p.overbought, i);
          sig.shortExit[i] = crossunder(r, 100 - p.exitLevel, i);
        }
      }
      return sig;
    },
  },
  supertrend: {
    name: 'Supertrend Trend Follow',
    description: 'Long when Supertrend flips up, short when it flips down.',
    params: { atrLength: { type: 'int', default: 10, min: 1 }, factor: { type: 'float', default: 3 } },
    signals(candles, p) {
      const { dir } = supertrend(candles, p.factor, p.atrLength);
      const sig = empty(candles.length);
      for (let i = 1; i < candles.length; i++) {
        const up = dir[i] === -1 && dir[i - 1] === 1;
        const dn = dir[i] === 1 && dir[i - 1] === -1;
        sig.longEntry[i] = sig.shortExit[i] = up;
        sig.shortEntry[i] = sig.longExit[i] = dn;
      }
      return sig;
    },
  },
  bollinger_breakout: {
    name: 'Bollinger Breakout',
    description: 'Long on a close above the upper band, exit on a close below the basis; mirrored for shorts.',
    params: { length: { type: 'int', default: 20, min: 2 }, mult: { type: 'float', default: 2 } },
    signals(candles, p) {
      const c = closes(candles);
      const basis = sma(c, p.length);
      const dev = stdev(c, p.length);
      const sig = empty(c.length);
      for (let i = 1; i < c.length; i++) {
        const up = basis[i] + p.mult * dev[i];
        const lo = basis[i] - p.mult * dev[i];
        sig.longEntry[i] = c[i] > up && c[i - 1] <= basis[i - 1] + p.mult * dev[i - 1];
        sig.longExit[i] = c[i] < basis[i];
        sig.shortEntry[i] = c[i] < lo && c[i - 1] >= basis[i - 1] - p.mult * dev[i - 1];
        sig.shortExit[i] = c[i] > basis[i];
      }
      return sig;
    },
  },
  donchian_breakout: {
    name: 'Donchian Breakout',
    description: 'Turtle-style: long on a new N-bar high, exit on an M-bar low; mirrored for shorts.',
    params: { entryLength: { type: 'int', default: 20, min: 2 }, exitLength: { type: 'int', default: 10, min: 1 } },
    signals(candles, p) {
      const hi = highest(candles.map((k) => k.h), p.entryLength);
      const lo = lowest(candles.map((k) => k.l), p.entryLength);
      const xhi = highest(candles.map((k) => k.h), p.exitLength);
      const xlo = lowest(candles.map((k) => k.l), p.exitLength);
      const sig = empty(candles.length);
      for (let i = 1; i < candles.length; i++) {
        const c = candles[i].c;
        sig.longEntry[i] = c > hi[i - 1];
        sig.shortEntry[i] = c < lo[i - 1];
        sig.longExit[i] = c < xlo[i - 1];
        sig.shortExit[i] = c > xhi[i - 1];
      }
      return sig;
    },
  },
};

export function listStrategies() {
  return Object.entries(BUILTIN_STRATEGIES).map(([id, s]) => ({ id, name: s.name, description: s.description, params: s.params }));
}

/** Resolve params against the schema (defaults, coercion, bounds). */
export function resolveParams(id, params = {}) {
  const s = BUILTIN_STRATEGIES[id];
  if (!s) throw Object.assign(new Error(`Unknown builtin strategy '${id}'`), { statusCode: 400 });
  const out = {};
  for (const [k, spec] of Object.entries(s.params)) {
    let v = params[k] ?? spec.default;
    if (spec.type === 'int') v = Math.round(Number(v));
    else if (spec.type === 'float') v = Number(v);
    else if (spec.type === 'bool') v = v === true || v === 'true' || v === 1;
    if ((spec.type === 'int' || spec.type === 'float') && !Number.isFinite(v)) v = spec.default;
    if (spec.min !== undefined && v < spec.min) v = spec.min;
    out[k] = v;
  }
  return out;
}

export function builtinSignals(id, candles, params) {
  const p = resolveParams(id, params);
  return { signals: BUILTIN_STRATEGIES[id].signals(candles, p), params: p };
}
