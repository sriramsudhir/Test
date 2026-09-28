// In-memory mock of web/src/api/client.js for the chart demo: deterministic synthetic candles, footprint,
// Pine runs (via the JS fast path), drawings CRUD and a simulated live socket.
import { computeFast } from '../src/chart/indicators/fast.js';
import { tfToMs, floorTime, isSecondsTf } from '../src/chart/timeframes.js';

const hash = (n) => {
  let x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
};
const BASE = { 'delta:BTCUSD': 64000, 'delta:ETHUSD': 3100, 'linear:SOLUSDT': 145 };
const TICK = { 'delta:BTCUSD': 0.5, 'delta:ETHUSD': 0.05, 'linear:SOLUSDT': 0.01 };

function priceAt(symbol, t) {
  const b = BASE[symbol] || 100;
  const d = t / 3600000;
  return b * (1 + 0.08 * Math.sin(d / 180) + 0.035 * Math.sin(d / 23) + 0.012 * Math.sin(d / 3.1) + 0.004 * Math.sin(d * 1.7) + 0.0025 * (hash(Math.floor(t / 60000)) - 0.5));
}

export function candleAt(symbol, tf, t) {
  const ms = tfToMs(tf);
  const o = priceAt(symbol, t);
  const c = priceAt(symbol, t + ms);
  const r = Math.abs(c - o) + o * 0.0015 * (0.3 + hash(t / ms)) * Math.sqrt(ms / 3600000 + 0.02);
  const h = Math.max(o, c) + r * hash(t / ms + 1) * 0.8;
  const l = Math.min(o, c) - r * hash(t / ms + 2) * 0.8;
  const v = (200 + 1800 * hash(t / ms + 3) + 900 * Math.abs(c - o) / (o * 0.002)) * Math.sqrt(ms / 3600000 + 0.01);
  const tick = TICK[symbol] || 0.01;
  const round = (x) => Math.round(x / tick) * tick;
  return { t, o: round(o), h: round(h), l: round(l), c: round(c), v: +v.toFixed(3) };
}

function candles({ symbol, tf, to, limit = 2000 }) {
  const ms = tfToMs(tf);
  const now = Date.now();
  const earliest = floorTime(now, tf) - ms * 6000; // ~6000 bars of history per tf
  const last = floorTime(Math.min(to ? +to : now, now), tf);
  const out = [];
  for (let t = last - (limit - 1) * ms; t <= last; t += ms) if (t >= earliest) out.push(candleAt(symbol, tf, t));
  if (!to || +to >= now) out[out.length - 1] = liveBar(symbol, tf);
  return out;
}

export function footprintFor(symbol, c) {
  const range = c.h - c.l;
  const tickBase = TICK[symbol] || 0.01;
  let tick = tickBase;
  while (range / tick > 14) tick *= range / tick > 60 ? 5 : 2;
  const lo = Math.floor(c.l / tick) * tick;
  const hi = Math.floor(c.h / tick) * tick;
  const levels = [];
  const up = c.c >= c.o;
  const poc = (c.o + c.c) / 2;
  let i = 0;
  for (let p = lo; p <= hi + 1e-9; p += tick, i++) {
    const w = Math.exp(-(((p - poc) / (range * 0.35 + tick)) ** 2));
    const vol = (c.v / Math.max(4, range / tick)) * (0.3 + 1.7 * w) * (0.6 + 0.8 * hash(p + c.t));
    let askShare = up ? 0.58 : 0.42;
    const r = hash(p * 3 + c.t);
    if (r > 0.9) askShare = 0.85;
    else if (r < 0.1) askShare = 0.15;
    levels.push({ p: +p.toFixed(8), bid: +(vol * (1 - askShare)).toFixed(3), ask: +(vol * askShare).toFixed(3) });
  }
  const delta = levels.reduce((a, l) => a + l.ask - l.bid, 0);
  return { t: c.t, levels, tick, delta };
}

// ------------------------------------------------------------------ live simulation
const live = new Map(); // key symbol|tf → current bar
function liveBar(symbol, tf) {
  const key = `${symbol}|${tf}`;
  const t = floorTime(Date.now(), tf);
  let b = live.get(key);
  if (!b || b.t !== t) {
    const base = candleAt(symbol, tf, t);
    b = { ...base, c: base.o, h: base.o, l: base.o, v: 0 };
    live.set(key, b);
  }
  return { ...b };
}

const handlers = new Map();
const subs = new Map();
const emitMsg = (type, msg) => (handlers.get(type) || new Set()).forEach((fn) => fn(msg));

let paused = false;
setInterval(() => {
  if (paused) return;
  for (const key of subs.keys()) {
    const [channel, symbol, tf] = key.split('|');
    if (channel === 'kline' && !isSecondsTf(tf)) {
      const k = `${symbol}|${tf}`;
      const t = floorTime(Date.now(), tf);
      let b = live.get(k);
      let closed = null;
      if (b && b.t !== t) {
        closed = { ...b };
        live.delete(k);
      }
      if (closed) emitMsg('kline', { type: 'kline', symbol, tf, candle: closed, closed: true });
      b = live.get(k) || liveBar(symbol, tf);
      const tick = TICK[symbol] || 0.01;
      const target = candleAt(symbol, tf, t);
      const step = (target.c - b.c) * 0.08 + (hash(Date.now()) - 0.5) * b.o * 0.0008;
      b.c = Math.round((b.c + step) / tick) * tick;
      b.h = Math.max(b.h, b.c);
      b.l = Math.min(b.l, b.c);
      b.v = +(b.v + 5 + 20 * hash(Date.now() + 1)).toFixed(3);
      live.set(k, b);
      emitMsg('kline', { type: 'kline', symbol, tf, candle: { ...b }, closed: false });
      if (subs.has(`footprint|${symbol}|${tf}`)) emitMsg('footprint', { type: 'footprint', symbol, tf, bar: footprintFor(symbol, b) });
    }
    if (channel === 'trades') {
      const p = priceAt(symbol, Date.now()) * (1 + (hash(Date.now()) - 0.5) * 0.0004);
      const trades = [];
      for (let i = 0; i < 4; i++) trades.push({ t: Date.now() - 200 + i * 50, p: +(p * (1 + (hash(i + Date.now()) - 0.5) * 0.0002)).toFixed(1), q: +(hash(i * 7 + Date.now()) * 2).toFixed(3), side: hash(i) > 0.5 ? 'Buy' : 'Sell' });
      emitMsg('trade', { type: 'trade', symbol, trades });
    }
  }
}, 500);

export const socket = {
  on(type, fn) {
    if (!handlers.has(type)) handlers.set(type, new Set());
    handlers.get(type).add(fn);
    return () => handlers.get(type).delete(fn);
  },
  off(type, fn) {
    handlers.get(type)?.delete(fn);
  },
  send() {},
  subscribe(channel, symbol, tf) {
    const key = [channel, symbol, tf].filter(Boolean).join('|');
    subs.set(key, (subs.get(key) || 0) + 1);
  },
  unsubscribe(channel, symbol, tf) {
    const key = [channel, symbol, tf].filter(Boolean).join('|');
    const n = (subs.get(key) || 0) - 1;
    if (n <= 0) subs.delete(key);
    else subs.set(key, n);
  },
  _pause(v) {
    paused = v;
  },
  _subs: subs,
};

// ------------------------------------------------------------------ REST
const drawings = new Map();
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
export const calls = [];

export const api = {
  async get(path, params = {}) {
    calls.push(['GET', path, params]);
    await delay(60);
    if (path === '/api/candles') {
      if (isSecondsTf(params.tf)) return { candles: [] };
      return { candles: candles(params) };
    }
    if (path === '/api/footprint') {
      const tf = params.tf;
      const ms = tfToMs(tf);
      const out = [];
      const from = Math.max(+params.from, Date.now() - ms * 400); // "recorded" only for the last 400 bars
      for (let t = floorTime(from, tf); t <= +params.to; t += ms) {
        const c = t === floorTime(Date.now(), tf) ? liveBar(params.symbol, tf) : candleAt(params.symbol, tf, t);
        out.push(footprintFor(params.symbol, c));
      }
      return { bars: out };
    }
    if (path === '/api/symbols') {
      return Object.keys(BASE).map((key) => ({ key, symbol: key.split(':')[1], provider: key.startsWith('delta') ? 'delta' : 'bybit', tickSize: TICK[key], contract_type: 'perpetual_futures' }));
    }
    if (path === '/api/drawings') return { drawings: [...drawings.values()].filter((d) => d.symbol === params.symbol) };
    if (path.startsWith('/api/pine/library/')) {
      const id = path.split('/').pop();
      return { id, name: id.toUpperCase(), source: `//@version=5\nindicator("${id.toUpperCase()}", overlay=true)\nlength = input.int(14, "Length")\nplot(ta.sma(close, length))` };
    }
    throw new Error(`mock: GET ${path} not implemented`);
  },
  async post(path, body) {
    calls.push(['POST', path, body]);
    if (path === '/api/pine/run') {
      await delay(500);
      const m = body.source.match(/indicator\("([^"]+)"/);
      const id = (m ? m[1] : 'sma').toLowerCase();
      const len = +(body.source.match(/input\.int\((\d+)/)?.[1] || 14);
      const cs = candles({ symbol: body.symbol, tf: body.tf, to: body.to, limit: Math.min(5000, Math.round((body.to - body.from) / tfToMs(body.tf)) + 1) });
      const res = computeFast(['sma', 'ema', 'bb', 'vwap', 'rsi', 'macd'].includes(id) ? id : 'sma', cs, { length: len });
      if (!res) return { error: 'unknown script' };
      return { plots: res.plots, meta: { title: `${res.meta.title} (pine)`, overlay: res.meta.overlay }, levels: res.levels };
    }
    throw new Error(`mock: POST ${path} not implemented`);
  },
  async put(path, body) {
    calls.push(['PUT', path, body]);
    drawings.set(body.id, body);
    return { ok: true };
  },
  async delete(path) {
    calls.push(['DELETE', path]);
    drawings.delete(decodeURIComponent(path.split('/').pop()));
    return { ok: true };
  },
};

export default { api, socket };
