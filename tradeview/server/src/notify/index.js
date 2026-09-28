// Alert notifications for when no browser tab is open (§13.3):
//   - Web Push (VAPID keys auto-generated on first start, stored in ctx.repos.kv)
//   - optional Telegram (TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID)
// notifyAlert(event) never throws and never blocks the alert broadcast (the engine does not await it).
import webpushDefault from 'web-push';

const KV_PUBLIC = 'vapid.publicKey';
const KV_PRIVATE = 'vapid.privateKey';
const PUSH_TTL_S = 3600;
const TELEGRAM_TIMEOUT_MS = 10000;

// ---- repository adapters (tolerant of method naming) --------------------------------------------
function kvGet(kv, key) {
  const v = kv?.get?.(key);
  if (v && typeof v === 'object' && 'value' in v) return v.value;
  return v ?? null;
}
function kvSet(kv, key, value) {
  if (kv?.set) return kv.set(key, value);
  if (kv?.put) return kv.put(key, value);
  throw new Error('kv repository has no set()');
}
function pushList(repo) {
  const rows = repo?.list?.() ?? repo?.all?.() ?? [];
  return rows.map((r) => (typeof r?.json === 'string' ? JSON.parse(r.json) : r)).filter((s) => s?.endpoint);
}
function pushSave(repo, sub) {
  const fn = repo?.save || repo?.upsert || repo?.put || repo?.add;
  if (!fn) throw new Error('push repository has no save()');
  return fn.call(repo, sub);
}
function pushDelete(repo, endpoint) {
  const fn = repo?.delete || repo?.remove;
  return fn ? fn.call(repo, endpoint) : false;
}

/**
 * @param {object} ctx
 * @param {object} [deps] test seams: { webpush, fetch }
 */
export function createNotifier(ctx, deps = {}) {
  const log = ctx.log || console;
  const webpush = deps.webpush || webpushDefault;
  const doFetch = deps.fetch || globalThis.fetch;
  const cfg = ctx.config || {};
  const env = process.env;
  const telegram = {
    token: cfg.telegramBotToken ?? cfg.TELEGRAM_BOT_TOKEN ?? env.TELEGRAM_BOT_TOKEN ?? '',
    chatId: cfg.telegramChatId ?? cfg.TELEGRAM_CHAT_ID ?? env.TELEGRAM_CHAT_ID ?? '',
  };
  const subject = cfg.vapidSubject ?? env.VAPID_SUBJECT ?? 'mailto:alerts@tradeview.local';
  const memoryKv = new Map();
  const memorySubs = new Map();
  let vapid = null;
  const stats = { pushSent: 0, pushFailed: 0, pushRemoved: 0, telegramSent: 0, telegramFailed: 0, lastError: null };

  const kv = ctx.repos?.kv || { get: (k) => memoryKv.get(k) ?? null, set: (k, v) => memoryKv.set(k, v) };
  const subs = ctx.repos?.push || {
    list: () => [...memorySubs.values()],
    save: (s) => memorySubs.set(s.endpoint, s),
    delete: (e) => memorySubs.delete(e),
  };
  if (!ctx.repos?.kv) log.warn?.('notify: ctx.repos.kv missing - VAPID keys will not survive a restart');
  if (!ctx.repos?.push) log.warn?.('notify: ctx.repos.push missing - push subscriptions kept in memory only');

  function init() {
    if (vapid) return vapid;
    let publicKey = kvGet(kv, KV_PUBLIC);
    let privateKey = kvGet(kv, KV_PRIVATE);
    if (!publicKey || !privateKey) {
      const keys = webpush.generateVAPIDKeys();
      publicKey = keys.publicKey;
      privateKey = keys.privateKey;
      kvSet(kv, KV_PUBLIC, publicKey);
      kvSet(kv, KV_PRIVATE, privateKey);
      log.info?.('notify: generated new VAPID keys');
    }
    webpush.setVapidDetails(subject, publicKey, privateKey);
    vapid = { publicKey, privateKey };
    return vapid;
  }

  function payloadFor(event) {
    const symbol = String(event.symbol || '').split(':').pop();
    const lay = event.laya && !event.laya.skipped && typeof event.laya.p === 'number' ? ` · Laya ${(event.laya.p * 100).toFixed(0)}%` : '';
    return {
      title: `Alert: ${event.name || 'TradeView'}`,
      body: `${event.message || ''}${event.price !== undefined ? `\n${symbol} @ ${event.price}` : ''}${lay}`.trim(),
      tag: `alert-${event.alertId ?? event.id ?? Date.now()}`,
      requireInteraction: true,
      renotify: true,
      vibrate: [500, 200, 500, 200, 800],
      sound: event.sound?.preset,
      data: { type: 'alert', event, url: '/' },
      t: event.t ?? Date.now(),
    };
  }

  async function sendPush(payload) {
    const out = { sent: 0, failed: 0, removed: 0 };
    let list = [];
    try {
      init();
      list = pushList(subs);
    } catch (err) {
      stats.lastError = err.message;
      log.warn?.({ err: err.message }, 'notify: push unavailable');
      return out;
    }
    const body = JSON.stringify(payload);
    await Promise.all(list.map(async (sub) => {
      try {
        await webpush.sendNotification(sub, body, { TTL: PUSH_TTL_S, urgency: 'high', topic: payload.tag.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) || undefined });
        out.sent++;
      } catch (err) {
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          out.removed++;
          try {
            pushDelete(subs, sub.endpoint);
          } catch {
            /* ignore */
          }
        } else {
          out.failed++;
          stats.lastError = err?.body || err?.message || String(err);
          log.warn?.({ err: stats.lastError, endpoint: sub.endpoint?.slice(0, 60) }, 'notify: push failed');
        }
      }
    }));
    stats.pushSent += out.sent;
    stats.pushFailed += out.failed;
    stats.pushRemoved += out.removed;
    return out;
  }

  async function sendTelegram(payload) {
    if (!telegram.token || !telegram.chatId || typeof doFetch !== 'function') return { ok: false, skipped: true };
    try {
      const res = await doFetch(`https://api.telegram.org/bot${telegram.token}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: telegram.chatId, text: `${payload.title}\n${payload.body}`, disable_notification: false }),
        signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`Telegram HTTP ${res.status}`);
      stats.telegramSent++;
      return { ok: true };
    } catch (err) {
      stats.telegramFailed++;
      stats.lastError = err?.message || String(err);
      log.warn?.({ err: stats.lastError }, 'notify: telegram failed'); // never log the token
      return { ok: false, error: stats.lastError };
    }
  }

  return {
    init,
    publicKey: () => init().publicKey,
    telegramEnabled: () => !!(telegram.token && telegram.chatId),

    /** Validate + store a PushSubscription JSON ({endpoint, keys:{p256dh, auth}}). */
    subscribe(sub) {
      if (!sub || typeof sub.endpoint !== 'string' || !/^https:\/\//.test(sub.endpoint)) throw Object.assign(new Error('subscription.endpoint must be an https URL'), { statusCode: 400 });
      if (!sub.keys || typeof sub.keys.p256dh !== 'string' || typeof sub.keys.auth !== 'string') throw Object.assign(new Error('subscription.keys.p256dh and keys.auth are required'), { statusCode: 400 });
      const clean = { endpoint: sub.endpoint, expirationTime: sub.expirationTime ?? null, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } };
      pushSave(subs, clean);
      return clean;
    },
    unsubscribe(endpoint) {
      return !!pushDelete(subs, endpoint);
    },
    subscriptionCount() {
      try {
        return pushList(subs).length;
      } catch {
        return 0;
      }
    },

    /** Push + Telegram for a fired AlertEvent. Never throws. */
    async notifyAlert(event) {
      try {
        const payload = payloadFor(event || {});
        const [push, tg] = await Promise.all([sendPush(payload), sendTelegram(payload)]);
        return { push, telegram: tg };
      } catch (err) {
        stats.lastError = err?.message || String(err);
        log.warn?.({ err: stats.lastError }, 'notify: failed');
        return { push: { sent: 0, failed: 0, removed: 0 }, telegram: { ok: false }, error: stats.lastError };
      }
    },

    async test() {
      return this.notifyAlert({ name: 'TradeView test', message: 'Push alerts are working.', t: Date.now(), alertId: 'test' });
    },

    status() {
      return { push: { subscriptions: this.subscriptionCount(), ready: !!vapid }, telegram: this.telegramEnabled(), ...stats };
    },
  };
}

let notifier = null;

/** Initialise the singleton (VAPID keys) — call once at startup (§11 lifecycle). */
export function start(ctx, deps) {
  notifier = createNotifier(ctx, deps);
  try {
    notifier.init();
  } catch (err) {
    (ctx.log || console).warn?.({ err: err.message }, 'notify: VAPID init failed (push disabled until fixed)');
  }
  return notifier;
}

export function stop() {
  notifier = null;
}

export function getNotifier() {
  return notifier;
}

/** Notify all channels about a fired alert. No-op (resolves) when start() was not called. Never throws. */
export async function notifyAlert(event) {
  if (!notifier) return null;
  return notifier.notifyAlert(event);
}
