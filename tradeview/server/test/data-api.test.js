import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import baseConfig from '../src/config.js';
import { buildServer } from '../src/index.js';
import { hashPassword, verifyPassword, parseHash } from '../src/auth/password.js';
import { SessionSigner, LoginLimiter, parseCookies, isProtectedPath } from '../src/auth/index.js';
import { floorTime } from '../src/data/timeframes.js';

const json = (obj, status = 200) => ({ ok: status < 300, status, headers: new Map(), text: async () => JSON.stringify(obj) });

/** Offline fetch: Delta candles/products fixtures; every other host is "blocked" like in this sandbox. */
async function fakeFetch(url) {
  const u = new URL(url);
  if (u.pathname === '/v2/history/candles') {
    const step = { '1m': 60000, '1h': 3600000 }[u.searchParams.get('resolution')];
    const end = Math.min(Number(u.searchParams.get('end')) * 1000, Date.now());
    const start = Math.max(Number(u.searchParams.get('start')) * 1000, end - 50 * step);
    const rows = [];
    for (let t = Math.ceil(start / step) * step; t <= end; t += step) rows.push({ time: t / 1000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 3 });
    return json({ success: true, result: rows });
  }
  if (u.pathname === '/v2/products') {
    return json({ success: true, result: [{ symbol: 'BTCUSD', contract_type: 'perpetual_futures', tick_size: '0.5', state: 'live', underlying_asset: { symbol: 'BTC' }, quoting_asset: { symbol: 'USD' } }], meta: {} });
  }
  return { ok: false, status: 403, headers: new Map(), text: async () => 'Host not in allowlist' };
}

class FakeStreams extends EventEmitter {
  constructor() {
    super();
    this.subs = new Map();
    this.status = 'connected';
  }
  subscribe(c, t) {
    const k = `${c}|${t}`;
    this.subs.set(k, (this.subs.get(k) || 0) + 1);
  }
  unsubscribe(c, t) {
    const k = `${c}|${t}`;
    const n = (this.subs.get(k) || 0) - 1;
    if (n > 0) this.subs.set(k, n);
    else this.subs.delete(k);
  }
  statuses() {
    return { delta: 'connected', bybit: 'idle' };
  }
  close() {}
}

function testConfig(extra = {}) {
  return { ...baseConfig, dbPath: ':memory:', logLevel: 'silent', port: 0, host: '127.0.0.1', gapfillOnStart: false, ...extra };
}

async function makeServer(extra) {
  const streams = new FakeStreams();
  const server = await buildServer({
    config: testConfig(extra), logger: false, fetch: fakeFetch, streams, optionalModules: false, web: false, record: false, gapfill: false,
  });
  server.ctx.bybit.rest.bybit.maxRetries = 0;
  return { server, streams, app: server.app };
}

test('password hashing and session tokens', async () => {
  const h = await hashPassword('correct horse');
  assert.match(h, /^scrypt\$16384\$8\$1\$/);
  assert.ok(await verifyPassword('correct horse', h));
  assert.ok(!(await verifyPassword('wrong', h)));
  assert.equal(parseHash('nope'), null);
  const s = new SessionSigner('secret', 'fp');
  const tok = s.sign({ iat: 1, exp: Date.now() + 1000 });
  assert.ok(s.verify(tok));
  assert.equal(s.verify(`${tok}x`), null);
  assert.equal(new SessionSigner('secret', 'other-password').verify(tok), null);
  assert.equal(s.verify(s.sign({ exp: Date.now() - 1 })), null);
  let now = 0;
  const rl = new LoginLimiter({ limit: 5, windowMs: 60000, now: () => now });
  for (let i = 0; i < 5; i++) assert.ok(rl.hit('ip').ok);
  assert.deepEqual(rl.hit('ip'), { ok: false, retryAfterSec: 60 });
  assert.ok(rl.hit('other').ok);
  now = 60001;
  assert.ok(rl.hit('ip').ok);
  assert.deepEqual(parseCookies('a=1; tv_session=abc%3D; b="q"'), { a: '1', tv_session: 'abc=', b: 'q' });
  assert.ok(isProtectedPath('/api/candles?x=1'));
  assert.ok(isProtectedPath('/ws'));
  assert.ok(!isProtectedPath('/api/health'));
  assert.ok(!isProtectedPath('/api/auth/login'));
  assert.ok(!isProtectedPath('/'));
  assert.ok(!isProtectedPath('/_next/static/x.js'));
});

test('REST API without auth: health, candles, symbols, drawings, errors', async () => {
  const { server, app } = await makeServer();
  try {
    const health = (await app.inject('/api/health')).json();
    assert.equal(health.ok, true);
    assert.equal(health.db, true);
    assert.equal(health.auth.enabled, false);
    assert.ok('delta' in health && 'bybit' in health && 'laya' in health);

    const r = await app.inject('/api/candles?symbol=delta:BTCUSD&tf=1m&limit=10');
    assert.equal(r.statusCode, 200);
    const body = r.json();
    assert.equal(body.symbol, 'delta:BTCUSD');
    assert.equal(body.candles.length, 10);
    assert.equal(body.candles.at(-1).t, floorTime(Date.now(), '1m'));
    assert.deepEqual(Object.keys(body.candles[0]), ['t', 'o', 'h', 'l', 'c', 'v']);

    // Bybit is unreachable: still 200 with (empty) cached data.
    const by = await app.inject('/api/candles?symbol=linear:BTCUSDT&tf=1h&limit=5');
    assert.equal(by.statusCode, 200);
    assert.deepEqual(by.json().candles, []);

    assert.equal((await app.inject('/api/candles?symbol=delta:BTCUSD&tf=7m')).statusCode, 400);
    assert.equal((await app.inject('/api/candles?symbol=option:X&tf=1m')).statusCode, 400);
    assert.equal((await app.inject('/api/symbols?provider=nope')).statusCode, 400);

    const syms = (await app.inject('/api/symbols')).json();
    assert.deepEqual(syms.map((s) => [s.key, s.provider]), [['delta:BTCUSD', 'delta']]);
    assert.deepEqual((await app.inject('/api/symbols?provider=bybit')).json(), []);

    const fp = await app.inject('/api/footprint?symbol=delta:BTCUSD&tf=1m');
    assert.equal(fp.statusCode, 200);
    assert.ok(Array.isArray(fp.json().bars));

    // Drawings CRUD.
    const put = await app.inject({ method: 'PUT', url: '/api/drawings/d1', payload: { symbol: 'delta:BTCUSD', type: 'hline', points: [{ t: 1, price: 2 }] } });
    assert.equal(put.statusCode, 200);
    assert.equal(put.json().drawing.id, 'd1');
    const post = await app.inject({ method: 'POST', url: '/api/drawings', payload: { symbol: 'delta:BTCUSD', type: 'text' } });
    assert.ok(post.json().drawing.id);
    assert.equal((await app.inject('/api/drawings?symbol=delta:BTCUSD')).json().drawings.length, 2);
    assert.equal((await app.inject({ method: 'PUT', url: '/api/drawings/x', payload: { type: 'hline' } })).statusCode, 400);
    assert.equal((await app.inject({ method: 'DELETE', url: '/api/drawings/d1' })).json().ok, true);
    assert.equal((await app.inject({ method: 'DELETE', url: '/api/drawings/d1' })).statusCode, 404);
    assert.equal((await app.inject({ method: 'DELETE', url: '/api/drawings?symbol=delta:BTCUSD' })).json().deleted, 1);

    const nf = await app.inject('/api/nope');
    assert.equal(nf.statusCode, 404);
    assert.equal(nf.json().error, 'not found');
    assert.deepEqual((await app.inject('/api/auth/me')).json(), { authenticated: true, authEnabled: false, expires: null });
  } finally {
    await server.stop();
  }
});

test('auth: login rate limit, cookie session, protected /api and /ws', async () => {
  const { server, streams, app } = await makeServer({ authPassword: 'hunter2-long-password', sessionSecret: 'test-secret' });
  try {
    assert.equal((await app.inject('/api/health')).statusCode, 200);
    assert.equal((await app.inject('/api/candles?symbol=delta:BTCUSD&tf=1m')).statusCode, 401);
    assert.equal((await app.inject('/api/symbols')).statusCode, 401);
    assert.deepEqual((await app.inject('/api/auth/me')).json(), { authenticated: false, authEnabled: true, expires: null });

    const bad = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'nope' } });
    assert.equal(bad.statusCode, 401);
    const good = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'hunter2-long-password' } });
    assert.equal(good.statusCode, 200);
    const setCookie = good.headers['set-cookie'];
    assert.match(setCookie, /^tv_session=[^;]+; Path=\/; SameSite=Lax; Max-Age=2592000; Expires=.*; HttpOnly$/);
    const cookie = setCookie.split(';')[0];
    const ok = await app.inject({ url: '/api/candles?symbol=delta:BTCUSD&tf=1m&limit=3', headers: { cookie } });
    assert.equal(ok.statusCode, 200);
    assert.equal(ok.json().candles.length, 3);
    const me = (await app.inject({ url: '/api/auth/me', headers: { cookie } })).json();
    assert.equal(me.authenticated, true);
    assert.ok(me.expires > Date.now());
    assert.equal((await app.inject({ url: '/api/symbols', headers: { cookie: 'tv_session=forged.token' } })).statusCode, 401);
    const out = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } });
    assert.match(out.headers['set-cookie'], /tv_session=; .*Max-Age=0/);

    // 5 attempts per minute per IP (2 used above): 3 more allowed, then 429.
    for (let i = 0; i < 3; i++) assert.equal((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'x' } })).statusCode, 401);
    const limited = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'hunter2-long-password' } });
    assert.equal(limited.statusCode, 429);
    assert.ok(Number(limited.headers['retry-after']) > 0);

    // WebSocket: rejected without cookie, accepted with it.
    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = app.server.address().port;
    const rejected = await new Promise((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      ws.on('unexpected-response', (_req, res) => resolve(res.statusCode));
      ws.on('open', () => resolve('open'));
      ws.on('error', () => {});
    });
    assert.equal(rejected, 401);

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { cookie } });
    const inbox = [];
    const waitFor = (pred, ms = 2000) => new Promise((resolve, reject) => {
      const t0 = Date.now();
      const tick = () => {
        const m = inbox.find(pred);
        if (m) return resolve(m);
        if (Date.now() - t0 > ms) return reject(new Error(`timeout; got ${JSON.stringify(inbox)}`));
        setTimeout(tick, 10);
      };
      tick();
    });
    ws.on('message', (d) => inbox.push(JSON.parse(d.toString())));
    await new Promise((r) => ws.on('open', r));
    const status = await waitFor((m) => m.type === 'status');
    assert.equal(status.bybit, 'connected');

    ws.send(JSON.stringify({ type: 'ping' }));
    await waitFor((m) => m.type === 'pong');
    ws.send(JSON.stringify({ type: 'subscribe', channel: 'kline', symbol: 'delta:BTCUSD', tf: '1m' }));
    ws.send(JSON.stringify({ type: 'subscribe', channel: 'trades', symbol: 'delta:BTCUSD' }));
    ws.send(JSON.stringify({ type: 'subscribe', channel: 'kline', symbol: 'delta:BTCUSD', tf: '99m' }));
    await waitFor((m) => m.type === 'subscribed' && m.channel === 'trades');
    await waitFor((m) => m.type === 'error' && /timeframe/.test(m.message));
    assert.equal(streams.subs.get('delta|kline.1.BTCUSD'), 1);
    assert.equal(streams.subs.get('delta|publicTrade.BTCUSD'), 1);

    const T = floorTime(Date.now(), '1m');
    streams.emit('message', { category: 'delta', topic: 'kline.1.BTCUSD', data: [{ start: T, interval: '1', open: '1', high: '2', low: '0.5', close: '1.5', volume: '3', turnover: '', confirm: false }] });
    streams.emit('message', { category: 'delta', topic: 'publicTrade.BTCUSD', data: [{ T: T + 5, S: 'Sell', v: '2', p: '1.5' }] });
    const k = await waitFor((m) => m.type === 'kline');
    assert.deepEqual(k, { type: 'kline', symbol: 'delta:BTCUSD', tf: '1m', candle: { t: T, o: 1, h: 2, l: 0.5, c: 1.5, v: 3 }, closed: false });
    const tr = await waitFor((m) => m.type === 'trade');
    assert.deepEqual(tr.trades, [{ t: T + 5, p: 1.5, q: 2, side: 'Sell' }]);

    server.ctx.broadcast({ type: 'alert', event: { id: 1 } });
    await waitFor((m) => m.type === 'alert');

    ws.close();
    const t0 = Date.now();
    while (streams.subs.size && Date.now() - t0 < 2000) await new Promise((r) => setTimeout(r, 10));
    assert.equal(streams.subs.size, 0, 'all subscriptions released on close');
  } finally {
    await server.stop();
  }
});
