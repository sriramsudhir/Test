import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { BybitRest, RateLimiter, parseKlines, parseInstrument, parseTrades, BybitError, toBybitInterval } from '../src/bybit/rest.js';
import { BybitWs, BybitStreams, chunk } from '../src/bybit/ws.js';
import { classify, parseSymbolKey } from '../src/bybit/markets.js';
import { Instruments } from '../src/bybit/instruments.js';

// Real-shaped Bybit v5 kline response (list is DESCENDING by start time, all strings).
const KLINE_RESPONSE = {
  retCode: 0,
  retMsg: 'OK',
  result: {
    category: 'linear',
    symbol: 'BTCUSDT',
    list: [
      ['1735693380000', '93481.2', '93520', '93470.1', '93510.5', '12.345', '1154321.77'],
      ['1735693320000', '93440', '93490.9', '93431.4', '93481.2', '20.001', '1869876.1'],
      ['1735693260000', '93401.3', '93450', '93399.9', '93440', '8.5', '794321.5'],
    ],
  },
  retExtInfo: {},
  time: 1735693399999,
};

const response = (body, status = 200, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: new Map(Object.entries(headers)),
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

const noSleep = async () => {};
const fastLimiter = () => new RateLimiter(1e6, { burst: 1e6 });

test('parseKlines converts descending string rows to ascending numeric candles', () => {
  const c = parseKlines(KLINE_RESPONSE.result.list);
  assert.equal(c.length, 3);
  assert.deepEqual(c.map((x) => x.t), [1735693260000, 1735693320000, 1735693380000]);
  assert.deepEqual(c[2], { t: 1735693380000, o: 93481.2, h: 93520, l: 93470.1, c: 93510.5, v: 12.345, qv: 1154321.77 });
  assert.deepEqual(parseKlines(undefined), []);
  // duplicates removed
  assert.equal(parseKlines([...KLINE_RESPONSE.result.list, KLINE_RESPONSE.result.list[0]]).length, 3);
});

test('getKlines builds the right request and returns ascending candles', async () => {
  const urls = [];
  const rest = new BybitRest({
    baseUrl: 'https://api.bybit.test', limiter: fastLimiter(), sleep: noSleep,
    fetch: async (url) => {
      urls.push(url);
      return response(KLINE_RESPONSE);
    },
  });
  const c = await rest.getKlines({ category: 'linear', symbol: 'BTCUSDT', tf: '1h', start: 1, end: 2, limit: 5000 });
  assert.equal(c[0].t, 1735693260000);
  const u = new URL(urls[0]);
  assert.equal(u.pathname, '/v5/market/kline');
  assert.equal(u.searchParams.get('interval'), '60');
  assert.equal(u.searchParams.get('limit'), '1000');
  assert.equal(u.searchParams.get('category'), 'linear');
  assert.equal(toBybitInterval('1W'), 'W');
  assert.equal(toBybitInterval('240'), '240');
  assert.throws(() => toBybitInterval('5s'));
});

test('retries on retCode 10006, HTTP 429 and network errors, then succeeds', async () => {
  const seq = [
    () => response({ retCode: 10006, retMsg: 'Too many visits!', result: {} }),
    () => response('rate limited', 429),
    () => {
      throw new TypeError('fetch failed');
    },
    () => response(KLINE_RESPONSE),
  ];
  const sleeps = [];
  let i = 0;
  const rest = new BybitRest({
    limiter: fastLimiter(),
    sleep: async (ms) => sleeps.push(ms),
    fetch: async () => seq[i++](),
  });
  const c = await rest.getKlines({ symbol: 'BTCUSDT', tf: '1m' });
  assert.equal(c.length, 3);
  assert.equal(i, 4);
  assert.equal(sleeps.length, 3);
  assert.ok(sleeps[1] >= sleeps[0] * 0.5, 'backoff grows');
  assert.equal(rest.stats.retries, 3);
  assert.equal(rest.health, 'ok');
});

test('non-retryable errors fail fast; exhausted retries throw BybitError', async () => {
  let calls = 0;
  const rest = new BybitRest({
    limiter: fastLimiter(), sleep: noSleep, maxRetries: 2,
    fetch: async () => {
      calls++;
      return response({ retCode: 10001, retMsg: 'params error: symbol invalid', result: {} });
    },
  });
  await assert.rejects(rest.getKlines({ symbol: 'NOPE', tf: '1m' }), (e) => e instanceof BybitError && e.retCode === 10001);
  assert.equal(calls, 1);

  let n = 0;
  const down = new BybitRest({ limiter: fastLimiter(), sleep: noSleep, maxRetries: 2, fetch: async () => { n++; throw new TypeError('ECONNREFUSED'); } });
  await assert.rejects(down.getTickers('linear'), /Network error/);
  assert.equal(n, 3);
  const forbidden = new BybitRest({ limiter: fastLimiter(), sleep: noSleep, fetch: async () => response('Host not in allowlist', 403) });
  await assert.rejects(forbidden.getServerTime(), /HTTP 403/);
});

test('RateLimiter enforces the token bucket rate', async () => {
  let now = 0;
  const waits = [];
  const rl = new RateLimiter(10, {
    burst: 2,
    now: () => now,
    sleep: async (ms) => {
      waits.push(ms);
      now += ms;
    },
  });
  for (let i = 0; i < 12; i++) await rl.take();
  // 2 from the burst, then 10 more at 10/s = 1000ms of virtual time.
  assert.ok(Math.abs(now - 1000) <= 20, `elapsed ${now}`);
  assert.equal(waits.length, 10);
});

test('RateLimiter real timing: 5 req/s with burst 1', async () => {
  const rl = new RateLimiter(20, { burst: 1 });
  const t0 = Date.now();
  await Promise.all(Array.from({ length: 6 }, () => rl.take()));
  const dt = Date.now() - t0;
  assert.ok(dt >= 230, `took ${dt}ms`); // 5 waits * 50ms
});

test('getKlinesRange pages backwards until the start', async () => {
  const step = 60000;
  const end = 1000 * step;
  const pages = [];
  const rest = new BybitRest({
    limiter: fastLimiter(), sleep: noSleep,
    fetch: async (url) => {
      const q = new URL(url).searchParams;
      const e = Number(q.get('end'));
      const s = Number(q.get('start'));
      const limit = Number(q.get('limit'));
      const list = [];
      for (let t = Math.floor(e / step) * step; t >= s && list.length < limit; t -= step) {
        list.push([String(t), '1', '2', '0.5', '1.5', '3', '4.5']);
      }
      pages.push(list.length);
      return response({ retCode: 0, retMsg: 'OK', result: { list } });
    },
  });
  const seen = [];
  const out = await rest.getKlinesRange({ symbol: 'BTCUSDT', tf: '1m', start: 10 * step, end, limit: 300, onPage: (p) => seen.push(p.length) });
  assert.equal(out.length, 991);
  assert.equal(out[0].t, 10 * step);
  assert.equal(out.at(-1).t, end);
  assert.deepEqual(pages, [300, 300, 300, 91]);
  assert.deepEqual(seen, pages);
  for (let i = 1; i < out.length; i++) assert.equal(out[i].t - out[i - 1].t, step);
});

test('getInstruments follows the cursor and parses filters', async () => {
  const page1 = {
    retCode: 0, retMsg: 'OK',
    result: {
      category: 'linear', nextPageCursor: 'abc',
      list: [
        { symbol: 'BTCUSDT', contractType: 'LinearPerpetual', status: 'Trading', baseCoin: 'BTC', quoteCoin: 'USDT', launchTime: '1585526400000', priceFilter: { minPrice: '0.10', maxPrice: '1999999.80', tickSize: '0.10' }, lotSizeFilter: { maxOrderQty: '1190.000', minOrderQty: '0.001', qtyStep: '0.001' } },
        { symbol: 'OLDUSDT', contractType: 'LinearPerpetual', status: 'Closed', baseCoin: 'OLD', quoteCoin: 'USDT', priceFilter: { tickSize: '0.0001' }, lotSizeFilter: { qtyStep: '1' } },
      ],
    },
  };
  const page2 = {
    retCode: 0, retMsg: 'OK',
    result: { category: 'linear', nextPageCursor: '', list: [{ symbol: 'XAUTUSDT', contractType: 'LinearPerpetual', status: 'Trading', baseCoin: 'XAUT', quoteCoin: 'USDT', priceFilter: { tickSize: '0.01' }, lotSizeFilter: { qtyStep: '0.001' } }] },
  };
  const cursors = [];
  const rest = new BybitRest({
    limiter: fastLimiter(), sleep: noSleep,
    fetch: async (url) => {
      const c = new URL(url).searchParams.get('cursor');
      cursors.push(c);
      return response(c ? page2 : page1);
    },
  });
  const list = await rest.getInstruments('linear');
  assert.deepEqual(cursors, [null, 'abc']);
  assert.deepEqual(list.map((x) => x.key), ['linear:BTCUSDT', 'linear:XAUTUSDT']);
  assert.equal(list[0].tickSize, 0.1);
  assert.equal(list[0].qtyStep, 0.001);
  const spot = parseInstrument('spot', { symbol: 'EURUSDT', baseCoin: 'EUR', quoteCoin: 'USDT', status: 'Trading', priceFilter: { tickSize: '0.0001' }, lotSizeFilter: { basePrecision: '0.01', minOrderQty: '1' } });
  assert.equal(spot.qtyStep, 0.01);
});

test('parseTrades maps recent-trade entries', () => {
  const t = parseTrades([
    { execId: 'b', symbol: 'BTCUSDT', price: '93500.10', size: '0.020', side: 'Sell', time: '1735693399500', isBlockTrade: false },
    { execId: 'a', symbol: 'BTCUSDT', price: '93500.00', size: '0.150', side: 'Buy', time: '1735693399000', isBlockTrade: false },
  ]);
  assert.deepEqual(t.map((x) => [x.t, x.p, x.q, x.side]), [[1735693399000, 93500, 0.15, 'Buy'], [1735693399500, 93500.1, 0.02, 'Sell']]);
});

test('market group classification', () => {
  assert.equal(classify({ symbol: 'BTCUSDT', base: 'BTC', quote: 'USDT' }), 'crypto');
  assert.equal(classify({ symbol: 'XAUTUSDT', base: 'XAUT', quote: 'USDT' }), 'commodities');
  assert.equal(classify({ symbol: 'PAXGUSDT', base: 'PAXG', quote: 'USDT' }), 'commodities');
  assert.equal(classify({ symbol: 'XAGUSDT', base: 'XAG', quote: 'USDT' }), 'commodities');
  assert.equal(classify({ symbol: 'USOILUSDT', base: 'USOIL', quote: 'USDT' }), 'commodities');
  assert.equal(classify({ symbol: 'EURUSDT', base: 'EUR', quote: 'USDT', category: 'spot' }), 'forex');
  assert.equal(classify({ symbol: 'GBPUSDT', base: 'GBP', quote: 'USDT' }), 'forex');
  assert.equal(classify({ symbol: 'BTCEUR', base: 'BTC', quote: 'EUR', category: 'spot' }), 'crypto');
  assert.equal(classify({ symbol: 'EURCUSDC', base: 'EURC', quote: 'USDC' }), 'forex');
});

test('parseSymbolKey', () => {
  assert.deepEqual(parseSymbolKey('linear:BTCUSDT'), { category: 'linear', symbol: 'BTCUSDT', key: 'linear:BTCUSDT' });
  assert.deepEqual(parseSymbolKey('spot:ethusdt'), { category: 'spot', symbol: 'ETHUSDT', key: 'spot:ETHUSDT' });
  assert.equal(parseSymbolKey('SOLUSDT').key, 'linear:SOLUSDT');
  assert.throws(() => parseSymbolKey('option:BTC-1'));
  assert.throws(() => parseSymbolKey(''));
  assert.throws(() => parseSymbolKey('linear:BTC USDT'));
});

test('Instruments: list/filter/tickSize and offline cache fallback', async () => {
  const cache = new Map();
  const repos = { meta: { get: (k) => cache.get(k) ?? null, set: (k, v) => cache.set(k, { value: JSON.parse(JSON.stringify(v)), t: Date.now() }) }, candles: { symbols: () => ['linear:BTCUSDT'] } };
  const list = [
    { key: 'linear:BTCUSDT', symbol: 'BTCUSDT', category: 'linear', base: 'BTC', quote: 'USDT', tickSize: 0.1, qtyStep: 0.001, contractType: 'LinearPerpetual' },
    { key: 'linear:XAUTUSDT', symbol: 'XAUTUSDT', category: 'linear', base: 'XAUT', quote: 'USDT', tickSize: 0.01, qtyStep: 0.001, contractType: 'LinearPerpetual' },
    { key: 'spot:EURUSDT', symbol: 'EURUSDT', category: 'spot', base: 'EUR', quote: 'USDT', tickSize: 0.0001, qtyStep: 0.01 },
  ];
  const inst = new Instruments({ rest: { getAllInstruments: async () => list }, repos, log: { info() {}, warn() {} } });
  await inst.load();
  assert.equal(inst.size, 3);
  assert.deepEqual(inst.list({ group: 'commodities' }).map((s) => s.key), ['linear:XAUTUSDT']);
  assert.deepEqual(inst.list({ group: 'forex' })[0], { key: 'spot:EURUSDT', symbol: 'EURUSDT', category: 'spot', provider: 'bybit', group: 'forex', base: 'EUR', quote: 'USDT', tickSize: 0.0001, qtyStep: 0.01, contractType: null });
  assert.deepEqual(inst.list({ q: 'btc' }).map((s) => s.key), ['linear:BTCUSDT']);
  assert.equal(inst.tickSize('BTCUSDT'), 0.1);

  // Offline: a new instance uses the persisted cache.
  const offline = new Instruments({ rest: { getAllInstruments: async () => { throw new Error('offline'); } }, repos, log: { info() {}, warn() {} } });
  await offline.load();
  assert.equal(offline.size, 3);
  assert.equal(offline.source, 'cache');
  // Offline with no cache: symbols seen in candles.
  const bare = new Instruments({ rest: { getAllInstruments: async () => { throw new Error('offline'); } }, repos: { candles: repos.candles }, log: { info() {}, warn() {} } });
  await bare.load();
  assert.deepEqual(bare.list().map((s) => s.key), ['linear:BTCUSDT']);

  // top linear by turnover
  inst.rest.getTickers = async () => [{ symbol: 'XAUTUSDT', turnover24h: 5 }, { symbol: 'BTCUSDT', turnover24h: 1e9 }];
  assert.deepEqual(await inst.topLinear(5), ['linear:BTCUSDT']); // XAUT is a commodity, not in the crypto top list
});

// ---------------------------------------------------------------- WebSocket

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
}

test('chunk splits into groups of at most 10', () => {
  assert.deepEqual(chunk([1, 2, 3], 2), [[1, 2], [3]]);
  assert.equal(chunk(Array.from({ length: 25 }), 10).length, 3);
});

test('BybitWs ref-counts topics, batches subscribes (<=10 args) and resubscribes after reconnect', async () => {
  FakeSocket.instances = [];
  const ws = new BybitWs({ category: 'linear', WebSocket: FakeSocket, baseUrl: 'wss://stream.test/v5/public', pingMs: 50, maxBackoffMs: 5, idleCloseMs: -1, log: { warn() {}, debug() {} } });
  const topics = Array.from({ length: 23 }, (_, i) => `publicTrade.SYM${i}USDT`);
  for (const t of topics) ws.subscribe(t);
  ws.subscribe(topics[0]); // second ref
  assert.equal(FakeSocket.instances.length, 1);
  const s1 = FakeSocket.instances[0];
  assert.equal(s1.url, 'wss://stream.test/v5/public/linear');
  const statuses = [];
  ws.on('status', (s) => statuses.push(s));
  s1.open();
  const subs = s1.sent.filter((m) => m.op === 'subscribe');
  assert.deepEqual(subs.map((m) => m.args.length), [10, 10, 3]);
  assert.deepEqual(subs.flatMap((m) => m.args).sort(), [...topics].sort());

  // Messages are emitted with category.
  const got = [];
  ws.on('message', (m) => got.push(m));
  s1.emit('message', Buffer.from(JSON.stringify({ topic: 'publicTrade.SYM1USDT', type: 'snapshot', ts: 1, data: [{ T: 1, s: 'SYM1USDT', S: 'Buy', v: '1', p: '2' }] })));
  assert.equal(got[0].category, 'linear');
  assert.equal(got[0].topic, 'publicTrade.SYM1USDT');

  // Ref-counting: first unsubscribe keeps the topic, second one sends unsubscribe.
  ws.unsubscribe(topics[0]);
  assert.equal(s1.sent.filter((m) => m.op === 'unsubscribe').length, 0);
  ws.unsubscribe(topics[0]);
  assert.deepEqual(s1.sent.filter((m) => m.op === 'unsubscribe').map((m) => m.args), [[topics[0]]]);

  // Ping is sent periodically.
  await new Promise((r) => setTimeout(r, 70));
  assert.ok(s1.sent.some((m) => m.op === 'ping'));

  // Drop the connection: reconnect and re-subscribe the remaining 22 topics.
  s1.close();
  assert.equal(ws.status, 'reconnecting');
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(FakeSocket.instances.length, 2);
  const s2 = FakeSocket.instances[1];
  s2.open();
  const resub = s2.sent.filter((m) => m.op === 'subscribe');
  assert.deepEqual(resub.map((m) => m.args.length), [10, 10, 2]);
  assert.ok(!resub.flatMap((m) => m.args).includes(topics[0]));
  assert.deepEqual(statuses, ['connected', 'reconnecting', 'connected']);

  // Failed subscription response is surfaced.
  const errs = [];
  ws.on('subscribe_error', (e) => errs.push(e));
  s2.emit('message', JSON.stringify({ success: false, ret_msg: 'Invalid symbol', op: 'subscribe', req_id: resub[0].req_id }));
  assert.equal(errs[0].topics.length, 10);
  ws.close();
  assert.equal(ws.status, 'closed');
});

test('BybitStreams routes per category and reports overall status', () => {
  FakeSocket.instances = [];
  const streams = new BybitStreams({ WebSocket: FakeSocket, baseUrl: 'wss://x/v5/public', idleCloseMs: -1, log: { warn() {}, debug() {} } });
  streams.subscribe('linear', 'kline.1.BTCUSDT');
  streams.subscribe('spot', 'publicTrade.ETHUSDT');
  assert.deepEqual(FakeSocket.instances.map((s) => s.url), ['wss://x/v5/public/linear', 'wss://x/v5/public/spot']);
  assert.equal(streams.status, 'reconnecting');
  FakeSocket.instances.forEach((s) => s.open());
  assert.equal(streams.status, 'connected');
  const got = [];
  streams.on('message', (m) => got.push(m.category));
  FakeSocket.instances[1].emit('message', JSON.stringify({ topic: 'publicTrade.ETHUSDT', data: [] }));
  assert.deepEqual(got, ['spot']);
  streams.close();
});
