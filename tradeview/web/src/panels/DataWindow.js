// Data window: OHLCV and indicator values at the crosshair of the active chart.
import { h, clear } from './util/dom.js';
import { formatPrice, formatCompact, formatPct, formatDateTime, splitKey } from './util/fmt.js';
import { chartState, chartIndicators } from './util/chartHub.js';
import { symbolInfo } from './SymbolSearch.js';

export class DataWindowPanel {
  constructor(el, { layout, api, socket, app }) {
    this.el = el;
    this.app = app;
    this.data = null;
    el.classList.add('panel', 'data-window');
    this.title = h('div.panel-title', 'Data window');
    this.body = h('div.panel-body.dw-body');
    el.append(h('div.panel-header', this.title), this.body);
    app.hub.on('crosshair', (c) => { if (c.chart === app.hub.active) { this.data = c; this.schedule(); } });
    app.hub.on('active', () => { this.data = app.hub.crosshair.get(app.hub.active) || null; this.schedule(); });
    app.hub.on('price', ({ chart }) => { if (chart === app.hub.active && (!this.data || !this.data.candle)) this.schedule(); });
    this.render();
  }

  schedule() {
    if (this._raf || !this.el.offsetParent) { if (!this.el.offsetParent) this._stale = true; return; }
    this._raf = requestAnimationFrame(() => { this._raf = null; this.render(); });
  }

  /** Called by the shell when the tab becomes visible. */
  onShow() { if (this._stale) { this._stale = false; this.render(); } }

  render() {
    clear(this.body);
    const chart = this.app.hub.active;
    if (!chart) { this.body.appendChild(h('div.empty', 'No active chart')); return; }
    const st = chartState(chart);
    const tick = symbolInfo.get(st.symbol)?.tickSize;
    this.title.textContent = `Data window · ${splitKey(st.symbol).symbol} ${st.tf || ''}`;
    const d = this.data || {};
    const c = d.candle;
    const rows = [];
    rows.push(['Date', d.time != null ? formatDateTime(d.time) : c && c.t != null ? formatDateTime(c.t) : '—']);
    if (c) {
      const chg = c.o ? ((c.c - c.o) / c.o) * 100 : null;
      const cls = c.c > c.o ? 'up' : c.c < c.o ? 'down' : '';
      rows.push(['Open', formatPrice(c.o, tick), cls], ['High', formatPrice(c.h, tick), cls], ['Low', formatPrice(c.l, tick), cls], ['Close', formatPrice(c.c, tick), cls]);
      rows.push(['Change', formatPct(chg), cls]);
      if (c.v != null) rows.push(['Volume', formatCompact(c.v)]);
    } else {
      rows.push(['Last', formatPrice(st.lastPrice, tick)]);
    }
    if (d.price != null) rows.push(['Crosshair', formatPrice(d.price, tick)]);
    this.body.appendChild(h('div.dw-section', h('div.dw-head', splitKey(st.symbol).symbol), ...rows.map(([k, v, cls]) => h('div.dw-row', h('span.dw-k', k), h(`span.dw-v${cls ? '.' + cls : ''}`, v)))));

    // Indicator values at the crosshair bar (ChartView.indicators.valuesAt), else from the crosshair payload.
    const t = d.time ?? (c && c.t);
    let rowsInd = null;
    try { if (t != null && chart.indicators && typeof chart.indicators.valuesAt === 'function') rowsInd = chart.indicators.valuesAt(t); } catch { /* ignore */ }
    if (Array.isArray(rowsInd) && rowsInd.length) {
      for (const ind of rowsInd) {
        const section = h('div.dw-section', h('div.dw-head', ind.title || ind.id, ind.visible === false ? h('span.muted', ' (hidden)') : null));
        for (const v of ind.values || []) {
          const k = h('span.dw-k', v.color ? h('span.dw-swatch', { style: { background: v.color } }) : null, v.name);
          section.appendChild(h('div.dw-row', k, h('span.dw-v', fmtVal(v.value, tick))));
        }
        if (ind.error) section.appendChild(h('div.dw-row.error', ind.error));
        this.body.appendChild(section);
      }
    } else if (d.indicators && typeof d.indicators === 'object' && Object.keys(d.indicators).length) {
      for (const [id, v] of Object.entries(d.indicators)) {
        const section = h('div.dw-section', h('div.dw-head', id));
        if (v && typeof v === 'object') for (const [plot, pv] of Object.entries(v)) section.appendChild(h('div.dw-row', h('span.dw-k', plot), h('span.dw-v', fmtVal(pv, tick))));
        else section.appendChild(h('div.dw-row', h('span.dw-k', 'Value'), h('span.dw-v', fmtVal(v, tick))));
        this.body.appendChild(section);
      }
    } else {
      const inds = chartIndicators(chart);
      if (inds.length) {
        const section = h('div.dw-section', h('div.dw-head', 'Indicators'));
        for (const i of inds) section.appendChild(h('div.dw-row', h('span.dw-k', i.title || i.name || i.builtin || i.id), h('span.dw-v', '—')));
        this.body.appendChild(section);
      }
    }
    if (!d.time && !c) this.body.appendChild(h('div.muted.small.dw-hint', 'Move the crosshair over the chart to inspect bars.'));
  }
}

function fmtVal(v, tick) {
  if (v == null) return '—';
  if (typeof v === 'number') return Math.abs(v) >= 1000 ? formatPrice(v, tick) : Number(v.toPrecision(6)).toString();
  if (typeof v === 'object' && 'value' in v) return fmtVal(v.value, tick);
  return String(v);
}
