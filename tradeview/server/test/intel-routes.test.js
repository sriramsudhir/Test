import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import * as pineRoutes from '../src/pine/routes.js';
import * as backtestRoutes from '../src/backtest/routes.js';
import * as alertRoutes from '../src/alerts/routes.js';
import * as layaRoutes from '../src/laya/routes.js';
import * as agentRoutes from '../src/agent/routes.js';
import * as pushRoutes from '../src/notify/routes.js';
import * as notify from '../src/notify/index.js';
import { createLayaService } from '../src/laya/index.js';
import { closePinePool } from '../src/pine/runner.js';

const quiet = { info() {}, warn() {}, error() {}, debug() {} };
const T = Date.UTC(2025, 0, 1);
let app;
let ctx;

before(async () => {
  const alerts = new Map();
  const events = [];
  const chat = [];
  const kv = new Map();
  const subs = new Map();
  ctx = {
    log: quiet,
    config: { agentDriver: 'off', layaThreshold: 0.6, layaMode: 'off' },
    broadcast: () => {},
    market: {
      getCandles: async ({ limit = 100 }) => Array.from({ length: Math.min(limit, 400) }, (_, i) => {
        const c = 100 + Math.sin(i / 7) * 5;
        return { t: T + i * 3600000, o: c - 0.3, h: c + 1, l: c - 1, c, v: 10 };
      }),
    },
    repos: {
      alerts: {
        list: ({ status } = {}) => [...alerts.values()].filter((a) => !status || a.status === status),
        get: (id) => alerts.get(id) || null,
        save: (a) => {
          const s = { ...a, id: a.id ?? `a${alerts.size + 1}`, status: a.status ?? 'active' };
          alerts.set(s.id, s);
          return s;
        },
        delete: (id) => alerts.delete(id),
      },
      alertEvents: { add: (e) => (events.push(e), e), list: ({ limit }) => events.slice(-limit) },
      chat: {
        append: (session, role, content) => chat.push({ session, role, content, t: T }),
        list: (session) => chat.filter((r) => r.session === session),
        clear: () => 0,
      },
      kv: { get: (k) => kv.get(k) ?? null, set: (k, v) => kv.set(k, v) },
      push: { list: () => [...subs.values()], save: (s) => subs.set(s.endpoint, s), delete: (e) => subs.delete(e) },
    },
  };
  ctx.laya = createLayaService(ctx);
  app = Fastify();
  for (const m of [pineRoutes, backtestRoutes, alertRoutes, layaRoutes, agentRoutes, pushRoutes]) await m.register(app, ctx);
  await app.ready();
});

after(async () => {
  await app.close();
  notify.stop();
  await closePinePool();
});

test('pine library + run routes', async () => {
  const lib = (await app.inject({ method: 'GET', url: '/api/pine/library' })).json();
  assert.ok(lib.items.length >= 24);
  assert.equal(lib.items[0].source, undefined, 'list has no sources');
  const rsi = await app.inject({ method: 'GET', url: '/api/pine/library/rsi' });
  assert.match(rsi.json().source, /ta\.rsi/);
  assert.equal((await app.inject({ method: 'GET', url: '/api/pine/library/nope' })).statusCode, 404);

  const run = await app.inject({ method: 'POST', url: '/api/pine/run', payload: { symbol: 'delta:BTCUSD', tf: '1h', builtin: 'bollinger' } });
  const body = run.json();
  assert.equal(run.statusCode, 200);
  assert.deepEqual(Object.keys(body.plots).sort(), ['Background', 'Basis', 'Lower', 'Upper']);
  assert.equal(body.meta.overlay, true);
  assert.equal(body.plots.Basis.data.at(-1).t, T + 399 * 3600000);

  const err = (await app.inject({ method: 'POST', url: '/api/pine/run', payload: { symbol: 'delta:BTCUSD', tf: '1h', source: '//@version=6\nindicator("x")\nplot(ta.nope(close))' } })).json();
  assert.equal(err.line, 3);
  assert.match(err.error, /ta.nope/);
  assert.equal((await app.inject({ method: 'POST', url: '/api/pine/run', payload: { symbol: 'delta:BTCUSD', tf: '9m', source: 'x' } })).statusCode, 400);
});

test('backtest route', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/backtest', payload: { symbol: 'delta:BTCUSD', tf: '1h', strategy: { id: 'supertrend' }, capital: 1000, commission: 0.1 } });
  assert.equal(res.statusCode, 200);
  const b = res.json();
  assert.equal(b.equity.length, 400);
  assert.equal(b.metrics.initialCapital, 1000);
  assert.ok(Array.isArray(b.trades));
  const pine = (await app.inject({ method: 'POST', url: '/api/backtest', payload: { symbol: 'delta:BTCUSD', tf: '1h', strategy: 'strategy_ema_cross' } })).json();
  assert.equal(pine.meta.mode, 'pine-strategy');
  assert.equal((await app.inject({ method: 'POST', url: '/api/backtest', payload: { symbol: 'delta:BTCUSD', tf: '1h' } })).statusCode, 400);
  const list = (await app.inject({ method: 'GET', url: '/api/backtest/strategies' })).json();
  assert.ok(list.builtin.length >= 4 && list.pine.length === 3);
});

test('alert CRUD routes', async () => {
  const bad = await app.inject({ method: 'POST', url: '/api/alerts', payload: { symbol: 'delta:BTCUSD', condition: { kind: 'price', op: 'above' } } });
  assert.equal(bad.statusCode, 400);
  const created = await app.inject({ method: 'POST', url: '/api/alerts', payload: { symbol: 'delta:BTCUSD', condition: { kind: 'price', op: 'crosses_up', value: 105 } } });
  assert.equal(created.statusCode, 201);
  const a = created.json();
  assert.equal(a.createdBy, 'user');
  assert.equal((await app.inject({ method: 'GET', url: '/api/alerts' })).json().alerts.length, 1);
  assert.equal((await app.inject({ method: 'GET', url: `/api/alerts/${a.id}` })).json().id, a.id);
  const patched = (await app.inject({ method: 'PATCH', url: `/api/alerts/${a.id}`, payload: { status: 'paused', name: 'renamed' } })).json();
  assert.deepEqual([patched.status, patched.name], ['paused', 'renamed']);
  assert.equal((await app.inject({ method: 'PATCH', url: '/api/alerts/zzz', payload: {} })).statusCode, 404);
  assert.deepEqual((await app.inject({ method: 'GET', url: '/api/alerts/events?limit=5' })).json(), { events: [] });
  assert.equal((await app.inject({ method: 'DELETE', url: `/api/alerts/${a.id}` })).statusCode, 200);
  assert.equal((await app.inject({ method: 'DELETE', url: `/api/alerts/${a.id}` })).statusCode, 404);
});

test('laya routes degrade when Laya is off', async () => {
  const st = (await app.inject({ method: 'GET', url: '/api/laya/status' })).json();
  assert.deepEqual([st.ready, st.mode], [false, 'off']);
  const d = await app.inject({ method: 'POST', url: '/api/laya/decide', payload: { symbol: 'delta:BTCUSD', tf: '1h' } });
  assert.equal(d.statusCode, 503);
  assert.equal(d.json().skipped, true);
});

test('agent status + chat SSE (driver off) + history', async () => {
  assert.deepEqual((await app.inject({ method: 'GET', url: '/api/agent/status' })).json(), { driver: 'off', ready: false, detail: 'The agent is disabled (AGENT_DRIVER=off).' });
  assert.equal((await app.inject({ method: 'POST', url: '/api/chat', payload: { message: 'hi' } })).statusCode, 400);
  const res = await app.inject({ method: 'POST', url: '/api/chat', payload: { session: 's1', message: 'hi', context: {} } });
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /text\/event-stream/);
  const evs = res.body.split('\n\n').filter((l) => l.startsWith('data: ')).map((l) => JSON.parse(l.slice(6)));
  assert.deepEqual(evs.map((e) => e.type), ['error', 'done']);
  const hist = (await app.inject({ method: 'GET', url: '/api/chat/history?session=s1' })).json();
  assert.equal(hist.agent.driver, 'off');
});

test('push routes', async () => {
  const v = (await app.inject({ method: 'GET', url: '/api/push/vapid' })).json();
  assert.equal(typeof v.publicKey, 'string');
  assert.ok(v.publicKey.length > 40);
  assert.equal((await app.inject({ method: 'GET', url: '/api/push/vapid' })).json().publicKey, v.publicKey, 'stable');
  const sub = { endpoint: 'https://push.example/x', keys: { p256dh: 'p', auth: 'a' } };
  assert.equal((await app.inject({ method: 'POST', url: '/api/push/subscribe', payload: { subscription: sub } })).statusCode, 201);
  assert.equal(ctx.repos.push.list().length, 1);
  assert.equal((await app.inject({ method: 'POST', url: '/api/push/subscribe', payload: { endpoint: 'nope' } })).statusCode, 400);
  const del = (await app.inject({ method: 'DELETE', url: '/api/push/subscribe', payload: { endpoint: sub.endpoint } })).json();
  assert.equal(del.removed, true);
});
