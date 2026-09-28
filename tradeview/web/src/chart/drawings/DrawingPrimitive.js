import { formatDateTime } from '../format.js';
import { getTool, toolHandles } from './tools.js';
import { handle as drawHandle } from './geometry.js';

/**
 * One drawing = one lightweight-charts v5 series primitive attached to the main series.
 * Geometry comes from the DrawingManager (time→x across the whole axis incl. future bars, price→y via series).
 */

class AxisView {
  constructor(coord, text, bg) {
    this._c = coord;
    this._t = text;
    this._bg = bg;
  }
  coordinate() {
    return this._c;
  }
  text() {
    return this._t;
  }
  textColor() {
    return '#ffffff';
  }
  backColor() {
    return this._bg;
  }
  visible() {
    return true;
  }
  tickVisible() {
    return true;
  }
}

class DrawingRenderer {
  constructor(prim) {
    this._p = prim;
  }
  draw(target) {
    const p = this._p;
    target.useMediaCoordinateSpace(({ context, mediaSize }) => {
      const r = p.manager.renderContext(p.model, mediaSize, context);
      if (!r) return;
      const tool = getTool(p.model.tool);
      if (!tool) return;
      context.save();
      try {
        tool.render(r);
        if ((r.selected || r.creating) && !p.model.locked) {
          for (const h of toolHandles(tool, r)) drawHandle(context, h.x, h.y, p.manager.activeHandle === h.key && r.selected);
        } else if (r.selected && p.model.locked) {
          for (const h of toolHandles(tool, r)) drawHandle(context, h.x, h.y, false, '#787b86');
        }
      } finally {
        context.restore();
      }
    });
  }
}

class DrawingPaneView {
  constructor(prim) {
    this._r = new DrawingRenderer(prim);
  }
  zOrder() {
    return 'top';
  }
  renderer() {
    return this._r;
  }
}

const EMPTY = Object.freeze([]);

export class DrawingPrimitive {
  constructor(manager, model) {
    this.manager = manager;
    this.model = model;
    this._views = [new DrawingPaneView(this)];
    this._priceAxis = EMPTY;
    this._timeAxis = EMPTY;
    this._requestUpdate = null;
  }

  attached({ requestUpdate }) {
    this._requestUpdate = requestUpdate;
  }

  detached() {
    this._requestUpdate = null;
  }

  requestUpdate() {
    this._requestUpdate?.();
  }

  _visible() {
    return !this.model.hidden && !this.manager.hiddenAll;
  }

  updateAllViews() {
    const m = this.manager;
    const tool = getTool(this.model.tool);
    if (!tool || !this._visible()) {
      this._priceAxis = EMPTY;
      this._timeAxis = EMPTY;
      return;
    }
    const selected = m.selectedId === this.model.id || m.draft?.model === this.model;
    const showPrice = (selected && (tool.axis === 'price' || tool.axis === 'both')) || (tool.axisAlways && tool.axis === 'price');
    const showTime = (selected && (tool.axis === 'time' || tool.axis === 'both')) || (tool.axisAlways && tool.axis === 'time');
    const color = selected ? '#2962ff' : this.model.style?.color || '#2962ff';
    const pa = [];
    const ta = [];
    const seenP = new Set();
    const seenT = new Set();
    const pts = tool.id === 'horizontal_line' || tool.id === 'horizontal_ray' || tool.id === 'vertical_line' ? this.model.points.slice(0, 1) : this.model.points;
    for (const p of pts) {
      if (showPrice && !seenP.has(p.price)) {
        seenP.add(p.price);
        const y = m.priceToY(p.price);
        if (y != null) pa.push(new AxisView(y, m.formatPrice(p.price), color));
      }
      if (showTime && !seenT.has(p.t)) {
        seenT.add(p.t);
        const x = m.timeToX(p.t);
        if (x != null) ta.push(new AxisView(x, formatDateTime(p.t, m.secondsTf), color));
      }
    }
    this._priceAxis = pa;
    this._timeAxis = ta;
  }

  paneViews() {
    return this._visible() ? this._views : EMPTY;
  }

  priceAxisViews() {
    return this._priceAxis;
  }

  timeAxisViews() {
    return this._timeAxis;
  }

  hitTest(x, y) {
    if (!this._visible()) return null;
    const res = this.manager.hitTestModel(this.model, x, y);
    if (!res) return null;
    return {
      externalId: this.model.id,
      zOrder: 'top',
      cursorStyle: res.handle != null ? (this.model.locked ? 'not-allowed' : 'pointer') : this.model.locked ? 'default' : 'move',
    };
  }
}
