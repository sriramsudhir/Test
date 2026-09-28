import { LineSeries, HistogramSeries, AreaSeries, LineType, LineStyle } from 'lightweight-charts';
import { computeFast, hasFastPath } from './fast.js';
import { normalizeBuiltinId, builtinInfo } from './catalog.js';
import { PLOT_PALETTE, withAlpha } from '../theme.js';
import { apiRequest } from '../apiHelpers.js';
import { uid, toMs, toSec, debounce, throttle, lowerIndex } from '../util.js';

/**
 * Indicators on a ChartView.
 *  - builtin ids → Pine source from GET /api/pine/library/:id, run through POST /api/pine/run
 *  - custom Pine source → POST /api/pine/run
 *  - SMA/EMA/BB/VWAP/RSI/MACD render instantly from a JS fast path, then reconcile with the Pine result
 *  - overlay vs separate pane from meta.overlay (v5 panes)
 *  - recompute on symbol/tf change, on each new closed bar (debounced) and on replay slice changes
 */

const PINE_COLORS = {
  red: '#f23645', green: '#089981', blue: '#2962ff', orange: '#ff9800', purple: '#9c27b0', yellow: '#ffeb3b',
  aqua: '#00bcd4', teal: '#089981', white: '#ffffff', black: '#363a45', gray: '#787b86', silver: '#b2b5be',
  maroon: '#880e4f', navy: '#311b92', olive: '#808000', lime: '#00e676', fuchsia: '#e040fb',
};

const libraryCache = new Map();

export function normalizeColor(c, fallback) {
  if (c == null || c === '' || c === 'na') return fallback;
  if (typeof c === 'object') {
    if (c.color) return normalizeColor(c.color, fallback);
    if ('r' in c) return `rgba(${c.r},${c.g},${c.b},${c.a ?? 1})`;
    return fallback;
  }
  const s = String(c).trim();
  const name = s.replace(/^color\./, '').toLowerCase();
  if (PINE_COLORS[name]) return PINE_COLORS[name];
  if (/^#[0-9a-f]{8}$/i.test(s)) {
    const a = parseInt(s.slice(7, 9), 16) / 255;
    return withAlpha(s.slice(0, 7), +a.toFixed(3));
  }
  return s;
}

function plotKind(style) {
  const s = String(style || '').toLowerCase();
  if (s.includes('hist') || s.includes('column')) return 'histogram';
  if (s.includes('area')) return 'area';
  if (s.includes('circle') || s.includes('cross') || s.includes('point')) return 'points';
  if (s.includes('step')) return 'step';
  return 'line';
}

/** Apply `inputs` to Pine `x = input*(defval, "Title", ...)` declarations. */
export function applyInputs(source, inputs) {
  if (!inputs || !Object.keys(inputs).length) return source;
  const norm = (k) => String(k).toLowerCase().replace(/[^a-z0-9]/g, '');
  const map = new Map(Object.entries(inputs).map(([k, v]) => [norm(k), v]));
  const alias = { len: 'length', length: 'len', src: 'source', source: 'src', mult: 'multiplier', multiplier: 'mult' };
  return source.replace(/^(\s*)(\w+)(\s*=\s*input(?:\.\w+)?\(\s*)([^,)]+)([^\n]*)$/gm, (m, ind, name, mid, defval, rest) => {
    const titleMatch = rest.match(/^\s*,\s*(?:title\s*=\s*)?["']([^"']+)["']/) || rest.match(/title\s*=\s*["']([^"']+)["']/);
    const keys = [norm(name), titleMatch ? norm(titleMatch[1]) : null, alias[norm(name)]].filter(Boolean);
    const key = keys.find((k) => map.has(k));
    if (!key) return m;
    let v = map.get(key);
    if (typeof v === 'string' && !/^(open|high|low|close|hl2|hlc3|ohlc4|volume)$/.test(v)) v = JSON.stringify(v);
    return `${ind}${name}${mid}${v}${rest}`;
  });
}

export class IndicatorManager {
  /** @param {import('../ChartView.js').ChartView} view */
  constructor(view) {
    this.view = view;
    /** @type {Map<string, any>} */
    this.items = new Map();
    this._colorIdx = 0;
    this._barCloseRecompute = debounce(() => this.recomputeAll({ pine: true }), 900);
    this._replayRecompute = debounce(() => this.recomputeAll({ pine: true }), 350);
    this._liveFast = throttle(() => this._recomputeFastLive(), 500);
  }

  destroy() {
    this._barCloseRecompute.cancel();
    this._replayRecompute.cancel();
    this._liveFast.cancel();
    for (const id of [...this.items.keys()]) this.remove(id, { silent: true });
  }

  // ------------------------------------------------------------------ public API
  add(spec = {}) {
    const builtin = normalizeBuiltinId(spec.builtin || (!spec.source ? spec.name || spec.indicator : null));
    const source = spec.source || null;
    if (!builtin && !source) throw new Error('addIndicator needs builtin or source');
    const id = spec.id && !this.items.has(spec.id) ? spec.id : uid('ind');
    const info = builtin ? builtinInfo(builtin) : null;
    const rec = {
      id,
      builtin,
      source,
      inputs: { ...(info?.inputs || {}), ...(spec.inputs || {}) },
      title: spec.title || info?.name?.replace(/\s*\(.*\)$/, '') || (builtin ? builtin.toUpperCase() : 'Pine Script'),
      userTitle: !!spec.title,
      overlay: spec.overlay ?? info?.overlay ?? null,
      mode: 'pending',
      error: null,
      visible: true,
      series: new Map(),
      priceLines: [],
      values: new Map(),
      colors: new Map(),
      fill: null,
      token: 0,
      colorBase: this._colorIdx,
    };
    this._colorIdx += 3;
    this.items.set(id, rec);
    this._compute(rec, { pine: true });
    this.view.emit('indicators', this.list());
    return id;
  }

  remove(idOrBuiltin, { silent = false } = {}) {
    let rec = this.items.get(idOrBuiltin);
    if (!rec) {
      const b = normalizeBuiltinId(idOrBuiltin);
      rec = [...this.items.values()].find((r) => r.builtin === b);
    }
    if (!rec) return false;
    this._clearSeries(rec);
    this.items.delete(rec.id);
    if (!silent) this.view.emit('indicators', this.list());
    return true;
  }

  list() {
    return [...this.items.values()].map((r) => ({
      id: r.id,
      builtin: r.builtin,
      title: r.title,
      overlay: !!r.overlay,
      inputs: { ...r.inputs },
      status: r.mode,
      error: r.error,
      visible: r.visible,
      hasSource: !!r.source,
    }));
  }

  setVisible(id, visible) {
    const rec = this.items.get(id);
    if (!rec) return;
    rec.visible = !!visible;
    for (const s of rec.series.values()) s.series.applyOptions({ visible: rec.visible });
    this.view.emit('indicators', this.list());
  }

  setInputs(id, inputs) {
    const rec = this.items.get(id);
    if (!rec) return;
    rec.inputs = { ...rec.inputs, ...inputs };
    this._compute(rec, { pine: true });
  }

  /** Legend values at a bar time (ms). */
  valuesAt(t) {
    const out = [];
    const ts = toSec(t);
    for (const rec of this.items.values()) {
      const vals = [];
      for (const [name, m] of rec.values) {
        const v = m.get(ts);
        vals.push({ name, value: v, color: rec.colors.get(name) });
      }
      out.push({ id: rec.id, title: rec.title, values: vals, status: rec.mode, error: rec.error, visible: rec.visible, overlay: !!rec.overlay });
    }
    return out;
  }

  // ------------------------------------------------------------------ triggers
  recomputeAll({ pine = true } = {}) {
    for (const rec of this.items.values()) this._compute(rec, { pine });
  }
  onDataReset() {
    this._barCloseRecompute.cancel();
    for (const rec of this.items.values()) {
      rec.mode = 'pending';
      rec.token++;
    }
    this.recomputeAll({ pine: true });
  }
  onBarClose() {
    this._barCloseRecompute();
    this._liveFast();
  }
  onTick() {
    this._liveFast();
  }
  onReplay() {
    // fast path instantly, Pine debounced
    this.recomputeAll({ pine: false });
    // Pine-only indicators have no instant path: re-render their last result clipped to the replay head so no
    // "future" points stay on the chart (they would also stretch the time scale past the replay bar).
    for (const rec of this.items.values()) {
      if (rec.lastRes && !(rec.builtin && hasFastPath(rec.builtin))) this._render(rec, rec.lastRes);
    }
    this._replayRecompute();
  }
  /** After the main series is recreated (chart type change) pane 0 series remain valid; nothing to do. */

  // ------------------------------------------------------------------ computation
  _recomputeFastLive() {
    for (const rec of this.items.values()) {
      if (rec.builtin && hasFastPath(rec.builtin) && (rec.mode === 'fast' || rec.mode === 'error')) this._compute(rec, { pine: false });
    }
  }

  _compute(rec, { pine }) {
    const v = this.view;
    const candles = v.indicatorCandles();
    if (!candles.length) return;
    if (rec.builtin && hasFastPath(rec.builtin)) {
      try {
        const res = computeFast(rec.builtin, candles, rec.inputs);
        if (res && (rec.mode !== 'pine' || !pine)) {
          this._render(rec, res);
          if (rec.mode !== 'pine') rec.mode = 'fast';
        }
      } catch (e) {
        console.warn('[indicators] fast path failed', e);
      }
    }
    if (!pine) return;
    const timeBased = v.isTimeBased;
    if (!timeBased && rec.builtin && hasFastPath(rec.builtin)) {
      // renko / range: compute on bricks client-side only
      rec.mode = 'fast';
      this.view.emit('indicators', this.list());
      return;
    }
    const token = ++rec.token; // only Pine runs bump the token; fast recomputes never cancel an in-flight run
    this._runPine(rec, token).catch((e) => {
      if (token !== rec.token) return;
      rec.error = e.message || String(e);
      if (rec.mode === 'pending') rec.mode = 'error';
      else if (rec.mode !== 'fast') rec.mode = 'error';
      this.view.emit('indicators', this.list());
    });
  }

  async _loadLibrary(id) {
    if (libraryCache.has(id)) return libraryCache.get(id);
    const p = apiRequest(this.view.api, 'get', `/api/pine/library/${encodeURIComponent(id)}`).then((res) => {
      const src = typeof res === 'string' ? res : res?.source || res?.code || res?.pine;
      if (!src) throw new Error(`Library indicator "${id}" has no source`);
      return { source: src, meta: res?.meta || null, name: res?.name || res?.title || null };
    });
    libraryCache.set(id, p);
    p.catch(() => libraryCache.delete(id));
    return p;
  }

  async _runPine(rec, token) {
    const v = this.view;
    let source = rec.source;
    if (!source && rec.builtin) {
      const lib = await this._loadLibrary(rec.builtin);
      source = lib.source;
      if (lib.name && !rec.titleFromPine) rec.title = rec.title || lib.name;
    }
    source = applyInputs(source, rec.inputs);
    const candles = v.indicatorCandles(false);
    if (!candles.length) return;
    const body = { symbol: v.symbol, tf: v.tf, source, from: candles[0].t, to: candles[candles.length - 1].t, inputs: rec.inputs };
    const res = await apiRequest(v.api, 'post', '/api/pine/run', body);
    if (token !== rec.token || !this.items.has(rec.id)) return;
    if (!res || res.error) throw new Error(res?.error?.message || res?.error || 'Pine run failed');
    if (!res.plots || !Object.keys(res.plots).length) throw new Error('Script produced no plots');
    rec.error = null;
    rec.mode = 'pine';
    if (res.meta?.title && !rec.userTitle) {
      rec.title = res.meta.title;
      rec.titleFromPine = true;
    }
    this._render(rec, res);
    this.view.emit('indicators', this.list());
  }

  // ------------------------------------------------------------------ rendering
  _clearSeries(rec) {
    const chart = this.view.chart;
    for (const s of rec.series.values()) {
      try {
        chart.removeSeries(s.series);
      } catch { /* already gone */ }
    }
    rec.series.clear();
    rec.priceLines = [];
    rec.values.clear();
  }

  _paneIndexFor(rec, overlay) {
    if (overlay) return 0;
    for (const s of rec.series.values()) {
      try {
        const idx = s.series.getPane().paneIndex();
        if (idx > 0) return idx;
      } catch { /* ignore */ }
    }
    return this.view.chart.panes().length;
  }

  _mapData(rec, name, data) {
    const v = this.view;
    const values = new Map();
    let rows = [];
    let lastT = -Infinity;
    // In bar replay nothing after the replay bar may be drawn (results can come from a run on the full history).
    const maxT = v.replay?.active && v.lastBar ? v.lastBar.t : Infinity;
    for (const d of data || []) {
      const t = toMs(d.t ?? d.time);
      if (t == null || t <= lastT) continue;
      if (t > maxT) break;
      lastT = t;
      const val = d.value ?? d.v ?? d.y;
      rows.push({ t, value: val == null || Number.isNaN(+val) ? null : +val, color: d.color ? normalizeColor(d.color) : undefined });
    }
    if (!v.isTimeBased) {
      // resample onto non-time-based bars (renko / range): value of the last source bar at or before brick time
      const bars = v.displayBars;
      const src = rows;
      rows = bars.map((b) => {
        const i = lowerIndex(src, b.t);
        return i >= 0 ? { t: b.t, value: src[i].value, color: src[i].color } : { t: b.t, value: null };
      });
    }
    const out = rows.map((r) => {
      const time = toSec(r.t);
      if (r.value == null) return { time };
      values.set(time, r.value);
      return r.color ? { time, value: r.value, color: r.color } : { time, value: r.value };
    });
    rec.values.set(name, values);
    return out;
  }

  _render(rec, res) {
    const chart = this.view.chart;
    rec.lastRes = res;
    const overlay = res.meta?.overlay ?? rec.overlay ?? false;
    if (rec.overlay !== overlay && rec.series.size) this._clearSeries(rec);
    rec.overlay = overlay;
    if (res.meta?.title && !rec.userTitle && (rec.mode !== 'pine' || rec.titleFromPine)) rec.title = res.meta.title;
    const paneIndex = this._paneIndexFor(rec, overlay);
    const names = Object.keys(res.plots);
    for (const [name, s] of [...rec.series]) {
      if (!names.includes(name)) {
        try {
          chart.removeSeries(s.series);
        } catch { /* ignore */ }
        rec.series.delete(name);
        rec.values.delete(name);
      }
    }
    let i = 0;
    for (const name of names) {
      const plot = res.plots[name] || {};
      const opt = plot.options || {};
      if (opt.display === 'none' || opt.display === false) continue;
      const kind = plotKind(opt.style || opt.plotStyle);
      const color = normalizeColor(opt.color, PLOT_PALETTE[(rec.colorBase + i++) % PLOT_PALETTE.length]);
      const width = Math.max(1, Math.min(4, Math.round(opt.linewidth ?? opt.lineWidth ?? opt.width ?? (kind === 'line' ? 2 : 1))));
      let entry = rec.series.get(name);
      if (entry && entry.kind !== kind) {
        try {
          chart.removeSeries(entry.series);
        } catch { /* ignore */ }
        rec.series.delete(name);
        entry = null;
      }
      const common = {
        title: '',
        lastValueVisible: true,
        priceLineVisible: false,
        visible: rec.visible,
        priceScaleId: overlay ? 'right' : 'right',
        crosshairMarkerVisible: kind !== 'histogram',
      };
      if (!entry) {
        const pane = paneIndex;
        let series;
        if (kind === 'histogram') series = chart.addSeries(HistogramSeries, { ...common, color, base: 0 }, pane);
        else if (kind === 'area') series = chart.addSeries(AreaSeries, { ...common, lineColor: color, topColor: withAlpha(color, 0.3), bottomColor: withAlpha(color, 0.02), lineWidth: width }, pane);
        else series = chart.addSeries(LineSeries, {
          ...common,
          color,
          lineWidth: width,
          lineType: kind === 'step' ? LineType.WithSteps : LineType.Simple,
          lineVisible: kind !== 'points',
          pointMarkersVisible: kind === 'points',
          pointMarkersRadius: kind === 'points' ? 2 : undefined,
          crosshairMarkerRadius: 3,
        }, pane);
        entry = { series, kind };
        rec.series.set(name, entry);
      } else {
        const o = kind === 'histogram' ? { color } : kind === 'area' ? { lineColor: color, lineWidth: width } : { color, lineWidth: width };
        entry.series.applyOptions(o);
      }
      rec.colors.set(name, color);
      entry.series.setData(this._mapData(rec, name, plot.data));
    }
    // horizontal levels (RSI 70/30 etc.)
    const first = rec.series.values().next().value;
    if (first) {
      for (const pl of rec.priceLines) {
        try {
          pl.series.removePriceLine(pl.line);
        } catch { /* ignore */ }
      }
      rec.priceLines = [];
      for (const lv of res.levels || res.hlines || []) {
        const line = first.series.createPriceLine({
          price: +lv.price,
          color: normalizeColor(lv.color, '#787b86'),
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: false,
          title: '',
        });
        rec.priceLines.push({ series: first.series, line });
      }
      if (!overlay) {
        try {
          const pane = first.series.getPane();
          if (!rec.paneSized) {
            rec.paneSized = true;
            pane.setStretchFactor(0.35);
          }
        } catch { /* ignore */ }
      }
    }
    this.view._legendRefresh?.();
  }
}
