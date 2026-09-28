import { el } from '../chart/util.js';

let openMenu = null;

/** Close the currently open dropdown, if any. */
export function closeMenu() {
  if (!openMenu) return;
  const m = openMenu;
  openMenu = null;
  m.el.remove();
  m.anchor.classList.remove('tv-open');
  document.removeEventListener('mousedown', m.onDoc, true);
  document.removeEventListener('keydown', m.onKey, true);
  window.removeEventListener('resize', m.onResize);
  m.onClose?.();
}

/**
 * Open a dropdown under `anchor`. `build(menuEl, close)` fills the menu.
 * opts: { align: 'left'|'right', side: 'bottom'|'right', className, onClose }
 */
export function showMenu(anchor, build, opts = {}) {
  if (openMenu && openMenu.anchor === anchor) {
    closeMenu();
    return null;
  }
  closeMenu();
  const menu = el('div', { class: `tv-menu ${opts.className || ''}` });
  build(menu, closeMenu);
  document.body.append(menu);
  const place = () => {
    const r = anchor.getBoundingClientRect();
    const mw = menu.offsetWidth;
    const mh = menu.offsetHeight;
    let left;
    let top;
    if (opts.side === 'right') {
      left = r.right + 4;
      top = r.top;
    } else {
      left = opts.align === 'right' ? r.right - mw : r.left;
      top = r.bottom + 4;
    }
    left = Math.max(4, Math.min(left, window.innerWidth - mw - 4));
    top = Math.max(4, Math.min(top, window.innerHeight - mh - 4));
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  };
  place();
  anchor.classList.add('tv-open');
  const onDoc = (e) => {
    if (!menu.contains(e.target) && !anchor.contains(e.target)) closeMenu();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') closeMenu();
  };
  const onResize = () => closeMenu();
  document.addEventListener('mousedown', onDoc, true);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', onResize);
  openMenu = { el: menu, anchor, onDoc, onKey, onResize, onClose: opts.onClose };
  return menu;
}

export function menuItem({ icon, label, hint, active, onclick, right }) {
  const item = el('div', { class: `tv-menu-item${active ? ' tv-active' : ''}`, role: 'menuitem' });
  if (icon) item.append(el('span', { class: 'tv-menu-icon', html: icon }));
  item.append(el('span', { class: 'tv-menu-label', text: label }));
  if (hint) item.append(el('span', { class: 'tv-menu-hint', text: hint }));
  if (right) item.append(right);
  if (onclick) item.addEventListener('click', onclick);
  return item;
}

export function menuHeader(text) {
  return el('div', { class: 'tv-menu-header', text });
}

export function menuSep() {
  return el('div', { class: 'tv-menu-sep' });
}
