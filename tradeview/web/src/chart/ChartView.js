import {
  createChart,
  CandlestickSeries,
  BarSeries,
  LineSeries,
  AreaSeries,
  BaselineSeries,
  HistogramSeries,
  PriceScaleMode,
  LineStyle,
  createSeriesMarkers,
} from 'lightweight-charts';
import * as client from '../api/client.js';
import { Emitter } from './emitter.js';
import { THEME, chartOptions } from './theme.js';
import { normalizeTf, tfToMs, isSecondsTf, floorTime, nextBarTime, tfLabel, getTimeframe } from './timeframes.js';
import { heikinAshi, heikinAshiNext, renko, rangeBars } from './transforms.js';
import { formatPrice, formatCompact, formatPercent, decimalsOf, inferPrecision, formatDateTime } from './format.js';
import { toMs, toSec, listen, lowerIndex, el, throttle, debounce, unwrapList, downloadDataUrl, clamp } from './util.js';
import { apiRequest } from './apiHelpers.js';
import { FootprintSeries, toFootprintItem, FOOTPRINT_DEFAULTS } from './footprint/FootprintSeries.js';
import { VolumeProfilePrimitive } from './footprint/VolumeProfile.js';
import { CountdownPrimitive } from './primitives.js';
import { AlertLinesPrimitive, AlertLineController } from './alertLines.js';
import { DrawingManager } from './drawings/DrawingManager.js';
import { IndicatorManager } from './indicators/IndicatorManager.js';
import { ReplayController } from '../replay/ReplayController.js';
import { ReplayBar } from '../replay/ReplayBar.js';

export const CHART_TYPES = [
  { id: 'candles', label: 'Candles' },
  { id: 'hollow', label: 'Hollow candles' },
  { id: 'bars', label: 'Bars' },
  { id: 'line', label: 'Line' },
  { id: 'area', label: 'Area' },
  { id: 'baseline', label: 'Baseline' },
  { id: 'heikin', label: 'Heikin Ashi' },
  { id: 'renko', label: 'Renko' },
  { id: 'range', label: 'Range' },
  { id: 'footprint', label: 'Footprint' },
];

const TYPE_ALIASES = {
  candle: 'candles', candlestick: 'candles', candlesticks: 'candles', hollow_candles: 'hollow', hollowcandles: 'hollow',
  bar: 'bars', ohlc: 'bars', heikin_ashi: 'heikin', heikinashi: 'heikin', ha: 'heikin', range_bars: 'range', rangebars: 'range',
  cluster: 'footprint', clusters: 'footprint', orderflow: 'footprint', lines: 'line',
};

export function normalizeChartType(t) {
  if (!t) return null;
  const s = String(t).trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (CHART_TYPES.some((c) => c.id === s)) return s;
  return TYPE_ALIASES[s] || null;
}

const PAGE = 2000;
export const DEFAULT_SYMBOL = 'delta:BTCUSD';

/** Provider + market label from a symbol key prefix (§1, §13.1). */
export function providerOf(symbol) {
  const cat = String(symbol).includes(':') ? String(symbol).split(':')[0] : '';
  if (cat === 'delta') return { provider: 'delta', name: 'Delta', market: '' };
  const market = { linear: 'Perpetual', inverse: 'Inverse', spot: 'Spot' }[cat] || cat;
  return { provider: 'bybit', name: 'Bybit', market };
}
const symbolInfoCache = new Map();

const resolveClient = (c) => {
  const api = c.api || c.default?.api || null;
  const socket = c.socket || c.default?.socket || null;
  return { api, socket };
};

function normalizeCandle(c) {
  if (Array.isArray(c)) return { t: toMs(+c[0]), o: +c[1], h: +c[2], l: +c[3], c: +c[4], v: +(c[5] || 0) };
  return {
    t: toMs(c.t ?? c.time ?? c.openTime ?? c.start),
    o: +(c.o ?? c.open),
    h: +(c.h ?? c.high),
    l: +(c.l ?? c.low),
    c: +(c.c ?? c.close),
    v: +(c.v ?? c.volume ?? 0),
  };
}

function cleanCandles(list) {
  const arr = list.map(normalizeCandle).filter((c) => Number.isFinite(c.t) && Number.isFinite(c.c));
  arr.sort((a, b) => a.t - b.t);
  const out = [];
  for (const c of arr) {
    if (out.length && out[out.length - 1].t === c.t) out[out.length - 1] = c;
    else out.push(c);
  }
  return out;
}

export class ChartView extends Emitter {
  /**
   * @param {HTMLElement} containerEl
   * @param {{ id?: string, symbol?: string, tf?: string, chartType?: string, api?: any, socket?: any,
   *           volume?: boolean, volumeProfile?: boolean, renko?: object, range?: object, footprint?: object }} opts
   */
  constructor(containerEl, opts = {}) {
    super();
    const fallback = resolveClient(client);
    this.api = opts.api || fallback.api;
    this.socket = opts.socket || fallback.socket;
    this.id = opts.id || `chart-${Math.random().toString(36).slice(2, 8)}`;
    this.symbol = opts.symbol || DEFAULT_SYMBOL;
    this.tf = normalizeTf(opts.tf) || '1h';
    this.chartType = normalizeChartType(opts.chartType) || 'candles';
    this.options = {
      volume: opts.volume !== false,
      renko: { mode: 'atr', atrLength: 14, boxSize: null, ...(opts.renko || {}) },
      range: { range: null, ...(opts.range || {}) },
      footprint: { ...(opts.footprint || {}) },
    };
    this.precision = 2;
    this.tickSize = 0.01;
    this._candles = [];
    this._display = [];
    this._fp = new Map();
    this._fpLoadedFrom = Infinity;
    this._markers = [];
    this._subs = [];
    this._priceClickFns = new Set();
    this._loadToken = 0;
    this._exhausted = false;
    this._loadingOlder = false;
    this._hoverBar = null;
    this._serverSecondsKlines = false;
    this._destroyed = false;

    this._buildDom(containerEl);
    this.chart = createChart(this.canvasHost, chartOptions());
    this._applyTfScaleOptions();

    this.volumeSeries = this.chart.addSeries(HistogramSeries, {
      priceScaleId: 'vol',
      priceFormat: { type: 'volume' },
      lastValueVisible: false,
      priceLineVisible: false,
      base: 0,
    });
    this.chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 }, visible: false });
    this.volumeSeries.applyOptions({ visible: this.options.volume });

    this.countdown = new CountdownPrimitive(() => this._countdownState());
    this.vpvr = new VolumeProfilePrimitive(() => this._vpvrData());
    this.vpvr.setEnabled(!!opts.volumeProfile);
    this.alertLines = new AlertLinesPrimitive((p) => this.formatPrice(p));
    this.alertCtl = new AlertLineController(this, this.alertLines); // before drawings: gets mousedown first
    this.drawings = new DrawingManager(this);
    this.indicators = new IndicatorManager(this);
    this.replay = new ReplayController(this);
    this.replayBar = new ReplayBar(this.root, this.replay, this);

    this._createMainSeries();
    this._wireChartEvents();
    this._wireSocket();

    this._rebuildThrottled = throttle(() => this._rebuild(), 250);
    this._fpEnsure = debounce(() => this._ensureFootprintVisible(), 300);
    this._fpHintDebounced = debounce(() => this._updateFpHint(), 150);
    this._loadSymbolInfo();
    this._load({ drawings: true });
  }

  // ================================================================== DOM
  _buildDom(container) {
    this.container = container;
    this.root = el('div', { class: 'tv-chart', 'data-chart-id': this.id });
    this.canvasHost = el('div', { class: 'tv-chart-canvas' });
    this.legend = el('div', { class: 'tv-legend' });
    this._legendMain = el('div', { class: 'tv-legend-main' });
    this._legendInd = el('div', { class: 'tv-legend-inds' });
    this.legend.append(this._legendMain, this._legendInd);

    this._scaleCtl = el('div', { class: 'tv-scale-ctl' });
    this._btnPct = el('button', { class: 'tv-scale-btn', title: 'Toggle percentage scale', text: '%', onclick: () => this.setScaleMode(this._scaleMode === 'percent' ? 'normal' : 'percent') });
    this._btnLog = el('button', { class: 'tv-scale-btn', title: 'Toggle log scale', text: 'log', onclick: () => this.setScaleMode(this._scaleMode === 'log' ? 'normal' : 'log') });
    this._btnAuto = el('button', { class: 'tv-scale-btn tv-on', title: 'Auto (fits data to screen)', text: 'auto', onclick: () => this.setAutoScale(!this._autoScale) });
    this._scaleCtl.append(this._btnPct, this._btnLog, this._btnAuto);
    this._scaleMode = 'normal';
    this._autoScale = true;

    this._goRt = el('button', {
      class: 'tv-go-rt',
      title: 'Scroll to the most recent bar',
      hidden: true,
      html: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 3l4 4-4 4M8 3l4 4-4 4"/></svg>',
      onclick: () => this.chart.timeScale().scrollToRealTime(),
    });

    this._plus = el('button', { class: 'tv-price-plus', title: 'Add alert at this price', hidden: true, html: '<svg width="12" height="12" viewBox="0 0 12 12" stroke="currentColor" stroke-width="1.5"><path d="M6 1v10M1 6h10"/></svg>' });
    this._plusHover = false;
    this._plus.addEventListener('mouseenter', () => (this._plusHover = true));
    this._plus.addEventListener('mouseleave', () => {
      this._plusHover = false;
      this._plus.hidden = true;
    });
    this._plus.addEventListener('mousedown', (e) => e.stopPropagation());
    this._plus.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this._plusPrice != null) this._firePriceClick(this._plusPrice, this._plusTime);
    });

    this._status = el('div', { class: 'tv-chart-status', hidden: true });
    this._fpHint = el('div', { class: 'tv-fp-hint', hidden: true });

    this.canvasHost.append(this.legend, this._scaleCtl, this._goRt, this._plus, this._status, this._fpHint);
    this.root.append(this.canvasHost);
    container.append(this.root);
    this.root.addEventListener('mousedown', () => this.emit('focus', this), true);
    this._mouseInside = false;
    this.canvasHost.addEventListener('mouseenter', () => (this._mouseInside = true));
    this.canvasHost.addEventListener('mouseleave', () => (this._mouseInside = false));
  }

  _setStatus(kind, text) {
    const s = this._status;
    if (!kind) {
      s.hidden = true;
      return;
    }
    s.hidden = false;
    s.className = `tv-chart-status tv-status-${kind}`;
    s.innerHTML = '';
    if (kind === 'loading') s.append(el('div', { class: 'tv-spinner' }));
    s.append(el('div', { class: 'tv-status-text', text }));
    if (kind === 'error') s.append(el('button', { class: 'tv-btn', text: 'Retry', onclick: () => this.reload() }));
  }

  // ================================================================== series
  _priceFormat() {
    return { type: 'price', precision: this.precision, minMove: this.tickSize || Math.pow(10, -this.precision) };
  }

  _createMainSeries() {
    const chart = this.chart;
    const type = this.chartType;
    const common = {
      priceFormat: this._priceFormat(),
      priceLineVisible: true,
      lastValueVisible: true,
      priceLineStyle: LineStyle.Dotted,
      priceLineWidth: 1,
    };
    const candle = {
      upColor: THEME.up,
      downColor: THEME.down,
      borderVisible: false,
      borderUpColor: THEME.up,
      borderDownColor: THEME.down,
      wickUpColor: THEME.up,
      wickDownColor: THEME.down,
    };
    let s;
    switch (type) {
      case 'hollow':
        s = chart.addSeries(CandlestickSeries, { ...common, ...candle, borderVisible: true }, 0);
        break;
      case 'bars':
        s = chart.addSeries(BarSeries, { ...common, upColor: THEME.up, downColor: THEME.down, thinBars: false, openVisible: true }, 0);
        break;
      case 'line':
        s = chart.addSeries(LineSeries, { ...common, color: '#2962ff', lineWidth: 2, crosshairMarkerRadius: 4 }, 0);
        break;
      case 'area':
        s = chart.addSeries(AreaSeries, { ...common, lineColor: '#2962ff', topColor: 'rgba(41,98,255,0.32)', bottomColor: 'rgba(41,98,255,0.02)', lineWidth: 2 }, 0);
        break;
      case 'baseline':
        s = chart.addSeries(BaselineSeries, {
          ...common,
          baseValue: { type: 'price', price: 0 },
          topLineColor: THEME.up,
          topFillColor1: 'rgba(38,166,154,0.28)',
          topFillColor2: 'rgba(38,166,154,0.05)',
          bottomLineColor: THEME.down,
          bottomFillColor1: 'rgba(239,83,80,0.05)',
          bottomFillColor2: 'rgba(239,83,80,0.28)',
          lineWidth: 2,
        }, 0);
        break;
      case 'footprint':
        s = chart.addCustomSeries(new FootprintSeries(), { ...common, ...FOOTPRINT_DEFAULTS, ...this.options.footprint, priceLineVisible: true }, 0);
        break;
      default:
        s = chart.addSeries(CandlestickSeries, { ...common, ...candle }, 0);
    }
    this.mainSeries = s;
    s.attachPrimitive(this.vpvr);
    s.attachPrimitive(this.countdown);
    s.attachPrimitive(this.alertLines);
    this.drawings.attach(s);
    this._markersApi = createSeriesMarkers(s, this._markers, { zOrder: 'top' });
    if (this._positionLine) this.setPositionLine(this._positionLine);
  }

  _destroyMainSeries() {
    const s = this.mainSeries;
    if (!s) return;
    this.drawings.detach();
    try {
      this._markersApi?.detach();
    } catch { /* ignore */ }
    for (const p of [this.vpvr, this.countdown, this.alertLines]) {
      try {
        s.detachPrimitive(p);
      } catch { /* ignore */ }
    }
    this.chart.removeSeries(s);
    this.mainSeries = null;
  }

  get isTimeBased() {
    return this.chartType !== 'renko' && this.chartType !== 'range';
  }

  get tfMs() {
    return tfToMs(this.tf);
  }

  get candles() {
    return this._candles;
  }

  get displayBars() {
    return this._display;
  }

  /** Last real candle currently shown (replay aware). */
  get lastBar() {
    if (this.replay?.active) {
      const i = this.replay.index;
      return i >= 0 ? this._candles[i] : null;
    }
    return this._candles.length ? this._candles[this._candles.length - 1] : null;
  }

  get lastPrice() {
    return this.lastBar ? this.lastBar.c : null;
  }

  _visibleCandles() {
    if (this.replay?.active) return this._candles.slice(0, this.replay.index + 1);
    return this._candles;
  }

  /** Candles for indicator computation. display=true → bars as displayed for non-time-based types. */
  indicatorCandles(display = true) {
    if (display && !this.isTimeBased) return this._display;
    return this._visibleCandles();
  }

  _computeDisplay(src) {
    switch (this.chartType) {
      case 'heikin':
        return heikinAshi(src);
      case 'renko': {
        const r = renko(src, { ...this.options.renko, tick: this.tickSize, minStep: 1000 });
        this._boxInfo = `box ${this.formatPrice(r.box)}`;
        return r.bars;
      }
      case 'range': {
        const r = rangeBars(src, { ...this.options.range, tick: this.tickSize, minStep: 1000 });
        this._boxInfo = `range ${this.formatPrice(r.range)}`;
        return r.bars;
      }
      default:
        this._boxInfo = null;
        return src;
    }
  }

  _toItem(b, i, bars) {
    const time = toSec(b.t);
    switch (this.chartType) {
      case 'line':
      case 'area':
      case 'baseline':
        return { time, value: b.c };
      case 'hollow': {
        const prev = i > 0 ? bars[i - 1].c : b.o;
        const col = b.c >= prev ? THEME.up : THEME.down;
        return { time, open: b.o, high: b.h, low: b.l, close: b.c, color: b.c > b.o ? 'rgba(0,0,0,0)' : col, borderColor: col, wickColor: col };
      }
      case 'footprint':
        return toFootprintItem(b, this._fp.get(b.t));
      default:
        return { time, open: b.o, high: b.h, low: b.l, close: b.c };
    }
  }

  _volItem(b, i, bars) {
    const prev = i > 0 ? bars[i - 1] : null;
    const up = this.chartType === 'hollow' && prev ? b.c >= prev.c : b.c >= b.o;
    return { time: toSec(b.t), value: b.v || 0, color: up ? 'rgba(38,166,154,0.45)' : 'rgba(239,83,80,0.45)' };
  }

  _rebuild() {
    if (this._destroyed || !this.mainSeries) return;

    const src = this._visibleCandles();
    const bars = this._computeDisplay(src);
    this._display = bars;
    if (this.chartType === 'baseline' && bars.length) {
      const tail = bars.slice(-200);
      const avg = tail.reduce((a, b) => a + b.c, 0) / tail.length;
      this.mainSeries.applyOptions({ baseValue: { type: 'price', price: +avg.toFixed(this.precision) } });
    }
    this.mainSeries.setData(bars.map((b, i) => this._toItem(b, i, bars)));
    this.volumeSeries.setData(bars.map((b, i) => this._volItem(b, i, bars)));
    this.volumeSeries.applyOptions({ visible: this.options.volume && this.chartType !== 'footprint' });
    this.vpvr.invalidate();
    this._refreshLegend();
    this._updateFpHint();
  }

  /** Empty-state hint when footprint mode has no footprint bars in the visible range (e.g. Delta history before recording). */
  _updateFpHint() {
    const h = this._fpHint;
    if (!h) return;
    if (this.chartType !== 'footprint' || !this._display.length || this._fpPending) {
      h.hidden = true;
      return;
    }
    const r = this.chart.timeScale().getVisibleLogicalRange();
    const bars = this._display;
    const from = clamp(Math.floor(r ? r.from : 0), 0, bars.length - 1);
    const to = clamp(Math.ceil(r ? r.to : bars.length - 1), 0, bars.length - 1);
    let any = false;
    for (let i = from; i <= to && !any; i++) any = this._fp.has(bars[i].t);
    if (any) {
      h.hidden = true;
      return;
    }
    const prov = providerOf(this.symbol);
    h.hidden = false;
    h.innerHTML = '';
    h.append(
      el('div', { class: 'tv-fp-hint-title', text: 'No footprint data for this range' }),
      el('div', {
        class: 'tv-fp-hint-text',
        text: prov.provider === 'delta'
          ? 'Delta footprint history exists only from when the server started recording trades. Scroll to recent bars, or switch to candles.'
          : 'Footprint history has not been backfilled for this range yet. Scroll to recent bars or run the footprint backfill.',
      }),
    );
  }

  /** Push the last visible candle into the series incrementally (live tick / replay step). */
  _pushLast(prevLen) {
    const src = this._visibleCandles();
    const c = src[src.length - 1];
    if (!c) return;
    const type = this.chartType;
    if (type === 'renko' || type === 'range') return this._rebuildThrottled();
    const disp = this._display;
    const appended = src.length > prevLen;
    if (type === 'heikin') {
      const prevHa = disp.length > (appended ? 0 : 1) ? disp[disp.length - (appended ? 1 : 2)] : null;
      const ha = heikinAshiNext(prevHa, c);
      if (appended) disp.push(ha);
      else disp[disp.length - 1] = ha;
    } else if (disp !== src) {
      this._display = src;
    }
    const bars = this._display;
    const i = bars.length - 1;
    try {
      this.mainSeries.update(this._toItem(bars[i], i, bars));
      this.volumeSeries.update(this._volItem(bars[i], i, bars));
    } catch {
      this._rebuild();
      return;
    }
    this.vpvr.invalidate();
    if (!this._hoverBar) this._refreshLegend();
  }

  // ================================================================== loading
  async _load({ drawings = false } = {}) {
    const token = ++this._loadToken;
    this._unsubscribe();
    this._candles = [];
    this._display = [];
    this._fp.clear();
    this._fpLoadedFrom = Infinity;
    this._exhausted = false;
    this._serverSecondsKlines = false;
    this.mainSeries?.setData([]);
    this.volumeSeries.setData([]);
    this._setStatus('loading', `Loading ${this._bareSymbol()} · ${tfLabel(this.tf)}…`);
    if (drawings) this.drawings.load(this.symbol);
    this._subscribe();
    let candles = [];
    let failed = null;
    try {
      const res = await apiRequest(this.api, 'get', '/api/candles', { symbol: this.symbol, tf: this.tf, limit: PAGE });
      candles = cleanCandles(unwrapList(res, 'candles'));
    } catch (e) {
      failed = e;
    }
    if (token !== this._loadToken || this._destroyed) return;
    // merge anything that streamed in while loading
    const live = this._candles;
    this._candles = candles;
    for (const c of live) this._upsert(c);
    if (candles.length < PAGE / 4 && !isSecondsTf(this.tf)) this._exhausted = candles.length === 0 ? false : this._exhausted;
    if (!this._candles.length) {
      if (isSecondsTf(this.tf)) this._setStatus('info', 'Waiting for live trades…');
      else if (failed) this._setStatus('error', `Could not load ${this._bareSymbol()}: ${failed.message || failed}`);
      else this._setStatus('info', 'No data');
    } else this._setStatus(null);
    if (!this.precisionFromInfo && this._candles.length) {
      this.precision = inferPrecision(this._candles);
      this.tickSize = Math.pow(10, -this.precision);
      this.mainSeries.applyOptions({ priceFormat: this._priceFormat() });
    }
    this._rebuild();
    this._resetView();
    if (this.chartType === 'footprint') this._loadFootprint();
    this.indicators.onDataReset();
    this.emit('loaded', { symbol: this.symbol, tf: this.tf, count: this._candles.length });
    const lp = this.lastPrice;
    if (lp != null) this.emit('price', { symbol: this.symbol, price: lp, t: this.lastBar.t });
  }

  reload() {
    return this._load({ drawings: false });
  }

  _resetView() {
    const ts = this.chart.timeScale();
    const n = this._display.length;
    const barSpacing = this.chartType === 'footprint' ? 96 : 7;
    ts.applyOptions({ barSpacing, rightOffset: this.chartType === 'footprint' ? 3 : 8 });
    if (n) {
      const width = ts.width() || 800;
      const count = Math.max(20, Math.floor(width / barSpacing));
      ts.setVisibleLogicalRange({ from: n - count, to: n + (this.chartType === 'footprint' ? 2 : 6) });
    }
  }

  async _loadOlder() {
    if (this._loadingOlder || this._exhausted || !this._candles.length || this.replay?.selecting) return;
    this._loadingOlder = true;
    const token = this._loadToken;
    const first = this._candles[0].t;
    try {
      const res = await apiRequest(this.api, 'get', '/api/candles', { symbol: this.symbol, tf: this.tf, to: first - 1, limit: PAGE });
      if (token !== this._loadToken || this._destroyed) return;
      const older = cleanCandles(unwrapList(res, 'candles')).filter((c) => c.t < first);
      if (!older.length) {
        this._exhausted = true;
        return;
      }
      this._candles = older.concat(this._candles);
      this._rebuild();
      if (this.chartType === 'footprint') this._fpEnsure();
      this.indicators.recomputeAll({ pine: true });
    } catch (e) {
      console.warn('[chart] older history failed', e.message);
    } finally {
      this._loadingOlder = false;
    }
  }

  /** Make sure history reaches back to `t` (used by replay/jump). */
  async ensureHistory(t, maxPages = 40) {
    let pages = 0;
    while (this._candles.length && this._candles[0].t > t && !this._exhausted && pages++ < maxPages) {
      const before = this._candles.length;
      await this._loadOlder();
      if (this._candles.length === before) break;
    }
    return this._candles.length && this._candles[0].t <= t;
  }

  async _loadSymbolInfo() {
    const sym = this.symbol;
    this.precisionFromInfo = false;
    try {
      let info = symbolInfoCache.get(sym);
      if (!info) {
        const res = await apiRequest(this.api, 'get', '/api/symbols', { q: this._bareSymbol() });
        const list = unwrapList(res, 'symbols');
        info = list.find((s) => s.key === sym) || list.find((s) => s.symbol === this._bareSymbol()) || null;
        if (info) symbolInfoCache.set(sym, info);
      }
      if (sym !== this.symbol || !info || this._destroyed) return;
      this.symbolInfo = info;
      const tick = +info.tickSize;
      if (tick > 0) {
        this.tickSize = tick;
        this.precision = decimalsOf(tick);
        this.precisionFromInfo = true;
        this.mainSeries?.applyOptions({ priceFormat: this._priceFormat() });
        this._refreshLegend();
      }
    } catch { /* offline: precision inferred from data */ }
  }

  // ---------------------------------------------------------------- footprint data
  async _loadFootprint(from, to) {
    const n = this._candles.length;
    if (!n) return;
    const tfm = this.tfMs;
    to = to ?? this._candles[n - 1].t + tfm;
    from = from ?? this._candles[Math.max(0, n - 300)].t;
    const token = this._loadToken;
    this._fpPending = true;
    try {
      const res = await apiRequest(this.api, 'get', '/api/footprint', { symbol: this.symbol, tf: this.tf, from, to });
      if (token !== this._loadToken || this._destroyed) return;
      for (const b of unwrapList(res, 'bars')) {
        const t = toMs(b.t);
        if (t != null) this._fp.set(t, b);
      }
      this._fpLoadedFrom = Math.min(this._fpLoadedFrom, from);
      if (this.chartType === 'footprint') this._rebuild();
      this.vpvr.invalidate();
    } catch (e) {
      console.warn('[chart] footprint load failed', e.message);
      this._fpLoadedFrom = Math.min(this._fpLoadedFrom, from);
    } finally {
      if (token === this._loadToken) {
        this._fpPending = false;
        this._updateFpHint();
      }
    }
  }

  _ensureFootprintVisible() {
    if (this.chartType !== 'footprint' || !this._display.length) return;
    const r = this.chart.timeScale().getVisibleLogicalRange();
    if (!r) return;
    const i = clamp(Math.floor(r.from), 0, this._display.length - 1);
    const t = this._display[i].t;
    if (t < this._fpLoadedFrom) {
      const j = Math.max(0, i - 200);
      this._loadFootprint(this._display[j].t, this._fpLoadedFrom);
    }
  }

  // ================================================================== live data
  _wireSocket() {
    const s = this.socket;
    this._offs = [
      listen(s, 'kline', (m) => this._onKline(m)),
      listen(s, 'trade', (m) => this._onTrades(m)),
      listen(s, 'trades', (m) => this._onTrades(m)),
      listen(s, 'footprint', (m) => this._onFootprint(m)),
    ];
  }

  _subscribe() {
    const s = this.socket;
    if (!s || typeof s.subscribe !== 'function') return;
    const subs = [['kline', this.symbol, this.tf]];
    if (isSecondsTf(this.tf)) subs.push(['trades', this.symbol]);
    if (this.chartType === 'footprint') subs.push(['footprint', this.symbol, this.tf]);
    for (const sub of subs) {
      try {
        s.subscribe(...sub);
      } catch (e) {
        console.warn('[chart] subscribe failed', e);
      }
    }
    this._subs = subs;
  }

  _unsubscribe() {
    const s = this.socket;
    if (s && typeof s.unsubscribe === 'function') {
      for (const sub of this._subs) {
        try {
          s.unsubscribe(...sub);
        } catch { /* ignore */ }
      }
    }
    this._subs = [];
  }

  _upsert(c) {
    const arr = this._candles;
    const last = arr[arr.length - 1];
    if (!last || c.t > last.t) {
      arr.push(c);
      return 'append';
    }
    if (c.t === last.t) {
      arr[arr.length - 1] = c;
      return 'update';
    }
    const i = lowerIndex(arr, c.t);
    if (i >= 0 && arr[i].t === c.t) arr[i] = c;
    else arr.splice(i + 1, 0, c);
    return 'insert';
  }

  _onKline(m) {
    if (!m || m.symbol !== this.symbol || normalizeTf(m.tf) !== this.tf || !m.candle) return;
    if (isSecondsTf(this.tf)) this._serverSecondsKlines = true;
    this._ingest(normalizeCandle(m.candle), !!m.closed);
  }

  _onTrades(m) {
    if (!m || m.symbol !== this.symbol || !isSecondsTf(this.tf) || this._serverSecondsKlines) return;
    const trades = m.trades || (m.trade ? [m.trade] : []);
    if (!trades.length) return;
    let lastClosed = false;
    for (const tr of trades) {
      const t = toMs(tr.t ?? tr.time);
      const p = +(tr.p ?? tr.price);
      const q = +(tr.q ?? tr.qty ?? tr.size ?? 0);
      if (!Number.isFinite(t) || !Number.isFinite(p)) continue;
      const bt = floorTime(t, this.tf);
      const arr = this._candles;
      const last = arr[arr.length - 1];
      if (last && last.t === bt) {
        const c = { ...last, h: Math.max(last.h, p), l: Math.min(last.l, p), c: p, v: last.v + q };
        this._ingest(c, false, true);
      } else if (!last || bt > last.t) {
        if (last) lastClosed = true;
        this._ingest({ t: bt, o: p, h: p, l: p, c: p, v: q }, false, true);
      }
    }
    if (lastClosed) this.indicators.onBarClose();
  }

  _ingest(c, closed, fromTrades = false) {
    const prevLen = this._candles.length;
    const kind = this._upsert(c);
    if (!prevLen && this._candles.length) this._setStatus(null);
    if (this.replay?.active) {
      this.replay.onLiveData();
      return;
    }
    if (kind === 'insert' || !this.mainSeries) this._rebuild();
    else this._pushLast(prevLen);
    this.emit('price', { symbol: this.symbol, price: c.c, t: c.t });
    if (closed || (kind === 'append' && prevLen && !fromTrades)) this.indicators.onBarClose();
    else this.indicators.onTick();
  }

  _onFootprint(m) {
    if (!m || m.symbol !== this.symbol || normalizeTf(m.tf) !== this.tf || !m.bar) return;
    const t = toMs(m.bar.t);
    this._fp.set(t, m.bar);
    if (this.chartType !== 'footprint' || this.replay?.active) return;
    const i = lowerIndex(this._display, t);
    if (i >= 0 && this._display[i].t === t) {
      try {
        this.mainSeries.update(this._toItem(this._display[i], i, this._display), i < this._display.length - 1);
      } catch {
        this._rebuildThrottled();
      }
    }
  }

  // ================================================================== chart events
  _wireChartEvents() {
    const chart = this.chart;
    const ts = chart.timeScale();
    this._onRange = (r) => {
      if (!r) return;
      if (r.from < 40) this._loadOlder();
      this._goRt.hidden = ts.scrollPosition() > -3;
      this._fpEnsure();
      if (this.chartType === 'footprint') this._fpHintDebounced();
    };
    ts.subscribeVisibleLogicalRangeChange(this._onRange);
    this._onTimeRange = (r) => {
      if (!r || this._applyingRange) return;
      this.emit('range', { from: r.from * 1000, to: r.to * 1000 });
    };
    ts.subscribeVisibleTimeRangeChange(this._onTimeRange);

    this._onCrosshair = (param) => {
      const pt = param.point;
      if (!pt || param.time == null || param.paneIndex > 0 && param.paneIndex == null) {
        this._hoverBar = null;
        // the pointer may be moving onto the "+" button itself: decide after its mouseenter fired
        clearTimeout(this._plusHideT);
        this._plusHideT = setTimeout(() => {
          if (!this._plusHover && !this._crosshairInPane) this._plus.hidden = true;
        }, 60);
        this._crosshairInPane = false;
        this._refreshLegend();
        if (!this._syncingCrosshair) this.emit('crosshair', null);
        return;
      }
      this._crosshairInPane = true;
      const t = param.time * 1000;
      const i = lowerIndex(this._display, t);
      this._hoverBar = i >= 0 ? { bar: this._display[i], prev: this._display[i - 1] } : null;
      this._refreshLegend();
      let price = null;
      if ((param.paneIndex ?? 0) === 0 && this.mainSeries) price = this.mainSeries.coordinateToPrice(pt.y);
      if (price != null && (param.paneIndex ?? 0) === 0 && this._mouseInside) {
        const size = chart.paneSize(0);
        this._plusPrice = this.roundPrice(price);
        this._plusTime = t;
        this._plus.hidden = false;
        this._plus.style.top = `${pt.y - 9}px`;
        this._plus.style.left = `${size.width - 22}px`;
      } else if (!this._plusHover) this._plus.hidden = true;
      if (!this._syncingCrosshair) this.emit('crosshair', { time: t, price, point: pt, paneIndex: param.paneIndex ?? 0 });
    };
    chart.subscribeCrosshairMove(this._onCrosshair);

    this._onClick = (param) => {
      if (!param.point) return;
      if (this.replay.selecting) {
        const t = param.time != null ? param.time * 1000 : this.xToTime(param.point.x);
        this.replay.start(this._displayTimeToCandleTime(t));
        return;
      }
      const ev = param.sourceEvent;
      if (ev && ev.altKey && (param.paneIndex ?? 0) === 0 && !this.drawings.tool) {
        const price = this.mainSeries.coordinateToPrice(param.point.y);
        if (price != null) this._firePriceClick(this.roundPrice(price), param.time ? param.time * 1000 : null);
      }
    };
    chart.subscribeClick(this._onClick);

    this._ro = new ResizeObserver(() => this._positionScaleCtl());
    this._ro.observe(this.canvasHost);
    chart.timeScale().subscribeSizeChange(() => this._positionScaleCtl());
  }

  _positionScaleCtl() {
    try {
      const w = this.chart.priceScale('right').width();
      this._scaleCtl.style.right = `${w + 6}px`;
      this._goRt.style.right = `${w + 8}px`;
    } catch { /* not ready */ }
  }

  _displayTimeToCandleTime(t) {
    if (this.isTimeBased) return floorTime(t, this.tf);
    const i = lowerIndex(this._candles, t);
    return i >= 0 ? this._candles[i].t : t;
  }

  setInteractive(on) {
    this.chart.applyOptions({ handleScroll: on ? { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true } : false, handleScale: on ? { axisPressedMouseMove: { time: true, price: true }, mouseWheel: true, pinch: true } : false });
  }

  // ================================================================== legend
  _bareSymbol() {
    const s = String(this.symbol);
    return s.includes(':') ? s.split(':')[1] : s;
  }

  _category() {
    const s = String(this.symbol);
    return s.includes(':') ? s.split(':')[0] : '';
  }

  _legendRefresh() {
    this._refreshLegend();
  }

  _refreshLegend() {
    if (this._legendRaf) return;
    this._legendRaf = requestAnimationFrame(() => {
      this._legendRaf = null;
      this._renderLegend();
    });
  }

  _renderLegend() {
    const hb = this._hoverBar;
    const bars = this._display;
    const bar = hb ? hb.bar : bars[bars.length - 1];
    const prev = hb ? hb.prev : bars[bars.length - 2];
    const m = this._legendMain;
    const prov = providerOf(this.symbol);
    const infoType = this.symbolInfo?.contract_type || this.symbolInfo?.contractType || this.symbolInfo?.type;
    const market = prov.market || (infoType ? String(infoType).replace(/_/g, ' ').replace(/\bfutures\b/, '').trim() : '');
    const catLabel = [prov.name, market].filter(Boolean).join(' ');
    const typeLabel = CHART_TYPES.find((c) => c.id === this.chartType)?.label;
    const parts = [];
    parts.push(`<span class="tv-lg-sym" data-act="symbol">${this._bareSymbol()}</span>`);
    parts.push(`<span class="tv-lg-dot">·</span><span class="tv-lg-tf">${tfLabel(this.tf)}</span>`);
    if (catLabel) parts.push(`<span class="tv-lg-dot">·</span><span class="tv-lg-ex">${catLabel}</span>`);
    if (this.chartType !== 'candles') parts.push(`<span class="tv-lg-dot">·</span><span class="tv-lg-ex">${typeLabel}${this._boxInfo ? ` (${this._boxInfo})` : ''}</span>`);
    if (this.replay?.active) parts.push('<span class="tv-lg-badge">REPLAY</span>');
    let ohlc = '';
    if (bar) {
      const up = bar.c >= bar.o;
      const cls = up ? 'tv-up' : 'tv-down';
      const ref = prev ? prev.c : bar.o;
      const ch = bar.c - ref;
      const chp = ref ? (ch / ref) * 100 : 0;
      const f = (v) => this.formatPrice(v);
      ohlc = `<span class="tv-lg-ohlc">` +
        `<span>O<b class="${cls}">${f(bar.o)}</b></span>` +
        `<span>H<b class="${cls}">${f(bar.h)}</b></span>` +
        `<span>L<b class="${cls}">${f(bar.l)}</b></span>` +
        `<span>C<b class="${cls}">${f(bar.c)}</b></span>` +
        `<b class="${ch >= 0 ? 'tv-up' : 'tv-down'}">${ch >= 0 ? '+' : ''}${f(ch)} (${formatPercent(chp)})</b>` +
        `</span>`;
      if (this.options.volume) ohlc += `<span class="tv-lg-vol">Vol <b class="${cls}">${formatCompact(bar.v)}</b></span>`;
      if (this.chartType === 'footprint') {
        const fp = this._fp.get(bar.t);
        if (fp) {
          const item = toFootprintItem(bar, fp);
          ohlc += `<span class="tv-lg-vol">Δ <b class="${item.delta >= 0 ? 'tv-up' : 'tv-down'}">${formatCompact(item.delta)}</b></span>`;
        }
      }
    }
    m.innerHTML = `<div class="tv-lg-title">${parts.join('')}</div>${ohlc}`;
    const symEl = m.querySelector('[data-act="symbol"]');
    if (symEl) symEl.onclick = () => this.emit('symbol-search', { chart: this });

    // indicators
    const t = bar ? bar.t : null;
    const rows = t != null ? this.indicators.valuesAt(t) : this.indicators.valuesAt(0);
    this._legendInd.innerHTML = '';
    for (const r of rows) {
      const row = el('div', { class: `tv-lg-ind${r.visible ? '' : ' tv-lg-off'}` });
      row.append(el('span', { class: 'tv-lg-ind-title', text: r.title }));
      if (r.status === 'pending') row.append(el('span', { class: 'tv-lg-pending', title: 'Computing…' }));
      if (r.error && r.status !== 'pine') row.append(el('span', { class: 'tv-lg-err', title: r.error, text: r.status === 'fast' ? '⚠' : '⚠ error' }));
      for (const v of r.values) {
        if (v.value == null) continue;
        row.append(el('span', { class: 'tv-lg-ind-val', style: { color: v.color }, text: this._fmtIndicator(v.value) }));
      }
      const ctl = el('span', { class: 'tv-lg-ind-ctl' });
      ctl.append(
        el('button', { title: r.visible ? 'Hide' : 'Show', html: r.visible ? EYE : EYE_OFF, onclick: () => this.indicators.setVisible(r.id, !r.visible) }),
        el('button', { title: 'Remove', html: CLOSE, onclick: () => this.removeIndicator(r.id) }),
      );
      row.append(ctl);
      this._legendInd.append(row);
    }
  }

  _fmtIndicator(v) {
    const a = Math.abs(v);
    if (a >= 1e6) return formatCompact(v);
    if (a >= 1000) return v.toFixed(Math.min(2, this.precision));
    return v.toFixed(a >= 10 ? 2 : Math.max(2, Math.min(this.precision, 6)));
  }

  // ================================================================== coordinate helpers
  _timeToLogical(t) {
    const bars = this._display;
    const n = bars.length;
    if (!n) return null;
    const tf = this.tfMs;
    if (t <= bars[0].t) return (t - bars[0].t) / tf;
    if (t >= bars[n - 1].t) return n - 1 + (t - bars[n - 1].t) / tf;
    const i = lowerIndex(bars, t);
    const a = bars[i];
    const b = bars[i + 1];
    return i + (t - a.t) / Math.max(1, b.t - a.t);
  }

  _logicalToTime(l) {
    const bars = this._display;
    const n = bars.length;
    const tf = this.tfMs;
    if (!n) return Math.round(Date.now() / tf) * tf;
    if (l <= 0) return Math.round(bars[0].t + l * tf);
    if (l >= n - 1) return Math.round(bars[n - 1].t + (l - (n - 1)) * tf);
    const i = Math.floor(l);
    const f = l - i;
    return Math.round(bars[i].t + f * (bars[i + 1].t - bars[i].t));
  }

  timeToX(t) {
    const l = this._timeToLogical(t);
    if (l == null) return null;
    // logicalToCoordinate() only resolves integral logical indices: interpolate linearly between two of them
    const ts = this.chart.timeScale();
    const i = Math.floor(l);
    const a = ts.logicalToCoordinate(i);
    if (a == null) return null;
    if (l === i) return a;
    const b = ts.logicalToCoordinate(i + 1);
    return b == null ? a : a + (b - a) * (l - i);
  }

  xToTime(x, snap = true) {
    const ts = this.chart.timeScale();
    const x0 = ts.logicalToCoordinate(0);
    const x1 = ts.logicalToCoordinate(1);
    let l;
    if (x0 == null || x1 == null || x1 === x0) l = ts.coordinateToLogical(x) ?? 0;
    else l = (x - x0) / (x1 - x0);
    if (snap) l = Math.round(l);
    return this._logicalToTime(l);
  }

  priceToY(p) {
    return this.mainSeries ? this.mainSeries.priceToCoordinate(p) : null;
  }

  yToPrice(y) {
    return this.mainSeries ? this.mainSeries.coordinateToPrice(y) : null;
  }

  formatPrice(p) {
    return formatPrice(p, this.precision);
  }

  roundPrice(p) {
    const tick = this.tickSize || Math.pow(10, -this.precision);
    return +(Math.round(p / tick) * tick).toFixed(this.precision);
  }

  /** Strong magnet: snap to the nearest OHLC value of the bar at time t. */
  snapPrice(t, price) {
    const i = lowerIndex(this._display, t);
    const b = this._display[i];
    if (!b || !this.mainSeries) return price;
    const y = this.mainSeries.priceToCoordinate(price);
    let best = price;
    let bd = Infinity;
    for (const v of [b.o, b.h, b.l, b.c]) {
      const vy = this.mainSeries.priceToCoordinate(v);
      const d = vy == null || y == null ? Math.abs(v - price) : Math.abs(vy - y);
      if (d < bd) {
        bd = d;
        best = v;
      }
    }
    return best;
  }

  barsBetween(t0, t1) {
    const a = this._timeToLogical(t0);
    const b = this._timeToLogical(t1);
    return a == null || b == null ? 0 : Math.round(b - a);
  }

  volumeBetween(t0, t1) {
    const [a, b] = t0 <= t1 ? [t0, t1] : [t1, t0];
    let v = 0;
    const src = this._display;
    for (let i = Math.max(0, lowerIndex(src, a)); i < src.length && src[i].t <= b; i++) if (src[i].t >= a) v += src[i].v || 0;
    return v;
  }

  // ================================================================== VPVR / countdown providers
  _vpvrData() {
    const bars = this._display;
    if (!bars.length) return null;
    const r = this.chart.timeScale().getVisibleLogicalRange();
    const from = clamp(Math.floor(r ? r.from : 0), 0, bars.length - 1);
    const to = clamp(Math.ceil(r ? r.to : bars.length - 1), 0, bars.length - 1);
    const slice = bars.slice(from, to + 1);
    const last = slice[slice.length - 1];
    return {
      candles: slice,
      footprint: this.chartType === 'heikin' || !this.isTimeBased ? null : this._fp,
      key: `${this.chartType}|${from}|${to}|${bars.length}|${last?.t}|${last?.c}|${last?.v}|${this._fp.size}`,
    };
  }

  _countdownState() {
    const c = this.lastBar;
    if (!c || this.replay?.active || !this.isTimeBased) return null;
    const close = nextBarTime(c.t, this.tf);
    if (close < Date.now() - this.tfMs) return null;
    const disp = this._display[this._display.length - 1];
    return { price: disp ? disp.c : c.c, closeTime: close, up: disp ? disp.c >= disp.o : c.c >= c.o };
  }

  _applyTfScaleOptions() {
    const tf = getTimeframe(this.tf);
    this.chart.applyOptions({
      timeScale: {
        timeVisible: tf ? tf.ms < 86400000 : true,
        secondsVisible: isSecondsTf(this.tf),
      },
    });
  }

  // ================================================================== public API (§12)
  setSymbol(symbol) {
    if (!symbol || symbol === this.symbol) return;
    if (this.replay.active || this.replay.selecting) this.replay.stop();
    this.symbol = String(symbol);
    this.precisionFromInfo = false;
    this.symbolInfo = null;
    this._loadSymbolInfo();
    this._load({ drawings: true });
    this.emit('symbol', this.symbol);
  }

  setTimeframe(tf) {
    const id = normalizeTf(tf);
    if (!id) throw new Error(`Unknown timeframe: ${tf}`);
    if (id === this.tf) return;
    if (this.replay.active || this.replay.selecting) this.replay.stop();
    this.tf = id;
    this._applyTfScaleOptions();
    this._load({ drawings: false });
    this.emit('tf', this.tf);
  }

  setChartType(type) {
    const t = normalizeChartType(type);
    if (!t) throw new Error(`Unknown chart type: ${type}`);
    if (t === this.chartType) return;
    const wasFootprint = this.chartType === 'footprint';
    const wasTimeBased = this.isTimeBased;
    this._destroyMainSeries();
    this.chartType = t;
    this._createMainSeries();
    this._rebuild();
    if (t === 'footprint' || wasFootprint) {
      this._unsubscribe();
      this._subscribe();
      this._resetView();
      if (t === 'footprint') this._loadFootprint();
    } else if (wasTimeBased !== this.isTimeBased) {
      this._resetView();
    }
    if (wasTimeBased !== this.isTimeBased || this.indicators.items.size) this.indicators.recomputeAll({ pine: this.isTimeBased });
    this.emit('charttype', t);
  }

  setRenkoOptions(o) {
    Object.assign(this.options.renko, o);
    if (this.chartType === 'renko') this._rebuild();
  }

  setRangeOptions(o) {
    Object.assign(this.options.range, o);
    if (this.chartType === 'range') this._rebuild();
  }

  setFootprintOptions(o) {
    Object.assign(this.options.footprint, o);
    if (this.chartType === 'footprint') this.mainSeries.applyOptions(o);
  }

  setVolumeVisible(on) {
    this.options.volume = !!on;
    this.volumeSeries.applyOptions({ visible: this.options.volume && this.chartType !== 'footprint' });
    this._refreshLegend();
  }

  setVolumeProfile(on, options) {
    if (options) this.vpvr.applyOptions(options);
    this.vpvr.setEnabled(on);
    this.emit('vpvr', !!on);
  }

  get volumeProfileEnabled() {
    return this.vpvr.enabled;
  }

  setScaleMode(mode) {
    const m = { normal: PriceScaleMode.Normal, log: PriceScaleMode.Logarithmic, percent: PriceScaleMode.Percentage, indexed: PriceScaleMode.IndexedTo100 }[mode];
    if (m == null) throw new Error(`Unknown scale mode: ${mode}`);
    this._scaleMode = mode;
    this.chart.priceScale('right', 0).applyOptions({ mode: m });
    this._btnLog.classList.toggle('tv-on', mode === 'log');
    this._btnPct.classList.toggle('tv-on', mode === 'percent');
    this.emit('scale', { mode, auto: this._autoScale });
  }

  setAutoScale(on) {
    this._autoScale = !!on;
    this.chart.priceScale('right', 0).applyOptions({ autoScale: this._autoScale });
    this._btnAuto.classList.toggle('tv-on', this._autoScale);
    this.emit('scale', { mode: this._scaleMode, auto: this._autoScale });
  }

  get scaleMode() {
    return this._scaleMode;
  }

  scrollToRealtime() {
    this.chart.timeScale().scrollToRealTime();
  }

  setVisibleRange({ from, to }) {
    if (!this._display.length) return;
    this._applyingRange = true;
    try {
      this.chart.timeScale().setVisibleRange({ from: toSec(toMs(from)), to: toSec(toMs(to)) });
    } catch { /* range outside data */ }
    setTimeout(() => (this._applyingRange = false), 0);
  }

  setCrosshair(t, price) {
    if (!this.mainSeries || !this._display.length) return;
    const i = lowerIndex(this._display, t);
    if (i < 0) return this.clearCrosshair();
    this._syncingCrosshair = true;
    try {
      const bar = this._display[i];
      this.chart.setCrosshairPosition(price ?? bar.c, toSec(bar.t), this.mainSeries);
    } finally {
      this._syncingCrosshair = false;
    }
  }

  clearCrosshair() {
    this._syncingCrosshair = true;
    try {
      this.chart.clearCrosshairPosition();
    } finally {
      this._syncingCrosshair = false;
    }
  }

  addIndicator(spec) {
    const id = this.indicators.add(typeof spec === 'string' ? { builtin: spec } : spec);
    this._refreshLegend();
    return id;
  }

  removeIndicator(id) {
    const ok = this.indicators.remove(id);
    this._refreshLegend();
    return ok;
  }

  listIndicators() {
    return this.indicators.list();
  }

  draw(spec) {
    return this.drawings.add(spec, { persist: true });
  }

  removeDrawing(id) {
    return this.drawings.remove(id);
  }

  clearDrawings() {
    this.drawings.clear();
  }

  listDrawings() {
    return this.drawings.list();
  }

  setDrawingTool(tool) {
    this.drawings.setTool(tool && tool !== 'cursor' ? tool : null);
  }

  get drawingTool() {
    return this.drawings.tool;
  }

  async startReplay(opts = {}) {
    const from = opts.from != null ? toMs(opts.from) : null;
    if (opts.speed != null) this.replay.setSpeed(+opts.speed);
    if (from == null) return this.replay.start();
    await this.replay.start(from);
    if (opts.play ?? opts.speed != null) this.replay.play();
  }

  getState() {
    let visibleRange = null;
    try {
      const r = this.chart.timeScale().getVisibleRange();
      if (r) visibleRange = { from: r.from * 1000, to: r.to * 1000 };
    } catch { /* ignore */ }
    return {
      id: this.id,
      symbol: this.symbol,
      tf: this.tf,
      chartType: this.chartType,
      visibleRange,
      indicators: this.listIndicators().map((i) => ({ id: i.id, builtin: i.builtin, title: i.title, inputs: i.inputs, overlay: i.overlay })),
      lastPrice: this.lastPrice,
      drawings: this.drawings.items.size,
      replay: this.replay.active ? { active: true, time: this.lastBar?.t ?? null, playing: this.replay.playing, speed: this.replay.speed } : undefined,
    };
  }

  onPriceClick(fn) {
    this._priceClickFns.add(fn);
    return () => this._priceClickFns.delete(fn);
  }

  _firePriceClick(price, time) {
    const payload = { price, time, symbol: this.symbol, tf: this.tf, chartId: this.id };
    for (const fn of this._priceClickFns) {
      try {
        fn(payload);
      } catch (e) {
        console.error(e);
      }
    }
    this.emit('priceclick', payload);
  }

  showAlertLine(alert) {
    if (!alert || (alert.symbol && alert.symbol !== this.symbol)) return false;
    return this.alertLines.set(alert);
  }

  removeAlertLine(id) {
    return this.alertLines.remove(id);
  }

  clearAlertLines() {
    this.alertLines.clear();
  }

  /** Replay slice changed (called by ReplayController). */
  _onReplayChange(o = {}) {
    if (o.exit) {
      this._rebuild();
      this.chart.timeScale().scrollToRealTime();
      this.indicators.recomputeAll({ pine: true });
    } else if (o.step === 1 && o.prevLen != null) {
      this._pushLast(o.prevLen);
      this.indicators.onReplay();
    } else {
      this._rebuild();
      if (o.start) this.chart.timeScale().scrollToRealTime();
      this.indicators.onReplay();
    }
    this.canvasHost.classList.toggle('tv-replay-active', !!this.replay.active);
    this._refreshLegend();
  }

  /** Paper-trading position line: { price, qty (signed), pnl } or null. */
  setPositionLine(p) {
    this._positionLine = p;
    if (this._posLineObj && this._posLineSeries) {
      try {
        this._posLineSeries.removePriceLine(this._posLineObj);
      } catch { /* series gone */ }
    }
    this._posLineObj = null;
    this._posLineSeries = null;
    if (!p || !this.mainSeries) return;
    const long = p.qty > 0;
    this._posLineObj = this.mainSeries.createPriceLine({
      price: p.price,
      color: long ? '#2962ff' : '#f23645',
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: `${long ? 'LONG' : 'SHORT'} ${Math.abs(p.qty)}${p.pnl != null ? `  ${p.pnl >= 0 ? '+' : ''}${this.formatPrice(p.pnl)}` : ''}`,
    });
    this._posLineSeries = this.mainSeries;
  }

  setMarkers(markers) {
    this._markers = markers || [];
    this._markersApi?.setMarkers(this._markers);
  }

  takeScreenshot() {
    return this.chart.takeScreenshot(true);
  }

  downloadScreenshot() {
    const canvas = this.takeScreenshot();
    const name = `${this._bareSymbol()}_${this.tf}_${formatDateTime(Date.now()).replace(/[: ]/g, '-')}.png`;
    downloadDataUrl(canvas.toDataURL('image/png'), name);
    return canvas;
  }

  /** Execute a ChartCommand (§7). Returns { ok, ...result } or throws on invalid input. */
  async executeCommand(cmd = {}) {
    const a = cmd.action;
    switch (a) {
      case 'set_symbol':
        this.setSymbol(cmd.symbol);
        return { ok: true, symbol: this.symbol };
      case 'set_timeframe':
      case 'set_interval':
        this.setTimeframe(cmd.tf ?? cmd.timeframe ?? cmd.interval);
        return { ok: true, tf: this.tf };
      case 'set_chart_type':
        this.setChartType(cmd.chartType ?? cmd.type ?? cmd.chart_type);
        return { ok: true, chartType: this.chartType };
      case 'add_indicator': {
        const spec = {
          id: cmd.id && cmd.id !== cmd.builtin ? cmd.id : undefined,
          builtin: cmd.builtin ?? (cmd.source ? undefined : cmd.indicator ?? cmd.name ?? cmd.id),
          source: cmd.source,
          inputs: cmd.inputs,
          title: cmd.title,
        };
        const id = this.addIndicator(spec);
        return { ok: true, id };
      }
      case 'remove_indicator':
        return { ok: this.removeIndicator(cmd.id ?? cmd.builtin ?? cmd.indicator) };
      case 'draw': {
        const id = this.draw({ ...cmd, createdBy: 'agent' });
        return { ok: true, id };
      }
      case 'remove_drawing':
        return { ok: this.removeDrawing(cmd.id) };
      case 'clear_drawings':
        this.clearDrawings();
        return { ok: true };
      case 'start_replay':
        await this.startReplay({ from: cmd.from, speed: cmd.speed, play: cmd.play });
        return { ok: true };
      case 'stop_replay':
        this.replay.stop();
        return { ok: true };
      case 'set_volume_profile':
        this.setVolumeProfile(cmd.enabled ?? cmd.on ?? true);
        return { ok: true };
      case 'show_alert_line':
        return { ok: this.showAlertLine(cmd.alert) };
      default:
        throw new Error(`Unsupported chart command: ${a}`);
    }
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    this._loadToken++;
    this.replay.destroy();
    this.replayBar.destroy();
    this._unsubscribe();
    for (const off of this._offs || []) off();
    this.indicators.destroy();
    this.drawings.destroy();
    this.alertCtl.destroy();
    this._ro?.disconnect();
    this._rebuildThrottled.cancel();
    this._fpEnsure.cancel();
    this._fpHintDebounced.cancel();
    if (this._legendRaf) cancelAnimationFrame(this._legendRaf);
    clearTimeout(this._plusHideT);
    try {
      this._destroyMainSeries(); // detaches primitives (stops the countdown timer)
    } catch { /* ignore */ }
    this.chart.remove();
    this.root.remove();
    this.removeAllListeners();
  }
}

const EYE = '<svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M2 9s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z"/><circle cx="9" cy="9" r="2"/></svg>';
const EYE_OFF = '<svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M2 9s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z"/><path d="M3 15L15 3"/></svg>';
const CLOSE = '<svg width="14" height="14" viewBox="0 0 14 14" stroke="currentColor" stroke-width="1.4"><path d="M3 3l8 8M11 3l-8 8"/></svg>';
