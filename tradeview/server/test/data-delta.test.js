import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { DeltaRest, parseDeltaCandles, parseDeltaProduct, parseDeltaTrades } from '../src/delta/rest.js';
import { DeltaWs } from '../src/delta/ws.js';
import { topicToChannel, channelToTopic, deltaResolution, deltaSourceTf, toMs } from '../src/delta/timeframes.js';
import { RateLimiter } from '../src/bybit/rest.js';
import { ProviderRouter, StreamRouter, klineSource, providerOf } from '../src/providers/index.js';
import { LiveHub } from '../src/data/live.js';
import { Recorder } from '../src/data/recorder.js';
import { MarketData } from '../src/data/market.js';
import { Backfiller, resolveSymbols } from '../src/data/backfill.js';
import { Instruments } from '../src/bybit/instruments.js';
import { initDb } from '../src/db/index.js';
import { floorTime, addBars } from '../src/data/timeframes.js';

const quiet = { info() {}, warn() {}, debug() {}, error() {} };
const noSleep = async () => {};
const fastLimiter = () => new RateLimiter(1e6, { burst: 1e6 });
const json = (obj, status = 200) => ({ ok: status < 300, status, headers: new Map(), text: async () => JSON.stringify(obj) });

// ---------------------------------------------------------------- fixtures (Delta v2 shapes)

const CANDLES = {
  success: true,
  result: [
    // Delta may return rows unordered; times are unix SECONDS.
    { time: 1735689720, open: 93510, high: 93600, low: 93500, close: 93590.5, volume: 812 },
    { time: 1735689600, open: 93400.5, high: 93550, low: 93380, close: 93450, volume: 1520 },
    { time: 1735689660, open: 93450, high: 93520, low: 93440, close: 93510, volume: 990 },
    { bogus: true },
  ],
};

const PRODUCTS_PAGE_1 = {
  success: true,
  result: [
    { id: 27, symbol: 'BTCUSD', contract_type: 'perpetual_futures', tick_size: '0.5', state: 'live', contract_value: '0.001', underlying_asset: { symbol: 'BTC' }, quoting_asset: { symbol: 'USD' }, settling_asset: { symbol: 'USD' } },
    { id: 3136, symbol: 'ETHUSD', contract_type: 'perpetual_futures', tick_size: '0.05', state: 'live', contract_value: '0.01', underlying_asset: { symbol: 'ETH' }, quoting_asset: { symbol: 'USD' } },
    { id: 9, symbol: 'OLDUSD', contract_type: 'perpetual_futures', tick_size: '0.1', state: 'expired', underlying_asset: { symbol: 'OLD' }, quoting_asset: { symbol: 'USD' } },
    'not-an-object',
  ],
  meta: { after: 'g3QAAAABZAAIcHJvZHVjdHM=', before: null },
};
const PRODUCTS_PAGE_2 = {
  success: true,
  result: [
    { id: 55000, symbol: 'C-BTC-100000-310125', contract_type: 'call_options', tick_size: '0.1', state: 'live', underlying_asset: { symbol: 'BTC' }, quoting_asset: { symbol: 'USD' } },
    { id: 101, symbol: 'BTC_USDT', contract_type: 'spot', tick_size: '0.1', state: 'live', underlying_asset: { symbol: 'BTC' }, quoting_asset: { symbol: 'USDT' }, product_specs: { min_order_size: '0.0001' } },
  ],
  meta: { after: null },
};

/** Fake Delta backend serving /v2/history/candles for any window from a deterministic generator. */
function fakeDelta({ now, listedAt = 0 }) {
  const calls = [];
  const resMs = { '1m': 60000, '3m': 180000, '5m': 300000, '15m': 900000, '30m': 1800000, '1h': 3600000, '2h': 7200000, '4h': 14400000, '6h': 21600000, '1d': 86400000 };
  const fn = async (url) => {
    const u = new URL(url);
    const q = Object.fromEntries(u.searchParams);
    calls.push({ path: u.pathname, q });
    if (u.pathname === '/v2/history/candles') {
      const step = resMs[q.resolution];
      const start = Math.max(Number(q.start) * 1000, listedAt);
      const end = Math.min(Number(q.end) * 1000, now());
      const rows = [];
      for (let t = Math.ceil(start / step) * step; t <= end; t += step) {
        const c = 100 + (t / step) % 10;
        rows.push({ time: t / 1000, open: c - 1, high: c + 2, low: c - 2, close: c, volume: 5 });
      }
      if (rows.length > 2000) return json({ success: false, error: { code: 'too_many_candles' } }, 400);
      rows.reverse(); // unordered on purpose
      return json({ success: true, result: rows });
    }
    if (u.pathname === '/v2/products') return json(q.after ? PRODUCTS_PAGE_2 : PRODUCTS_PAGE_1);
    if (u.pathname === '/v2/tickers') {
      return json({ success: true, result: [
        { symbol: 'ETHUSD', close: 3300.5, turnover_usd: 5e8, volume: 100000, contract_type: 'perpetual_futures' },
        { symbol: 'BTCUSD', close: 93500, turnover_usd: 2e9, volume: 50000, contract_type: 'perpetual_futures' },
      ] });
    }
    if (u.pathname.startsWith('/v2/trades/')) {
      return json({ success: true, result: { trades: [
        { side: 'sell', size: 5, price: '93500.5', timestamp: 1735689600500000 },
        { side: 'buy', size: 12, price: '93501', timestamp: 1735689600100000 },
      ] } });
    }
    return json({ success: false, error: 'not found' }, 404);
  };
  fn.calls = calls;
  return fn;
}

const NOW = Date.UTC(2025, 5, 10, 12, 34, 56);
const mkRest = (fetch) => new DeltaRest({ fetch, limiter: fastLimiter(), sleep: noSleep, log: quiet });

// ---------------------------------------------------------------- mapping + parsing

test('delta timeframe mapping and topic translation', () => {
  assert.equal(deltaResolution('1D'), '1d');
  assert.equal(deltaResolution('1h'), '1h');
  assert.equal(deltaResolution('12h'), null);
  assert.equal(deltaSourceTf('12h'), '6h');
  assert.equal(deltaSourceTf('1M'), '1D');
  assert.equal(deltaSourceTf('1W'), '1D');
  assert.deepEqual(topicToChannel('kline.60.BTCUSD'), { name: 'candlestick_1h', symbol: 'BTCUSD', tf: '1h' });
  assert.deepEqual(topicToChannel('kline.D.ETHUSD'), { name: 'candlestick_1d', symbol: 'ETHUSD', tf: '1D' });
  assert.deepEqual(topicToChannel('publicTrade.BTCUSD'), { name: 'all_trades', symbol: 'BTCUSD' });
  assert.equal(topicToChannel('kline.720.BTCUSD'), null); // 12h is derived, never subscribed natively
  assert.equal(channelToTopic('candlestick_5m', 'BTCUSD'), 'kline.5.BTCUSD');
  assert.equal(toMs(1735689600), 1735689600000);
  assert.equal(toMs(1735689600123456), 1735689600123);
  assert.deepEqual(klineSource('delta', '12h'), { mode: 'derived', from: '6h' });
  assert.deepEqual(klineSource('linear', '12h'), { mode: 'native' });
  assert.deepEqual(klineSource('delta', '5s'), { mode: 'trades' });
  assert.equal(providerOf('delta:BTCUSD'), 'delta');
  assert.equal(providerOf('spot:BTCUSDT'), 'bybit');
});

test('parseDeltaCandles sorts ascending, converts seconds, skips junk', () => {
  const c = parseDeltaCandles(CANDLES.result);
  assert.deepEqual(c.map((x) => x.t), [1735689600000, 1735689660000, 1735689720000]);
  assert.deepEqual(c[0], { t: 1735689600000, o: 93400.5, h: 93550, l: 93380, c: 93450, v: 1520, qv: null });
  assert.deepEqual(parseDeltaCandles(null), []);
});

test('parseDeltaProduct / parseDeltaTrades', () => {
  const p = parseDeltaProduct(PRODUCTS_PAGE_1.result[0]);
  assert.equal(p.key, 'delta:BTCUSD');
  assert.equal(p.tickSize, 0.5);
  assert.equal(p.base, 'BTC');
  assert.equal(p.quote, 'USD');
  assert.equal(p.qtyStep, 1);
  assert.equal(p.provider, 'delta');
  assert.equal(parseDeltaProduct({ nope: 1 }), null);
  assert.equal(parseDeltaProduct(PRODUCTS_PAGE_2.result[1]).qtyStep, 0.0001);
  const tr = parseDeltaTrades({ trades: [
    { side: 'sell', size: 5, price: '10', timestamp: 1735689600200000 },
    { buyer_role: 'taker', seller_role: 'maker', size: 1, price: '11', timestamp: 1735689600100000 },
    { size: 1, price: '11', timestamp: 1735689600300000 },
  ] });
  assert.deepEqual(tr, [{ t: 1735689600100, p: 11, q: 1, side: 'Buy' }, { t: 1735689600200, p: 10, q: 5, side: 'Sell' }]);
});

// ---------------------------------------------------------------- REST

test('DeltaRest candles: seconds params, windows of <= 2000 bars, backwards paging, listing stop', async () => {
  const listedAt = floorTime(NOW, '1m') - 4500 * 60000;
  const fetch = fakeDelta({ now: () => NOW, listedAt });
  const rest = mkRest(fetch);
  const pages = [];
  const out = await rest.getKlinesRange({ symbol: 'BTCUSD', tf: '1m', start: NOW - 10 * 86400000, end: NOW, onPage: (p) => pages.push(p.length) });
  assert.equal(out.length, 4501);
  assert.equal(out[0].t, listedAt);
  assert.equal(out.at(-1).t, floorTime(NOW, '1m'));
  for (let i = 1; i < out.length; i++) assert.equal(out[i].t - out[i - 1].t, 60000);
  assert.deepEqual(pages, [2000, 2000, 501]);
  const calls = fetch.calls.filter((c) => c.path === '/v2/history/candles');
  assert.equal(calls[0].q.resolution, '1m');
  assert.equal(calls[0].q.symbol, 'BTCUSD');
  assert.ok(Number(calls[0].q.end) < 1e10, 'unix seconds');
  assert.equal(calls.length, 4); // 3 data windows + 1 empty window before listing
});

test('DeltaRest derives 12h from 6h and 1M from 1d (calendar months)', async () => {
  const fetch = fakeDelta({ now: () => NOW });
  const rest = mkRest(fetch);
  const h12 = await rest.getKlinesRange({ symbol: 'BTCUSD', tf: '12h', start: NOW - 5 * 86400000, end: NOW });
  assert.ok(h12.length >= 10);
  for (const b of h12) assert.equal(b.t % (12 * 3600000), 0);
  assert.equal(h12.at(-1).t, floorTime(NOW, '12h'));
  assert.ok(fetch.calls.every((c) => c.path !== '/v2/history/candles' || c.q.resolution === '6h'));
  // Each full 12h bar = two 6h bars: volume 10.
  assert.equal(h12[0].v, 10);

  const m = await rest.getKlinesRange({ symbol: 'BTCUSD', tf: '1M', start: Date.UTC(2025, 0, 1), end: NOW });
  assert.deepEqual(m.map((b) => new Date(b.t).toISOString().slice(0, 10)), ['2025-01-01', '2025-02-01', '2025-03-01', '2025-04-01', '2025-05-01', '2025-06-01']);
  assert.equal(m[1].v, 28 * 5); // February 2025 = 28 daily bars
  const w = await rest.getKlinesRange({ symbol: 'BTCUSD', tf: '1W', start: NOW - 30 * 86400000, end: NOW });
  for (const b of w) assert.equal(new Date(b.t).getUTCDay(), 1);
  await assert.rejects(rest.getKlinesRange({ symbol: 'BTCUSD', tf: '5s', start: 0, end: NOW }), /not served by Delta/);
});

test('DeltaRest products pagination, tickers, trades, errors and retries', async () => {
  const fetch = fakeDelta({ now: () => NOW });
  const rest = mkRest(fetch);
  const list = await rest.getInstruments();
  assert.deepEqual(list.map((x) => x.key), ['delta:BTCUSD', 'delta:ETHUSD', 'delta:C-BTC-100000-310125', 'delta:BTC_USDT']);
  assert.deepEqual(fetch.calls.filter((c) => c.path === '/v2/products').map((c) => c.q.after ?? null), [null, 'g3QAAAABZAAIcHJvZHVjdHM=']);
  const tickers = await rest.getTickers('delta');
  assert.equal(tickers[1].lastPrice, 93500);
  assert.equal(tickers[1].turnover24h, 2e9);
  const trades = await rest.getRecentTrades({ symbol: 'BTCUSD' });
  assert.deepEqual(trades.map((t) => t.side), ['Buy', 'Sell']);

  let n = 0;
  const flaky = mkRest(async () => {
    n++;
    if (n === 1) return json({ success: false, error: { code: 'rate_limited' } }, 429);
    if (n === 2) throw new TypeError('fetch failed');
    return json(CANDLES);
  });
  const c = await flaky.getNativeCandles({ symbol: 'BTCUSD', tf: '1m', start: 1735689600000, end: 1735689720000 });
  assert.equal(c.length, 3);
  assert.equal(flaky.stats.retries, 2);
  const bad = mkRest(async () => json({ success: false, error: { code: 'invalid_contract' } }, 400));
  await assert.rejects(bad.getNativeCandles({ symbol: 'NOPE', tf: '1m', start: 0, end: 1 }), /invalid_contract/);
});

test('ProviderRouter dispatches by category and merges instruments', async () => {
  const seen = [];
  const mk = (name) => ({
    getKlinesRange: async (p) => seen.push(`${name}:klines:${p.category}`),
    getRecentTrades: async () => seen.push(`${name}:trades`),
    getTickers: async (c) => seen.push(`${name}:tickers:${c}`),
    getAllInstruments: async () => (name === 'delta' ? [{ key: 'delta:BTCUSD' }] : Promise.reject(new Error('blocked'))),
    health: 'ok',
    stats: {},
  });
  const r = new ProviderRouter({ delta: mk('delta'), bybit: mk('bybit'), log: quiet });
  await r.getKlinesRange({ category: 'delta' });
  await r.getKlinesRange({ category: 'linear' });
  await r.getRecentTrades({ category: 'spot' });
  await r.getTickers('delta');
  assert.deepEqual(seen, ['delta:klines:delta', 'bybit:klines:linear', 'bybit:trades', 'delta:tickers:delta']);
  assert.deepEqual(await r.getAllInstruments(), [{ key: 'delta:BTCUSD', provider: 'delta' }]);
});

// ---------------------------------------------------------------- WS

class FakeSocket extends EventEmitter {
  static instances = [];
  constructor(url) {
    super();
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    FakeSocket.instances.push(this);
  }
  send(s) {
    this.sent.push(JSON.parse(s));
  }
  open() {
    this.readyState = 1;
    this.emit('open');
  }
  close() {
    this.readyState = 3;
    this.emit('close');
  }
  terminate() {
    this.close();
  }
  push(obj) {
    this.emit('message', Buffer.from(JSON.stringify(obj)));
  }
}

test('DeltaWs: heartbeat, grouped subscribe, normalised trades and candle confirmation', async () => {
  FakeSocket.instances = [];
  let now = Date.UTC(2025, 0, 1, 0, 0, 30);
  const ws = new DeltaWs({ url: 'wss://socket.test', WebSocket: FakeSocket, log: quiet, idleCloseMs: -1, checkMs: 10, maxBackoffMs: 5, now: () => now });
  ws.subscribe('publicTrade.BTCUSD');
  ws.subscribe('publicTrade.ETHUSD');
  ws.subscribe('kline.1.BTCUSD');
  ws.subscribe('publicTrade.BTCUSD');
  const s = FakeSocket.instances[0];
  s.open();
  assert.deepEqual(s.sent[0], { type: 'enable_heartbeat' });
  assert.deepEqual(s.sent.slice(1), [
    { type: 'subscribe', payload: { channels: [{ name: 'all_trades', symbols: ['BTCUSD', 'ETHUSD'] }] } },
    { type: 'subscribe', payload: { channels: [{ name: 'candlestick_1m', symbols: ['BTCUSD'] }] } },
  ]);
  const msgs = [];
  ws.on('message', (m) => msgs.push(m));

  s.push({ symbol: 'BTCUSD', price: '93500.5', size: 10, type: 'all_trades', buyer_role: 'taker', seller_role: 'maker', timestamp: 1735689600123456 });
  s.push({ symbol: 'BTCUSD', price: '93499', size: 3, type: 'all_trades', buyer_role: 'maker', seller_role: 'taker', timestamp: 1735689600223456 });
  s.push({ type: 'all_trades_snapshot', symbol: 'BTCUSD', trades: [{ price: '1', size: 1 }] });
  s.push({ type: 'heartbeat' });
  assert.deepEqual(msgs.map((m) => [m.topic, m.data[0].S, m.data[0].T, m.data[0].p]), [
    ['publicTrade.BTCUSD', 'Buy', 1735689600123, '93500.5'],
    ['publicTrade.BTCUSD', 'Sell', 1735689600223, '93499'],
  ]);

  msgs.length = 0;
  const T0 = Date.UTC(2025, 0, 1);
  const candle = (start, close) => ({ type: 'candlestick_1m', symbol: 'BTCUSD', resolution: '1m', candle_start_time: start * 1000, open: 100, high: 110, low: 90, close, volume: 7, timestamp: (start + 1000) * 1000 });
  s.push(candle(T0, 101));
  s.push(candle(T0, 102));
  s.push(candle(T0 + 60000, 103)); // new bar => previous confirmed
  assert.deepEqual(msgs.map((m) => [m.topic, m.data[0].start, m.data[0].close, m.data[0].confirm]), [
    ['kline.1.BTCUSD', T0, 101, false],
    ['kline.1.BTCUSD', T0, 102, false],
    ['kline.1.BTCUSD', T0, 102, true],
    ['kline.1.BTCUSD', T0 + 60000, 103, false],
  ]);
  // Period + grace elapsed without a new bar => confirmed by the watchdog.
  msgs.length = 0;
  now = T0 + 120000 + 3500;
  ws.lastMessageAt = now;
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(msgs.map((m) => [m.data[0].start, m.data[0].confirm]), [[T0 + 60000, true]]);

  // Silence > 35s => reconnect and resubscribe everything.
  now += 36000;
  await new Promise((r) => setTimeout(r, 60));
  assert.ok(FakeSocket.instances.length >= 2, 'reconnected');
  const s2 = FakeSocket.instances.at(-1);
  s2.open();
  assert.equal(s2.sent.filter((m) => m.type === 'subscribe').length, 2);

  // Ref-counting.
  ws.unsubscribe('publicTrade.BTCUSD');
  assert.equal(s2.sent.filter((m) => m.type === 'unsubscribe').length, 0);
  ws.unsubscribe('publicTrade.BTCUSD');
  assert.deepEqual(s2.sent.filter((m) => m.type === 'unsubscribe'), [{ type: 'unsubscribe', payload: { channels: [{ name: 'all_trades', symbols: ['BTCUSD'] }] } }]);
  ws.close();
});

test('StreamRouter + LiveHub: delta trades and klines flow through the same hub', () => {
  const delta = new EventEmitter();
  Object.assign(delta, { refs: new Map(), status: 'connected', subs: [], subscribe(t) { this.subs.push(t); this.refs.set(t, 1); }, unsubscribe(t) { this.refs.delete(t); }, close() {} });
  const bybit = new EventEmitter();
  Object.assign(bybit, { status: 'idle', subs: [], subscribe(c, t) { this.subs.push(`${c}:${t}`); }, unsubscribe() {}, close() {} });
  const streams = new StreamRouter({ delta, bybit, log: quiet });
  const { repos } = initDb(':memory:');
  const hub = new LiveHub({ repos, streams, log: quiet, config: {} });
  hub.acquire('trades', 'delta:BTCUSD');
  hub.acquire('kline', 'delta:BTCUSD', '1m');
  hub.acquire('kline', 'linear:BTCUSDT', '1m');
  assert.deepEqual(delta.subs, ['publicTrade.BTCUSD', 'kline.1.BTCUSD']);
  assert.deepEqual(bybit.subs, ['linear:kline.1.BTCUSDT']);
  const got = [];
  hub.on('trades', (e) => got.push(e));
  delta.emit('message', { category: 'delta', topic: 'publicTrade.BTCUSD', data: [{ T: 5, S: 'Buy', v: '2', p: '100' }] });
  assert.deepEqual(got, [{ symbol: 'delta:BTCUSD', trades: [{ t: 5, p: 100, q: 2, side: 'Buy' }], prevPrice: undefined }]);
  assert.deepEqual(streams.statuses(), { delta: 'connected', bybit: 'idle' });
  hub.stop();
});

test('LiveHub derives Delta 12h bars from the 6h stream (seeded from history)', async () => {
  const delta = new EventEmitter();
  Object.assign(delta, { refs: new Map(), status: 'connected', subs: [], subscribe(t) { this.subs.push(t); this.refs.set(t, 1); }, unsubscribe(t) { this.refs.delete(t); }, close() {} });
  const bybit = Object.assign(new EventEmitter(), { status: 'idle', subscribe() {}, unsubscribe() {}, close() {} });
  const streams = new StreamRouter({ delta, bybit, log: quiet });
  const { repos } = initDb(':memory:');
  const P = Date.UTC(2025, 0, 1, 12); // 12h period start
  const market = { getCandles: async ({ tf, from, to }) => (tf === '6h' && from === P && to < P + 6 * 3600000 ? [{ t: P, o: 10, h: 15, l: 9, c: 12, v: 100 }] : []) };
  const hub = new LiveHub({ repos, streams, log: quiet, config: {}, market });
  const out = [];
  hub.on('kline', (e) => e.tf === '12h' && out.push(e));
  hub.acquire('kline', 'delta:BTCUSD', '12h');
  assert.deepEqual(delta.subs, ['kline.360.BTCUSD']);
  const k6 = (start, close, confirm) => ({ category: 'delta', topic: 'kline.360.BTCUSD', data: [{ start, interval: '360', open: 12, high: 20, low: 11, close, volume: 7, confirm }] });
  delta.emit('message', k6(P + 6 * 3600000, 13, false));
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(out.at(-1), { symbol: 'delta:BTCUSD', tf: '12h', candle: { t: P, o: 10, h: 20, l: 9, c: 13, v: 107 }, closed: false });
  delta.emit('message', k6(P + 6 * 3600000, 14, true)); // last 6h bar of the period closes
  assert.deepEqual(out.at(-1), { symbol: 'delta:BTCUSD', tf: '12h', candle: { t: P, o: 10, h: 20, l: 9, c: 14, v: 107 }, closed: true });
  assert.equal(repos.candles.range('delta:BTCUSD', '12h', {}).length, 1);
  hub.release('kline', 'delta:BTCUSD', '12h');
  assert.equal(delta.refs.size, 0);
  hub.stop();
});

// ---------------------------------------------------------------- recorder, market, backfill

test('Recorder records trades + footprint for RECORD_SYMBOLS and prunes old trades', () => {
  const { repos } = initDb(':memory:');
  const streams = Object.assign(new EventEmitter(), { status: 'connected', subs: new Map(), subscribe(c, t) { this.subs.set(`${c}|${t}`, (this.subs.get(`${c}|${t}`) || 0) + 1); }, unsubscribe(c, t) { const k = `${c}|${t}`; const n = this.subs.get(k) - 1; if (n) this.subs.set(k, n); else this.subs.delete(k); }, close() {} });
  const T0 = Date.UTC(2025, 0, 1, 10);
  let now = T0;
  const hub = new LiveHub({ repos, streams, log: quiet, config: { footprintTickMult: 1 }, instruments: { tickSize: () => 0.5 }, now: () => now });
  repos.trades.insertMany('delta:BTCUSD', [{ t: T0 - 40 * 86400000, p: 1, q: 1, side: 'Buy' }]);
  const rec = new Recorder({ live: hub, repos, log: quiet, config: { tradesRetentionDays: 30 }, now: () => now }).start(['delta:BTCUSD', 'bad key!']);
  assert.equal(repos.trades.count('delta:BTCUSD'), 0); // pruned on start
  assert.equal(streams.subs.get('delta|publicTrade.BTCUSD'), 6); // one per footprint tf (1m..1h)
  streams.emit('message', { category: 'delta', topic: 'publicTrade.BTCUSD', data: [{ T: T0 + 1000, S: 'Buy', v: '2', p: '100.2' }, { T: T0 + 2000, S: 'Sell', v: '1', p: '100.7' }] });
  streams.emit('message', { category: 'delta', topic: 'publicTrade.ETHUSD', data: [{ T: T0 + 1000, S: 'Buy', v: '2', p: '3000' }] });
  rec.flush();
  assert.deepEqual(repos.trades.range('delta:BTCUSD'), [{ t: T0 + 1000, p: 100.2, q: 2, side: 'Buy' }, { t: T0 + 2000, p: 100.7, q: 1, side: 'Sell' }]);
  assert.equal(repos.trades.count('delta:ETHUSD'), 0);
  now = T0 + 61000;
  streams.emit('message', { category: 'delta', topic: 'publicTrade.BTCUSD', data: [{ T: T0 + 61000, S: 'Buy', v: '1', p: '101' }] });
  assert.deepEqual(repos.footprint.rows('delta:BTCUSD', '1m', { to: T0 + 59999 }).map((r) => [r.price, r.bid_v, r.ask_v]), [[100, 0, 2], [100.5, 1, 0]]);
  rec.stop();
  assert.equal(streams.subs.size, 0);
  assert.equal(repos.trades.count('delta:BTCUSD'), 3);
  hub.stop();
});

test('MarketData + Backfiller work against Delta through the router (1m and derived 1M)', async () => {
  const fetch = fakeDelta({ now: () => NOW });
  const deltaRest = mkRest(fetch);
  const router = new ProviderRouter({ delta: deltaRest, bybit: { getKlinesRange: () => { throw new Error('bybit must not be called'); } }, log: quiet });
  const { repos } = initDb(':memory:');
  const market = new MarketData({ repos, rest: router, log: quiet, config: {}, now: () => NOW });
  const c = await market.getCandles({ symbol: 'delta:BTCUSD', tf: '15m', limit: 3000 });
  assert.equal(c.length, 3000);
  assert.equal(c.at(-1).t, floorTime(NOW, '15m'));
  const m = await market.getCandles({ symbol: 'delta:BTCUSD', tf: '1M', limit: 3 });
  assert.deepEqual(m.map((b) => b.t), [Date.UTC(2025, 3, 1), Date.UTC(2025, 4, 1), Date.UTC(2025, 5, 1)]);

  const bf = new Backfiller({ repos, rest: router, log: quiet, now: () => NOW });
  const events = [];
  const s = await bf.run({ symbols: ['delta:ETHUSD'], days: 30, tfs: ['1h', '12h', '1W'], footprint: true, onEvent: (e) => events.push(e.type) });
  assert.equal(s.failed.length, 0);
  assert.ok(events.includes('fp_skip'));
  const h = repos.candles.range('delta:ETHUSD', '1h', { limit: 5000 });
  assert.equal(h[0].t, floorTime(NOW - 30 * 86400000, '1h'));
  assert.ok(repos.candles.count('delta:ETHUSD', '12h') >= 60);
  assert.equal(repos.backfillState.get('delta:ETHUSD', '1W').oldest <= floorTime(NOW - 30 * 86400000, '1W'), true);
  const again = await bf.backfillCandles({ key: 'delta:ETHUSD', tf: '1h', days: 30 });
  assert.equal(again.stored, 0);
});

test('Instruments merges both providers; symbols list filters provider and hides options', async () => {
  const fetch = fakeDelta({ now: () => NOW });
  const router = new ProviderRouter({
    delta: mkRest(fetch),
    bybit: { getAllInstruments: async () => [{ key: 'linear:BTCUSDT', symbol: 'BTCUSDT', category: 'linear', base: 'BTC', quote: 'USDT', tickSize: 0.1, qtyStep: 0.001, contractType: 'LinearPerpetual' }], getTickers: async () => [] },
    log: quiet,
  });
  const { repos } = initDb(':memory:');
  const inst = new Instruments({ rest: router, repos, log: quiet });
  await inst.load();
  assert.deepEqual(inst.list().map((s) => `${s.provider}:${s.key}`), ['delta:delta:BTC_USDT', 'delta:delta:BTCUSD', 'delta:delta:ETHUSD', 'bybit:linear:BTCUSDT']);
  assert.deepEqual(inst.list({ provider: 'bybit' }).map((s) => s.key), ['linear:BTCUSDT']);
  assert.deepEqual(inst.list({ contractType: 'call_options' }).map((s) => s.key), ['delta:C-BTC-100000-310125']);
  assert.equal(inst.tickSize('delta:BTCUSD'), 0.5);
  assert.deepEqual(await inst.topDelta(1), ['delta:BTCUSD']);
  const keys = await resolveSymbols(['delta:top:2', 'delta:SOLUSD'], { instruments: inst, config: {} });
  assert.deepEqual(keys, ['delta:BTCUSD', 'delta:ETHUSD', 'delta:SOLUSD']);
  assert.deepEqual(await resolveSymbols(['delta'], { instruments: inst, config: {} }), ['delta:BTCUSD', 'delta:ETHUSD']);
});
