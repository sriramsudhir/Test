// Web Push subscription helpers (§13.3): service worker registration, GET /api/push/vapid,
// pushManager.subscribe, POST/DELETE /api/push/subscribe. Handles iOS (needs home-screen install) and denied permission.

export function pushSupport() {
  const ua = navigator.userAgent || '';
  const iOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
  const hasSW = 'serviceWorker' in navigator;
  const hasPush = 'PushManager' in window;
  const hasNotif = 'Notification' in window;
  const secure = window.isSecureContext;
  let reason = null;
  if (!secure) reason = 'Push alerts need HTTPS (or localhost).';
  else if (iOS && !standalone) reason = 'On iPhone/iPad: tap Share → “Add to Home Screen”, open TradeView from the home screen, then enable push alerts there (iOS 16.4+).';
  else if (!hasSW || !hasPush || !hasNotif) reason = 'This browser does not support push notifications.';
  return { supported: !reason, reason, iOS, standalone, permission: hasNotif ? Notification.permission : 'unsupported' };
}

let registration = null;

/** Register /sw.js once (also used for the PWA). */
export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return null;
  if (registration) return registration;
  try {
    registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    return registration;
  } catch (err) {
    console.warn('[push] service worker registration failed', err);
    return null;
  }
}

function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function currentSubscription() {
  const reg = await registerServiceWorker();
  if (!reg || !reg.pushManager) return null;
  try { return await reg.pushManager.getSubscription(); } catch { return null; }
}

/**
 * Subscribe this device. Must be called from a user gesture (permission prompt).
 * @returns {Promise<{ ok: boolean, message: string }>}
 */
export async function enablePush(api) {
  const s = pushSupport();
  if (!s.supported) return { ok: false, message: s.reason };
  let perm = Notification.permission;
  if (perm === 'default') perm = await Notification.requestPermission();
  if (perm === 'denied') {
    return { ok: false, message: 'Notifications are blocked for this site. Allow them in the browser/site settings (lock icon in the address bar), then try again.' };
  }
  if (perm !== 'granted') return { ok: false, message: 'Notification permission was not granted.' };
  const reg = await registerServiceWorker();
  if (!reg) return { ok: false, message: 'Could not register the service worker.' };
  await navigator.serviceWorker.ready;
  let key;
  try {
    const res = await api.get('/api/push/vapid');
    key = res && (res.publicKey || res.key || res.vapidPublicKey);
  } catch (err) {
    return { ok: false, message: `Server push is unavailable: ${err.message}` };
  }
  if (!key) return { ok: false, message: 'The server did not provide a VAPID key.' };
  let sub = await reg.pushManager.getSubscription();
  // A subscription created with a different key cannot be reused.
  if (sub && sub.options && sub.options.applicationServerKey) {
    const existing = new Uint8Array(sub.options.applicationServerKey);
    const wanted = urlBase64ToUint8Array(key);
    if (existing.length !== wanted.length || existing.some((b, i) => b !== wanted[i])) {
      await sub.unsubscribe().catch(() => {});
      sub = null;
    }
  }
  if (!sub) {
    try {
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) });
    } catch (err) {
      return { ok: false, message: `Subscribing failed: ${err.message}` };
    }
  }
  try {
    await api.post('/api/push/subscribe', { subscription: sub.toJSON(), ...sub.toJSON(), userAgent: navigator.userAgent });
  } catch (err) {
    return { ok: false, message: `Could not register the device with the server: ${err.message}` };
  }
  return { ok: true, message: 'Push alerts enabled on this device.' };
}

export async function disablePush(api) {
  const sub = await currentSubscription();
  if (!sub) return { ok: true, message: 'Push alerts are off.' };
  try { await api.delete('/api/push/subscribe', undefined, { body: { endpoint: sub.endpoint } }); } catch { /* server may be down */ }
  await sub.unsubscribe().catch(() => {});
  return { ok: true, message: 'Push alerts disabled on this device.' };
}
