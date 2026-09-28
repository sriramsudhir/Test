import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { initDb } from '../src/db/index.js';
import { LiveHub, parseWsTrades, parseWsKline } from '../src/data/live.js';

const quiet = { info() {}, warn() {}, debug() {}, error() {} };

class FakeStreams extends EventEmitter {
  constructor() {
    super();
    this.refs = new Map();
    this.status = 'connected';
  }
  subscribe(category, topic) {
    const k = `${category}|${topic}`;
    this.refs.set(k, (this.refs.get(k) || 0) + 1);
  }
  unsubscribe(category, topic) {
    const k = `${category}|${topic}`;
    const n = (this.refs.get(k) || 0) - 1;
    if (n <= 0) this.refs.delete(k);
    else this.refs.set(k, n);
  }
  close() {}
  push(category, topic, data) {
    this.emit('message', { category, topic, type: 'snapshot', ts: Date.now(), data });
  }
}

const T0 = Date.UTC(2025, 5, 2, 10, 0, 0);

// Real-shaped Bybit WS payloads.
const klineMsg = (start, close, confirm) => [{
  start, end: start + 59999, interval: '1', open: '100', close: String(close), high: '105', low: '95',
  volume: '12.5', turnover: '1250', confirm, timestamp: start + 30000,
}];
const tradeMsg = (T, p, v, S) => ({ T, s: 'BTCUSDT', S, v: String(v), p: String(p), L: 'PlusTick', i: `id-${T}-${p}`, BT: false });

function setup(now = () => T0) {
  const { repos } = initDb(':memory:');
  const streams = new FakeStreams();
  const hub = new LiveHub({ repos, streams, log: quiet, now, instruments: { tickSize: () => 0.5 }, config: { footprintTickMult: 1 } });
  return { repos, streams, hub };
}

test('ws payload parsers', () => {
  assert.deepEqual(parseWsTrades([tradeMsg(2, '10.5', '0.1', 'Sell'), tradeMsg(1, '10', '1', 'Buy')]), [
    { t: 1, p: 10, q: 1, side: 'Buy' },
    { t: 2, p: 10.5, q: 0.1, side: 'Sell' },
  ]);
  const k = parseWsKline(klineMsg(T0, 101, true)[0]);
  assert.deepEqual(k.candle, { t: T0, o: 100, h: 105, l: 95, c: 101, v: 12.5, qv: 1250 });
  assert.equal(k.closed, true);
});

test('acquire/release are ref-counted and map to Bybit topics', () => {
  const { streams, hub } = setup();
  hub.acquire('kline', 'linear:BTCUSDT', '1m');
  hub.acquire('kline', 'linear:BTCUSDT', '1m');
  hub.acquire('trades', 'spot:ETHUSDT');
  hub.acquire('footprint', 'linear:BTCUSDT', '5m');
  hub.acquire('kline', 'linear:BTCUSDT', '5s');
  assert.equal(streams.refs.get('linear|kline.1.BTCUSDT'), 1);
  assert.equal(streams.refs.get('spot|publicTrade.ETHUSDT'), 1);
  assert.equal(streams.refs.get('linear|publicTrade.BTCUSDT'), 2); // footprint + 5s bars
  assert.equal(hub.refCount('kline', 'linear:BTCUSDT', '1m'), 2);
  hub.release('kline', 'linear:BTCUSDT', '1m');
  assert.equal(streams.refs.get('linear|kline.1.BTCUSDT'), 1);
  hub.release('kline', 'linear:BTCUSDT', '1m');
  assert.equal(streams.refs.has('linear|kline.1.BTCUSDT'), false);
  hub.release('footprint', 'linear:BTCUSDT', '5m');
  hub.release('kline', 'linear:BTCUSDT', '5s');
  assert.equal(streams.refs.has('linear|publicTrade.BTCUSDT'), false);
  assert.equal(hub.release('kline', 'linear:BTCUSDT', '1m'), 0); // extra release is harmless
  assert.throws(() => hub.acquire('orderbook', 'linear:BTCUSDT'));
  assert.throws(() => hub.acquire('kline', 'linear:BTCUSDT', '7m'));
  assert.throws(() => hub.acquire('footprint', 'linear:BTCUSDT', '5s'));
  hub.stop();
});

test('closed klines are emitted and persisted; coverage extended when contiguous', () => {
  const { repos, streams, hub } = setup();
  repos.backfillState.set('linear:BTCUSDT', '1m', { oldest: T0 - 600000, newest: T0 - 60000 });
  const events = [];
  hub.on('kline', (e) => events.push(e));
  hub.acquire('kline', 'linear:BTCUSDT', '1m');
  streams.push('linear', 'kline.1.BTCUSDT', klineMsg(T0, 101, false));
  streams.push('linear', 'kline.1.BTCUSDT', klineMsg(T0, 102, true));
  assert.equal(events.length, 2);
  assert.deepEqual(events[1], { symbol: 'linear:BTCUSDT', tf: '1m', candle: { t: T0, o: 100, h: 105, l: 95, c: 102, v: 12.5 }, closed: true });
  assert.equal(repos.candles.count('linear:BTCUSDT', '1m'), 1);
  assert.equal(repos.backfillState.get('linear:BTCUSDT', '1m').newest, T0);
  assert.equal(hub.lastPrice('linear:BTCUSDT'), 102);
  // A non-contiguous closed bar is stored but does not extend coverage.
  streams.push('linear', 'kline.1.BTCUSDT', klineMsg(T0 + 600000, 103, true));
  assert.equal(repos.backfillState.get('linear:BTCUSDT', '1m').newest, T0);
  hub.stop();
});

test('trades -> trades event, seconds bars and live footprint', () => {
  let now = T0 + 1000;
  const { repos, streams, hub } = setup(() => now);
  const trades = [];
  const klines = [];
  const fps = [];
  hub.on('trades', (e) => trades.push(e));
  hub.on('kline', (e) => klines.push(e));
  hub.on('footprint', (e) => fps.push(e));
  hub.acquire('trades', 'linear:BTCUSDT');
  hub.acquire('kline', 'linear:BTCUSDT', '5s');
  hub.acquire('footprint', 'linear:BTCUSDT', '1m');

  streams.push('linear', 'publicTrade.BTCUSDT', [tradeMsg(T0 + 1000, 100.2, 1, 'Buy'), tradeMsg(T0 + 1500, 100.7, 2, 'Sell')]);
  assert.deepEqual(trades[0].trades.map((t) => t.side), ['Buy', 'Sell']);
  assert.equal(hub.lastPrice('linear:BTCUSDT'), 100.7);
  assert.deepEqual(klines.at(-1), { symbol: 'linear:BTCUSDT', tf: '5s', candle: { t: T0, o: 100.2, h: 100.7, l: 100.2, c: 100.7, v: 3 }, closed: false });
  assert.deepEqual(fps.at(-1).bar.levels, [{ p: 100, bid: 0, ask: 1 }, { p: 100.5, bid: 2, ask: 0 }]);

  // Next 5s bucket closes the previous seconds bar.
  now = T0 + 6000;
  streams.push('linear', 'publicTrade.BTCUSDT', [tradeMsg(T0 + 6000, 101, 1, 'Buy')]);
  const closed = klines.filter((k) => k.closed);
  assert.equal(closed.length, 1);
  assert.equal(closed[0].candle.t, T0);
  assert.equal(hub.secondBars('linear:BTCUSDT', '5s').length, 2);

  // Wall clock closes the forming seconds bar without new trades.
  now = T0 + 11000;
  hub._tick();
  assert.equal(klines.filter((k) => k.closed).length, 2);

  // New minute: footprint bar rolls and the first (partial) bar is persisted.
  now = T0 + 61000;
  streams.push('linear', 'publicTrade.BTCUSDT', [tradeMsg(T0 + 61000, 102, 1, 'Sell')]);
  const rows = repos.footprint.rows('linear:BTCUSDT', '1m', {});
  assert.deepEqual(rows.map((r) => [r.price, r.bid_v, r.ask_v]), [[100, 0, 1], [100.5, 2, 0], [101, 0, 1]]);
  const live = hub.footprintBars('linear:BTCUSDT', '1m');
  assert.equal(live.length, 1);
  assert.equal(live[0].t, T0 + 60000);
  assert.equal(live[0].partialStart, false);
  hub.stop();
  // stop() persists the in-progress bar.
  assert.equal(repos.footprint.rows('linear:BTCUSDT', '1m', { from: T0 + 60000 }).length, 1);
});

test('status events and refill after reconnect', async () => {
  const { streams, hub } = setup();
  const refreshed = [];
  hub.market = { refresh: async (s, tf) => refreshed.push(`${s} ${tf}`) };
  const statuses = [];
  hub.on('status', (s) => statuses.push(s.bybit));
  hub.acquire('kline', 'linear:BTCUSDT', '1h');
  streams.status = 'reconnecting';
  streams.emit('status', { category: 'linear', status: 'reconnecting' });
  streams.status = 'connected';
  streams.emit('status', { category: 'linear', status: 'connected' });
  assert.deepEqual(statuses, ['reconnecting', 'connected']);
  assert.deepEqual(refreshed, ['linear:BTCUSDT 1h']);
  assert.equal(hub.status().bybit, 'connected');
  hub.stop();
});
