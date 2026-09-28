// Strategy Tester: POST /api/backtest (§4, §9); overview metrics, equity + drawdown chart, trade list,
// trade markers on the active chart.
import { createChart, AreaSeries, HistogramSeries, LineSeries, ColorType, LineStyle } from 'lightweight-charts';
import { h, clear, icon, add } from './util/dom.js';
import { toast } from './util/dialog.js';
import { formatNum, formatPct, formatPrice, formatDateTime, formatSigned, splitKey, TIMEFRAMES, toDateInput, toMs, DEFAULT_SYMBOL } from './util/fmt.js';
import { chartState } from './util/chartHub.js';
import { load, save } from './util/store.js';
import { symbolInfo } from './SymbolSearch.js';

const METRICS = [
  ['netProfit', 'Net profit', 'money', 'netProfitPct'],
  ['trades', 'Total closed trades', 'int'],
  ['winRate', 'Percent profitable', 'pct'],
  ['profitFactor', 'Profit factor', 'ratio'],
  ['maxDrawdown', 'Max drawdown', 'money', 'maxDrawdownPct', true],
  ['avgTrade', 'Avg trade', 'money'],
  ['sharpe', 'Sharpe ratio', 'ratio'],
  ['sortino', 'Sortino ratio', 'ratio'],
  ['grossProfit', 'Gross profit', 'money'],
  ['grossLoss', 'Gross loss', 'money', null, true],
  ['largestWin', 'Largest winning trade', 'money'],
  ['largestLoss', 'Largest losing trade', 'money'],
  ['avgWin', 'Avg winning trade', 'money'],
  ['avgLoss', 'Avg losing trade', 'money'],
  ['wins', 'Winning trades', 'int'],
  ['losses', 'Losing trades', 'int'],
  ['avgBarsInTrade', 'Avg # bars in trades', 'num'],
  ['exposure', 'Exposure', 'pct'],
  ['totalCommission', 'Commission paid', 'money'],
  ['buyHoldPct', 'Buy & hold return', 'pct'],
  ['finalEquity', 'Final equity', 'money'],
  ['initialCapital', 'Initial capital', 'money'],
];
const SUMMARY = ['netProfit', 'trades', 'winRate', 'profitFactor', 'maxDrawdown', 'sharpe'];
const KNOWN = new Set(METRICS.map((m) => m[0]).concat(METRICS.map((m) => m[3]).filter(Boolean)));

function fmtMetric(v, kind) {
  if (v == null || (typeof v === 'number' && !isFinite(v))) return '—';
  if (typeof v !== 'number') return String(v);
  switch (kind) {
    case 'money': return formatSigned(v, 2).replace(/^\+/, v > 0 ? '+' : '') + ' USDT';
    case 'pct': return formatPct(v, 2, false);
    case 'int': return String(Math.round(v));
    case 'ratio': return formatNum(v, 3);
    default: return formatNum(v, 2);
  }
}

export class StrategyTesterPanel {
  constructor(el, { layout, api, socket, app }) {
    this.el = el;
    this.layout = layout;
    this.api = api;
    this.app = app;
    this.strategies = { builtin: [], pine: [] };
    this.result = null;
    this.request = null;
    this.view = 'overview';
    this.editorSource = null;
    this.markerState = null; // { chart, ids[] | 'markers' }
    this.chart = null;

    const saved = load('tester.form', {});
    const now = Date.now();
    this.form = {
      strategy: saved.strategy || 'builtin:ema_cross',
      params: saved.params || {},
      sync: saved.sync !== false,
      symbol: saved.symbol || DEFAULT_SYMBOL,
      tf: saved.tf || '1h',
      from: toDateInput(now - 182 * 86400000),
      to: toDateInput(now),
      capital: saved.capital ?? 10000,
      commission: saved.commission ?? 0.055,
      slippage: saved.slippage ?? 1,
      sizingType: saved.sizingType || 'percent',
      sizingValue: saved.sizingValue ?? 100,
      allowLong: saved.allowLong !== false,
      allowShort: saved.allowShort !== false,
    };

    el.classList.add('panel', 'tester-panel');
    this.formEl = h('div.tester-form');
    this.resultEl = h('div.tester-result');
    add(el, this.formEl, this.resultEl);
    this.renderForm();
    this.renderResult();
    this.loadStrategies();
    app.hub.on('active', () => this.syncSymbol());
    app.hub.on('symbol', () => this.syncSymbol());
    app.hub.on('tf', () => this.syncSymbol());
  }

  persistForm() {
    const { from, to, ...rest } = this.form;
    save('tester.form', rest);
  }

  async loadStrategies() {
    try {
      const res = await this.api.get('/api/backtest/strategies');
      this.strategies = { builtin: (res && res.builtin) || [], pine: (res && res.pine) || [] };
    } catch {
      try {
        const lib = await this.api.get('/api/pine/library');
        const items = Array.isArray(lib) ? lib : (lib && lib.items) || [];
        this.strategies = { builtin: [], pine: items.filter((i) => i.type === 'strategy') };
      } catch { /* offline */ }
    }
    if (!this.strategies.builtin.length && this.form.strategy.startsWith('builtin:')) {
      this.form.strategy = this.strategies.pine.length ? `lib:${this.strategies.pine[0].id}` : 'editor';
    }
    this.renderForm();
  }

  syncSymbol() {
    if (!this.form.sync) return;
    const st = chartState(this.app.hub.active);
    if (st.symbol) this.form.symbol = st.symbol;
    if (st.tf) this.form.tf = st.tf;
    if (this.symLabel) this.symLabel.textContent = `${splitKey(this.form.symbol).symbol} · ${this.form.tf}`;
  }

  // ------------------------------------------------------------------ form

  renderForm() {
    this.syncSymbol();
    const f = this.form;
    clear(this.formEl);
    const stratSel = h('select.input.input-sm');
    const addOpt = (parent, value, label) => parent.appendChild(h('option', { value, selected: value === f.strategy }, label));
    addOpt(stratSel, 'editor', 'Pine Editor script');
    if (this.strategies.builtin.length) {
      const g = h('optgroup', { label: 'Built-in strategies' });
      for (const s of this.strategies.builtin) addOpt(g, `builtin:${s.id}`, s.name || s.id);
      stratSel.appendChild(g);
    }
    if (this.strategies.pine.length) {
      const g = h('optgroup', { label: 'Pine library strategies' });
      for (const s of this.strategies.pine) addOpt(g, `lib:${s.id}`, s.name || s.id);
      stratSel.appendChild(g);
    }
    stratSel.value = f.strategy;
    stratSel.addEventListener('change', () => { f.strategy = stratSel.value; f.params = {}; this.persistForm(); this.renderForm(); });

    const num = (key, attrs = {}) => {
      const i = h('input.input.input-sm.num', { type: 'number', step: 'any', value: String(f[key]), ...attrs });
      i.addEventListener('input', () => { f[key] = i.value === '' ? '' : Number(i.value); this.persistForm(); });
      return i;
    };
    const date = (key) => {
      const i = h('input.input.input-sm', { type: 'date', value: f[key] });
      i.addEventListener('change', () => { f[key] = i.value; });
      return i;
    };
    const cb = (key, label) => {
      const i = h('input', { type: 'checkbox', checked: !!f[key] });
      i.addEventListener('change', () => { f[key] = i.checked; this.persistForm(); if (key === 'sync') this.renderForm(); });
      return h('label.check', i, label);
    };

    this.symLabel = h('button.input.input-sm.input-btn', { type: 'button', title: f.sync ? 'Follows the active chart' : 'Pick symbol' }, `${splitKey(f.symbol).symbol} · ${f.tf}`);
    this.symLabel.addEventListener('click', () => {
      if (f.sync) return;
      this.app.openSymbolSearch({ title: 'Backtest symbol', onSelect: (k) => { f.symbol = k; this.persistForm(); this.renderForm(); } });
    });
    const tfSel = h('select.input.input-sm', { disabled: f.sync });
    for (const t of TIMEFRAMES.filter((x) => !x.endsWith('s'))) tfSel.appendChild(h('option', { value: t, selected: t === f.tf }, t));
    tfSel.value = f.tf;
    tfSel.addEventListener('change', () => { f.tf = tfSel.value; this.persistForm(); this.renderForm(); });

    const sizingSel = h('select.input.input-sm');
    for (const [v, l] of [['percent', '% of equity'], ['fixed', 'Fixed qty']]) sizingSel.appendChild(h('option', { value: v, selected: v === f.sizingType }, l));
    sizingSel.value = f.sizingType;
    sizingSel.addEventListener('change', () => { f.sizingType = sizingSel.value; this.persistForm(); });

    this.runBtn = h('button.btn.btn-primary.btn-sm', { type: 'button', onclick: () => this.run() }, icon('play', 14), 'Run backtest');

    // Builtin strategy params
    const paramsEl = h('div.tester-params');
    if (f.strategy.startsWith('builtin:')) {
      const s = this.strategies.builtin.find((x) => `builtin:${x.id}` === f.strategy);
      for (const [k, spec] of Object.entries((s && s.params) || {})) {
        const v = f.params[k] ?? spec.default;
        let input;
        if (spec.type === 'bool') {
          input = h('input', { type: 'checkbox', checked: !!v });
          input.addEventListener('change', () => { f.params[k] = input.checked; this.persistForm(); });
          paramsEl.appendChild(h('label.check', input, k));
        } else {
          input = h('input.input.input-sm.num', { type: 'number', step: spec.type === 'int' ? 1 : 'any', value: String(v), min: spec.min, max: spec.max });
          input.addEventListener('input', () => { f.params[k] = Number(input.value); this.persistForm(); });
          paramsEl.appendChild(h('div.fld', h('span', k), input));
        }
      }
      if (s && s.description) paramsEl.appendChild(h('span.muted.tester-desc', { title: s.description }, s.description));
    } else if (f.strategy === 'editor') {
      paramsEl.appendChild(h('span.muted', 'Uses the strategy() script currently open in the Pine Editor.'));
    }

    add(this.formEl, 
      h('div.tester-row',
        h('div.fld', h('span', 'Strategy'), stratSel),
        h('div.fld', h('span', 'Symbol'), this.symLabel),
        h('div.fld', h('span', 'TF'), tfSel),
        cb('sync', 'Sync chart'),
        h('div.fld', h('span', 'From'), date('from')),
        h('div.fld', h('span', 'To'), date('to')),
        h('span.spacer'),
        this.runBtn),
      h('div.tester-row',
        h('div.fld', h('span', 'Capital'), num('capital', { min: 1 })),
        h('div.fld', h('span', 'Commission %'), num('commission', { min: 0, step: 0.005 })),
        h('div.fld', h('span', 'Slippage (ticks)'), num('slippage', { min: 0, step: 1 })),
        h('div.fld', h('span', 'Order size'), num('sizingValue', { min: 0 }), sizingSel),
        cb('allowLong', 'Long'),
        cb('allowShort', 'Short')),
      paramsEl.childNodes.length ? h('div.tester-row', paramsEl) : null);
  }

  // ------------------------------------------------------------------ running

  /** Called by the Pine Editor "Run backtest" button. */
  runWithSource(source, title) {
    this.editorSource = { source, title };
    this.form.strategy = 'editor';
    this.renderForm();
    return this.run();
  }

  buildRequest() {
    const f = this.form;
    this.syncSymbol();
    const from = new Date(`${f.from}T00:00:00`).getTime();
    const to = new Date(`${f.to}T23:59:59`).getTime();
    if (!isFinite(from) || !isFinite(to) || from >= to) throw new Error('Invalid date range');
    const req = {
      symbol: f.symbol,
      tf: f.tf,
      from,
      to: Math.min(to, Date.now()),
      capital: Number(f.capital) || 10000,
      commission: Number(f.commission) || 0,
      slippage: Number(f.slippage) || 0,
      sizing: { type: f.sizingType, value: Number(f.sizingValue) || 100 },
      allowLong: f.allowLong,
      allowShort: f.allowShort,
    };
    const tick = symbolInfo.get(f.symbol)?.tickSize;
    if (tick) req.tickSize = tick;
    if (f.strategy === 'editor') {
      const src = (this.editorSource && this.editorSource.source) || this.app.getPineSourceSync?.();
      if (!src || !/^\s*strategy\s*\(/m.test(src)) throw new Error('Open a strategy() script in the Pine Editor first');
      req.source = src;
    } else if (f.strategy.startsWith('builtin:')) {
      req.strategy = { id: f.strategy.slice(8), params: { ...f.params } };
    } else if (f.strategy.startsWith('lib:')) {
      req.strategy = { id: f.strategy.slice(4) };
    }
    return req;
  }

  async run() {
    let req;
    try { req = this.buildRequest(); } catch (err) { toast(err.message, 'warn'); return; }
    this.editorSource = null;
    this.running = true;
    this.runBtn.disabled = true;
    add(clear(this.runBtn), h('span.spinner'), 'Running…');
    clear(this.resultEl).appendChild(h('div.tester-loading', h('span.spinner.lg'), `Backtesting ${splitKey(req.symbol).symbol} ${req.tf}…`));
    try {
      const res = await this.api.post('/api/backtest', req);
      if (res && res.error) throw Object.assign(new Error(res.error), { data: res });
      this.showResult(res, req);
    } catch (err) {
      const line = err.data && err.data.line;
      clear(this.resultEl).appendChild(h('div.tester-error', icon('warn', 18),
        h('div', h('b', 'Backtest failed'), h('div', `${err.message}${line ? ` (line ${line})` : ''}`))));
      if (line && req.source) this.app.pine?.showError?.(err.message, line);
    } finally {
      this.running = false;
      this.runBtn.disabled = false;
      add(clear(this.runBtn), icon('play', 14), 'Run backtest');
    }
  }

  /** Display a backtest result (also used when the agent runs one). */
  showResult(res, req) {
    this.result = res || { trades: [], equity: [], metrics: {} };
    this.request = req || this.request || { symbol: this.form.symbol, tf: this.form.tf };
    this.renderResult();
    this.drawMarkers();
  }

  // ------------------------------------------------------------------ results

  renderResult() {
    this.destroyChart();
    clear(this.resultEl);
    const r = this.result;
    if (!r) {
      this.resultEl.appendChild(h('div.empty-state.compact', icon('flask', 30),
        h('div.empty-title', 'Strategy Tester'),
        h('div.empty-sub', 'Pick a built-in strategy or open a strategy() script in the Pine Editor, then press Run backtest.')));
      return;
    }
    const m = r.metrics || {};
    const tabs = h('div.tabs.tabs-sm');
    for (const [id, label] of [['overview', 'Overview'], ['trades', `List of trades (${(r.trades || []).length})`], ['metrics', 'Performance summary']]) {
      tabs.appendChild(h(`button.tab${this.view === id ? '.active' : ''}`, { type: 'button', onclick: () => { this.view = id; this.renderResult(); } }, label));
    }
    const meta = r.meta || {};
    const summary = h('div.tester-summary');
    for (const key of SUMMARY) {
      const def = METRICS.find((x) => x[0] === key);
      const v = m[key];
      const sub = def[3] != null && m[def[3]] != null ? formatPct(m[def[3]]) : null;
      const cls = def[2] === 'money' ? (def[4] ? 'down' : v > 0 ? 'up' : v < 0 ? 'down' : '') : '';
      summary.appendChild(h('div.sum-item', h('div.sum-label', def[1]), h(`div.sum-value.${cls}`, fmtMetric(v, def[2]).replace(' USDT', '')), sub ? h(`div.sum-sub.${cls}`, sub) : null));
    }
    const head = h('div.tester-head',
      tabs,
      h('span.spacer'),
      h('span.muted.tester-meta', `${splitKey(this.request.symbol).symbol} ${this.request.tf}${meta.title ? ' · ' + meta.title : ''}${meta.mode ? ' · ' + meta.mode : ''}`),
      h('button.btn.btn-ghost.btn-sm', { type: 'button', title: 'Show trades on the active chart', onclick: () => this.drawMarkers(true) }, icon('target', 14), 'Chart'),
      h('button.btn.btn-ghost.btn-sm', { type: 'button', title: 'Remove trade markers', onclick: () => this.clearMarkers() }, icon('x', 14)));
    add(this.resultEl, head);
    if (meta.note) this.resultEl.appendChild(h('div.tester-note', meta.note));
    for (const w of meta.warnings || []) this.resultEl.appendChild(h('div.tester-note.warn', typeof w === 'string' ? w : w.message || JSON.stringify(w)));

    if (this.view === 'overview') {
      const chartHost = h('div.equity-chart');
      add(this.resultEl, summary, chartHost);
      requestAnimationFrame(() => this.buildChart(chartHost));
    } else if (this.view === 'trades') {
      add(this.resultEl, this.renderTrades());
    } else {
      add(this.resultEl, this.renderMetrics(m));
    }
  }

  renderMetrics(m) {
    const grid = h('div.metrics-grid');
    for (const [key, label, kind, pctKey, negative] of METRICS) {
      if (!(key in m)) continue;
      const v = m[key];
      const cls = kind === 'money' && typeof v === 'number' ? (negative ? (v ? 'down' : '') : v > 0 ? 'up' : v < 0 ? 'down' : '') : '';
      grid.appendChild(h('div.metric', h('div.metric-label', label),
        h(`div.metric-value.${cls}`, fmtMetric(v, kind), pctKey && m[pctKey] != null ? h('span.metric-sub', ` ${formatPct(m[pctKey])}`) : null)));
    }
    for (const [k, v] of Object.entries(m)) {
      if (KNOWN.has(k) || typeof v === 'object') continue;
      grid.appendChild(h('div.metric', h('div.metric-label', k.replace(/([A-Z])/g, ' $1').toLowerCase()), h('div.metric-value', fmtMetric(v, 'num'))));
    }
    return h('div.table-wrap', grid);
  }

  renderTrades() {
    const trades = (this.result.trades || []).slice().reverse();
    const tick = symbolInfo.get(this.request.symbol)?.tickSize;
    const tbody = h('tbody');
    let cum = 0;
    const cumById = new Map();
    for (const t of this.result.trades || []) { cum += Number(t.pnl) || 0; cumById.set(t, cum); }
    for (const t of trades) {
      const long = String(t.side || '').toLowerCase().startsWith('l') || t.side === 1;
      const pnl = Number(t.pnl);
      tbody.appendChild(h('tr',
        h('td.num', String(t.id ?? '')),
        h(`td.${long ? 'up' : 'down'}`, long ? 'Long' : 'Short'),
        h('td.nowrap', formatDateTime(t.entryTime)),
        h('td.num', formatPrice(t.entryPrice, tick)),
        h('td.nowrap', formatDateTime(t.exitTime)),
        h('td.num', formatPrice(t.exitPrice, tick)),
        h('td.num', formatNum(t.qty, t.qty < 1 ? 4 : 2)),
        h(`td.num.${pnl > 0 ? 'up' : pnl < 0 ? 'down' : ''}`, formatSigned(pnl, 2)),
        h(`td.num.${pnl > 0 ? 'up' : pnl < 0 ? 'down' : ''}`, formatPct(t.pnlPct)),
        h('td.num', formatSigned(cumById.get(t), 2)),
        h('td.num', String(t.bars ?? '')),
        h('td.muted', t.exitReason || '')));
    }
    if (!trades.length) tbody.appendChild(h('tr', h('td.empty', { colSpan: 12 }, 'No trades in this range')));
    return h('div.table-wrap', h('table.data-table.trades-table',
      h('thead', h('tr', ...['#', 'Type', 'Entry time', 'Entry', 'Exit time', 'Exit', 'Qty', 'P&L', 'P&L %', 'Cum. P&L', 'Bars', 'Exit reason'].map((c, i) => h(i === 0 || i === 3 || i >= 5 && i <= 10 ? 'th.num' : 'th', c)))),
      tbody));
  }

  buildChart(host) {
    if (!host.isConnected) return;
    const eq = (this.result.equity || []).filter((p) => p && isFinite(p.value));
    if (eq.length < 2) { host.appendChild(h('div.empty', 'No equity data')); return; }
    const chart = createChart(host, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: '#131722' }, textColor: '#b2b5be', fontSize: 11, panes: { separatorColor: '#2a2e39' } },
      grid: { vertLines: { color: '#1e222d' }, horzLines: { color: '#1e222d' } },
      rightPriceScale: { borderColor: '#2a2e39' },
      timeScale: { borderColor: '#2a2e39', timeVisible: true },
      crosshair: { horzLine: { color: '#434651' }, vertLine: { color: '#434651' } },
    });
    this.chart = chart;
    // Dedupe by second (lightweight-charts needs strictly increasing times).
    const bySec = new Map();
    for (const p of eq) bySec.set(Math.floor(toMs(p.t) / 1000), Number(p.value));
    const data = [...bySec].sort((a, b) => a[0] - b[0]).map(([time, value]) => ({ time, value }));
    const capital = this.result.metrics?.initialCapital ?? this.request.capital ?? data[0].value;
    const up = data[data.length - 1].value >= capital;
    const area = chart.addSeries(AreaSeries, {
      lineColor: up ? '#089981' : '#f23645',
      topColor: up ? 'rgba(8,153,129,0.35)' : 'rgba(242,54,69,0.35)',
      bottomColor: 'rgba(0,0,0,0)',
      lineWidth: 2,
      priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
      title: 'Equity',
    });
    area.setData(data);
    area.createPriceLine({ price: capital, color: '#787b86', lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false, title: 'capital' });
    // Drawdown % as a histogram in a second pane.
    let peak = -Infinity;
    const dd = data.map((p) => {
      peak = Math.max(peak, p.value);
      return { time: p.time, value: peak > 0 ? -((peak - p.value) / peak) * 100 : 0, color: 'rgba(242,54,69,0.55)' };
    });
    const hist = chart.addSeries(HistogramSeries, { priceFormat: { type: 'percent', precision: 2 }, title: 'Drawdown %' }, 1);
    hist.setData(dd);
    // Buy & hold comparison, if the server supplied it.
    if (Array.isArray(this.result.buyHold) && this.result.buyHold.length > 1) {
      const bh = chart.addSeries(LineSeries, { color: '#787b86', lineWidth: 1, title: 'Buy & hold' });
      bh.setData(this.result.buyHold.map((p) => ({ time: Math.floor(toMs(p.t) / 1000), value: p.value })));
    }
    try {
      const panes = chart.panes();
      if (panes[1]) panes[1].setHeight(Math.max(50, Math.round(host.clientHeight * 0.25)));
    } catch { /* older API */ }
    chart.timeScale().fitContent();
  }

  destroyChart() {
    if (this.chart) { try { this.chart.remove(); } catch { /* ignore */ } this.chart = null; }
  }

  // ------------------------------------------------------------------ chart markers

  clearMarkers() {
    const s = this.markerState;
    if (!s) return;
    const c = s.chart;
    try {
      if (s.mode === 'trades') c.clearTrades?.();
      else if (s.mode === 'markers') c.setMarkers([]);
      else for (const id of s.ids) c.removeDrawing(id);
    } catch { /* chart gone */ }
    this.markerState = null;
  }

  drawMarkers(force = false) {
    const r = this.result;
    if (!r || !this.request) return;
    const chart = this.layout.active;
    if (!chart) return;
    const st = chartState(chart);
    if (st.symbol && st.symbol !== this.request.symbol) {
      if (!force) return;
      chart.setSymbol?.(this.request.symbol);
    }
    this.clearMarkers();
    const trades = r.trades || [];
    if (typeof chart.showTrades === 'function') {
      chart.showTrades(trades);
      this.markerState = { chart, mode: 'trades' };
      return;
    }
    const markers = [];
    for (const t of trades) {
      const long = String(t.side || '').toLowerCase().startsWith('l');
      markers.push({ t: toMs(t.entryTime), time: Math.floor(toMs(t.entryTime) / 1000), position: long ? 'belowBar' : 'aboveBar', color: long ? '#2962ff' : '#e91e63', shape: long ? 'arrowUp' : 'arrowDown', text: long ? `Long ${formatNum(t.qty, 3)}` : `Short ${formatNum(t.qty, 3)}`, price: t.entryPrice });
      if (t.exitTime != null) {
        markers.push({ t: toMs(t.exitTime), time: Math.floor(toMs(t.exitTime) / 1000), position: long ? 'aboveBar' : 'belowBar', color: '#ff9800', shape: long ? 'arrowDown' : 'arrowUp', text: `Close ${formatSigned(t.pnl, 2)}`, price: t.exitPrice });
      }
    }
    markers.sort((a, b) => a.time - b.time);
    if (typeof chart.setMarkers === 'function') {
      chart.setMarkers(markers);
      this.markerState = { chart, mode: 'markers' };
      return;
    }
    if (typeof chart.draw === 'function') {
      const ids = [];
      for (const mk of markers.slice(-200)) {
        try {
          const id = chart.draw({ type: 'arrow', points: [{ t: mk.t, price: mk.price }], color: mk.color, direction: mk.shape === 'arrowUp' ? 'up' : 'down', text: mk.text, temporary: true, source: 'backtest' });
          if (id != null) ids.push(id);
        } catch { break; }
      }
      this.markerState = { chart, mode: 'drawings', ids };
    }
  }
}
