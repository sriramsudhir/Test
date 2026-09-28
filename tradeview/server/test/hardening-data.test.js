// Hardening: SQLite growth + pruning, bounded reads, refresh cost, map/ref leaks, reconnect backoff, compression,
// input validation (symbols, agent tools) and the Pine queue bound.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import zlib from 'node:zlib';
import WebSocket from 'ws';
import baseConfig from '../src/config.js';
import { buildServer } from '../src/index.js';
import { initDb } from '../src/db/index.js';
import { Recorder, FOOTPRINT_PRUNE_TFS } from '../src/data/recorder.js';
import { MarketData } from '../src/data/market.js';
import { LiveHub } from '../src/data/live.js';
import { DeltaWs } from '../src/delta/ws.js';
import { parseSymbolKey } from '../src/bybit/markets.js';
import { validateInput } from '../src/agent/validate.js';
import { TOOL_SCHEMAS } from '../src/agent/tools.js';
import { PinePool, MAX_QUEUE } from '../src/pine/runner.js';

const quiet = { info() {}, warn() {}, debug() {}, error() {} };
const DAY = 86400000;
const MIN = 60000;
const tick = () => new Promise((r) => setImmediate(r));

class FakeStreams extends EventEmitter {
  constructor() {
    super();
    this.status = 'connected';
    this.subs = new Map();
  }
  subscribe(c, t) {
    this.subs.set(`${c}|${t}`, (this.subs.get(`${c}|${t}`) || 0) + 1);
  }
  unsubscribe(c, t) {
    const k = `${c}|${t}`;
    const n = (this.subs.get(k) || 0) - 1;
    if (n > 0) this.subs.set(k, n);
    else this.subs.delete(k);
  }
  statuses() {
    return {};
  }
  close() {}
}

test('trade pruning runs in bounded batches and finishes asynchronously', async () => {
  const { repos } = initDb(':memory:');
  const now = Date.UTC(2026, 5, 1);
  const old = Array.from({ length: 50000 }, (_, i) => ({ t: now - 40 * DAY + i, p: 1, q: 1, side: 'Buy' }));
  repos.trades.insertMany('delta:BTCUSD', old);
  repos.trades.insertMany('delta:BTCUSD', [{ t: now - 1000, p: 2, q: 1, side: 'Sell' }]);
  const live = new LiveHub({ streams: new FakeStreams(), log: quiet, config: {}, now: () => now });
  const rec = new Recorder({ live, repos, log: quiet, config: { tradesRetentionDays: 30, footprintRetentionDays: 0 }, now: () => now });
  const sync = rec.prune();
  assert.equal(sync, 20000, 'first batch only, synchronously');
  assert.equal(repos.trades.count('delta:BTCUSD'), 30001);
  assert.equal(rec.prune(), 0, 'no overlapping prune runs');
  for (let i = 0; i < 20 && rec.pruning; i++) await tick();
  assert.equal(rec.pruning, false);
  assert.deepEqual(repos.trades.range('delta:BTCUSD').map((t) => t.p), [2], 'recent trade kept');
  live.stop();
});

test('footprint retention prunes 1m/3m/5m history only, via the primary key', async () => {
  const { db, repos } = initDb(':memory:');
  const now = Date.UTC(2026, 5, 1);
  const bar = (t) => ({ t, levels: [{ p: 100, bid: 1, ask: 2 }, { p: 100.5, bid: 3, ask: 4 }] });
  for (const sym of ['delta:BTCUSD', 'linear:ETHUSDT']) {
    for (const tf of ['1m', '5m', '15m', '1h']) {
      const bars = [];
      for (let d = 200; d >= 0; d -= 1) bars.push(bar(now - d * DAY - (d % 2) * MIN));
      repos.footprint.upsertBars(sym, tf, bars);
    }
  }
  assert.deepEqual(repos.footprint.symbols(), ['delta:BTCUSD', 'linear:ETHUSDT']);
  const plan = db.prepare('EXPLAIN QUERY PLAN DELETE FROM footprint WHERE symbol=? AND tf=? AND t < ?').all('a', '1m', 1).map((r) => r.detail).join(' ');
  assert.match(plan, /PRIMARY KEY/);
  const live = new LiveHub({ streams: new FakeStreams(), log: quiet, config: {}, now: () => now });
  const rec = new Recorder({ live, repos, log: quiet, config: { tradesRetentionDays: 30, footprintRetentionDays: 90 }, now: () => now });
  rec.prune();
  for (let i = 0; i < 2000 && rec.pruning; i++) await tick();
  const cutoff = now - 90 * DAY;
  for (const sym of ['delta:BTCUSD', 'linear:ETHUSDT']) {
    for (const tf of FOOTPRINT_PRUNE_TFS.filter((x) => x !== '3m')) {
      assert.ok(repos.footprint.firstTime(sym, tf) >= cutoff, `${sym} ${tf} not pruned`);
      assert.equal(repos.footprint.lastTime(sym, tf), now, `${sym} ${tf} recent bars kept`);
    }
    assert.equal(repos.footprint.firstTime(sym, '15m'), now - 200 * DAY, '15m kept');
    assert.equal(repos.footprint.firstTime(sym, '1h'), now - 200 * DAY, '1h kept');
  }
  live.stop();
});

test('refresh() of an up-to-date pair costs no REST call and concurrent refreshes share one run', async () => {
  const { repos } = initDb(':memory:');
  const now = Date.UTC(2026, 5, 1, 12, 30, 20);
  const lastClosed = Date.UTC(2026, 5, 1, 12, 29);
  repos.backfillState.set('delta:BTCUSD', '1m', { oldest: lastClosed - 1000 * MIN, newest: lastClosed });
  let calls = 0;
  let release;
  const rest = {
    getKlinesRange: async () => {
      calls++;
      await new Promise((r) => (release = r));
    },
  };
  const market = new MarketData({ repos, rest, log: quiet, config: {}, now: () => now });
  await market.refresh('delta:BTCUSD', '1m');
  assert.equal(calls, 0, 'forming bar must not be fetched by refresh');
  // 3 bars behind: one fetch, shared by concurrent callers (reconnect storm).
  repos.backfillState.set('delta:BTCUSD', '1m', { oldest: lastClosed - 1000 * MIN, newest: lastClosed - 3 * MIN });
  const ps = [market.refresh('delta:BTCUSD', '1m'), market.refresh('delta:BTCUSD', '1m'), market.refresh('delta:BTCUSD', '1m')];
  await tick();
  assert.equal(calls, 1);
  release();
  await Promise.all(ps);
  assert.equal(repos.backfillState.get('delta:BTCUSD', '1m').newest, lastClosed);
});

test('getFootprint never reads an unbounded range from SQLite', async () => {
  const { repos } = initDb(':memory:');
  const now = Date.UTC(2026, 5, 1);
  const bars = [];
  for (let i = 0; i < 3000; i++) bars.push({ t: now - (3000 - i) * MIN, levels: [{ p: 100, bid: 1, ask: 1 }] });
  repos.footprint.upsertBars('delta:BTCUSD', '1m', bars);
  const seen = [];
  const rows = repos.footprint.rows;
  repos.footprint.rows = (s, tf, o) => {
    seen.push(o);
    return rows(s, tf, o);
  };
  const market = new MarketData({ repos, rest: null, log: quiet, config: {}, now: () => now });
  const got = await market.getFootprint({ symbol: 'delta:BTCUSD', tf: '1m', from: 0, limit: 100 });
  assert.equal(got.length, 100);
  assert.equal(got.at(-1).t, now - MIN, 'newest bars of the range');
  assert.equal(seen[0].maxBars, 100, 'DB read bounded by maxBars');
  const def = await market.getFootprint({ symbol: 'delta:BTCUSD', tf: '1m', from: 0 });
  assert.equal(def.length, 500);
});

test('LiveHub drops per-symbol state once the last subscription is released', () => {
  const hub = new LiveHub({ streams: new FakeStreams(), log: quiet, config: {} });
  for (let i = 0; i < 200; i++) {
    const sym = `delta:SYM${i}USD`;
    hub.acquire('trades', sym);
    hub.acquire('kline', sym, '1m');
    hub.release('trades', sym);
    assert.ok(hub.syms.has(sym), 'kept while a kline ref remains');
    hub.release('kline', sym, '1m');
  }
  assert.equal(hub.syms.size, 0);
  assert.equal(hub.refs.size, 0);
  hub.stop();
});

test('a WS message arriving after client cleanup cannot leak a LiveHub ref', async () => {
  const streams = new FakeStreams();
  const server = await buildServer({
    config: { ...baseConfig, dbPath: ':memory:', logLevel: 'silent', gapfillOnStart: false, authPassword: '', authPasswordHash: '' },
    logger: false, fetch: async () => ({ ok: false, status: 403, headers: new Map(), text: async () => '' }), streams, optionalModules: false, web: false, record: false, gapfill: false,
  });
  await server.app.listen({ port: 0, host: '127.0.0.1' });
  const ws = new WebSocket(`ws://127.0.0.1:${server.app.server.address().port}/ws`);
  await new Promise((r) => ws.once('message', r)); // status hello
  const [client] = [...server.ctx.sockets.clients];
  client.socket.emit('error', new Error('boom')); // server-side cleanup
  client.socket.emit('message', Buffer.from(JSON.stringify({ type: 'subscribe', channel: 'kline', symbol: 'delta:BTCUSD', tf: '1m' })));
  assert.equal(server.ctx.live.refs.size, 0);
  ws.terminate();
  await server.stop();
});

test('Delta WS backoff keeps growing while connections flap (accept then drop)', () => {
  class FakeWs extends EventEmitter {
    constructor() {
      super();
      this.readyState = 0;
      FakeWs.last = this;
    }
    send() {}
    close() {}
    terminate() {}
  }
  let now = 1_000_000;
  const d = new DeltaWs({ WebSocket: FakeWs, log: quiet, now: () => now });
  d.subscribe('publicTrade.BTCUSD');
  const flap = (upMs) => {
    const w = FakeWs.last;
    w.readyState = 1;
    w.emit('open');
    now += upMs;
    w.readyState = 3;
    w.emit('close');
    clearTimeout(d.timers.reconnect);
    d.timers.reconnect = null;
    d.connect();
  };
  for (let i = 0; i < 6; i++) flap(200);
  assert.equal(d.attempt, 6, 'backoff must not reset on a connection that dropped immediately');
  flap(60000); // a long-lived connection resets it
  assert.equal(d.attempt, 1);
  d.close();
});

test('large JSON responses are gzipped when accepted; small ones and non-gzip clients are not', async () => {
  const { repos } = initDb(':memory:');
  const server = await buildServer({
    config: { ...baseConfig, dbPath: ':memory:', logLevel: 'silent', gapfillOnStart: false, authPassword: '', authPasswordHash: '' },
    logger: false, fetch: async () => ({ ok: false, status: 403, headers: new Map(), text: async () => '' }), streams: new FakeStreams(), optionalModules: false, web: false, record: false, gapfill: false,
  });
  void repos;
  const now = Date.now();
  const bars = Array.from({ length: 2000 }, (_, i) => ({ t: Math.floor(now / MIN) * MIN - (2000 - i) * MIN, o: 1, h: 2, l: 0.5, c: 1.5, v: 3 }));
  server.ctx.repos.candles.upsertMany('delta:BTCUSD', '1m', bars);
  server.ctx.repos.backfillState.set('delta:BTCUSD', '1m', { oldest: bars[0].t, newest: bars.at(-1).t });
  const url = `/api/candles?symbol=delta:BTCUSD&tf=1m&limit=2000&to=${bars.at(-1).t}`;
  const gz = await server.app.inject({ method: 'GET', url, headers: { 'accept-encoding': 'gzip, br' } });
  assert.equal(gz.headers['content-encoding'], 'gzip');
  const body = JSON.parse(zlib.gunzipSync(gz.rawPayload));
  assert.equal(body.candles.length, 2000);
  const plain = await server.app.inject({ method: 'GET', url });
  assert.equal(plain.headers['content-encoding'], undefined);
  assert.ok(gz.rawPayload.length * 4 < plain.rawPayload.length, `${gz.rawPayload.length} vs ${plain.rawPayload.length}`);
  const small = await server.app.inject({ method: 'GET', url: '/api/health', headers: { 'accept-encoding': 'gzip' } });
  assert.equal(small.headers['content-encoding'], undefined);
  await server.stop();
});

test('symbol keys that could traverse provider URL paths are rejected', () => {
  for (const bad of ['delta:..', 'delta:.', 'linear:-X', 'delta:../v2', 'delta:A/B', '..']) assert.throws(() => parseSymbolKey(bad), /Invalid symbol|Unknown category/, bad);
  assert.equal(parseSymbolKey('delta:C-BTC-90000-310125').key, 'delta:C-BTC-90000-310125');
  assert.equal(parseSymbolKey('BTCUSDT').key, 'linear:BTCUSDT');
});

test('agent tool inputs: symbol format and string lengths are enforced', () => {
  assert.deepEqual(validateInput(TOOL_SCHEMAS.set_symbol, { symbol: 'delta:BTCUSD' }), []);
  assert.deepEqual(validateInput(TOOL_SCHEMAS.set_symbol, { symbol: 'BTCUSDT' }), []);
  assert.ok(validateInput(TOOL_SCHEMAS.set_symbol, { symbol: '<img src=x onerror=alert(1)>' }).length);
  assert.ok(validateInput(TOOL_SCHEMAS.get_candles, { symbol: 'delta:..', tf: '1m' }).length);
  assert.ok(validateInput(TOOL_SCHEMAS.draw, { type: 'text', points: [{ t: 1e12, price: 1 }], text: 'x'.repeat(5000) }).length);
  assert.deepEqual(validateInput(TOOL_SCHEMAS.run_pine, { symbol: 'delta:BTCUSD', tf: '1m', source: 'x'.repeat(50000) }), []);
});

test('the Pine pool refuses work beyond its queue bound and rejects queued jobs on close', async () => {
  const src = `//@version=6
indicator("slow")
s = 0.0
for i = 0 to 100000
    for j = 0 to 100000
        s += 1
plot(s)`;
  const candles = Array.from({ length: 20 }, (_, i) => ({ open: 1, high: 1, low: 1, close: 1, volume: 1, openTime: i * MIN, closeTime: i * MIN + MIN - 1 }));
  const pool = new PinePool(1);
  const job = { candles, source: src, inputs: {}, props: {}, alertMode: 'all' };
  const running = [];
  for (let i = 0; i < MAX_QUEUE + 1; i++) running.push(pool.exec(job, 30000).catch((e) => e));
  await assert.rejects(pool.exec(job, 30000), (err) => err.kind === 'busy');
  await pool.close();
  const results = await Promise.all(running);
  assert.ok(results.every((e) => e instanceof Error), 'queued and running jobs settle on close');
});

test('push subscriptions: public https endpoints only, bounded count, send timeout', async () => {
  const { unsafePushEndpoint, createNotifier, MAX_PUSH_SUBSCRIPTIONS } = await import('../src/notify/index.js');
  for (const ok of ['https://fcm.googleapis.com/fcm/send/abc', 'https://updates.push.services.mozilla.com/wpush/v2/x', 'https://web.push.apple.com/Q', 'https://wns2-par02p.notify.windows.com/w/?token=1']) {
    assert.equal(unsafePushEndpoint(ok), null, ok);
  }
  for (const bad of ['http://fcm.googleapis.com/x', 'https://127.0.0.1/x', 'https://localhost:3000/api/alerts', 'https://10.0.0.5/', 'https://169.254.169.254/latest', 'https://192.168.1.1/', 'https://172.20.0.1/', 'https://[::1]/', 'https://[fd00::1]/', 'https://printer.local/', 'https://metadata.google.internal/', 'https://intranet/', 'https://user:pw@fcm.googleapis.com/x', 'notaurl']) {
    assert.ok(unsafePushEndpoint(bad), bad);
  }
  const { repos } = initDb(':memory:');
  const sent = [];
  const webpush = { generateVAPIDKeys: () => ({ publicKey: 'pub', privateKey: 'priv' }), setVapidDetails() {}, sendNotification: async (sub, body, opts) => sent.push(opts) };
  const n = createNotifier({ log: quiet, config: {}, repos }, { webpush, fetch: async () => ({ ok: true }) });
  assert.throws(() => n.subscribe({ endpoint: 'https://127.0.0.1:3000/x', keys: { p256dh: 'a', auth: 'b' } }), /public host/);
  for (let i = 0; i < MAX_PUSH_SUBSCRIPTIONS + 10; i++) n.subscribe({ endpoint: `https://fcm.googleapis.com/fcm/send/${i}`, keys: { p256dh: 'a', auth: 'b' } });
  assert.equal(n.subscriptionCount(), MAX_PUSH_SUBSCRIPTIONS);
  await n.notifyAlert({ alertId: 'a', name: 'x', symbol: 'delta:BTCUSD', price: 1, message: 'm' });
  assert.equal(sent.length, MAX_PUSH_SUBSCRIPTIONS);
  assert.ok(sent.every((o) => o.timeout > 0), 'push sends carry a timeout');
});
