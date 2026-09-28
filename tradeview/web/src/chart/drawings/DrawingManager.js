import { DrawingPrimitive } from './DrawingPrimitive.js';
import { getTool, normalizeTool, toolHandles, toolDrag } from './tools.js';
import { apiRequest } from '../apiHelpers.js';
import { DRAWING_COLORS } from '../theme.js';
import { uid, toMs, el, unwrapList } from '../util.js';
import { isSecondsTf } from '../timeframes.js';

const HANDLE_R = 8;
const clone = (o) => JSON.parse(JSON.stringify(o));

/**
 * Owns all drawings of one ChartView: creation state machine, selection, handle/body dragging, keyboard,
 * floating properties toolbar, inline text editing and persistence through /api/drawings.
 */
export class DrawingManager {
  /** @param {import('../ChartView.js').ChartView} view */
  constructor(view) {
    this.view = view;
    /** @type {Map<string, DrawingPrimitive>} */
    this.items = new Map();
    this.tool = null;
    this.draft = null;
    this.selectedId = null;
    this.hoverId = null;
    this.activeHandle = null;
    this.magnet = false;
    this.hiddenAll = false;
    this.lockedAll = false;
    this._drag = null;
    this._focused = false;
    this._series = null;
    this._saveTimers = new Map();
    this._loadToken = 0;

    this._onDown = this._onDown.bind(this);
    this._onMove = this._onMove.bind(this);
    this._onUp = this._onUp.bind(this);
    this._onHover = this._onHover.bind(this);
    this._onKey = this._onKey.bind(this);
    this._onDocDown = this._onDocDown.bind(this);
    this._onDbl = this._onDbl.bind(this);
    this._onTouchStart = this._onTouchStart.bind(this);

    const host = view.canvasHost;
    host.addEventListener('mousedown', this._onDown, true);
    host.addEventListener('touchstart', this._onTouchStart, { capture: true, passive: false });
    host.addEventListener('mousemove', this._onHover);
    host.addEventListener('dblclick', this._onDbl, true);
    window.addEventListener('mousemove', this._onMove);
    window.addEventListener('mouseup', this._onUp);
    document.addEventListener('keydown', this._onKey);
    document.addEventListener('mousedown', this._onDocDown, true);

    this._buildPropsBar();
  }

  destroy() {
    const host = this.view.canvasHost;
    host.removeEventListener('mousedown', this._onDown, true);
    host.removeEventListener('touchstart', this._onTouchStart, true);
    host.removeEventListener('mousemove', this._onHover);
    host.removeEventListener('dblclick', this._onDbl, true);
    window.removeEventListener('mousemove', this._onMove);
    window.removeEventListener('mouseup', this._onUp);
    document.removeEventListener('keydown', this._onKey);
    document.removeEventListener('mousedown', this._onDocDown, true);
    for (const t of this._saveTimers.values()) clearTimeout(t.h);
    this.detach();
    this.items.clear();
    this._props?.remove();
    this._editor?.remove();
  }

  // ---------------------------------------------------------------- coordinate helpers (used by primitives)
  get secondsTf() {
    return isSecondsTf(this.view.tf);
  }
  timeToX(t) {
    return this.view.timeToX(t);
  }
  priceToY(p) {
    return this._series ? this._series.priceToCoordinate(p) : null;
  }
  formatPrice(p) {
    return this.view.formatPrice(p);
  }

  /** Build the render/hit-test context for a model. */
  renderContext(model, size, ctx = null) {
    const series = this._series;
    if (!series) return null;
    const pts = [];
    for (const p of model.points) {
      const x = this.view.timeToX(p.t);
      const y = series.priceToCoordinate(p.price);
      if (x == null || y == null) return null;
      pts.push({ x, y });
    }
    if (!pts.length) return null;
    const v = this.view;
    const last = v.lastBar;
    const lastX = last ? v.timeToX(last.t) : null;
    const entryT = model.points[0]?.t;
    return {
      ctx,
      w: size.width,
      h: size.height,
      pts,
      model,
      style: model.style || {},
      selected: this.selectedId === model.id,
      hovered: this.hoverId === model.id,
      creating: this.draft?.model === model,
      p2y: (p) => series.priceToCoordinate(p),
      y2p: (y) => series.coordinateToPrice(y),
      t2x: (t) => v.timeToX(t),
      x2t: (x) => v.xToTime(x),
      fmtPrice: (p) => v.formatPrice(p),
      tick: v.tickSize,
      tfMs: v.tfMs,
      barsBetween: (a, b) => v.barsBetween(a, b),
      volumeBetween: (a, b) => v.volumeBetween(a, b),
      lastPrice: last ? last.c : null,
      path: last && lastX != null && entryT != null && last.t > entryT ? [{ x: lastX }] : null,
    };
  }

  hitTestModel(model, x, y) {
    const tool = getTool(model.tool);
    if (!tool) return null;
    const r = this.renderContext(model, this._paneSize());
    if (!r) return null;
    if (this.selectedId === model.id) {
      for (const h of toolHandles(tool, r)) {
        if (Math.hypot(h.x - x, h.y - y) <= HANDLE_R) return { handle: h.key };
      }
    }
    return tool.hit(r, x, y) ? { handle: null } : null;
  }

  _paneSize() {
    try {
      return this.view.chart.paneSize(0);
    } catch {
      return { width: 800, height: 400 };
    }
  }

  // ---------------------------------------------------------------- series attachment
  attach(series) {
    this.detach();
    this._series = series;
    for (const prim of this.items.values()) series.attachPrimitive(prim);
    if (this.draft && !this.items.has(this.draft.model.id)) series.attachPrimitive(this.draft.prim);
  }

  detach() {
    if (!this._series) return;
    for (const prim of this.items.values()) {
      try {
        this._series.detachPrimitive(prim);
      } catch { /* series already removed */ }
    }
    if (this.draft) {
      try {
        this._series.detachPrimitive(this.draft.prim);
      } catch { /* ignore */ }
    }
    this._series = null;
  }

  _requestAll() {
    for (const p of this.items.values()) p.requestUpdate();
    this.draft?.prim.requestUpdate();
  }

  // ---------------------------------------------------------------- public API
  setTool(tool) {
    const id = tool ? normalizeTool(tool) : null;
    if (tool && !id && tool !== 'cursor') throw new Error(`Unknown drawing tool: ${tool}`);
    this._cancelDraft();
    this.tool = id;
    this.view.canvasHost.classList.toggle('tv-drawing-mode', !!id);
    if (id) this.select(null);
    this.view.emit('tool', id);
  }

  list() {
    return [...this.items.values()].map((p) => clone(p.model));
  }

  get(id) {
    const p = this.items.get(id);
    return p ? p.model : null;
  }

  /** Add a drawing from a model or agent spec. Returns id. */
  add(input, { persist = true, select = false } = {}) {
    const model = this._normalize(input);
    if (!model) throw new Error('Invalid drawing spec');
    if (this.items.has(model.id)) this.remove(model.id, { persist: false });
    const prim = new DrawingPrimitive(this, model);
    this.items.set(model.id, prim);
    this._series?.attachPrimitive(prim);
    if (select) this.select(model.id);
    if (persist) this._save(model);
    this.view.emit('drawing', { type: 'create', drawing: clone(model) });
    return model.id;
  }

  update(id, patch = {}, { persist = true } = {}) {
    const prim = this.items.get(id);
    if (!prim) return false;
    const m = prim.model;
    if (patch.style) m.style = { ...m.style, ...patch.style };
    if (patch.points) m.points = patch.points.map((p) => ({ t: toMs(p.t ?? p.time), price: +p.price }));
    for (const k of ['locked', 'hidden', 'name']) if (k in patch) m[k] = patch[k];
    prim.requestUpdate();
    if (persist) this._save(m);
    this.view.emit('drawing', { type: 'update', drawing: clone(m) });
    if (id === this.selectedId) this._updateProps();
    return true;
  }

  remove(id, { persist = true } = {}) {
    const prim = this.items.get(id);
    if (!prim) return false;
    try {
      this._series?.detachPrimitive(prim);
    } catch { /* ignore */ }
    this.items.delete(id);
    if (this.selectedId === id) this.select(null);
    if (persist) {
      const pending = this._saveTimers.get(id);
      if (pending) clearTimeout(pending.h);
      this._saveTimers.delete(id);
      apiRequest(this.view.api, 'delete', `/api/drawings/${encodeURIComponent(id)}`).catch((e) => console.warn('[drawings] delete failed', e.message));
    }
    this.view.emit('drawing', { type: 'remove', id });
    return true;
  }

  clear({ persist = true } = {}) {
    for (const id of [...this.items.keys()]) this.remove(id, { persist });
  }

  select(id) {
    if (this.selectedId === id) return;
    this.selectedId = id && this.items.has(id) ? id : null;
    this.activeHandle = null;
    this._requestAll();
    this._updateProps();
    this.view.emit('drawing', { type: 'select', id: this.selectedId });
  }

  setMagnet(on) {
    this.magnet = !!on;
  }

  lockAll(on = !this.lockedAll) {
    this.lockedAll = !!on;
    for (const p of this.items.values()) {
      p.model.locked = this.lockedAll;
      this._save(p.model);
    }
    this._requestAll();
    this._updateProps();
    return this.lockedAll;
  }

  hideAll(on = !this.hiddenAll) {
    this.hiddenAll = !!on;
    if (this.hiddenAll) this.select(null);
    this._requestAll();
    return this.hiddenAll;
  }

  /** Load persisted drawings for a symbol (replaces the current set without deleting on the server). */
  async load(symbol) {
    const token = ++this._loadToken;
    this._cancelDraft();
    this.clear({ persist: false });
    let rows = [];
    try {
      rows = unwrapList(await apiRequest(this.view.api, 'get', '/api/drawings', { symbol }), 'drawings');
    } catch (e) {
      console.warn('[drawings] load failed', e.message);
      return;
    }
    if (token !== this._loadToken) return;
    for (const row of rows) {
      let m = row;
      try {
        if (typeof row.json === 'string') m = { id: row.id, ...JSON.parse(row.json) };
        else if (row.json && typeof row.json === 'object') m = { id: row.id, ...row.json };
      } catch {
        continue;
      }
      if (m.symbol && m.symbol !== symbol) continue;
      try {
        this.add(m, { persist: false });
      } catch { /* skip invalid rows */ }
    }
  }

  // ---------------------------------------------------------------- spec normalisation
  _normalize(input) {
    const spec = input || {};
    const toolId = normalizeTool(spec.tool || spec.type || spec.shape || spec.kind);
    const tool = getTool(toolId);
    if (!tool) throw new Error(`Unknown drawing type: ${spec.tool || spec.type || spec.shape}`);
    const v = this.view;
    const last = v.lastBar;
    const defT = last ? last.t : Date.now();
    let points = (spec.points || []).map((p) => ({ t: toMs(p.t ?? p.time) ?? defT, price: +(p.price ?? p.value ?? p.p) }));
    if (!points.length && spec.price != null) points = [{ t: toMs(spec.t ?? spec.time) ?? defT, price: +spec.price }];
    if (!points.length && spec.t != null && toolId === 'vertical_line') points = [{ t: toMs(spec.t), price: last ? last.c : 0 }];
    const style = { ...tool.defaults, ...(spec.style || {}) };
    for (const k of ['color', 'width', 'lineStyle', 'text', 'fontSize', 'fill', 'extendLeft', 'extendRight', 'qty']) {
      if (spec[k] != null) style[k] = spec[k];
    }
    if (spec.label && !style.text) style.text = spec.label;

    if (toolId === 'long_position' || toolId === 'short_position') {
      const long = toolId === 'long_position';
      const entry = spec.entry != null ? { t: toMs(spec.t ?? spec.time) ?? points[0]?.t ?? defT, price: +spec.entry } : points[0];
      if (!entry || !Number.isFinite(entry.price)) throw new Error('Position needs an entry price');
      let tp = spec.target ?? spec.tp ?? spec.takeProfit;
      let sl = spec.stop ?? spec.sl ?? spec.stopLoss;
      const extra = points.slice(entry === points[0] ? 1 : 0).map((p) => p.price);
      for (const pr of extra) {
        const profitSide = long ? pr > entry.price : pr < entry.price;
        if (profitSide && tp == null) tp = pr;
        else if (!profitSide && sl == null) sl = pr;
      }
      const span = entry.price * 0.01;
      tp = tp != null ? +tp : long ? entry.price + 2 * span : entry.price - 2 * span;
      sl = sl != null ? +sl : long ? entry.price - span : entry.price + span;
      let right = Math.max(...points.map((p) => p.t));
      if (!(right > entry.t)) right = entry.t + v.tfMs * 30;
      points = [entry, { t: right, price: tp }, { t: right, price: sl }];
    } else if (tool.clicks >= 1 && points.length < Math.max(1, tool.clicks) && toolId !== 'parallel_channel') {
      if (!points.length) throw new Error(`${tool.label} needs ${tool.clicks} point(s)`);
      if (tool.clicks === 2 && points.length === 1) points.push({ t: points[0].t + v.tfMs * 20, price: points[0].price });
      if (tool.clicks === 3) while (points.length < 3) points.push({ ...points[points.length - 1], t: points[points.length - 1].t + v.tfMs * 10 });
    }
    if (toolId === 'parallel_channel' && points.length === 2) {
      const off = Math.abs(points[1].price - points[0].price) * 0.3 || points[0].price * 0.01;
      points.push({ t: points[0].t, price: points[0].price + off });
    }
    if (points.some((p) => !Number.isFinite(p.t) || !Number.isFinite(p.price))) throw new Error('Drawing points need numeric t and price');
    return {
      id: spec.id || uid('drw'),
      symbol: spec.symbol || v.symbol,
      tool: toolId,
      points,
      style,
      locked: !!spec.locked,
      hidden: !!spec.hidden,
      createdBy: spec.createdBy || 'user',
      created: spec.created || Date.now(),
    };
  }

  // ---------------------------------------------------------------- persistence
  _save(model) {
    const prev = this._saveTimers.get(model.id);
    if (prev) clearTimeout(prev.h);
    const h = setTimeout(() => {
      this._saveTimers.delete(model.id);
      if (!this.items.has(model.id)) return;
      const body = { ...clone(model), symbol: model.symbol || this.view.symbol };
      apiRequest(this.view.api, 'put', `/api/drawings/${encodeURIComponent(model.id)}`, body).catch((e) =>
        console.warn('[drawings] save failed', e.message),
      );
    }, 350);
    this._saveTimers.set(model.id, { h });
  }

  // ---------------------------------------------------------------- pointer handling
  _local(e) {
    const chartEl = this.view.chart.chartElement();
    const rect = chartEl.getBoundingClientRect();
    const size = this._paneSize();
    let leftW = 0;
    try {
      leftW = this.view.chart.priceScale('left').width();
    } catch { /* no left scale */ }
    const x = e.clientX - rect.left - leftW;
    const y = e.clientY - rect.top;
    return { x, y, inPane: x >= 0 && y >= 0 && x <= size.width && y <= size.height };
  }

  _ptFromLocal(p, { magnet = this.magnet, snapTime = true } = {}) {
    const v = this.view;
    const t = v.xToTime(p.x, snapTime);
    let price = this._series ? this._series.coordinateToPrice(p.y) : null;
    if (price == null) price = v.lastBar ? v.lastBar.c : 0;
    if (magnet) price = v.snapPrice(t, price);
    return { t, price: +price };
  }

  _hitAny(p) {
    const arr = [...this.items.values()].reverse();
    // the selected drawing wins ties
    if (this.selectedId) arr.sort((a, b) => (b.model.id === this.selectedId) - (a.model.id === this.selectedId));
    for (const prim of arr) {
      if (prim.model.hidden || this.hiddenAll) continue;
      const h = this.hitTestModel(prim.model, p.x, p.y);
      if (h) return { prim, handle: h.handle };
    }
    return null;
  }

  _onTouchStart(e) {
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    const fake = { button: 0, clientX: t.clientX, clientY: t.clientY, shiftKey: false, altKey: false, stopPropagation: () => e.stopPropagation(), preventDefault: () => e.preventDefault(), touch: true };
    this._onDown(fake);
    if (this._drag || this.draft) {
      const move = (ev) => {
        const tt = ev.touches[0];
        if (tt) this._onMove({ clientX: tt.clientX, clientY: tt.clientY, buttons: 1 });
        ev.preventDefault();
      };
      const end = (ev) => {
        const tt = ev.changedTouches[0];
        this._onUp({ clientX: tt.clientX, clientY: tt.clientY });
        window.removeEventListener('touchmove', move);
        window.removeEventListener('touchend', end);
      };
      window.addEventListener('touchmove', move, { passive: false });
      window.addEventListener('touchend', end);
    }
  }

  _onDocDown(e) {
    const inside = this.view.root.contains(e.target);
    this._focused = inside;
    if (!inside && this._editor && !this._editor.contains(e.target)) this._commitEditor();
  }

  _onDown(e) {
    if (e.button !== 0) return;
    if (this._editor && e.target === this._editor) return;
    if (this.view.replay?.selecting) return;
    const p = this._local(e);
    if (!p.inPane) return;
    this._focused = true;

    if (this.tool) {
      e.stopPropagation();
      e.preventDefault();
      this._toolDown(p);
      return;
    }
    if (this.hiddenAll) return;
    const hit = this._hitAny(p);
    if (hit) {
      e.stopPropagation();
      e.preventDefault();
      const m = hit.prim.model;
      this.select(m.id);
      if (m.locked) return;
      this._drag = {
        prim: hit.prim,
        handle: hit.handle,
        start: p,
        orig: clone(m.points),
        moved: false,
      };
      this.activeHandle = hit.handle;
      this.view.setInteractive(false);
      return;
    }
    if (this.selectedId) this.select(null);
  }

  _toolDown(p) {
    const tool = getTool(this.tool);
    const pt = this._ptFromLocal(p, { snapTime: tool.clicks !== 0 });
    if (!this.draft) {
      const model = this._normalizeDraft(tool, pt);
      if (tool.clicks === 1) {
        if (tool.init) {
          const r = this.renderContext({ ...model, points: [pt] }, this._paneSize());
          tool.init(model, pt, r || this._fallbackR());
        }
        this.add(model, { select: true });
        this._afterCreate(model);
        return;
      }
      const prim = new DrawingPrimitive(this, model);
      model.points = tool.clicks === 0 ? [pt] : [pt, { ...pt }];
      this.draft = { model, prim, tool, index: 1, down: p, pressed: true, moved: false };
      this._series?.attachPrimitive(prim);
      this._requestAll();
      return;
    }
    this._fixPoint(pt);
  }

  _fallbackR() {
    const v = this.view;
    return { w: 800, h: 400, y2p: () => 0, t2x: (t) => v.timeToX(t) ?? 0, x2t: (x) => v.xToTime(x) };
  }

  _normalizeDraft(tool, pt) {
    return {
      id: uid('drw'),
      symbol: this.view.symbol,
      tool: tool.id,
      points: [pt],
      style: { ...tool.defaults },
      locked: false,
      hidden: false,
      createdBy: 'user',
      created: Date.now(),
    };
  }

  _fixPoint(pt) {
    const d = this.draft;
    if (!d) return;
    d.model.points[d.index] = pt;
    if (d.index + 1 >= d.tool.clicks) this._finishDraft();
    else {
      d.index++;
      d.model.points.push({ ...pt });
      d.prim.requestUpdate();
    }
  }

  _finishDraft() {
    const d = this.draft;
    if (!d) return;
    this.draft = null;
    try {
      this._series?.detachPrimitive(d.prim);
    } catch { /* ignore */ }
    if (d.tool.clicks === 0 && d.model.points.length < 2) return this.setTool(null);
    this.add(d.model, { select: true });
    this._afterCreate(d.model);
  }

  _afterCreate(model) {
    this.setTool(null);
    if (getTool(model.tool)?.editable) setTimeout(() => this._editText(model.id, true), 0);
  }

  _cancelDraft() {
    if (!this.draft) return;
    try {
      this._series?.detachPrimitive(this.draft.prim);
    } catch { /* ignore */ }
    this.draft = null;
  }

  _onHover(e) {
    if (this._drag || this.draft || this.tool) return;
    const p = this._local(e);
    let id = null;
    if (p.inPane && !this.hiddenAll) {
      const hit = this._hitAny(p);
      id = hit ? hit.prim.model.id : null;
    }
    if (id !== this.hoverId) {
      this.hoverId = id;
      this._requestAll();
    }
  }

  _onMove(e) {
    if (this.draft) {
      const p = this._local(e);
      const d = this.draft;
      if (Math.hypot(p.x - d.down.x, p.y - d.down.y) > 4) d.moved = true;
      const pt = this._ptFromLocal(p, { snapTime: d.tool.clicks !== 0 });
      if (d.tool.clicks === 0) {
        if (e.buttons === 0 && !e.touches) return;
        const lastPt = d.model.points[d.model.points.length - 1];
        const lx = this.view.timeToX(lastPt.t);
        const ly = this.priceToY(lastPt.price);
        if (lx == null || ly == null || Math.hypot(p.x - lx, p.y - ly) >= 3) d.model.points.push({ t: this.view.xToTime(p.x, false), price: pt.price });
      } else {
        d.model.points[d.index] = pt;
      }
      d.prim.requestUpdate();
      return;
    }
    const drag = this._drag;
    if (!drag) return;
    const p = this._local(e);
    if (!drag.moved && Math.hypot(p.x - drag.start.x, p.y - drag.start.y) < 2) return;
    drag.moved = true;
    const m = drag.prim.model;
    const tool = getTool(m.tool);
    if (drag.handle != null) {
      const pt = this._ptFromLocal(p);
      m.points = clone(drag.orig);
      const r = this.renderContext(m, this._paneSize());
      toolDrag(tool, m, drag.handle, pt, r);
    } else {
      const dx = p.x - drag.start.x;
      const dy = p.y - drag.start.y;
      const snap = m.tool !== 'brush';
      m.points = drag.orig.map((o) => {
        const x0 = this.view.timeToX(o.t);
        const y0 = this.priceToY(o.price);
        const t = x0 == null ? o.t : this.view.xToTime(x0 + dx, snap);
        const price = y0 == null ? o.price : this._series.coordinateToPrice(y0 + dy) ?? o.price;
        return { t, price: +price };
      });
    }
    drag.prim.requestUpdate();
  }

  _onUp(e) {
    const d = this.draft;
    if (d && d.pressed) {
      d.pressed = false;
      if (d.tool.clicks === 0) return this._finishDraft();
      if (d.moved && d.index === 1) {
        const pt = this._ptFromLocal(this._local(e));
        this._fixPoint(pt);
      }
      return;
    }
    const drag = this._drag;
    if (!drag) return;
    this._drag = null;
    this.activeHandle = null;
    this.view.setInteractive(true);
    if (drag.moved) {
      this._save(drag.prim.model);
      this.view.emit('drawing', { type: 'update', drawing: clone(drag.prim.model) });
    }
    drag.prim.requestUpdate();
  }

  _onDbl(e) {
    const p = this._local(e);
    if (!p.inPane) return;
    const hit = this._hitAny(p);
    if (hit && getTool(hit.prim.model.tool)?.editable && !hit.prim.model.locked) {
      e.stopPropagation();
      e.preventDefault();
      this._editText(hit.prim.model.id);
    }
  }

  _onKey(e) {
    if (!this._focused) return;
    const tag = (e.target && e.target.tagName) || '';
    if (/INPUT|TEXTAREA|SELECT/.test(tag) || e.target?.isContentEditable) return;
    if (e.key === 'Escape') {
      if (this.draft || this.tool) this.setTool(null);
      else this.select(null);
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.selectedId) {
      e.preventDefault();
      this.remove(this.selectedId);
    }
  }

  // ---------------------------------------------------------------- inline text editing
  _editText(id, isNew = false) {
    const prim = this.items.get(id);
    if (!prim) return;
    this._commitEditor();
    const m = prim.model;
    const x = this.view.timeToX(m.points[0].t);
    const y = this.priceToY(m.points[0].price);
    if (x == null || y == null) return;
    const chartRect = this.view.chart.chartElement().getBoundingClientRect();
    const hostRect = this.view.canvasHost.getBoundingClientRect();
    const ta = el('textarea', {
      class: 'tv-text-editor',
      spellcheck: 'false',
      style: {
        left: `${x + chartRect.left - hostRect.left - 4}px`,
        top: `${y + chartRect.top - hostRect.top - 4}px`,
        fontSize: `${m.style.fontSize || 14}px`,
        color: m.style.color,
      },
    });
    ta.value = isNew && m.style.text === 'Text' ? '' : m.style.text || '';
    ta.placeholder = 'Text';
    const prevText = m.style.text;
    m.style.text = '';
    prim.requestUpdate();
    ta.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Enter' && !ev.shiftKey) {
        ev.preventDefault();
        this._commitEditor();
      } else if (ev.key === 'Escape') {
        ta.value = prevText;
        this._commitEditor();
      }
    });
    ta.addEventListener('blur', () => this._commitEditor());
    this._editor = ta;
    this._editorId = id;
    this._editorPrev = prevText;
    this.view.canvasHost.append(ta);
    ta.focus();
  }

  _commitEditor() {
    const ta = this._editor;
    if (!ta) return;
    this._editor = null;
    const id = this._editorId;
    const text = ta.value.trim();
    ta.remove();
    const prim = this.items.get(id);
    if (!prim) return;
    if (!text) {
      if (!this._editorPrev || this._editorPrev === 'Text') this.remove(id);
      else {
        prim.model.style.text = this._editorPrev;
        prim.requestUpdate();
      }
      return;
    }
    this.update(id, { style: { text } });
  }

  // ---------------------------------------------------------------- floating properties toolbar
  _buildPropsBar() {
    const bar = el('div', { class: 'tv-draw-props', hidden: true });
    const colorBtn = el('button', { class: 'tv-dp-btn tv-dp-color', title: 'Color' }, [el('span', { class: 'tv-dp-swatch' })]);
    const palette = el('div', { class: 'tv-dp-palette', hidden: true });
    for (const c of DRAWING_COLORS) {
      palette.append(
        el('button', {
          class: 'tv-dp-pcolor',
          style: { background: c },
          title: c,
          onclick: (ev) => {
            ev.stopPropagation();
            if (this.selectedId) this.update(this.selectedId, { style: { color: c } });
            palette.hidden = true;
          },
        }),
      );
    }
    colorBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      palette.hidden = !palette.hidden;
    });
    const widthBtn = el('button', { class: 'tv-dp-btn', title: 'Line width' });
    widthBtn.addEventListener('click', () => {
      const m = this.get(this.selectedId);
      if (!m) return;
      const w = ((m.style.width || 1) % 4) + 1;
      this.update(m.id, { style: { width: w } });
    });
    const styleBtn = el('button', { class: 'tv-dp-btn', title: 'Line style' });
    styleBtn.addEventListener('click', () => {
      const m = this.get(this.selectedId);
      if (!m) return;
      const order = ['solid', 'dashed', 'dotted'];
      const next = order[(order.indexOf(m.style.lineStyle || 'solid') + 1) % 3];
      this.update(m.id, { style: { lineStyle: next } });
    });
    const lockBtn = el('button', { class: 'tv-dp-btn', title: 'Lock / unlock' });
    lockBtn.addEventListener('click', () => {
      const m = this.get(this.selectedId);
      if (m) this.update(m.id, { locked: !m.locked });
    });
    const hideBtn = el('button', { class: 'tv-dp-btn', title: 'Hide', html: ICON_EYE_OFF });
    hideBtn.addEventListener('click', () => {
      const id = this.selectedId;
      if (!id) return;
      this.update(id, { hidden: true });
      this.select(null);
    });
    const delBtn = el('button', { class: 'tv-dp-btn tv-dp-del', title: 'Remove (Del)', html: ICON_TRASH });
    delBtn.addEventListener('click', () => this.selectedId && this.remove(this.selectedId));
    const name = el('span', { class: 'tv-dp-name' });
    bar.append(name, colorBtn, palette, widthBtn, styleBtn, lockBtn, hideBtn, delBtn);
    bar.addEventListener('mousedown', (e) => e.stopPropagation());
    this._props = bar;
    this._propsEls = { name, colorBtn, widthBtn, styleBtn, lockBtn, palette };
    this.view.canvasHost.append(bar);
  }

  _updateProps() {
    const bar = this._props;
    if (!bar) return;
    const m = this.get(this.selectedId);
    bar.hidden = !m;
    this._propsEls.palette.hidden = true;
    if (!m) return;
    const e = this._propsEls;
    e.name.textContent = getTool(m.tool)?.label || m.tool;
    e.colorBtn.querySelector('.tv-dp-swatch').style.background = m.style.color;
    e.widthBtn.innerHTML = `<svg width="22" height="16" viewBox="0 0 22 16"><line x1="2" y1="8" x2="20" y2="8" stroke="currentColor" stroke-width="${m.style.width || 1}"/></svg><span>${m.style.width || 1}px</span>`;
    const dash = m.style.lineStyle === 'dashed' ? '4 3' : m.style.lineStyle === 'dotted' ? '1.5 3' : '';
    e.styleBtn.innerHTML = `<svg width="22" height="16" viewBox="0 0 22 16"><line x1="2" y1="8" x2="20" y2="8" stroke="currentColor" stroke-width="2" stroke-dasharray="${dash}"/></svg>`;
    e.lockBtn.innerHTML = m.locked ? ICON_LOCK : ICON_UNLOCK;
    e.lockBtn.classList.toggle('tv-on', !!m.locked);
  }
}

const ICON_TRASH = '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M3 5h12M7 5V3.5h4V5M5 5l.8 10h6.4L13 5M7.5 8v4.5M10.5 8v4.5"/></svg>';
const ICON_LOCK = '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="4" y="8" width="10" height="7" rx="1"/><path d="M6 8V6a3 3 0 0 1 6 0v2"/></svg>';
const ICON_UNLOCK = '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="4" y="8" width="10" height="7" rx="1"/><path d="M6 8V6a3 3 0 0 1 5.8-1"/></svg>';
const ICON_EYE_OFF = '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M2 9s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z"/><circle cx="9" cy="9" r="2"/><path d="M3 15L15 3"/></svg>';
