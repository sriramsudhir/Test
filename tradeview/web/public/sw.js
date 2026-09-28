/* TradeView service worker (§13.3): Web Push alert notifications + notification click handling.
 * Deliberately has no fetch handler: the app always talks to the live server (no stale cached data). */

const DEFAULT_VIBRATE = [500, 200, 500, 200, 1000];

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

function parsePayload(event) {
  if (!event.data) return {};
  try {
    return event.data.json();
  } catch {
    return { body: event.data.text() };
  }
}

function fmtPrice(p) {
  const n = Number(p);
  if (!Number.isFinite(n)) return '';
  const a = Math.abs(n);
  const d = a >= 10000 ? 1 : a >= 100 ? 2 : a >= 1 ? 3 : 6;
  return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

/** Accepts { title, body, tag, url, data } or a raw AlertEvent / { event: AlertEvent }. */
function buildNotification(payload) {
  const data = payload.data || {};
  const ev = payload.event || data.event || (payload.alertId ? payload : null) || (data.alertId ? data : null);
  const symbol = ev && ev.symbol ? String(ev.symbol).split(':').pop() : '';
  let title = payload.title;
  let body = payload.body;
  if (!title) title = ev ? `🔔 ${ev.name || symbol || 'Alert'}` : 'TradeView alert';
  if (!body && ev) {
    const parts = [];
    if (symbol) parts.push(`${symbol} ${fmtPrice(ev.price)}`);
    if (ev.message) parts.push(ev.message);
    const l = ev.laya;
    if (l && !l.skipped && l.p != null) parts.push(`Laya P(true) ${Math.round(l.p * 100)}%`);
    body = parts.join('\n');
  }
  // One notification per alert: re-fires of the same alert replace (and re-alert via renotify) the previous one.
  const tag = ev && (ev.alertId || ev.id) ? String(ev.alertId || ev.id) : payload.tag || 'tradeview-alert';
  const deep = ev && ev.symbol ? `/?symbol=${encodeURIComponent(ev.symbol)}&panel=alerts` : null;
  const url = payload.url || (data.url && data.url !== '/' ? data.url : null) || deep || '/';
  return {
    title,
    options: {
      body: body || '',
      tag,
      renotify: true,
      requireInteraction: true,
      vibrate: DEFAULT_VIBRATE,
      icon: payload.icon || '/icon.svg',
      badge: payload.badge || '/favicon.svg',
      timestamp: (ev && ev.t) || Date.now(),
      silent: false,
      data: { url, event: ev || null, alertId: ev ? ev.alertId : null },
      actions: [{ action: 'open', title: 'Open chart' }, { action: 'dismiss', title: 'Dismiss' }],
    },
  };
}

self.addEventListener('push', (event) => {
  const payload = parsePayload(event);
  const { title, options } = buildNotification(payload);
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  const n = event.notification;
  n.close();
  if (event.action === 'dismiss') return;
  const data = n.data || {};
  const target = new URL(data.url || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of all) {
      if (new URL(client.url).origin === self.location.origin) {
        client.postMessage({ type: 'push-click', data });
        if ('focus' in client) return client.focus();
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(target);
    return undefined;
  })());
});

self.addEventListener('pushsubscriptionchange', (event) => {
  // Re-subscribe with the same key and tell the server (best effort; the page also re-syncs on load).
  event.waitUntil((async () => {
    try {
      const old = event.oldSubscription;
      const key = old && old.options ? old.options.applicationServerKey : null;
      if (!key) return;
      const sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      const json = sub.toJSON();
      await fetch('/api/push/subscribe', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: json, ...json }),
      });
    } catch {
      /* ignore */
    }
  })());
});
