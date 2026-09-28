// ChartHub: watches the Layout's ChartView instances (§12) and re-broadcasts their events in one place,
// so panels do not need to track charts being created/destroyed when the layout changes.
//
// hub.on('charts', fn(charts))            chart list changed
// hub.on('active', fn(chart))             active chart changed
// hub.on('crosshair', fn({chart, ...normalised}))
// hub.on('symbol'|'tf'|'price'|'drawing'|'replay'|'indicator', fn({chart, data}))
// hub.onChart(fn(chart))                  called for every chart now and in the future; fn may return a cleanup

const CHART_EVENTS = ['symbol', 'tf', 'price', 'drawing', 'replay', 'indicator', 'indicators', 'chartType', 'alertmove', 'tool'];

/** Normalise a ChartView 'crosshair' payload into { time, price, candle, indicators, point }. */
export function normaliseCrosshair(p) {
  if (!p || typeof p !== 'object') return { time: null, price: null, candle: null, indicators: null };
  const candle = p.candle || p.bar || p.ohlc || p.ohlcv || (p.data && p.data.o != null ? p.data : null) || null;
  const c = candle
    ? {
        t: candle.t ?? candle.time ?? p.time ?? p.t ?? null,
        o: candle.o ?? candle.open,
        h: candle.h ?? candle.high,
        l: candle.l ?? candle.low,
        c: candle.c ?? candle.close,
        v: candle.v ?? candle.volume,
      }
    : null;
  let time = p.time ?? p.t ?? (c ? c.t : null);
  if (time != null && typeof time === 'object') time = null; // business-day objects are not used here
  const price = p.price ?? p.value ?? (p.point && p.point.price) ?? null;
  const indicators = p.indicators || p.values || p.series || null;
  return { time: time == null ? null : Number(time), price: price == null ? null : Number(price), candle: c, indicators, raw: p };
}

export class ChartHub {
  constructor(layout) {
    this.layout = layout;
    this._handlers = new Map();
    this._known = new Map(); // chart -> cleanup[]
    this._chartCallbacks = new Set();
    this.crosshair = new Map(); // chart -> normalised crosshair
    this.active = null;
    if (layout && typeof layout.on === 'function') {
      layout.on('active', () => this.sync());
      for (const ev of ['layout', 'charts', 'change']) {
        try { layout.on(ev, () => this.sync()); } catch { /* optional events */ }
      }
    }
    this._timer = setInterval(() => this.sync(), 1000);
    this.sync();
  }

  on(type, fn) {
    if (!this._handlers.has(type)) this._handlers.set(type, new Set());
    this._handlers.get(type).add(fn);
    return () => this._handlers.get(type)?.delete(fn);
  }

  emit(type, payload) {
    const set = this._handlers.get(type);
    if (!set) return;
    for (const fn of [...set]) {
      try { fn(payload); } catch (err) { console.error(`[hub] ${type} handler failed`, err); }
    }
  }

  get charts() {
    const list = this.layout && this.layout.charts;
    return Array.isArray(list) ? list.filter(Boolean) : [];
  }

  /** Run fn for every current and future chart. fn may return a cleanup function. */
  onChart(fn) {
    this._chartCallbacks.add(fn);
    for (const [chart, cleanups] of this._known) {
      const c = safeCall(fn, chart);
      if (typeof c === 'function') cleanups.push(c);
    }
    return () => this._chartCallbacks.delete(fn);
  }

  sync() {
    const current = this.charts;
    let changed = false;
    for (const chart of current) {
      if (this._known.has(chart)) continue;
      changed = true;
      const cleanups = [];
      this._known.set(chart, cleanups);
      if (typeof chart.on === 'function') {
        const sub = (ev, fn) => {
          try {
            const off = chart.on(ev, fn);
            if (typeof off === 'function') cleanups.push(off);
          } catch { /* chart does not support this event */ }
        };
        sub('crosshair', (p) => {
          const n = normaliseCrosshair(p);
          this.crosshair.set(chart, n);
          this.emit('crosshair', { chart, ...n });
        });
        for (const ev of CHART_EVENTS) sub(ev, (data) => this.emit(ev, { chart, data }));
      }
      for (const fn of this._chartCallbacks) {
        const c = safeCall(fn, chart);
        if (typeof c === 'function') cleanups.push(c);
      }
    }
    for (const [chart, cleanups] of [...this._known]) {
      if (current.includes(chart)) continue;
      changed = true;
      for (const c of cleanups) safeCall(c);
      this._known.delete(chart);
      this.crosshair.delete(chart);
    }
    if (changed) this.emit('charts', current);
    const active = (this.layout && this.layout.active) || current[0] || null;
    if (active !== this.active) {
      this.active = active;
      this.emit('active', active);
    }
  }

  /** Crosshair price on the active chart, falling back to the last price. */
  activePrice() {
    const chart = this.active;
    if (!chart) return null;
    const cr = this.crosshair.get(chart);
    if (cr && cr.price != null && isFinite(cr.price)) return cr.price;
    const st = chartState(chart);
    return st.lastPrice ?? null;
  }

  destroy() {
    clearInterval(this._timer);
    for (const cleanups of this._known.values()) for (const c of cleanups) safeCall(c);
    this._known.clear();
  }
}

function safeCall(fn, ...a) {
  try { return fn(...a); } catch (err) { console.error('[hub] callback failed', err); return undefined; }
}

/** chart.getState() with a safe fallback. */
export function chartState(chart) {
  if (!chart) return {};
  try {
    const s = typeof chart.getState === 'function' ? chart.getState() : null;
    if (s) return s;
  } catch (err) { console.warn('[hub] getState failed', err); }
  return { id: chart.id, symbol: chart.symbol, tf: chart.tf, chartType: chart.chartType };
}

/** Best-effort list of drawings on a chart: [{ id, type, name, visible, points }]. */
export function chartDrawings(chart) {
  if (!chart) return [];
  try {
    let list = null;
    if (typeof chart.listDrawings === 'function') list = chart.listDrawings();
    else if (typeof chart.getDrawings === 'function') list = chart.getDrawings();
    else if (chart.drawings) list = chart.drawings;
    if (list && typeof list.list === 'function') list = list.list();
    if (list instanceof Map) list = [...list.values()];
    else if (list && !Array.isArray(list) && typeof list === 'object') list = Object.values(list);
    return Array.isArray(list)
      ? list.map((d) => (d && d.spec ? { ...d.spec, id: d.id ?? d.spec.id, visible: d.visible } : d)).filter(Boolean).map((d) => ({ ...d, type: d.type || d.tool }))
      : [];
  } catch {
    return [];
  }
}

/** Best-effort list of indicators on a chart: [{ id, name, visible, ... }]. */
export function chartIndicators(chart) {
  if (!chart) return [];
  try {
    if (typeof chart.listIndicators === 'function') {
      const l = chart.listIndicators();
      return Array.isArray(l) ? l : [];
    }
  } catch { /* ignore */ }
  const st = chartState(chart);
  return Array.isArray(st.indicators) ? st.indicators : [];
}
