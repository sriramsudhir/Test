import { THEME } from './theme.js';

/**
 * Dashed alert lines with a bell label, rendered as a series primitive. Lines can be dragged vertically;
 * on release the ChartView emits 'alertmove' { id, alert, key:'value'|'value2', price } so the alerts panel
 * can PATCH /api/alerts/:id.
 */

const COLOR = '#ff9800';
const PAUSED = '#787b86';
const EMPTY = Object.freeze([]);

const BELL_PATH = 'M6 1.2c-2 0-3.3 1.5-3.3 3.4v2.3L1.6 8.6h8.8L9.3 6.9V4.6C9.3 2.7 8 1.2 6 1.2zM4.7 9.6a1.3 1.3 0 0 0 2.6 0z';
let _bell = null;
const bell = () => (_bell ||= new Path2D(BELL_PATH)); // created lazily: no canvas APIs at import time

class AxisLabel {
  constructor(y, text, color) {
    this._y = y;
    this._t = text;
    this._c = color;
  }
  coordinate() {
    return this._y;
  }
  text() {
    return this._t;
  }
  textColor() {
    return '#131722';
  }
  backColor() {
    return this._c;
  }
  visible() {
    return true;
  }
}

class Renderer {
  constructor(p) {
    this._p = p;
  }
  draw(target) {
    const p = this._p;
    if (!p._series || !p.lines.size) return;
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      ctx.save();
      for (const ln of p.lines.values()) {
        for (const lv of ln.levels) {
          const price = p._dragging && p._dragging.id === ln.id && p._dragging.key === lv.key ? p._dragging.price : lv.price;
          const y = p._series.priceToCoordinate(price);
          if (y == null) continue;
          const yy = Math.round(y) + 0.5;
          const color = ln.paused ? PAUSED : COLOR;
          ctx.strokeStyle = color;
          ctx.lineWidth = p._hover === `${ln.id}:${lv.key}` ? 2 : 1;
          ctx.setLineDash([5, 4]);
          ctx.beginPath();
          ctx.moveTo(0, yy);
          ctx.lineTo(mediaSize.width, yy);
          ctx.stroke();
          ctx.setLineDash([]);
          // bell label at the right edge
          ctx.font = `11px ${THEME.font}`;
          const text = ln.label || 'Alert';
          const tw = Math.min(ctx.measureText(text).width, 160);
          const bw = tw + 26;
          const bx = mediaSize.width - bw - 6;
          const by = yy - 9;
          ctx.fillStyle = color;
          ctx.beginPath();
          if (ctx.roundRect) ctx.roundRect(bx, by, bw, 18, 3);
          else ctx.rect(bx, by, bw, 18);
          ctx.fill();
          ctx.save();
          ctx.translate(bx + 5, by + 3);
          ctx.fillStyle = '#131722';
          ctx.fill(bell());
          ctx.restore();
          ctx.fillStyle = '#131722';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(text, bx + 20, yy + 0.5, 160);
        }
      }
      ctx.restore();
    });
  }
}

class View {
  constructor(p) {
    this._r = new Renderer(p);
  }
  zOrder() {
    return 'top';
  }
  renderer() {
    return this._r;
  }
}

export class AlertLinesPrimitive {
  constructor(formatPrice) {
    this.lines = new Map();
    this._fmt = formatPrice;
    this._views = [new View(this)];
    this._axis = EMPTY;
    this._series = null;
    this._req = null;
    this._dragging = null;
    this._hover = null;
  }

  attached({ series, requestUpdate }) {
    this._series = series;
    this._req = requestUpdate;
  }
  detached() {
    this._series = null;
    this._req = null;
  }
  requestUpdate() {
    this._req?.();
  }

  /** Accepts an Alert (§6) or { id, price, name }. Returns false when the alert has no price level. */
  set(alert) {
    const levels = [];
    const c = alert.condition || {};
    if (alert.price != null) levels.push({ key: 'value', price: +alert.price });
    else if (c.kind === 'price' || (c.kind == null && c.value != null)) {
      if (c.value != null) levels.push({ key: 'value', price: +c.value });
      if (c.value2 != null) levels.push({ key: 'value2', price: +c.value2 });
    }
    if (!levels.length || !alert.id) return false;
    this.lines.set(alert.id, {
      id: alert.id,
      alert,
      levels,
      label: alert.name || alert.message || 'Alert',
      paused: alert.status && alert.status !== 'active',
    });
    this.requestUpdate();
    return true;
  }

  remove(id) {
    const ok = this.lines.delete(id);
    this.requestUpdate();
    return ok;
  }

  clear() {
    this.lines.clear();
    this.requestUpdate();
  }

  updateAllViews() {
    if (!this._series || !this.lines.size) {
      this._axis = EMPTY;
      return;
    }
    const out = [];
    for (const ln of this.lines.values()) {
      for (const lv of ln.levels) {
        const price = this._dragging && this._dragging.id === ln.id && this._dragging.key === lv.key ? this._dragging.price : lv.price;
        const y = this._series.priceToCoordinate(price);
        if (y != null) out.push(new AxisLabel(y, this._fmt(price), ln.paused ? PAUSED : COLOR));
      }
    }
    this._axis = out;
  }

  paneViews() {
    return this.lines.size ? this._views : EMPTY;
  }
  priceAxisViews() {
    return this._axis;
  }

  /** @returns {{id, key, price}|null} */
  hitLine(y, tol = 5) {
    if (!this._series) return null;
    let best = null;
    for (const ln of this.lines.values()) {
      for (const lv of ln.levels) {
        const ly = this._series.priceToCoordinate(lv.price);
        if (ly == null) continue;
        const d = Math.abs(ly - y);
        if (d <= tol && (!best || d < best.d)) best = { id: ln.id, key: lv.key, price: lv.price, d };
      }
    }
    return best;
  }

  hitTest(x, y) {
    const h = this.hitLine(y);
    const key = h ? `${h.id}:${h.key}` : null;
    if (key !== this._hover) {
      this._hover = key;
      this.requestUpdate();
    }
    return h ? { externalId: `alert:${h.id}`, zOrder: 'top', cursorStyle: 'ns-resize' } : null;
  }
}

/** Wires mouse dragging of alert lines on a ChartView. */
export class AlertLineController {
  constructor(view, primitive) {
    this.view = view;
    this.prim = primitive;
    this._down = this._down.bind(this);
    this._move = this._move.bind(this);
    this._up = this._up.bind(this);
    view.canvasHost.addEventListener('mousedown', this._down, true);
    window.addEventListener('mousemove', this._move);
    window.addEventListener('mouseup', this._up);
  }

  destroy() {
    this.view.canvasHost.removeEventListener('mousedown', this._down, true);
    window.removeEventListener('mousemove', this._move);
    window.removeEventListener('mouseup', this._up);
  }

  _local(e) {
    const rect = this.view.chart.chartElement().getBoundingClientRect();
    const size = this.view.chart.paneSize(0);
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    return { x, y, inPane: x >= 0 && y >= 0 && x <= size.width && y <= size.height };
  }

  _down(e) {
    if (e.button !== 0 || this.view.drawings?.tool || this.view.replay?.selecting) return;
    const p = this._local(e);
    if (!p.inPane) return;
    const hit = this.prim.hitLine(p.y);
    if (!hit) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    this.prim._dragging = { id: hit.id, key: hit.key, price: hit.price, start: hit.price, moved: false };
    this.view.setInteractive(false);
  }

  _move(e) {
    const d = this.prim._dragging;
    if (!d) return;
    const p = this._local(e);
    const price = this.prim._series?.coordinateToPrice(p.y);
    if (price == null) return;
    d.price = this.view.roundPrice(price);
    d.moved = true;
    this.prim.requestUpdate();
  }

  _up() {
    const d = this.prim._dragging;
    if (!d) return;
    this.prim._dragging = null;
    this.view.setInteractive(true);
    const ln = this.prim.lines.get(d.id);
    if (!ln || !d.moved || d.price === d.start) return this.prim.requestUpdate();
    const lv = ln.levels.find((l) => l.key === d.key);
    if (lv) lv.price = d.price;
    this.prim.requestUpdate();
    const condition = { ...(ln.alert.condition || {}), [d.key]: d.price };
    ln.alert = { ...ln.alert, condition };
    this.view.emit('alertmove', { id: d.id, alert: ln.alert, key: d.key, price: d.price, patch: { condition } });
  }
}
