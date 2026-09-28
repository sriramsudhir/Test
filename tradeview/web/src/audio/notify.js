// Desktop notifications (Notification API) and tab-title flashing.

export function notificationsSupported() {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function notificationPermission() {
  return notificationsSupported() ? Notification.permission : 'unsupported';
}

/** Ask for permission (must be called from a user gesture in most browsers). */
export async function requestNotificationPermission() {
  if (!notificationsSupported()) return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

/**
 * Show a desktop notification if permitted. Clicking focuses the tab.
 * @returns {Notification|null}
 */
export function notify({ title, body = '', tag, requireInteraction = true, onClick } = {}) {
  if (!notificationsSupported() || Notification.permission !== 'granted') return null;
  try {
    const n = new Notification(title || 'TradeView alert', {
      body,
      tag,
      requireInteraction,
      renotify: !!tag,
      icon: '/favicon.svg',
      badge: '/favicon.svg',
    });
    n.onclick = () => {
      try { window.focus(); } catch { /* ignore */ }
      if (onClick) onClick();
      n.close();
    };
    return n;
  } catch {
    return null;
  }
}

let flashTimer = null;
let originalTitle = null;

/** Alternate the document title with `text` until stopFlash() is called. Returns stopFlash. */
export function flashTitle(text) {
  if (originalTitle == null) originalTitle = document.title;
  clearInterval(flashTimer);
  let on = false;
  flashTimer = setInterval(() => {
    on = !on;
    document.title = on ? `🔔 ${text}` : originalTitle;
  }, 800);
  document.title = `🔔 ${text}`;
  return stopFlash;
}

export function stopFlash() {
  clearInterval(flashTimer);
  flashTimer = null;
  if (originalTitle != null) document.title = originalTitle;
  originalTitle = null;
}

export const isFlashing = () => flashTimer != null;
