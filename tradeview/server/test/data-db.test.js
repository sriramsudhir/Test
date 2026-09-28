import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initDb, dbHealthy } from '../src/db/index.js';

const T0 = Date.UTC(2025, 0, 1);
const mk = (i, c = 100 + i) => ({ t: T0 + i * 60000, o: c - 1, h: c + 1, l: c - 2, c, v: i + 1, qv: (i + 1) * c });

test('schema is created and health check works', () => {
  const { db } = initDb(':memory:');
  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`).all().map((r) => r.name);
  for (const t of ['alert_events', 'alerts', 'backfill_state', 'candles', 'chat_messages', 'drawings', 'footprint']) assert.ok(tables.includes(t), t);
  assert.ok(dbHealthy(db));
  db.close();
  assert.ok(!dbHealthy(db));
});

test('candles: bulk upsert, overwrite, range with limit anchoring', () => {
  const { repos } = initDb(':memory:');
  const n = repos.candles.upsertMany('linear:BTCUSDT', '1m', Array.from({ length: 100 }, (_, i) => mk(i)));
  assert.equal(n, 100);
  // Upsert overwrites existing rows.
  repos.candles.upsertMany('linear:BTCUSDT', '1m', [mk(5, 999)]);
  assert.equal(repos.candles.count('linear:BTCUSDT', '1m'), 100);
  const all = repos.candles.range('linear:BTCUSDT', '1m', {});
  assert.equal(all[5].c, 999);
  assert.deepEqual(Object.keys(all[0]), ['t', 'o', 'h', 'l', 'c', 'v']);
  const tail = repos.candles.range('linear:BTCUSDT', '1m', { to: T0 + 50 * 60000, limit: 10 });
  assert.deepEqual(tail.map((c) => (c.t - T0) / 60000), [41, 42, 43, 44, 45, 46, 47, 48, 49, 50]);
  const head = repos.candles.range('linear:BTCUSDT', '1m', { from: T0 + 20 * 60000, limit: 3, anchor: 'start' });
  assert.deepEqual(head.map((c) => (c.t - T0) / 60000), [20, 21, 22]);
  assert.equal(repos.candles.last('linear:BTCUSDT', '1m').t, T0 + 99 * 60000);
  assert.equal(repos.candles.first('linear:BTCUSDT', '1m').t, T0);
  assert.equal(repos.candles.range('linear:BTCUSDT', '5m', {}).length, 0);
  assert.deepEqual(repos.candles.symbols(), ['linear:BTCUSDT']);
  assert.equal(repos.candles.pairs()[0].n, 100);
});

test('candles: large bulk upsert is fast (single transaction)', () => {
  const { repos } = initDb(':memory:');
  const rows = Array.from({ length: 50000 }, (_, i) => mk(i));
  const t0 = Date.now();
  repos.candles.upsertMany('linear:ETHUSDT', '1m', rows);
  assert.ok(Date.now() - t0 < 5000);
  assert.equal(repos.candles.count('linear:ETHUSDT', '1m'), 50000);
});

test('footprint: replace bars and read rows', () => {
  const { repos } = initDb(':memory:');
  const bar = { t: T0, levels: [{ p: 100, bid: 1, ask: 2 }, { p: 100.5, bid: 3, ask: 0 }] };
  assert.equal(repos.footprint.upsertBars('linear:BTCUSDT', '1m', [bar, { t: T0 + 60000, levels: [{ p: 101, bid: 1, ask: 1 }] }]), 3);
  repos.footprint.upsertBars('linear:BTCUSDT', '1m', [{ t: T0, levels: [{ p: 100, bid: 5, ask: 5 }] }]);
  const rows = repos.footprint.rows('linear:BTCUSDT', '1m', {});
  assert.deepEqual(rows, [
    { t: T0, price: 100, bid_v: 5, ask_v: 5 },
    { t: T0 + 60000, price: 101, bid_v: 1, ask_v: 1 },
  ]);
  assert.equal(repos.footprint.rows('linear:BTCUSDT', '1m', { maxBars: 1 }).length, 1);
  assert.equal(repos.footprint.lastTime('linear:BTCUSDT', '1m'), T0 + 60000);
});

test('backfill_state get/set/extend', () => {
  const { repos } = initDb(':memory:');
  assert.equal(repos.backfillState.get('linear:BTCUSDT', '1h'), null);
  repos.backfillState.set('linear:BTCUSDT', '1h', { oldest: 100, newest: 200 });
  assert.deepEqual(repos.backfillState.extend('linear:BTCUSDT', '1h', { oldest: 50 }), { oldest: 50, newest: 200 });
  assert.deepEqual(repos.backfillState.extend('linear:BTCUSDT', '1h', { newest: 300 }), { oldest: 50, newest: 300 });
  assert.deepEqual(repos.backfillState.all(), [{ symbol: 'linear:BTCUSDT', tf: '1h', oldest: 50, newest: 300 }]);
});

test('alerts, alert events, drawings, chat repositories', () => {
  const { repos } = initDb(':memory:');
  const a = repos.alerts.save({ symbol: 'linear:BTCUSDT', tf: '1m', name: 'x', condition: { kind: 'price', op: 'above', value: 1 } });
  assert.ok(a.id);
  assert.equal(a.status, 'active');
  assert.equal(repos.alerts.get(a.id).condition.value, 1);
  repos.alerts.update(a.id, { status: 'triggered' });
  assert.equal(repos.alerts.list({ status: 'triggered' }).length, 1);
  assert.equal(repos.alerts.list({ status: 'active' }).length, 0);
  const e = repos.alertEvents.add({ alertId: a.id, symbol: 'linear:BTCUSDT', t: 5, price: 2, message: 'hi' });
  assert.equal(typeof e.id, 'number');
  repos.alertEvents.add({ alertId: a.id, t: 6, price: 3 });
  assert.deepEqual(repos.alertEvents.list({ limit: 10 }).map((x) => x.t), [6, 5]);
  assert.ok(repos.alerts.delete(a.id));
  assert.equal(repos.alerts.get(a.id), null);

  repos.drawings.put({ id: 'd1', symbol: 'linear:BTCUSDT', type: 'hline', points: [{ t: 1, price: 2 }] });
  repos.drawings.put({ id: 'd2', symbol: 'spot:ETHUSDT', type: 'text' });
  repos.drawings.put({ id: 'd1', symbol: 'linear:BTCUSDT', type: 'hline', points: [{ t: 1, price: 3 }] });
  assert.equal(repos.drawings.list('linear:BTCUSDT').length, 1);
  assert.equal(repos.drawings.get('d1').points[0].price, 3);
  assert.equal(repos.drawings.list().length, 2);
  assert.equal(repos.drawings.clear('spot:ETHUSDT'), 1);

  repos.chat.append('s1', 'user', 'hello');
  repos.chat.append('s1', 'assistant', [{ type: 'text', text: 'hi' }]);
  repos.chat.append('s2', 'user', 'other');
  const h = repos.chat.list('s1');
  assert.deepEqual(h.map((m) => m.role), ['user', 'assistant']);
  assert.equal(h[1].content[0].text, 'hi');
  assert.deepEqual(repos.chat.list('s1', 1).map((m) => m.role), ['assistant']);
  assert.equal(repos.chat.sessions().length, 2);
});
