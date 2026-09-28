// Hardening: alert engine edge cases for a 24/7 deployment (seeding, restarts, Laya deadline, shutdown, growth).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { AlertEngine } from '../src/alerts/engine.js';
import { validateAlert } from '../src/alerts/validate.js';
import { LiveHub } from '../src/data/live.js';
import { initDb } from '../src/db/index.js';

const quiet = { info() {}, warn() {}, error() {}, debug() {} };
const SYM = 'delta:BTCUSD';
const T0 = Date.UTC(2026, 0, 5, 10, 0, 0);

class FakeLive extends EventEmitter {
  acquire() {}
  release() {}
  lastPrice() {
    return undefined;
  }
}

function setup({ live = new FakeLive(), deps = {}, repos, laya } = {}) {
  const db = repos ? null : initDb(':memory:');
  const ctx = {
    log: quiet,
    config: { layaThreshold: 0.6 },
    repos: repos || db.repos,
    live,
    market: { getCandles: async () => [], getFootprint: async () => [] },
    broadcast: () => {},
    laya: laya || { status: () => ({ ready: true, mode: 'http' }), decide: async () => null },
  };
  let now = T0;
  const engine = new AlertEngine(ctx, { now: () => now, notify: async () => {}, ...deps });
  return { ctx, engine, setNow: (t) => (now = t), getNow: () => now };
}

function addAlert(ctx, input) {
  return ctx.repos.alerts.save(validateAlert({ symbol: SYM, tf: '1m', name: 'x', ...input }, { now: 0 }));
}

test('a batch that moves UP through the level never fires crosses_down (LiveHub prevPrice seeding)', async () => {
  // Real LiveHub: lastPrice() already holds the batch's last trade when the engine runs.
  const streams = Object.assign(new EventEmitter(), { status: 'connected', subscribe() {}, unsubscribe() {}, close() {} });
  const live = new LiveHub({ streams, log: quiet, config: {}, now: () => T0 });
  const { ctx, engine } = setup({ live });
  addAlert(ctx, { condition: { kind: 'price', op: 'crosses_down', value: 102 } });
  const up = addAlert(ctx, { condition: { kind: 'price', op: 'crosses_up', value: 102 } });
  engine.start();
  // First batch after start: 100 -> 105 (an up-move). Before the fix the first trade was compared with 105.
  streams.emit('message', { category: 'delta', topic: 'publicTrade.BTCUSD', data: [{ T: T0, S: 'Buy', v: '1', p: '100' }, { T: T0 + 1, S: 'Buy', v: '1', p: '105' }] });
  await engine.idle();
  const events = ctx.repos.alertEvents.list();
  assert.deepEqual(events.map((e) => e.alertId), [up.id], 'only crosses_up fired');
  // A later batch is seeded from the price before it: 105 -> 101 crosses down on the first trade.
  streams.emit('message', { category: 'delta', topic: 'publicTrade.BTCUSD', data: [{ T: T0 + 2, S: 'Sell', v: '1', p: '101' }] });
  await engine.idle();
  assert.equal(ctx.repos.alertEvents.list().length, 2);
  await engine.stop();
  live.stop();
});

test('restart does not re-fire once_per_bar in a bar that already fired, nor bypass every_time cooldown', async () => {
  const { ctx } = setup();
  const bar = addAlert(ctx, { condition: { kind: 'price', op: 'above', value: 100 }, trigger: 'once_per_bar' });
  const every = addAlert(ctx, { condition: { kind: 'price', op: 'above', value: 100 }, trigger: 'every_time' });
  const run = async (now, price) => {
    const e = new AlertEngine(ctx, { now: () => now, notify: async () => {} });
    e.start();
    ctx.live.emit('trades', { symbol: SYM, trades: [{ t: now, p: price }], prevPrice: price });
    await e.idle();
    await e.stop();
  };
  await run(T0 + 5000, 101);
  assert.equal(ctx.repos.alertEvents.list({ alertId: bar.id }).length, 1);
  assert.equal(ctx.repos.alertEvents.list({ alertId: every.id }).length, 1);
  // "Restart" 10 s later, same 1m bar: once_per_bar must not fire again.
  await run(T0 + 15000, 101);
  assert.equal(ctx.repos.alertEvents.list({ alertId: bar.id }).length, 1, 'once_per_bar re-fired after restart');
  // Restart within the every_time cooldown (1 s) must not fire; after it, it may.
  await run(T0 + 15200, 101);
  assert.equal(ctx.repos.alertEvents.list({ alertId: every.id }).length, 2, 'every_time fired at 15 s (after cooldown)');
  await run(T0 + 15500, 101);
  assert.equal(ctx.repos.alertEvents.list({ alertId: every.id }).length, 2, 'every_time cooldown bypassed by restart');
  // Next bar: once_per_bar fires again.
  await run(T0 + 61000, 101);
  assert.equal(ctx.repos.alertEvents.list({ alertId: bar.id }).length, 2);
});

test('a hung Laya gate cannot block an alert: it fires with laya.skipped after the deadline', async () => {
  const { ctx, engine } = setup({ deps: { askLaya: () => new Promise(() => {}), layaDeadlineMs: 50 } });
  const a = addAlert(ctx, { condition: { kind: 'price', op: 'crosses_up', value: 100 }, laya: { enabled: true } });
  engine.start();
  ctx.live.emit('trades', { symbol: SYM, trades: [{ t: T0, p: 101 }], prevPrice: 99 });
  const t0 = Date.now();
  await engine.idle();
  assert.ok(Date.now() - t0 < 2000);
  const [ev] = ctx.repos.alertEvents.list({ alertId: a.id });
  assert.ok(ev, 'alert fired');
  assert.equal(ev.laya.skipped, true);
  assert.match(ev.laya.reason, /timed out/);
  assert.equal(ctx.repos.alerts.get(a.id).status, 'triggered');
  await engine.stop();
});

test('stop() is bounded even when a notification hangs', async () => {
  const { ctx, engine } = setup({ deps: { notify: () => new Promise(() => {}), stopWaitMs: 100 } });
  addAlert(ctx, { condition: { kind: 'price', op: 'above', value: 100 } });
  engine.start();
  ctx.live.emit('trades', { symbol: SYM, trades: [{ t: T0, p: 101 }], prevPrice: 99 });
  await new Promise((r) => setImmediate(r));
  let timer;
  const res = await Promise.race([
    engine.stop().then(() => 'stopped'),
    new Promise((r) => { timer = setTimeout(() => r('hung'), 2000); }),
  ]);
  clearTimeout(timer);
  assert.equal(res, 'stopped', 'stop() hung on a pending notification');
});

test('fired/expired alerts leave no per-alert runtime state behind', async () => {
  const { ctx, engine, setNow } = setup();
  for (let i = 0; i < 50; i++) addAlert(ctx, { condition: { kind: 'price', op: 'crosses_up', value: 100 + i * 0.01 } });
  for (let i = 0; i < 20; i++) addAlert(ctx, { condition: { kind: 'price', op: 'above', value: 1e9 }, expires: T0 + 1000 });
  engine.start();
  ctx.live.emit('trades', { symbol: SYM, trades: [{ t: T0, p: 101 }], prevPrice: 99 });
  await engine.idle();
  setNow(T0 + 2000);
  engine.checkExpiry();
  assert.equal(engine.alerts.size, 0);
  assert.equal(engine.state.size, 0, 'state map leaks');
  assert.equal(engine.drawings.size, 0);
  assert.equal(ctx.repos.alertEvents.list({ limit: 1000 }).length, 50);
  await engine.stop();
});

test('alert event history is trimmed to ALERT_EVENTS_MAX', async () => {
  const { repos } = initDb(':memory:');
  for (let i = 0; i < 30; i++) repos.alertEvents.add({ alertId: 'a', t: i, price: i });
  assert.equal(repos.alertEvents.trim(50), 0, 'no-op below the cap');
  assert.equal(repos.alertEvents.trim(10), 20);
  const left = repos.alertEvents.list({ limit: 100 });
  assert.equal(left.length, 10);
  assert.equal(left[0].price, 29, 'newest kept');
  const { engine } = setup({ repos });
  engine.ctx.config.alertEventsMax = 5;
  assert.equal(engine.housekeeping(), 5);
  assert.equal(repos.alertEvents.list({ limit: 100 }).length, 5);
});

test('laya question and embedded drawings are size-bounded', () => {
  const a = validateAlert({ symbol: SYM, condition: { kind: 'price', op: 'above', value: 1 }, laya: { enabled: true, question: 'q'.repeat(5000) } });
  assert.equal(a.laya.question.length, 500);
  assert.throws(() => validateAlert({ symbol: SYM, condition: { kind: 'drawing', op: 'crosses', drawing: { type: 'hline', pad: 'x'.repeat(30000) } } }), /too large/);
  assert.throws(() => validateAlert({ symbol: 'delta:..', condition: { kind: 'price', op: 'above', value: 1 } }), /symbol/);
});

test('a triggered once-alert that is re-armed (status active again) fires again', async () => {
  const { ctx, engine, setNow } = setup();
  const a = addAlert(ctx, { condition: { kind: 'price', op: 'above', value: 100 }, trigger: 'once' });
  engine.start();
  ctx.live.emit('trades', { symbol: SYM, trades: [{ t: T0, p: 101 }], prevPrice: 99 });
  await engine.idle();
  const fired = ctx.repos.alerts.get(a.id);
  assert.equal(fired.status, 'triggered');
  setNow(T0 + 10000); // same bar
  const rearmed = ctx.repos.alerts.save({ ...fired, status: 'active' });
  engine.upsert(rearmed);
  ctx.live.emit('trades', { symbol: SYM, trades: [{ t: T0 + 10000, p: 102 }], prevPrice: 101 });
  await engine.idle();
  assert.equal(ctx.repos.alertEvents.list({ alertId: a.id }).length, 2);
  await engine.stop();
});
