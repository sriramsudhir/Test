// Modal dialogs (stacked, Esc closes the topmost), toasts, confirm/prompt, popup menus.
import { h, icon } from './dom.js';

const stack = [];

function layer() {
  let el = document.getElementById('overlay-root');
  if (!el) {
    el = h('div#overlay-root');
    document.body.appendChild(el);
  }
  return el;
}

/**
 * Open a modal dialog.
 * @param {object} o
 * @param {string|Node} [o.title]
 * @param {Node|((body: HTMLElement, dlg: object) => void)} [o.content]
 * @param {Array<{label:string, kind?:'primary'|'danger'|'ghost', onClick?:(dlg)=>any, close?:boolean}>} [o.buttons]
 * @param {string} [o.className]
 * @param {boolean} [o.dismissible=true] Esc / backdrop click closes
 * @param {() => void} [o.onClose]
 * @returns {{ el: HTMLElement, body: HTMLElement, footer: HTMLElement, close: () => void, closed: boolean }}
 */
export function openDialog(o = {}) {
  const dismissible = o.dismissible !== false;
  const body = h('div.dialog-body');
  const footer = h('div.dialog-footer');
  const closeBtn = h('button.icon-btn.dialog-close', { type: 'button', title: 'Close (Esc)', 'aria-label': 'Close' }, icon('x'));
  const header = o.title != null
    ? h('div.dialog-header', h('div.dialog-title', o.title), dismissible ? closeBtn : null)
    : null;
  const box = h(`div.dialog${o.className ? '.' + o.className.split(' ').join('.') : ''}`, { role: 'dialog', 'aria-modal': 'true' }, header, body, footer);
  const backdrop = h('div.dialog-backdrop', box);
  const dlg = {
    el: box,
    body,
    footer,
    closed: false,
    dismissible,
    close() {
      if (dlg.closed) return;
      dlg.closed = true;
      const i = stack.indexOf(dlg);
      if (i !== -1) stack.splice(i, 1);
      backdrop.classList.add('closing');
      setTimeout(() => backdrop.remove(), 120);
      try { o.onClose && o.onClose(); } catch (err) { console.error(err); }
    },
  };
  closeBtn.addEventListener('click', () => dlg.close());
  if (dismissible) {
    backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) dlg.close(); });
  }
  if (typeof o.content === 'function') o.content(body, dlg);
  else if (o.content) body.appendChild(o.content);
  if (o.buttons && o.buttons.length) {
    for (const b of o.buttons) {
      const btn = h(`button.btn${b.kind ? '.btn-' + b.kind : ''}`, { type: 'button' }, b.label);
      btn.addEventListener('click', async () => {
        let r;
        if (b.onClick) {
          btn.disabled = true;
          try { r = await b.onClick(dlg); } finally { btn.disabled = false; }
        }
        if (r !== false && b.close !== false) dlg.close();
      });
      footer.appendChild(btn);
    }
  } else {
    footer.remove();
  }
  layer().appendChild(backdrop);
  stack.push(dlg);
  requestAnimationFrame(() => {
    const f = box.querySelector('[autofocus]') || box.querySelector('input:not([type=hidden]):not([disabled]), textarea, select');
    if (f) f.focus();
  });
  return dlg;
}

/** Close the topmost dismissible dialog. Returns true if one was closed. */
export function closeTopDialog() {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].dismissible) { stack[i].close(); return true; }
  }
  return false;
}

export const hasOpenDialog = () => stack.length > 0;

export function confirmDialog(message, { title = 'Confirm', okLabel = 'OK', danger = false } = {}) {
  return new Promise((resolve) => {
    let result = false;
    openDialog({
      title,
      className: 'dialog-sm',
      content: h('p.dialog-text', message),
      buttons: [
        { label: 'Cancel', kind: 'ghost' },
        { label: okLabel, kind: danger ? 'danger' : 'primary', onClick: () => { result = true; } },
      ],
      onClose: () => resolve(result),
    });
  });
}

export function promptDialog(message, { title = 'Input', value = '', okLabel = 'OK', placeholder = '' } = {}) {
  return new Promise((resolve) => {
    let result = null;
    const input = h('input.input', { type: 'text', value, placeholder, autofocus: true });
    const dlg = openDialog({
      title,
      className: 'dialog-sm',
      content: h('div.form', h('label.field', h('span', message), input)),
      buttons: [
        { label: 'Cancel', kind: 'ghost' },
        { label: okLabel, kind: 'primary', onClick: () => { result = input.value; } },
      ],
      onClose: () => resolve(result),
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { result = input.value; dlg.close(); }
    });
  });
}

// ---------------- toasts ----------------

function toastRoot() {
  let el = document.getElementById('toast-root');
  if (!el) {
    el = h('div#toast-root', { 'aria-live': 'polite' });
    document.body.appendChild(el);
  }
  return el;
}

/** toast('Saved', 'success'|'error'|'info'|'warn', ms) */
export function toast(message, kind = 'info', ms = 3500) {
  const ico = { success: 'check', error: 'warn', warn: 'warn', info: 'spark' }[kind] || 'spark';
  const el = h(`div.toast.toast-${kind}`, icon(ico, 16), h('span', message));
  toastRoot().appendChild(el);
  const close = () => { el.classList.add('closing'); setTimeout(() => el.remove(), 200); };
  el.addEventListener('click', close);
  setTimeout(close, ms);
  return close;
}

// ---------------- popup menus ----------------

let openMenu = null;

/**
 * Show a popup menu anchored to an element.
 * items: [{ label, onClick, icon?, danger?, disabled? } | { header: 'text' } | { separator: true }]
 */
export function popupMenu(anchor, items, { align = 'left' } = {}) {
  closeMenu();
  const menu = h('div.popup-menu', { role: 'menu' });
  for (const it of items) {
    if (it.separator) { menu.appendChild(h('div.menu-sep')); continue; }
    if (it.header) { menu.appendChild(h('div.menu-header', it.header)); continue; }
    const row = h(`button.menu-item${it.danger ? '.danger' : ''}`, { type: 'button', disabled: !!it.disabled, role: 'menuitem' },
      it.icon ? icon(it.icon, 16) : null, h('span', it.label), it.hint ? h('span.menu-hint', it.hint) : null);
    row.addEventListener('click', () => { closeMenu(); it.onClick && it.onClick(); });
    menu.appendChild(row);
  }
  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect();
  const mw = menu.offsetWidth;
  const mh = menu.offsetHeight;
  let left = align === 'right' ? r.right - mw : r.left;
  let top = r.bottom + 4;
  if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 4);
  left = Math.max(8, Math.min(left, window.innerWidth - mw - 8));
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  const onDoc = (e) => { if (!menu.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) closeMenu(); };
  setTimeout(() => document.addEventListener('mousedown', onDoc), 0);
  openMenu = { menu, onDoc };
  return menu;
}

export function closeMenu() {
  if (!openMenu) return false;
  document.removeEventListener('mousedown', openMenu.onDoc);
  openMenu.menu.remove();
  openMenu = null;
  return true;
}
