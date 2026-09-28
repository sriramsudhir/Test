// Login screen (§13.3). Shown when /api/auth/me or any /api call returns 401, or the WebSocket is refused.
// POST /api/auth/login { password } sets an httpOnly session cookie.
import { h, icon } from './util/dom.js';

const LOGO = `<svg width="44" height="44" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="14" fill="#2962ff"/><path d="M14 42l10-12 8 7 10-15 8 9" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/**
 * Check the session. Returns { authenticated, authEnabled, user? }.
 * A missing endpoint (404) or an unreachable server is treated as "no auth" so the app still loads offline.
 */
export async function checkSession() {
  try {
    const res = await fetch('/api/auth/me', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    if (res.status === 401) return { authenticated: false, authEnabled: true };
    if (!res.ok) return { authenticated: true, authEnabled: false };
    const data = await res.json().catch(() => ({}));
    return {
      authenticated: data.authenticated !== false,
      authEnabled: data.authEnabled ?? data.enabled ?? data.auth ?? true,
      user: data.user || data.name || null,
    };
  } catch {
    return { authenticated: true, authEnabled: false, offline: true };
  }
}

export async function logout() {
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  } catch { /* ignore */ }
}

let current = null;

/**
 * Show the login screen. Resolves once the user has logged in successfully.
 * Calling it while it is already visible returns the same promise.
 * @param {{ reason?: string }} [opts]
 */
export function showLogin(opts = {}) {
  if (current) return current.promise;
  let resolve;
  const promise = new Promise((r) => { resolve = r; });

  const pw = h('input.input.login-input', { type: 'password', name: 'password', autocomplete: 'current-password', placeholder: 'Password', required: true, autofocus: true });
  const show = h('button.login-eye', { type: 'button', title: 'Show password', 'aria-label': 'Show password' }, icon('eye', 18));
  show.addEventListener('click', () => {
    const vis = pw.type === 'password';
    pw.type = vis ? 'text' : 'password';
    show.replaceChildren(icon(vis ? 'eyeOff' : 'eye', 18));
    pw.focus();
  });
  const err = h('div.login-error', { role: 'alert' });
  const submit = h('button.btn.btn-primary.login-submit', { type: 'submit' }, 'Sign in');
  const form = h('form.login-form', { novalidate: true },
    h('label.login-label', { for: 'login-pw' }, 'Password'),
    h('div.login-field', pw, show),
    err,
    submit);
  pw.id = 'login-pw';

  const screen = h('div.login-screen', { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'login-title' },
    h('div.login-bg'),
    h('div.login-card',
      h('div.login-logo', { html: LOGO }),
      h('h1#login-title', 'TradeView'),
      h('p.login-sub', opts.reason || 'Sign in to your trading workspace'),
      form,
      h('div.login-foot', icon('spark', 12), 'Alerts keep running on the server while you are signed out.')));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = pw.value;
    if (!password) { err.textContent = 'Enter your password'; pw.focus(); return; }
    submit.disabled = true;
    submit.replaceChildren(h('span.spinner'), 'Signing in…');
    err.textContent = '';
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        screen.classList.add('closing');
        setTimeout(() => screen.remove(), 250);
        current = null;
        resolve(true);
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (res.status === 429) {
        const retry = Number(res.headers.get('retry-after')) || null;
        err.textContent = `Too many attempts. Try again ${retry ? `in ${retry}s` : 'in a minute'}.`;
      } else if (res.status === 401 || res.status === 403) {
        err.textContent = 'Wrong password.';
      } else {
        err.textContent = data.error || `Sign-in failed (HTTP ${res.status}).`;
      }
      form.classList.remove('shake');
      void form.offsetWidth;
      form.classList.add('shake');
      pw.select();
    } catch {
      err.textContent = 'Cannot reach the server. Check your connection and try again.';
    } finally {
      submit.disabled = false;
      submit.replaceChildren('Sign in');
    }
  });

  document.body.appendChild(screen);
  requestAnimationFrame(() => pw.focus());
  current = { promise };
  return promise;
}

export const isLoginVisible = () => !!current;
