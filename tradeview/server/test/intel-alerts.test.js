import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  evaluatePriceOp, evaluateDrawingOp, drawingValueAt, canFire, evaluateCondition, renderMessage, inside,
} from '../src/alerts/conditions.js';
import { validateAlert } from '../src/alerts/validate.js';
import { AlertEngine } from '../src/alerts/engine.js';
import { createAlert, updateAlert, deleteAlert } from '../src/alerts/service.js';
import { closePinePool } from '../src/pine/runner.js';

after(() => closePinePool());

// ---------------------------------------------------------------- pure conditions

test('price op truth table', () => {
  const rows = [
    // op, prev, cur, value, expected
    ['crosses_up', 99, 100, 100, true],
    ['crosses_up', 99, 101, 100, true],
    ['crosses_up', 100, 101, 100, false], // was not below
    ['crosses_up', 101, 99, 100, false],
    ['crosses_up', undefined, 101, 100, false],
    ['crosses_down', 101, 100, 100, true],
    ['crosses_down', 101, 99, 100, true],
    ['crosses_down', 100, 99, 100, false],
    ['crosses_down', 99, 101, 100, false],
    ['crosses', 99, 101, 100, true],
    ['crosses', 101, 99, 100, true],
    ['crosses', 99, 99.5, 100, false],
    ['crosses', 100, 100, 100, false],
    ['above', undefined, 101, 100, true],
    ['above', 101, 100, 100, false],
    ['below', 100, 99, 100, true],
    ['below', 99, 100, 100, false],
    ['bogus', 99, 101, 100, false],
  ];
  for (const [op, prev, cur, v, exp] of rows) assert.equal(evaluatePriceOp(op, prev, cur, v), exp, `${op} ${prev}->${cur} vs ${v}`);
});

test('channel truth table', () => {
  const rows = [
    ['enters_channel', 89, 95, true],
    ['enters_channel', 111, 105, true],
    ['enters_channel', 95, 96, false],
    ['enters_channel', 89, 111, false],
    ['enters_channel', undefined, 95, false],
    ['exits_channel', 95, 111, true],
    ['exits_channel', 95, 89, true],
    ['exits_channel', 95, 100, false],
    ['exits_channel', 80, 85, false],
  ];
  for (const [op, prev, cur, exp] of rows) assert.equal(evaluatePriceOp(op, prev, cur, 90, 110), exp, `${op} ${prev}->${cur}`);
  assert.equal(evaluatePriceOp('enters_channel', 89, 95, 110, 90), true, 'bounds in any order');
  assert.equal(inside(90, 90, 110), true);
});

test('moving levels (trendline) use the level at each time', () => {
  // level rises from 100 to 102 while price goes 101 -> 101.5: price fell below the line
  assert.equal(evaluatePriceOp('crosses_down', 101, 101.5, { prev: 100, cur: 102 }), true);
  assert.equal(evaluatePriceOp('crosses_up', 101, 101.5, { prev: 100, cur: 102 }), false);
});

test('drawing values at time t', () => {
  const tl = { type: 'trendline', points: [{ t: 1000, price: 100 }, { t: 2000, price: 110 }] };
  assert.equal(drawingValueAt(tl, 1500).value, 105);
  assert.equal(drawingValueAt(tl, 2500).value, null, 'segment does not extend');
  assert.equal(drawingValueAt({ ...tl, extend: 'right' }, 2500).value, 115);
  assert.equal(drawingValueAt({ ...tl, type: 'ray' }, 3000).value, 120);
  assert.equal(drawingValueAt({ ...tl, type: 'ray' }, 500).value, null);
  assert.equal(drawingValueAt({ type: 'hline', points: [{ t: 0, price: 42 }] }, 99999).value, 42);
  assert.equal(drawingValueAt({ type: 'hline', price: 43 }, 1).value, 43);
  const rect = { type: 'rectangle', points: [{ t: 1000, price: 120 }, { t: 2000, price: 100 }] };
  assert.deepEqual(drawingValueAt(rect, 1500), { value: 100, value2: 120 });
  assert.deepEqual(drawingValueAt(rect, 2500), { value: null, value2: null });
  assert.equal(drawingValueAt(null, 0).value, null);
});

test('drawing ops', () => {
  const tl = { type: 'ray', points: [{ t: 0, price: 100 }, { t: 1000, price: 101 }] };
  assert.equal(evaluateDrawingOp('crosses_up', tl, 1000, 100.9, 2000, 102.5), true); // line 101 -> 102
  assert.equal(evaluateDrawingOp('crosses_up', tl, 1000, 101.5, 2000, 102.5), false);
  const rect = { type: 'rectangle', points: [{ t: 0, price: 90 }, { t: 5000, price: 110 }] };
  assert.equal(evaluateDrawingOp('enters_channel', rect, 1000, 85, 2000, 95), true);
  assert.equal(evaluateDrawingOp('above', rect, 1000, 85, 2000, 111), true);
  assert.equal(evaluateDrawingOp('crosses', rect, 1000, 105, 2000, 111), true);
  assert.equal(evaluateCondition({ kind: 'drawing', op: 'below' }, { cur: 99, t: 0, drawing: { type: 'hline', price: 100 } }), true);
  assert.equal(evaluateCondition({ kind: 'indicator' }, { cur: 1, t: 0 }), false);
});

test('trigger gating', () => {
  assert.equal(canFire('once', {}, 0, 0), true);
  assert.equal(canFire('once', { lastFiredAt: 5 }, 0, 10), false);
  assert.equal(canFire('once_per_bar', { lastFiredBar: 60000 }, 60000, 1), false);
  assert.equal(canFire('once_per_bar', { lastFiredBar: 60000 }, 120000, 1), true);
  assert.equal(canFire('once_per_bar_close', {}, 60000, 1), true);
  assert.equal(canFire('every_time', { lastFiredAt: 1000 }, 0, 1500, 1000), false);
  assert.equal(canFire('every_time', { lastFiredAt: 1000 }, 0, 2000, 1000), true);
  assert.equal(canFire('nope', {}, 0, 0), false);
  assert.equal(renderMessage('{{symbol}} at {{price}} {{missing}}', { symbol: 'X', price: 5 }), 'X at 5 {{missing}}');
});

test('alert validation and defaults', () => {
  const a = validateAlert({ symbol: 'linear:BTCUSDT', condition: { kind: 'price', op: 'crosses_up', value: '65000' } }, { now: 0 });
  assert.equal(a.condition.value, 65000);
  assert.equal(a.tf, '1m');
  assert.equal(a.trigger, 'once');
  assert.equal(a.createdBy, 'user');
  assert.equal(a.laya.enabled, false);
  assert.equal(a.laya.threshold, 0.6);
  assert.equal(a.sound.preset, 'siren');
  assert.equal(a.status, 'active');
  const ag = validateAlert({ symbol: 'linear:BTCUSDT', condition: { kind: 'price', op: 'enters_channel', value: 2, value2: 1 } }, { createdBy: 'agent', now: 0 });
  assert.deepEqual([ag.condition.value, ag.condition.value2], [1, 2]);
  assert.equal(ag.laya.enabled, true);
  assert.equal(ag.sound.preset, 'klaxon');
  assert.equal(ag.sound.loop, true);
  const ind = validateAlert({ symbol: 'spot:ETHUSDT', tf: '1h', condition: { kind: 'indicator', source: 'x' } }, { now: 0 });
  assert.equal(ind.trigger, 'once_per_bar_close');
  const bad = [
    {},
    { symbol: 'BTCUSDT', condition: { kind: 'price', op: 'above', value: 1 } },
    { symbol: 'linear:BTCUSDT', condition: { kind: 'price', op: 'sideways', value: 1 } },
    { symbol: 'linear:BTCUSDT', condition: { kind: 'price', op: 'above' } },
    { symbol: 'linear:BTCUSDT', condition: { kind: 'price', op: 'exits_channel', value: 1 } },
    { symbol: 'linear:BTCUSDT', condition: { kind: 'indicator' } },
    { symbol: 'linear:BTCUSDT', condition: { kind: 'drawing', op: 'above' } },
    { symbol: 'linear:BTCUSDT', condition: { kind: 'price', op: 'above', value: 1 }, trigger: 'sometimes' },
    { symbol: 'linear:BTCUSDT', condition: { kind: 'price', op: 'above', value: 1 }, tf: '7m' },
    { symbol: 'linear:BTCUSDT', condition: { kind: 'price', op: 'above', value: 1 }, expires: 5 },
  ];
  for (const b of bad) assert.throws(() => validateAlert(b, { now: 1000 }), { name: 'ValidationError' }, JSON.stringify(b));
});

// ---------------------------------------------------------------- engine with fakes

const quiet = { info() {}, warn() {}, error() {}, debug() {} };

function fakeRepos() {
  const alerts = new Map();
  const events = [];
  const drawings = new Map();
  let seq = 0;
  return {
    alerts: {
      list: ({ status } = {}) => [...alerts.values()].filter((a) => !status || a.status === status).map((a) => ({ ...a })),
      get: (id) => (alerts.has(id) ? { ...alerts.get(id) } : null),
      save: (a) => {
        const s = { ...a, id: a.id ?? `a${++seq}`, status: a.status ?? 'active' };
        alerts.set(s.id, s);
        return { ...s };
      },
      delete: (id) => alerts.delete(id),
    },
    alertEvents: {
      add: (e) => {
        const s = { ...e, id: events.length + 1 };
        events.push(s);
        return s;
      },
      list: ({ limit = 100 } = {}) => events.slice(-limit).reverse(),
    },
    drawings: { get: (id) => drawings.get(id) || null, put: (d) => drawings.set(d.id, d) },
    _events: events,
    _alerts: alerts,
  };
}

class FakeLive extends EventEmitter {
  constructor() {
    super();
    this.acquired = [];
    this.released = [];
    this.prices = new Map();
  }
  acquire(channel, symbol, tf) {
    this.acquired.push([channel, symbol, tf]);
  }
  release(channel, symbol, tf) {
    this.released.push([channel, symbol, tf]);
  }
  lastPrice(symbol) {
    return this.prices.get(symbol);
  }
}

function synthCandles(n = 120, t0 = 0, tf = 60000) {
  return Array.from({ length: n }, (_, i) => ({ t: t0 + i * tf, o: 100, h: 101, l: 99, c: 100 + Math.sin(i / 5), v: 10 }));
}

function makeCtx({ layaAnswer } = {}) {
  const broadcasts = [];
  const layaCalls = [];
  const ctx = {
    log: quiet,
    config: { layaThreshold: 0.6 },
    repos: fakeRepos(),
    live: new FakeLive(),
    market: { getCandles: async ({ limit = 100 } = {}) => synthCandles(Math.min(limit, 250)), getFootprint: async () => [] },
    broadcast: (m) => broadcasts.push(m),
    laya: {
      status: () => ({ ready: layaAnswer !== null, mode: 'http', error: layaAnswer === null ? 'down' : undefined }),
      decide: async (state, questions) => {
        layaCalls.push({ state, questions });
        return layaAnswer === null || layaAnswer === undefined ? null : { answers: { decision: { noul: layaAnswer }, direction: { choice: 'bullish' } } };
      },
    },
  };
  return { ctx, broadcasts, layaCalls };
}

const base = { symbol: 'linear:BTCUSDT', tf: '1m', name: 'BTC 100', message: 'BTC {{price}}' };
const T0 = Date.UTC(2025, 0, 1);

async function setup(alertInput, opts = {}) {
  const env = makeCtx(opts);
  let now = opts.now ?? T0;
  const engine = new AlertEngine(env.ctx, { now: () => now });
  const alert = env.ctx.repos.alerts.save(validateAlert({ ...base, ...alertInput }, { now: 0 }));
  engine.start();
  const trades = async (...prices) => {
    env.ctx.live.emit('trades', { symbol: base.symbol, trades: prices.map((p) => ({ t: now, p, q: 1, side: 'Buy' })) });
    await engine.idle();
  };
  const setNow = (t) => (now = t);
  return { ...env, engine, alert, trades, setNow };
}

test('engine: acquires trades, fires once, persists, broadcasts, releases', async () => {
  const { ctx, engine, alert, trades, broadcasts } = await setup({ condition: { kind: 'price', op: 'crosses_up', value: 100 } });
  assert.deepEqual(ctx.live.acquired, [['trades', base.symbol, undefined]]);
  await trades(99, 99.5);
  assert.equal(ctx.repos._events.length, 0);
  await trades(100.5, 99, 101);
  assert.equal(ctx.repos._events.length, 1, 'once');
  const ev = ctx.repos._events[0];
  assert.equal(ev.alertId, alert.id);
  assert.equal(ev.price, 100.5);
  assert.equal(ev.message, 'BTC 100.5');
  assert.equal(ev.laya, undefined, 'gate disabled');
  assert.deepEqual(broadcasts.map((b) => b.type), ['alert', 'alert_update']);
  assert.equal(broadcasts[0].event.id, 1);
  assert.equal(broadcasts[1].alert.status, 'triggered');
  assert.equal(ctx.repos.alerts.get(alert.id).status, 'triggered');
  assert.deepEqual(ctx.live.released, [['trades', base.symbol, undefined]]);
  await engine.stop();
});

test('engine: seeds previous price from LiveHub.lastPrice', async () => {
  const env = makeCtx();
  env.ctx.live.prices.set(base.symbol, 99);
  const engine = new AlertEngine(env.ctx, { now: () => T0 });
  env.ctx.repos.alerts.save(validateAlert({ ...base, condition: { kind: 'price', op: 'crosses_up', value: 100 } }, { now: 0 }));
  engine.start();
  env.ctx.live.emit('trades', { symbol: base.symbol, trades: [{ t: T0, p: 100.2 }] });
  await engine.idle();
  assert.equal(env.ctx.repos._events.length, 1);
  await engine.stop();
});

test('engine: Laya gate passes -> fires with laya result attached', async () => {
  const { ctx, engine, trades, layaCalls } = await setup(
    { condition: { kind: 'price', op: 'crosses_up', value: 100 }, laya: { enabled: true, question: 'Breakout holds?', threshold: 0.7 } },
    { layaAnswer: 0.82 },
  );
  await trades(99, 101);
  assert.equal(layaCalls.length, 1);
  assert.equal(layaCalls[0].questions.decision.question, 'Breakout holds?');
  assert.equal(layaCalls[0].state.alert.level, 100);
  assert.equal(layaCalls[0].state.price, 101);
  const ev = ctx.repos._events[0];
  assert.equal(ev.laya.p, 0.82);
  assert.equal(ev.laya.passed, true);
  assert.equal(ev.laya.direction, 'bullish');
  await engine.stop();
});

test('engine: Laya gate rejects -> no event, stays active, re-asks only on a new bar', async () => {
  const { ctx, engine, alert, trades, layaCalls, broadcasts, setNow } = await setup(
    { condition: { kind: 'price', op: 'crosses', value: 100 }, trigger: 'once', laya: { enabled: true } },
    { layaAnswer: 0.3 },
  );
  await trades(99, 101, 99, 101); // several crosses in the same minute
  assert.equal(layaCalls.length, 1, 'asked once for this bar');
  assert.equal(ctx.repos._events.length, 0);
  assert.equal(ctx.repos.alerts.get(alert.id).status, 'active');
  assert.equal(ctx.repos.alerts.get(alert.id).lastCheck.laya.passed, false);
  assert.ok(broadcasts.every((b) => b.type === 'alert_update'));
  setNow(T0 + 60000);
  await trades(99);
  assert.equal(layaCalls.length, 2, 'new bar -> asked again');
  await engine.stop();
});

test('engine: Laya unavailable -> fires with laya.skipped (never swallowed)', async () => {
  const { ctx, engine, trades } = await setup(
    { condition: { kind: 'price', op: 'crosses_down', value: 100 }, laya: { enabled: true } },
    { layaAnswer: null },
  );
  await trades(101, 99);
  assert.equal(ctx.repos._events.length, 1);
  assert.equal(ctx.repos._events[0].laya.skipped, true);
  assert.equal(ctx.repos._events[0].laya.reason, 'down');
  await engine.stop();
});

test('engine: once_per_bar fires at most once per bar; every_time respects the cooldown', async () => {
  const s = await setup({ condition: { kind: 'price', op: 'above', value: 100 }, trigger: 'once_per_bar' });
  await s.trades(101, 102, 103);
  assert.equal(s.ctx.repos._events.length, 1);
  s.setNow(T0 + 60000);
  await s.trades(104);
  assert.equal(s.ctx.repos._events.length, 2);
  assert.equal(s.ctx.repos.alerts.get(s.alert.id).status, 'active');
  assert.equal(s.ctx.repos.alerts.get(s.alert.id).triggerCount, 2);
  await s.engine.stop();

  const e = await setup({ condition: { kind: 'price', op: 'above', value: 100 }, trigger: 'every_time' });
  await e.trades(101, 102);
  assert.equal(e.ctx.repos._events.length, 1);
  e.setNow(T0 + 1500);
  await e.trades(103);
  assert.equal(e.ctx.repos._events.length, 2);
  await e.engine.stop();
});

test('engine: expiry marks the alert expired and never fires', async () => {
  const { ctx, engine, alert, trades, broadcasts } = await setup({ condition: { kind: 'price', op: 'above', value: 100 }, expires: T0 - 1 });
  assert.equal(ctx.repos.alerts.get(alert.id).status, 'expired');
  assert.equal(broadcasts[0].type, 'alert_update');
  assert.equal(broadcasts[0].alert.status, 'expired');
  await trades(101);
  assert.equal(ctx.repos._events.length, 0);
  assert.deepEqual(ctx.live.released.length, 1);
  await engine.stop();
});

test('engine: once_per_bar_close evaluates on closed klines', async () => {
  const { ctx, engine, trades } = await setup({ condition: { kind: 'price', op: 'crosses_up', value: 100 }, trigger: 'once_per_bar_close' });
  assert.deepEqual(ctx.live.acquired, [['kline', base.symbol, '1m']]);
  await trades(99, 101); // ticks ignored for bar-close alerts
  assert.equal(ctx.repos._events.length, 0);
  ctx.live.emit('kline', { symbol: base.symbol, tf: '1m', candle: { t: T0, o: 99, h: 101, l: 98, c: 99.5, v: 1 }, closed: false });
  ctx.live.emit('kline', { symbol: base.symbol, tf: '1m', candle: { t: T0, o: 99, h: 101, l: 98, c: 99.5, v: 1 }, closed: true });
  ctx.live.emit('kline', { symbol: base.symbol, tf: '5m', candle: { t: T0, o: 99, h: 101, l: 98, c: 105, v: 1 }, closed: true });
  await engine.idle();
  assert.equal(ctx.repos._events.length, 0);
  ctx.live.emit('kline', { symbol: base.symbol, tf: '1m', candle: { t: T0 + 60000, o: 99.5, h: 101, l: 99, c: 100.5, v: 1 }, closed: true });
  await engine.idle();
  assert.equal(ctx.repos._events.length, 1);
  assert.equal(ctx.repos._events[0].price, 100.5);
  assert.equal(ctx.repos._events[0].t, T0 + 120000 - 1);
  await engine.stop();
});

test('engine: indicator alerts run Pine on closed bars (alertcondition and "signal" plot)', async () => {
  const src = `//@version=6
indicator("cond")
alertcondition(close > 1000, "Big", "close above 1000")`;
  const { ctx, engine } = await setup({ tf: '1m', condition: { kind: 'indicator', source: src }, trigger: 'once_per_bar_close' });
  assert.deepEqual(ctx.live.acquired, [['kline', base.symbol, '1m']]);
  const barT = 250 * 60000;
  ctx.live.emit('kline', { symbol: base.symbol, tf: '1m', candle: { t: barT, o: 100, h: 101, l: 99, c: 100, v: 1 }, closed: true });
  await engine.idle();
  assert.equal(ctx.repos._events.length, 0);
  ctx.live.emit('kline', { symbol: base.symbol, tf: '1m', candle: { t: barT + 60000, o: 100, h: 1200, l: 99, c: 1100, v: 1 }, closed: true });
  await engine.idle();
  assert.equal(ctx.repos._events.length, 1);
  assert.equal(ctx.repos._events[0].detail, 'close above 1000');
  assert.equal(ctx.repos._events[0].condition.kind, 'indicator');
  await engine.stop();

  const sig = `//@version=6
indicator("sig")
plot(close > 1000 ? 1 : 0, "signal")`;
  const s2 = await setup({ condition: { kind: 'indicator', source: sig } });
  s2.ctx.live.emit('kline', { symbol: base.symbol, tf: '1m', candle: { t: barT, o: 100, h: 1200, l: 99, c: 1100, v: 1 }, closed: true });
  await s2.engine.idle();
  assert.equal(s2.ctx.repos._events.length, 1);
  assert.equal(s2.ctx.repos._events[0].detail, 'signal');
  await s2.engine.stop();
});

test('engine: drawing alerts follow a trendline from the drawings repo', async () => {
  const env = makeCtx();
  const now = T0 + 60000;
  env.ctx.repos.drawings.put({ id: 'd1', symbol: base.symbol, type: 'ray', points: [{ t: T0, price: 100 }, { t: T0 + 60000, price: 110 }] });
  const engine = new AlertEngine(env.ctx, { now: () => now });
  env.ctx.repos.alerts.save(validateAlert({ ...base, condition: { kind: 'drawing', drawingId: 'd1', op: 'crosses_up' } }, { now: 0 }));
  engine.start();
  // line is 110 at T0+60s, 115 at T0+90s
  env.ctx.live.emit('trades', { symbol: base.symbol, trades: [{ t: T0 + 60000, p: 109 }, { t: T0 + 90000, p: 114 }] });
  await engine.idle();
  assert.equal(env.ctx.repos._events.length, 0, 'price rose but stayed under the rising line');
  env.ctx.live.emit('trades', { symbol: base.symbol, trades: [{ t: T0 + 90000, p: 116 }] });
  await engine.idle();
  assert.equal(env.ctx.repos._events.length, 1);
  await engine.stop();
});

test('service CRUD informs the engine immediately', async () => {
  const env = makeCtx();
  const engine = new AlertEngine(env.ctx, { now: () => T0 });
  engine.start();
  const a = createAlert(env.ctx, { ...base, condition: { kind: 'price', op: 'above', value: 100 } }, { engine });
  assert.equal(engine.list().length, 1);
  assert.deepEqual(env.ctx.live.acquired, [['trades', base.symbol, undefined]]);
  assert.equal(env.broadcasts.at(-1).type, 'alert_update');
  const paused = updateAlert(env.ctx, a.id, { status: 'paused' }, { engine });
  assert.equal(paused.status, 'paused');
  assert.equal(engine.list().length, 0);
  assert.equal(env.ctx.live.released.length, 1);
  updateAlert(env.ctx, a.id, { status: 'active', condition: { kind: 'price', op: 'below', value: 50 } }, { engine });
  assert.equal(engine.list()[0].condition.op, 'below');
  assert.equal(deleteAlert(env.ctx, a.id, { engine }), true);
  assert.equal(engine.list().length, 0);
  assert.equal(updateAlert(env.ctx, 'missing', {}), null);
  assert.throws(() => createAlert(env.ctx, { symbol: 'x' }), { statusCode: 400 });
  await engine.stop();
});
