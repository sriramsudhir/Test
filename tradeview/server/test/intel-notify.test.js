import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createNotifier } from '../src/notify/index.js';
import { AlertEngine } from '../src/alerts/engine.js';
import { validateAlert } from '../src/alerts/validate.js';

const quiet = { info() {}, warn() {}, error() {}, debug() {} };

function kvRepo() {
  const m = new Map();
  return { m, get: (k) => m.get(k) ?? null, set: (k, v) => m.set(k, v) };
}
function pushRepo() {
  const m = new Map();
  return { m, list: () => [...m.values()], save: (s) => m.set(s.endpoint, s), delete: (e) => m.delete(e) };
}
function fakeWebpush() {
  const sent = [];
  let gen = 0;
  return {
    sent,
    details: null,
    fail: new Map(),
    generateVAPIDKeys: () => ({ publicKey: `PUB${++gen}`, privateKey: `PRIV${gen}` }),
    setVapidDetails(subject, pub, priv) {
      this.details = { subject, pub, priv };
    },
    async sendNotification(sub, body, opts) {
      if (this.fail.has(sub.endpoint)) throw Object.assign(new Error('push error'), { statusCode: this.fail.get(sub.endpoint) });
      sent.push({ sub, body: JSON.parse(body), opts });
      return { statusCode: 201 };
    },
  };
}
const sub = (n) => ({ endpoint: `https://push.example/${n}`, keys: { p256dh: `p${n}`, auth: `a${n}` } });

test('VAPID keys are generated once and persisted in repos.kv', () => {
  const kv = kvRepo();
  const wp = fakeWebpush();
  const n1 = createNotifier({ log: quiet, repos: { kv, push: pushRepo() } }, { webpush: wp });
  assert.equal(n1.publicKey(), 'PUB1');
  assert.equal(kv.m.get('vapid.publicKey'), 'PUB1');
  assert.equal(kv.m.get('vapid.privateKey'), 'PRIV1');
  const n2 = createNotifier({ log: quiet, repos: { kv, push: pushRepo() } }, { webpush: wp });
  assert.equal(n2.publicKey(), 'PUB1', 'reused after restart');
  assert.equal(wp.details.pub, 'PUB1');
  assert.match(wp.details.subject, /^mailto:/);
});

test('subscribe validation, push fan-out, expired subscriptions removed, telegram', async () => {
  const push = pushRepo();
  const wp = fakeWebpush();
  const tg = [];
  const fetch = async (url, init) => {
    tg.push({ url, body: JSON.parse(init.body) });
    return { ok: true, status: 200 };
  };
  const n = createNotifier(
    { log: quiet, repos: { kv: kvRepo(), push }, config: { telegramBotToken: 'TOKEN', telegramChatId: '42' } },
    { webpush: wp, fetch },
  );
  assert.throws(() => n.subscribe({ endpoint: 'http://insecure', keys: { p256dh: 'x', auth: 'y' } }), /https/);
  assert.throws(() => n.subscribe({ endpoint: 'https://x' }), /keys/);
  n.subscribe(sub(1));
  n.subscribe({ ...sub(2), extra: 'dropped' });
  n.subscribe(sub(3));
  assert.equal(n.subscriptionCount(), 3);
  assert.equal(push.m.get('https://push.example/2').extra, undefined);
  wp.fail.set('https://push.example/2', 410);
  wp.fail.set('https://push.example/3', 500);
  const res = await n.notifyAlert({ id: 7, alertId: 'a1', name: 'BTC breakout', message: 'BTC crossed 65000', symbol: 'delta:BTCUSD', price: 65010, t: 1, laya: { p: 0.81, passed: true }, sound: { preset: 'klaxon' } });
  assert.deepEqual(res.push, { sent: 1, failed: 1, removed: 1 });
  assert.equal(push.m.has('https://push.example/2'), false, 'gone subscription removed');
  const msg = wp.sent[0];
  assert.equal(msg.body.title, 'Alert: BTC breakout');
  assert.match(msg.body.body, /BTC crossed 65000\nBTCUSD @ 65010 · Laya 81%/);
  assert.equal(msg.body.requireInteraction, true);
  assert.equal(msg.body.data.event.alertId, 'a1');
  assert.equal(msg.opts.urgency, 'high');
  assert.ok(msg.opts.TTL > 0);
  assert.equal(res.telegram.ok, true);
  assert.equal(tg[0].url, 'https://api.telegram.org/botTOKEN/sendMessage');
  assert.equal(tg[0].body.chat_id, '42');
  assert.equal(n.unsubscribe('https://push.example/1'), true);
  assert.equal(n.subscriptionCount(), 1);
});

test('notifyAlert never throws (broken repos, broken telegram)', async () => {
  const n = createNotifier(
    { log: quiet, repos: { kv: kvRepo(), push: { list: () => { throw new Error('db down'); }, save() {}, delete() {} } }, config: { telegramBotToken: 't', telegramChatId: 'c' } },
    { webpush: fakeWebpush(), fetch: async () => { throw new Error('offline'); } },
  );
  const res = await n.notifyAlert({ name: 'x' });
  assert.deepEqual(res.push, { sent: 0, failed: 0, removed: 0 });
  assert.equal(res.telegram.ok, false);
  const noTg = createNotifier({ log: quiet, repos: { kv: kvRepo(), push: pushRepo() } }, { webpush: fakeWebpush() });
  assert.equal((await noTg.notifyAlert({})).telegram.skipped, true);
});

test('alert engine: a failing notifier never blocks the alert broadcast', async () => {
  const live = new EventEmitter();
  live.acquire = () => {};
  live.release = () => {};
  const broadcasts = [];
  const events = [];
  const alerts = new Map();
  const ctx = {
    log: quiet,
    live,
    broadcast: (m) => broadcasts.push(m),
    repos: {
      alerts: { list: () => [...alerts.values()], save: (a) => (alerts.set(a.id ?? 'a1', { ...a, id: a.id ?? 'a1' }), alerts.get(a.id ?? 'a1')), get: (id) => alerts.get(id) },
      alertEvents: { add: (e) => (events.push(e), { ...e, id: events.length }) },
    },
  };
  let calls = 0;
  let release;
  const slow = new Promise((r) => (release = r));
  const engine = new AlertEngine(ctx, {
    now: () => 0,
    notify: async (ev) => {
      calls++;
      assert.equal(ev.id, 1);
      await slow;
      throw new Error('push service down');
    },
  });
  ctx.repos.alerts.save(validateAlert({ symbol: 'delta:BTCUSD', condition: { kind: 'price', op: 'crosses_up', value: 100 } }, { now: -1 }));
  engine.start();
  live.emit('trades', { symbol: 'delta:BTCUSD', trades: [{ t: 0, p: 99 }, { t: 0, p: 101 }] });
  await new Promise((r) => setImmediate(r));
  assert.equal(calls, 1);
  assert.deepEqual(broadcasts.map((b) => b.type), ['alert', 'alert_update'], 'broadcast happened while the push is still pending');
  release();
  await engine.idle();
  assert.equal(events.length, 1);
  await engine.stop();

  // a notifier that throws synchronously is also contained
  const e2 = new AlertEngine({ ...ctx, broadcast: () => {} }, { now: () => 0, notify: () => { throw new Error('sync'); } });
  alerts.clear();
  ctx.repos.alerts.save(validateAlert({ symbol: 'delta:BTCUSD', condition: { kind: 'price', op: 'above', value: 1 } }, { now: -1 }));
  e2.start();
  live.emit('trades', { symbol: 'delta:BTCUSD', trades: [{ t: 0, p: 5 }] });
  await e2.idle();
  assert.equal(events.length, 2);
  await e2.stop();
});
