import { ICONS } from './icons.js';
import { showMenu, closeMenu, menuItem } from './menu.js';
import { TOOL_GROUPS, DRAWING_TOOLS } from '../chart/drawings/tools.js';
import { el } from '../chart/util.js';

const LAST_KEY = 'tv.drawingGroupLast';

function loadLast() {
  try {
    return JSON.parse(localStorage.getItem(LAST_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

/**
 * Left vertical drawing toolbar: cursor, grouped tool flyouts (remembering the last tool of each group),
 * magnet mode, lock all, hide all, remove all. Applies to the layout's active chart.
 */
export class DrawingToolbar {
  /** @param {HTMLElement} host  @param {import('./Layout.js').Layout} layout */
  constructor(host, layout) {
    this.layout = layout;
    this.last = { ...Object.fromEntries(TOOL_GROUPS.map((g) => [g.id, g.tools[0]])), ...loadLast() };
    this.magnet = false;
    this.root = el('div', { class: 'tv-drawbar' });
    host.append(this.root);
    this._chartOffs = [];
    this._build();
    this._offs = [layout.on('active', (c, prev) => this._bindActive(prev)), layout.on('charts', () => this._applyMagnet())];
    this._bindActive();
  }

  destroy() {
    for (const off of [...this._offs, ...this._chartOffs]) off();
    closeMenu();
    this.root.remove();
  }

  get chart() {
    return this.layout.active;
  }

  _build() {
    const r = this.root;
    this.cursorBtn = el('button', { class: 'tv-db-btn', title: 'Cross', html: ICONS.cursor, onclick: () => this.chart?.setDrawingTool(null) });
    r.append(this.cursorBtn, el('div', { class: 'tv-db-sep' }));
    this.groupBtns = new Map();
    for (const g of TOOL_GROUPS) {
      const main = el('button', { class: 'tv-db-btn', title: '' });
      const arrow = el('button', { class: 'tv-db-arrow', title: g.label, html: ICONS.flyout });
      const wrap = el('div', { class: 'tv-db-group' }, [main, arrow]);
      main.addEventListener('click', () => this._select(this.last[g.id]));
      arrow.addEventListener('click', (e) => {
        e.stopPropagation();
        this._flyout(g, wrap);
      });
      wrap.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this._flyout(g, wrap);
      });
      this.groupBtns.set(g.id, { main, wrap });
      r.append(wrap);
    }
    r.append(el('div', { class: 'tv-db-sep' }));
    this.magnetBtn = el('button', { class: 'tv-db-btn', title: 'Magnet mode snaps drawings to OHLC', html: ICONS.magnet, onclick: () => this.setMagnet(!this.magnet) });
    this.lockBtn = el('button', { class: 'tv-db-btn', title: 'Lock all drawings', html: ICONS.unlock, onclick: () => this._lockAll() });
    this.hideBtn = el('button', { class: 'tv-db-btn', title: 'Hide all drawings', html: ICONS.eye, onclick: () => this._hideAll() });
    this.removeBtn = el('button', { class: 'tv-db-btn tv-db-remove', title: 'Remove all drawings', html: ICONS.trash, onclick: () => this._removeAll() });
    r.append(this.magnetBtn, this.lockBtn, this.hideBtn, this.removeBtn);
    this._renderGroups();
  }

  _select(tool) {
    const c = this.chart;
    if (!c) return;
    c.setDrawingTool(c.drawingTool === tool ? null : tool);
  }

  _flyout(g, anchor) {
    showMenu(anchor, (m, close) => {
      m.classList.add('tv-menu-tools');
      for (const id of g.tools) {
        const t = DRAWING_TOOLS[id];
        m.append(
          menuItem({
            icon: ICONS[id],
            label: t.label,
            active: this.chart?.drawingTool === id,
            onclick: () => {
              close();
              this.last[g.id] = id;
              try {
                localStorage.setItem(LAST_KEY, JSON.stringify(this.last));
              } catch { /* ignore */ }
              this._renderGroups();
              this.chart?.setDrawingTool(id);
            },
          }),
        );
      }
    }, { side: 'right' });
  }

  _bindActive(prev) {
    for (const off of this._chartOffs) off();
    this._chartOffs = [];
    if (prev && prev !== this.chart && prev.drawingTool) prev.setDrawingTool(null);
    const c = this.chart;
    if (c) {
      this._chartOffs.push(c.on('tool', () => this._renderGroups()));
      this._chartOffs.push(c.on('drawing', () => this._renderState()));
      c.drawings.setMagnet(this.magnet);
    }
    this._renderGroups();
    this._renderState();
  }

  _renderGroups() {
    const active = this.chart?.drawingTool || null;
    this.cursorBtn.classList.toggle('tv-active', !active);
    for (const g of TOOL_GROUPS) {
      const { main, wrap } = this.groupBtns.get(g.id);
      const inGroup = g.tools.includes(active);
      if (inGroup) this.last[g.id] = active;
      const id = this.last[g.id];
      main.innerHTML = ICONS[id];
      main.title = DRAWING_TOOLS[id]?.label || '';
      wrap.classList.toggle('tv-active', inGroup);
    }
  }

  _renderState() {
    const d = this.chart?.drawings;
    if (!d) return;
    this.lockBtn.innerHTML = d.lockedAll ? ICONS.lock : ICONS.unlock;
    this.lockBtn.classList.toggle('tv-active', d.lockedAll);
    this.lockBtn.title = d.lockedAll ? 'Unlock all drawings' : 'Lock all drawings';
    this.hideBtn.innerHTML = d.hiddenAll ? ICONS.eye_off : ICONS.eye;
    this.hideBtn.classList.toggle('tv-active', d.hiddenAll);
    this.hideBtn.title = d.hiddenAll ? 'Show all drawings' : 'Hide all drawings';
    this.magnetBtn.classList.toggle('tv-active', this.magnet);
  }

  setMagnet(on) {
    this.magnet = !!on;
    this._applyMagnet();
    this._renderState();
  }

  _applyMagnet() {
    for (const c of this.layout.charts) c.drawings.setMagnet(this.magnet);
  }

  _lockAll() {
    this.chart?.drawings.lockAll();
    this._renderState();
  }

  _hideAll() {
    this.chart?.drawings.hideAll();
    this._renderState();
  }

  _removeAll() {
    const b = this.removeBtn;
    const c = this.chart;
    if (!c || !c.drawings.items.size) return;
    if (!b.classList.contains('tv-confirm')) {
      b.classList.add('tv-confirm');
      b.title = `Click again to remove ${c.drawings.items.size} drawing(s)`;
      clearTimeout(this._confirmT);
      this._confirmT = setTimeout(() => {
        b.classList.remove('tv-confirm');
        b.title = 'Remove all drawings';
      }, 2500);
      return;
    }
    clearTimeout(this._confirmT);
    b.classList.remove('tv-confirm');
    b.title = 'Remove all drawings';
    c.clearDrawings();
  }
}
