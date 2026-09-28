import { Emitter } from '../chart/emitter.js';
import { ChartView, DEFAULT_SYMBOL } from '../chart/ChartView.js';
import { Toolbar, LAYOUT_IDS } from './Toolbar.js';
import { DrawingToolbar } from './DrawingToolbar.js';
import { el, debounce, SYMBOL_KEY_RE } from '../chart/util.js';

const COUNTS = { 1: 1, '2h': 2, '2v': 2, 3: 3, 4: 4, 6: 6, 8: 8 };
const STORAGE_KEY = 'tv.layout.v1';
const FORWARD = ['symbol-search', 'open-indicators', 'alertmove', 'priceclick', 'drawing', 'indicators', 'replay', 'price', 'loaded'];

function normalizeLayoutId(id) {
  if (id == null) return null;
  const s = String(id).trim().toLowerCase().replace(/\s+/g, '');
  const alias = { single: '1', '2': '2h', '2x1': '2h', '1x2': '2v', horizontal: '2h', vertical: '2v', '2x2': '4', '3x2': '6', '4x2': '8', grid: '4' };
  const v = alias[s] || s;
  return LAYOUT_IDS.includes(v) ? v : null;
}

/**
 * Multi-chart workspace: top toolbar, left drawing toolbar, CSS-grid of ChartViews (layouts 1, 2h, 2v, 3, 4, 6, 8),
 * active-chart highlight, symbol/interval/crosshair/time sync and agent command routing (§12).
 *
 * Events: 'active' (chart, prevChart), 'layout' (id), 'charts' (charts), 'sync' ({key, value}),
 * 'symbol-search' / 'open-indicators' ({ chart, chartId }), 'screenshot', plus forwarded chart events
 * ('alertmove', 'priceclick', 'drawing', 'indicators', 'replay', 'price', 'loaded') with (payload, chart).
 */
export class Layout extends Emitter {
  /**
   * @param {HTMLElement} rootEl
   * @param {{ layout?: string, symbol?: string, tf?: string, chartType?: string, toolbar?: boolean,
   *           drawingToolbar?: boolean, persist?: boolean, api?: any, socket?: any }} opts
   */
  constructor(rootEl, opts = {}) {
    super();
    this.rootEl = rootEl;
    this.opts = { toolbar: true, drawingToolbar: true, persist: true, ...opts };
    /** @type {ChartView[]} */
    this.charts = [];
    this.active = null;
    this.layoutId = '1';
    this._sync = { syncSymbol: false, syncInterval: false, syncCrosshair: true, syncTime: false };
    this._hover = null;
    this._chartOffs = new Map();
    this._save = debounce(() => this._persist(), 400);

    this.root = el('div', { class: 'tv-workspace' });
    this.topHost = el('div', { class: 'tv-top' });
    this.body = el('div', { class: 'tv-body' });
    this.leftHost = el('div', { class: 'tv-left' });
    this.grid = el('div', { class: 'tv-grid' });
    this.body.append(this.leftHost, this.grid);
    this.root.append(this.topHost, this.body);
    rootEl.append(this.root);

    const saved = this.opts.persist ? this._restore() : null;
    if (saved?.sync) Object.assign(this._sync, saved.sync);
    this._savedCharts = saved?.charts || [];
    this.setLayout(normalizeLayoutId(opts.layout) || normalizeLayoutId(saved?.layout) || '1');
    const act = saved?.active != null ? this.charts[saved.active] : null;
    this.setActive(act || this.charts[0]);
    this._savedCharts = null;

    if (this.opts.toolbar) this.toolbar = new Toolbar(this.topHost, this);
    else this.topHost.hidden = true;
    if (this.opts.drawingToolbar) this.drawingToolbar = new DrawingToolbar(this.leftHost, this);
    else this.leftHost.hidden = true;

    this._onFs = () => this.root.classList.toggle('tv-fullscreen', document.fullscreenElement === this.root);
    document.addEventListener('fullscreenchange', this._onFs);
  }

  // ---------------------------------------------------------------- sync toggles
  get syncSymbol() {
    return this._sync.syncSymbol;
  }
  set syncSymbol(v) {
    this._setSync('syncSymbol', v);
  }
  get syncInterval() {
    return this._sync.syncInterval;
  }
  set syncInterval(v) {
    this._setSync('syncInterval', v);
  }
  get syncCrosshair() {
    return this._sync.syncCrosshair;
  }
  set syncCrosshair(v) {
    this._setSync('syncCrosshair', v);
  }
  get syncTime() {
    return this._sync.syncTime;
  }
  set syncTime(v) {
    this._setSync('syncTime', v);
  }

  _setSync(key, v) {
    this._sync[key] = !!v;
    if (v && this.active) {
      // bring the other charts in line immediately
      if (key === 'syncSymbol') for (const c of this.charts) if (c !== this.active) c.setSymbol(this.active.symbol);
      if (key === 'syncInterval') for (const c of this.charts) if (c !== this.active) c.setTimeframe(this.active.tf);
    }
    if (key === 'syncCrosshair' && !v) for (const c of this.charts) c.clearCrosshair();
    this.emit('sync', { key, value: !!v });
    this._save();
  }

  setSync(key, v) {
    if (!(key in this._sync)) throw new Error(`Unknown sync option ${key}`);
    this._setSync(key, v);
  }

  // ---------------------------------------------------------------- layout
  setLayout(id) {
    const lid = normalizeLayoutId(id);
    if (!lid) throw new Error(`Unknown layout: ${id}`);
    const n = COUNTS[lid];
    this.layoutId = lid;
    this.grid.dataset.layout = lid;
    // create missing charts
    while (this.charts.length < n) {
      const i = this.charts.length;
      const saved = this._savedCharts?.[i];
      const tpl = this.active || this.charts[0];
      this._createChart(i, {
        symbol: (SYMBOL_KEY_RE.test(String(saved?.symbol ?? '')) ? saved.symbol : null) || (tpl && this._sync.syncSymbol ? tpl.symbol : tpl?.symbol) || this.opts.symbol || DEFAULT_SYMBOL,
        tf: saved?.tf || tpl?.tf || this.opts.tf || '1h',
        chartType: saved?.chartType || this.opts.chartType || 'candles',
        indicators: saved?.indicators || [],
        volumeProfile: saved?.volumeProfile,
      });
    }
    // destroy extra charts
    while (this.charts.length > n) {
      const c = this.charts.pop();
      this._chartOffs.get(c)?.forEach((off) => off());
      this._chartOffs.delete(c);
      c.destroy();
      c.container.remove();
      if (this.active === c) this.active = null;
    }
    this.charts.forEach((c, i) => (c.container.style.gridArea = `c${i}`));
    if (!this.active || !this.charts.includes(this.active)) this.setActive(this.charts[0]);
    this._updateHighlight();
    this.emit('layout', lid);
    this.emit('charts', this.charts);
    this._save();
    return lid;
  }

  _createChart(i, spec) {
    const cell = el('div', { class: 'tv-cell' });
    this.grid.append(cell);
    const chart = new ChartView(cell, {
      id: `chart-${i + 1}`,
      symbol: spec.symbol,
      tf: spec.tf,
      chartType: spec.chartType,
      api: this.opts.api,
      socket: this.opts.socket,
      volumeProfile: spec.volumeProfile,
    });
    chart.container = cell;
    for (const ind of spec.indicators || []) {
      try {
        chart.addIndicator(ind);
      } catch (e) {
        console.warn('[layout] restore indicator failed', e.message);
      }
    }
    const offs = [];
    offs.push(chart.on('focus', () => this.setActive(chart)));
    cell.addEventListener('mouseenter', () => (this._hover = chart));
    cell.addEventListener('mouseleave', () => {
      if (this._hover === chart) this._hover = null;
      if (this._sync.syncCrosshair) for (const c of this.charts) if (c !== chart) c.clearCrosshair();
    });
    offs.push(chart.on('symbol', (s) => this._onChartSymbol(chart, s)));
    offs.push(chart.on('tf', (tf) => this._onChartTf(chart, tf)));
    offs.push(chart.on('crosshair', (p) => this._onChartCrosshair(chart, p)));
    offs.push(chart.on('range', (r) => this._onChartRange(chart, r)));
    offs.push(chart.on('charttype', () => this._save()));
    offs.push(chart.on('indicators', () => this._save()));
    offs.push(chart.on('vpvr', () => this._save()));
    for (const ev of FORWARD) offs.push(chart.on(ev, (payload) => this.emit(ev, payload && typeof payload === 'object' && !Array.isArray(payload) ? { chartId: chart.id, chart, ...payload } : payload, chart)));
    this._chartOffs.set(chart, offs);
    this.charts.push(chart);
    return chart;
  }

  setActive(chart) {
    if (!chart || chart === this.active) return;
    const prev = this.active;
    this.active = chart;
    this._updateHighlight();
    this.emit('active', chart, prev);
    this._save();
  }

  _updateHighlight() {
    const multi = this.charts.length > 1;
    for (const c of this.charts) c.container.classList.toggle('tv-cell-active', multi && c === this.active);
  }

  // ---------------------------------------------------------------- sync handlers
  _onChartSymbol(chart, s) {
    if (this._syncing) return;
    if (this._sync.syncSymbol) {
      this._syncing = true;
      try {
        for (const c of this.charts) if (c !== chart) c.setSymbol(s);
      } finally {
        this._syncing = false;
      }
    }
    this.emit('symbol', s, chart);
    this._save();
  }

  _onChartTf(chart, tf) {
    if (this._syncing) return;
    if (this._sync.syncInterval) {
      this._syncing = true;
      try {
        for (const c of this.charts) if (c !== chart) c.setTimeframe(tf);
      } finally {
        this._syncing = false;
      }
    }
    this.emit('tf', tf, chart);
    this._save();
  }

  _onChartCrosshair(chart, p) {
    if (!this._sync.syncCrosshair || this.charts.length < 2) return;
    if (this._hover && this._hover !== chart) return;
    for (const c of this.charts) {
      if (c === chart) continue;
      if (!p) c.clearCrosshair();
      else c.setCrosshair(p.time, c.symbol === chart.symbol && p.paneIndex === 0 ? p.price : undefined);
    }
  }

  _onChartRange(chart, r) {
    if (!this._sync.syncTime || this.charts.length < 2) return;
    const source = this._hover || this.active;
    if (source !== chart) return;
    for (const c of this.charts) if (c !== chart) c.setVisibleRange(r);
  }

  // ---------------------------------------------------------------- agent integration
  getContext() {
    return {
      charts: this.charts.map((c) => c.getState()),
      activeChartId: this.active?.id ?? null,
      layout: this.layoutId,
      sync: { ...this._sync },
    };
  }

  getChart(id) {
    return this.charts.find((c) => c.id === id) || null;
  }

  /** Route a ChartCommand (§7) to cmd.chartId or the active chart; handles set_layout here. */
  async executeCommand(cmd = {}) {
    if (!cmd || !cmd.action) throw new Error('ChartCommand needs an action');
    if (cmd.action === 'set_layout') {
      const id = this.setLayout(cmd.layout ?? cmd.id ?? cmd.value ?? cmd.name);
      if (cmd.sync && typeof cmd.sync === 'object') for (const [k, v] of Object.entries(cmd.sync)) if (k in this._sync) this._setSync(k, v);
      return { ok: true, layout: id };
    }
    if (cmd.action === 'set_sync') {
      this.setSync(cmd.key, cmd.value);
      return { ok: true };
    }
    let chart = this.active;
    if (cmd.chartId != null) {
      chart = this.getChart(cmd.chartId) || (typeof cmd.chartId === 'number' ? this.charts[cmd.chartId - 1] : null);
      if (!chart) throw new Error(`No chart with id ${cmd.chartId}`);
    }
    if (!chart) throw new Error('No active chart');
    return chart.executeCommand(cmd);
  }

  // ---------------------------------------------------------------- misc
  toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else this.root.requestFullscreen?.().catch(() => this.root.classList.toggle('tv-fullscreen'));
  }

  _persist() {
    if (!this.opts.persist) return;
    const state = {
      layout: this.layoutId,
      active: Math.max(0, this.charts.indexOf(this.active)),
      sync: this._sync,
      charts: this.charts.map((c) => ({
        symbol: c.symbol,
        tf: c.tf,
        chartType: c.chartType,
        volumeProfile: c.volumeProfileEnabled,
        indicators: c.indicators.list().map((i) => ({ builtin: i.builtin || undefined, source: i.hasSource ? c.indicators.items.get(i.id)?.source : undefined, inputs: i.inputs })),
      })),
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch { /* storage unavailable */ }
  }

  _restore() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    } catch {
      return null;
    }
  }

  destroy() {
    this._save.cancel();
    document.removeEventListener('fullscreenchange', this._onFs);
    this.toolbar?.destroy();
    this.drawingToolbar?.destroy();
    for (const c of this.charts) {
      this._chartOffs.get(c)?.forEach((off) => off());
      c.destroy();
    }
    this.charts = [];
    this.root.remove();
    this.removeAllListeners();
  }
}
