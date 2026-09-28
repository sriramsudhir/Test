#!/usr/bin/env node
// Local fake Delta Exchange for integration / e2e tests. Implements exactly what server/src/delta/* calls:
//   REST  GET /v2/products            {success, result:[product], meta:{after}}
//         GET /v2/tickers[/:symbol]    {success, result:[ticker] | ticker}
//         GET /v2/history/candles      ?resolution=&symbol=&start=&end= (unix seconds) -> {success, result:[{time,open,high,low,close,volume}]}
//         GET /v2/trades/:symbol       {success, result:{trades:[{price,size,buyer_role,seller_role,timestamp(µs)}]}}
//         GET /v2/settings             {success, result:{server_time}}
//   WS    {"type":"subscribe","payload":{"channels":[{"name":"candlestick_1m","symbols":["BTCUSD"]},{"name":"all_trades",...}]}}
//         {"type":"enable_heartbeat"} -> {"type":"heartbeat"} every few seconds
//         pushes {type:"all_trades", symbol, price, size, buyer_role, seller_role, timestamp(µs)}
//         and {type:"candlestick_<res>", symbol, candle_start_time(µs), open, high, low, close, volume, resolution}
//   Control (test only):
//         POST /control/price {symbol, price}      force the price (a trade prints at that price immediately)
//         POST /control/pause {paused:true|false}  freeze / resume the random walk (trades keep printing at the same price)
//         GET  /control/state                      current prices + ws clients
//
// History: a deterministic random walk of 1m bars covering HISTORY_DAYS (default 366) up to the minute the fake
// started (same UTC day => same data). Every other resolution is aggregated from those 1m bars, so all timeframes
// are mutually consistent. Minutes after start come from the live trade stream, so REST and WS agree.
//
//   node web/test/e2e/fake-delta.mjs [--port 8790] [--laya-port 8791] [--no-laya]
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { startFakeLaya } from './fake-laya.mjs';

const MIN = 60000;
const RES_MIN = { '1m': 1, '3m': 3, '5m': 5, '15m': 15, '30m': 30, '1h': 60, '2h': 120, '4h': 240, '6h': 360, '1d': 1440, '1w': 10080, '7d': 10080, '2w': 20160, '30d': 43200 };

export const PRODUCTS = [
  { id: 27, symbol: 'BTCUSD', base: 'BTC', start: 60000, tick: 0.5, contractValue: '0.001', vol: 0.0009 },
  { id: 3136, symbol: 'ETHUSD', base: 'ETH', start: 3000, tick: 0.05, contractValue: '0.01', vol: 0.0011 },
  { id: 14823, symbol: 'SOLUSD', base: 'SOL', start: 150, tick: 0.01, contractValue: '1', vol: 0.0014 },
  // Listed so the default watchlist resolves; they print trades less often.
  { id: 14969, symbol: 'XRPUSD', base: 'XRP', start: 0.58, tick: 0.0001, contractValue: '1', vol: 0.0013, quiet: true },
  { id: 15041, symbol: 'BNBUSD', base: 'BNB', start: 560, tick: 0.05, contractValue: '0.1', vol: 0.001, quiet: true },
  { id: 14745, symbol: 'DOGEUSD', base: 'DOGE', start: 0.12, tick: 0.00001, contractValue: '100', vol: 0.0016, quiet: true },
];

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash32(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}
const gauss = (rnd) => {
  const u = Math.max(1e-12, rnd());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
};
const roundTick = (p, tick) => Math.round(p / tick) * tick;
const fix = (p, tick) => Number(roundTick(p, tick).toFixed(Math.max(0, -Math.floor(Math.log10(tick)) + 1)));

/** Deterministic 1m history for one product: typed arrays indexed by minute offset from `anchor`. */
function buildHistory(prod, anchor, minutes) {
  const rnd = mulberry32(hash32(`${prod.symbol}|${anchor}`));
  const o = new Float64Array(minutes);
  const h = new Float64Array(minutes);
  const l = new Float64Array(minutes);
  const c = new Float64Array(minutes);
  const v = new Float64Array(minutes);
  const logBase = Math.log(prod.start);
  let lp = logBase;
  let prev = prod.start;
  for (let i = 0; i < minutes; i++) {
    // Mean-reverting log random walk with regime-ish vol so a year stays in a sane range.
    const volMul = 0.6 + 0.8 * (0.5 + 0.5 * Math.sin(i / 4321));
    lp += prod.vol * volMul * gauss(rnd) - 0.00002 * (lp - logBase);
    const close = fix(Math.exp(lp), prod.tick);
    const open = prev;
    const wick = Math.abs(gauss(rnd)) * prod.vol * 0.5;
    o[i] = open;
    c[i] = close;
    h[i] = fix(Math.max(open, close) * (1 + wick * rnd()), prod.tick);
    l[i] = fix(Math.min(open, close) * (1 - wick * rnd()), prod.tick);
    v[i] = Math.round(50 + 400 * rnd() * volMul);
    prev = close;
  }
  return { o, h, l, c, v };
}

export async function startFakeDelta({ port = 8790, host = '127.0.0.1', historyDays = 366, tradeMs = 250, log = console } = {}) {
  const startedAt = Date.now();
  const startMinute = Math.floor(startedAt / MIN) * MIN;
  const dayStart = Math.floor(startedAt / 86400000) * 86400000;
  const anchor = dayStart - historyDays * 86400000; // same UTC day => same history
  const histMinutes = (startMinute - anchor) / MIN; // minutes [anchor, startMinute)
  const t0 = Date.now();
  const syms = new Map();
  for (const p of PRODUCTS) {
    const hist = buildHistory(p, anchor, histMinutes);
    syms.set(p.symbol, {
      prod: p,
      hist,
      live: new Map(), // minute start (ms) -> {o,h,l,c,v}
      price: hist.c[histMinutes - 1],
      rnd: mulberry32(hash32(`${p.symbol}|live|${startedAt}`)),
      trades: [], // ring of recent trades
      paused: false,
    });
  }
  log.info?.(`[fake-delta] generated ${histMinutes} x 1m bars per symbol in ${Date.now() - t0} ms`);

  /** 1m bar at minute start t (ms) or null. */
  function minuteBar(s, t) {
    if (t < anchor) return null;
    if (t < startMinute) {
      const i = (t - anchor) / MIN;
      return { o: s.hist.o[i], h: s.hist.h[i], l: s.hist.l[i], c: s.hist.c[i], v: s.hist.v[i] };
    }
    return s.live.get(t) || null;
  }

  function barStartFor(t, res) {
    const m = RES_MIN[res];
    if (res === '1w' || res === '7d' || res === '2w') {
      // Weeks aligned to Monday 00:00 UTC (1970-01-05 is a Monday).
      const mon = 4 * 86400000;
      return Math.floor((t - mon) / (m * MIN)) * m * MIN + mon;
    }
    return Math.floor(t / (m * MIN)) * m * MIN;
  }

  /** Aggregate 1m bars into one bar of `res` starting at `start`, or null if there is no data. */
  function aggBar(s, res, start) {
    const n = RES_MIN[res];
    let bar = null;
    const end = Math.min(start + n * MIN, Date.now() + 1);
    for (let t = Math.max(start, anchor); t < end; t += MIN) {
      const b = minuteBar(s, t);
      if (!b) continue;
      if (!bar) bar = { o: b.o, h: b.h, l: b.l, c: b.c, v: b.v };
      else {
        if (b.h > bar.h) bar.h = b.h;
        if (b.l < bar.l) bar.l = b.l;
        bar.c = b.c;
        bar.v += b.v;
      }
    }
    return bar;
  }

  function candles(symbol, res, startSec, endSec) {
    const s = syms.get(symbol);
    if (!s) return null;
    const n = RES_MIN[res];
    const lastT = Date.now();
    const from = barStartFor(Math.max(startSec * 1000, anchor), res);
    const to = Math.min(endSec * 1000, lastT);
    const out = [];
    for (let t = from; t <= to; t += n * MIN) {
      if (t < startSec * 1000) continue;
      const b = aggBar(s, res, t);
      if (!b) continue;
      out.push({ time: t / 1000, open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v });
    }
    // Delta caps a response at 2000 candles and returns newest first.
    return out.slice(-2000).reverse();
  }

  // ------------------------------------------------------------------ live trade stream
  const clients = new Set(); // { ws, subs:Set<"name|symbol">, heartbeat }

  function send(ws, obj) {
    if (ws.readyState === 1) ws.send(JSON.stringify(obj));
  }

  function printTrade(s, price, size, side) {
    const now = Date.now();
    const m = Math.floor(now / MIN) * MIN;
    let bar = s.live.get(m);
    if (!bar) {
      // Open at the previous close so bars are continuous.
      const prev = minuteBar(s, m - MIN);
      const open = prev ? prev.c : price;
      bar = { o: open, h: Math.max(open, price), l: Math.min(open, price), c: price, v: 0 };
      s.live.set(m, bar);
    }
    bar.h = Math.max(bar.h, price);
    bar.l = Math.min(bar.l, price);
    bar.c = price;
    bar.v += size;
    s.price = price;
    const trade = {
      symbol: s.prod.symbol,
      price: String(price),
      size,
      buyer_role: side === 'buy' ? 'taker' : 'maker',
      seller_role: side === 'buy' ? 'maker' : 'taker',
      timestamp: now * 1000,
      type: 'all_trades',
    };
    s.trades.push(trade);
    if (s.trades.length > 500) s.trades.splice(0, s.trades.length - 500);
    for (const c of clients) {
      if (c.subs.has(`all_trades|${s.prod.symbol}`)) send(c.ws, trade);
      for (const key of c.subs) {
        const [name, sym] = key.split('|');
        if (sym !== s.prod.symbol || !name.startsWith('candlestick_')) continue;
        const res = name.slice('candlestick_'.length);
        const start = barStartFor(now, res);
        const b = aggBar(s, res, start);
        if (!b) continue;
        send(c.ws, {
          type: name, symbol: sym, resolution: res, candle_start_time: start * 1000, timestamp: now * 1000,
          open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v,
        });
      }
    }
  }

  const tickTimer = setInterval(() => {
    for (const s of syms.values()) {
      const r = s.rnd;
      if (r() < (s.prod.quiet ? 0.85 : 0.25)) continue; // irregular prints: ~3 trades/s for the majors at 250 ms
      let price = s.price;
      if (!s.paused) price = fix(price * (1 + s.prod.vol * 0.12 * gauss(r)), s.prod.tick);
      const side = r() < 0.5 ? 'buy' : 'sell';
      printTrade(s, price, Math.max(1, Math.round(r() * 60)), side);
    }
  }, tradeMs);

  // ------------------------------------------------------------------ HTTP
  const json = (res, code, body) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const readBody = (req) => new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); }
    });
  });

  const product = (p) => ({
    id: p.id,
    symbol: p.symbol,
    description: `${p.base} Perpetual`,
    contract_type: 'perpetual_futures',
    state: 'live',
    trading_status: 'operational',
    tick_size: String(p.tick),
    contract_value: p.contractValue,
    launch_time: new Date(anchor).toISOString(),
    underlying_asset: { symbol: p.base },
    quoting_asset: { symbol: 'USD' },
    settling_asset: { symbol: 'USD' },
    product_specs: {},
  });

  function ticker(s) {
    const now = Date.now();
    const day = aggBar(s, '1d', barStartFor(now, '1d')) || { o: s.price, h: s.price, l: s.price, v: 0 };
    return {
      symbol: s.prod.symbol,
      product_id: s.prod.id,
      contract_type: 'perpetual_futures',
      close: s.price,
      mark_price: String(s.price),
      spot_price: String(s.price),
      open: day.o,
      high: day.h,
      low: day.l,
      volume: day.v,
      turnover_usd: day.v * s.price * Number(s.prod.contractValue),
      timestamp: now * 1000,
    };
  }

  const stats = { requests: 0 };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'x'}`);
    const p = url.pathname;
    stats.requests++;
    try {
      if (req.method === 'GET' && p === '/v2/products') {
        return json(res, 200, { success: true, result: PRODUCTS.map(product), meta: { after: null, before: null, limit: 500, total_count: PRODUCTS.length } });
      }
      if (req.method === 'GET' && p === '/v2/tickers') {
        const types = url.searchParams.get('contract_types');
        const list = !types || types.split(',').includes('perpetual_futures') ? [...syms.values()].map(ticker) : [];
        return json(res, 200, { success: true, result: list });
      }
      let m = /^\/v2\/tickers\/([^/]+)$/.exec(p);
      if (req.method === 'GET' && m) {
        const s = syms.get(decodeURIComponent(m[1]));
        if (!s) return json(res, 404, { success: false, error: { code: 'not_found' } });
        return json(res, 200, { success: true, result: ticker(s) });
      }
      if (req.method === 'GET' && p === '/v2/history/candles') {
        const q = url.searchParams;
        const resolution = String(q.get('resolution') || '').toLowerCase();
        const symbol = q.get('symbol');
        const start = Number(q.get('start'));
        const end = Number(q.get('end'));
        if (!RES_MIN[resolution]) return json(res, 400, { success: false, error: { code: 'invalid_resolution' } });
        if (!Number.isFinite(start) || !Number.isFinite(end)) return json(res, 400, { success: false, error: { code: 'bad_schema' } });
        const list = candles(symbol, resolution, start, end);
        if (!list) return json(res, 400, { success: false, error: { code: 'invalid_symbol' } });
        return json(res, 200, { success: true, result: list });
      }
      m = /^\/v2\/trades\/([^/]+)$/.exec(p);
      if (req.method === 'GET' && m) {
        const s = syms.get(decodeURIComponent(m[1]));
        if (!s) return json(res, 404, { success: false, error: { code: 'not_found' } });
        return json(res, 200, { success: true, result: { trades: s.trades.slice(-100).reverse().map(({ type, ...t }) => t) } });
      }
      if (req.method === 'GET' && p === '/v2/settings') {
        return json(res, 200, { success: true, result: { server_time: Date.now() * 1000 } });
      }
      // ---- control
      if (req.method === 'POST' && p === '/control/price') {
        const body = await readBody(req);
        const s = syms.get(String(body.symbol || '').replace(/^delta:/, ''));
        const price = Number(body.price);
        if (!s || !Number.isFinite(price)) return json(res, 400, { error: 'symbol and price required' });
        printTrade(s, fix(price, s.prod.tick), Number(body.size) || 10, price >= s.price ? 'buy' : 'sell');
        if (body.pause !== undefined) s.paused = !!body.pause;
        return json(res, 200, { ok: true, symbol: s.prod.symbol, price: s.price });
      }
      if (req.method === 'POST' && p === '/control/pause') {
        const body = await readBody(req);
        for (const s of syms.values()) if (!body.symbol || s.prod.symbol === String(body.symbol).replace(/^delta:/, '')) s.paused = body.paused !== false;
        return json(res, 200, { ok: true });
      }
      if (req.method === 'GET' && p === '/control/state') {
        return json(res, 200, {
          startedAt,
          anchor,
          requests: stats.requests,
          clients: [...clients].map((c) => [...c.subs]),
          prices: Object.fromEntries([...syms].map(([k, s]) => [k, s.price])),
        });
      }
      return json(res, 404, { success: false, error: { code: 'not_found', path: p } });
    } catch (err) {
      log.error?.('[fake-delta] request failed', err);
      return json(res, 500, { success: false, error: String(err && err.message) });
    }
  });

  // ------------------------------------------------------------------ WS
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req)));
  wss.on('connection', (ws) => {
    const c = { ws, subs: new Set(), heartbeat: null };
    clients.add(c);
    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(String(raw)); } catch { return send(ws, { type: 'error', message: 'invalid json' }); }
      if (msg.type === 'enable_heartbeat') {
        clearInterval(c.heartbeat);
        c.heartbeat = setInterval(() => send(ws, { type: 'heartbeat' }), 5000);
        return;
      }
      if (msg.type === 'disable_heartbeat') { clearInterval(c.heartbeat); return; }
      if (msg.type === 'subscribe' || msg.type === 'unsubscribe') {
        const chans = msg.payload?.channels;
        if (!Array.isArray(chans)) return send(ws, { type: 'error', message: 'payload.channels required' });
        for (const ch of chans) {
          const name = String(ch.name || '');
          const ok = name === 'all_trades' || name === 'v2/ticker' || (name.startsWith('candlestick_') && RES_MIN[name.slice(12)]);
          if (!ok) { send(ws, { type: 'error', message: `unknown channel ${name}` }); continue; }
          for (const sym of ch.symbols || []) {
            if (msg.type === 'subscribe') c.subs.add(`${name}|${sym}`);
            else c.subs.delete(`${name}|${sym}`);
          }
        }
        send(ws, { type: 'subscriptions', channels: [...c.subs].map((k) => ({ name: k.split('|')[0], symbols: [k.split('|')[1]] })) });
        return;
      }
      send(ws, { type: 'error', message: `unknown type ${msg.type}` });
    });
    ws.on('close', () => { clearInterval(c.heartbeat); clients.delete(c); });
    ws.on('error', () => {});
  });

  await new Promise((resolve) => server.listen(port, host, resolve));
  const base = `http://${host}:${server.address().port}`;
  log.info?.(`[fake-delta] REST ${base}  WS ${base.replace('http', 'ws')}`);
  return {
    url: base,
    wsUrl: base.replace('http', 'ws'),
    price: (symbol) => syms.get(String(symbol).replace(/^delta:/, ''))?.price,
    async close() {
      clearInterval(tickTimer);
      for (const c of clients) { clearInterval(c.heartbeat); try { c.ws.terminate(); } catch { /* ignore */ } }
      wss.close();
      server.closeAllConnections?.();
      await new Promise((r) => server.close(() => r()));
    },
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const arg = (name, def) => {
    const i = process.argv.indexOf(`--${name}`);
    return i > 0 ? process.argv[i + 1] : def;
  };
  const delta = await startFakeDelta({ port: Number(arg('port', process.env.FAKE_DELTA_PORT || 8790)) });
  let laya = null;
  if (!process.argv.includes('--no-laya')) laya = await startFakeLaya({ port: Number(arg('laya-port', process.env.FAKE_LAYA_PORT || 8791)) });
  console.log(`\nPoint TradeView at it:\n  DELTA_REST=${delta.url} DELTA_WS=${delta.wsUrl}${laya ? ` LAYA_MODE=http LAYA_URL=${laya.url}` : ''}\n`);
  const stop = async () => { await delta.close(); await laya?.close(); process.exit(0); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}
