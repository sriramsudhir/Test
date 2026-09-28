// Replay trading panel: bound to layout.active.replay (ReplayController §12, events tick/state/fill).
// Controls (start/play/pause/step/speed/exit), paper trading (buy/sell/close with qty), positions, fills, P&L.
import { h, clear, icon, add } from './util/dom.js';
import { toast } from './util/dialog.js';
import { formatPrice, formatNum, formatSigned, formatDateTime, splitKey, toDateTimeInput, toMs } from './util/fmt.js';
import { chartState } from './util/chartHub.js';
import { load, save } from './util/store.js';
import { symbolInfo } from './SymbolSearch.js';

const SPEEDS = [0.5, 1, 2, 3, 5, 10, 25, 50, 100];

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Normalise ReplayController.pnl, which may be a number or an object. */
function normPnl(p) {
  if (p == null) return { realized: null, unrealized: null, total: null, equity: null };
  if (typeof p === 'number') return { realized: null, unrealized: null, total: p, equity: null };
  const realized = num(p.realized ?? p.closed ?? p.realised);
  const unrealized = num(p.unrealized ?? p.open ?? p.unrealised ?? p.openPnl);
  const total = num(p.total ?? p.net ?? (realized != null || unrealized != null ? (realized || 0) + (unrealized || 0) : null));
  return { realized, unrealized, total, equity: num(p.equity ?? p.balance) };
}

export class ReplayTradingPanel {
  constructor(el, { layout, api, socket, app }) {
    this.el = el;
    this.layout = layout;
    this.app = app;
    this.chart = null;
    this.replay = null;
    this.offs = [];
    this.fills = [];
    this.state = {};
    this.lastTick = null;
    this.qty = load('replay.qty', 1);

    el.classList.add('panel', 'replay-panel');
    this.statusEl = h('div.replay-status');
    this.controlsEl = h('div.replay-controls');
    this.tradeEl = h('div.replay-trade');
    this.pnlEl = h('div.replay-pnl');
    this.posBody = h('tbody');
    this.fillBody = h('tbody');
    add(el, 
      h('div.subbar.replay-bar', this.statusEl, h('span.spacer'), this.controlsEl),
      h('div.replay-grid',
        h('div.replay-left', this.tradeEl, this.pnlEl),
        h('div.replay-tables',
          h('div.replay-table-title', 'Positions'),
          h('div.table-wrap', h('table.data-table', h('thead', h('tr', ...['Side', 'Qty', 'Avg price', 'Last', 'Unrealized P&L', ''].map((c, i) => h(i >= 1 && i <= 4 ? 'th.num' : 'th', c)))), this.posBody)),
          h('div.replay-table-title', 'Orders / fills'),
          h('div.table-wrap', h('table.data-table', h('thead', h('tr', ...['Time', 'Side', 'Qty', 'Price', 'Realized P&L'].map((c, i) => h(i >= 2 ? 'th.num' : 'th', c)))), this.fillBody)))));

    app.hub.on('active', (chart) => this.bind(chart));
    app.hub.on('replay', ({ chart }) => { if (chart === this.chart) { this.rebindIfChanged(); this.render(); } });
    this.bind(app.hub.active);
    this.renderTrade();
  }

  rebindIfChanged() {
    if (this.chart && this.chart.replay !== this.replay) this.bind(this.chart, true);
  }

  bind(chart, force = false) {
    if (chart === this.chart && !force) return;
    for (const off of this.offs) try { off(); } catch { /* ignore */ }
    this.offs = [];
    this.chart = chart || null;
    this.replay = chart ? chart.replay || null : null;
    const r = this.replay;
    this.fills = r && Array.isArray(r.fills) ? r.fills.slice().reverse() : [];
    this.state = r && typeof r.snapshot === 'function' ? r.snapshot() : {};
    if (r && typeof r.on === 'function') {
      const sub = (ev, fn) => { const off = r.on(ev, fn); if (typeof off === 'function') this.offs.push(off); else this.offs.push(() => r.off?.(ev, fn)); };
      sub('tick', (t) => { this.lastTick = t; this.renderStatus(); this.renderPositions(); this.renderPnl(); });
      sub('state', (s) => { this.state = s || {}; this.render(); });
      sub('fill', (f) => {
        this.fills.unshift(f);
        if (this.fills.length > 500) this.fills.pop();
        this.renderFills();
        this.renderPositions();
        this.renderPnl();
      });
    }
    this.render();
  }

  // ---------------------------------------------------------------- state helpers

  isActive() {
    const r = this.replay;
    if (!r) return false;
    const s = this.state && this.state.state ? this.state.state : r.state;
    if (typeof s === 'string') return !['idle', 'stopped', 'off', 'inactive'].includes(s);
    if (typeof r.active === 'boolean') return r.active;
    if (typeof r.isActive === 'function') return r.isActive();
    return !!(this.state && (this.state.active || this.state.playing));
  }

  isPlaying() {
    const r = this.replay;
    const s = (this.state && this.state.state) || (r && r.state);
    if (typeof s === 'string') return s === 'playing';
    return !!((this.state && this.state.playing) || (r && r.playing));
  }

  currentTime() {
    const t = this.lastTick;
    const r = this.replay;
    return toMs((t && (t.t ?? t.time ?? (t.candle && t.candle.t))) ?? (this.state && (this.state.t ?? this.state.time)) ?? (r && (r.time ?? r.currentTime)));
  }

  currentPrice() {
    const t = this.lastTick;
    const r = this.replay;
    return num((t && (t.price ?? (t.candle && t.candle.c) ?? t.c)) ?? (r && (r.price ?? r.lastPrice)));
  }

  speed() {
    return num((this.state && this.state.speed) ?? (this.replay && this.replay.speed)) ?? 1;
  }

  // ---------------------------------------------------------------- rendering

  render() {
    this.renderStatus();
    this.renderControls();
    this.renderTrade();
    this.renderPositions();
    this.renderFills();
    this.renderPnl();
  }

  renderStatus() {
    clear(this.statusEl);
    const st = chartState(this.chart);
    if (!this.chart) { add(this.statusEl, h('span.muted', 'No active chart')); return; }
    if (!this.replay) { add(this.statusEl, h('span.muted', 'Bar replay is not available for this chart')); return; }
    const active = this.isActive();
    const tick = symbolInfo.get(st.symbol)?.tickSize;
    add(this.statusEl, 
      h(`span.replay-badge.${active ? (this.isPlaying() ? 'playing' : 'paused') : 'idle'}`, active ? (this.isPlaying() ? 'PLAYING' : 'PAUSED') : 'REPLAY OFF'),
      h('span.replay-sym', `${splitKey(st.symbol).symbol} · ${st.tf || ''}`),
      active ? h('span.replay-time', icon('clock', 13), formatDateTime(this.currentTime())) : null,
      active && this.currentPrice() != null ? h('span.replay-price', formatPrice(this.currentPrice(), tick)) : null);
  }

  renderControls() {
    clear(this.controlsEl);
    const r = this.replay;
    if (!r) return;
    const btn = (ico, title, fn, cls = '') => h(`button.icon-btn${cls}`, { type: 'button', title, 'aria-label': title, onclick: () => { try { fn(); } catch (err) { toast(err.message, 'error'); } } }, icon(ico, 16));
    if (!this.isActive()) {
      const st = chartState(this.chart);
      const vr = st.visibleRange || {};
      const def = toMs(vr.from && vr.to ? (toMs(vr.from) + toMs(vr.to)) / 2 : Date.now() - 30 * 86400000);
      const from = h('input.input.input-sm', { type: 'datetime-local', value: toDateTimeInput(def) });
      add(this.controlsEl, 
        h('span.muted', 'Start from'), from,
        h('button.btn.btn-primary.btn-sm', { type: 'button', onclick: () => this.start(new Date(from.value).getTime()) }, icon('replay', 14), 'Start replay'),
        h('button.btn.btn-ghost.btn-sm', { type: 'button', title: 'Start at the middle of the visible range', onclick: () => this.start(def) }, 'Visible range'));
      return;
    }
    const speedSel = h('select.input.input-sm', { title: 'Speed' });
    const cur = this.speed();
    for (const s of SPEEDS) speedSel.appendChild(h('option', { value: s, selected: s === cur }, `${s}x`));
    speedSel.value = String(cur);
    speedSel.addEventListener('change', () => { r.setSpeed(Number(speedSel.value)); this.state = { ...this.state, speed: Number(speedSel.value) }; });
    const jump = h('input.input.input-sm', { type: 'datetime-local', title: 'Jump to date', value: toDateTimeInput(this.currentTime() || Date.now()) });
    jump.addEventListener('change', () => { const t = new Date(jump.value).getTime(); if (isFinite(t)) r.jumpTo(t); });
    add(this.controlsEl, 
      btn('stepBack', 'Step back', () => r.stepBack(1)),
      this.isPlaying() ? btn('pause', 'Pause', () => r.pause(), '.accent') : btn('play', 'Play', () => r.play(), '.accent'),
      btn('step', 'Step forward', () => r.stepForward(1)),
      speedSel,
      jump,
      h('button.btn.btn-ghost.btn-sm', { type: 'button', onclick: () => { r.stop(); this.state = {}; this.render(); } }, icon('x', 14), 'Exit replay'));
  }

  renderTrade() {
    clear(this.tradeEl);
    const active = this.isActive();
    const qty = h('input.input.num', { type: 'number', min: 0, step: 'any', value: String(this.qty), title: 'Order quantity' });
    qty.addEventListener('input', () => { this.qty = Number(qty.value) || 0; save('replay.qty', this.qty); });
    const act = (fn, label) => () => {
      if (!this.replay) return;
      if (!this.isActive()) { toast('Start bar replay first', 'warn'); return; }
      if (label !== 'close' && !(this.qty > 0)) { toast('Enter a quantity', 'warn'); return; }
      try { fn(); } catch (err) { toast(err.message, 'error'); }
    };
    const price = this.currentPrice();
    const tick = symbolInfo.get(chartState(this.chart).symbol)?.tickSize;
    add(this.tradeEl, 
      h('div.trade-title', 'Paper trading'),
      h('div.trade-row', h('span.muted', 'Qty'), qty),
      h('div.trade-buttons',
        h('button.btn.btn-sell', { type: 'button', disabled: !active, onclick: act(() => this.replay.sell(this.qty), 'sell') }, h('span', 'SELL'), h('small', price != null ? formatPrice(price, tick) : '')),
        h('button.btn.btn-buy', { type: 'button', disabled: !active, onclick: act(() => this.replay.buy(this.qty), 'buy') }, h('span', 'BUY'), h('small', price != null ? formatPrice(price, tick) : ''))),
      h('button.btn.btn-ghost.btn-sm.btn-block', { type: 'button', disabled: !active, onclick: act(() => this.replay.closeAll(), 'close') }, 'Close all positions'),
      !active ? h('div.muted.small', 'Orders fill at the replay price of the current bar.') : null);
  }

  positions() {
    const r = this.replay;
    if (!r) return [];
    let p = typeof r.positions === 'function' ? r.positions() : r.positions;
    if (!p) return [];
    if (p instanceof Map) p = [...p.values()];
    if (!Array.isArray(p)) p = typeof p === 'object' && ('qty' in p || 'size' in p) ? [p] : Object.values(p);
    return p.filter((x) => x && Math.abs(Number(x.qty ?? x.size ?? 0)) > 0);
  }

  renderPositions() {
    clear(this.posBody);
    const list = this.positions();
    const tick = symbolInfo.get(chartState(this.chart).symbol)?.tickSize;
    const last = this.currentPrice();
    if (!list.length) {
      this.posBody.appendChild(h('tr', h('td.empty', { colSpan: 6 }, 'No open positions')));
      return;
    }
    for (const p of list) {
      const qtyRaw = Number(p.qty ?? p.size ?? 0);
      const side = String(p.side || (qtyRaw >= 0 ? 'long' : 'short')).toLowerCase();
      const long = side.startsWith('l') || side === 'buy';
      const avg = num(p.avgPrice ?? p.entryPrice ?? p.price);
      const qty = Math.abs(qtyRaw);
      const upnl = num(p.unrealized ?? p.pnl ?? p.upnl) ?? (avg != null && last != null ? (last - avg) * qty * (long ? 1 : -1) : null);
      this.posBody.appendChild(h('tr',
        h(`td.${long ? 'up' : 'down'}`, long ? 'Long' : 'Short'),
        h('td.num', formatNum(qty, qty < 1 ? 4 : 2)),
        h('td.num', formatPrice(avg, tick)),
        h('td.num', formatPrice(last, tick)),
        h(`td.num.${upnl > 0 ? 'up' : upnl < 0 ? 'down' : ''}`, formatSigned(upnl, 2)),
        h('td', h('button.btn.btn-ghost.btn-xs', { type: 'button', onclick: () => {
          try { if (typeof this.replay.close === 'function') this.replay.close(p.id ?? p); else this.replay.closeAll(); } catch (err) { toast(err.message, 'error'); }
        } }, 'Close'))));
    }
  }

  renderFills() {
    clear(this.fillBody);
    const tick = symbolInfo.get(chartState(this.chart).symbol)?.tickSize;
    if (!this.fills.length) {
      this.fillBody.appendChild(h('tr', h('td.empty', { colSpan: 5 }, 'No fills yet')));
      return;
    }
    for (const f of this.fills.slice(0, 200)) {
      const side = String(f.side || (Number(f.qty) >= 0 ? 'buy' : 'sell')).toLowerCase();
      const buy = side.startsWith('b') || side.startsWith('l');
      const pnl = num(f.pnl ?? f.realized ?? f.realizedPnl);
      this.fillBody.appendChild(h('tr',
        h('td.nowrap', formatDateTime(f.t ?? f.time)),
        h(`td.${buy ? 'up' : 'down'}`, side.toUpperCase()),
        h('td.num', formatNum(Math.abs(Number(f.qty ?? f.size ?? 0)), 4)),
        h('td.num', formatPrice(f.price, tick)),
        h(`td.num.${pnl > 0 ? 'up' : pnl < 0 ? 'down' : ''}`, pnl == null ? '—' : formatSigned(pnl, 2))));
    }
  }

  renderPnl() {
    clear(this.pnlEl);
    const r = this.replay;
    const raw = r ? (typeof r.pnl === 'function' ? r.pnl() : r.pnl) : null;
    const p = normPnl(raw);
    if (p.realized == null) {
      const realizedFromFills = this.fills.reduce((s, f) => s + (num(f.pnl ?? f.realized) || 0), 0);
      if (this.fills.length) p.realized = realizedFromFills;
    }
    if (p.total == null && (p.realized != null || p.unrealized != null)) p.total = (p.realized || 0) + (p.unrealized || 0);
    const item = (label, v) => h('div.pnl-item', h('div.pnl-label', label), h(`div.pnl-value.${v > 0 ? 'up' : v < 0 ? 'down' : ''}`, v == null ? '—' : formatSigned(v, 2)));
    add(this.pnlEl, item('Realized P&L', p.realized), item('Unrealized P&L', p.unrealized), item('Net P&L', p.total));
    if (p.equity != null) this.pnlEl.appendChild(h('div.pnl-item', h('div.pnl-label', 'Equity'), h('div.pnl-value', formatNum(p.equity, 2))));
  }

  // ---------------------------------------------------------------- actions

  /** Start a replay on the active chart (used by Alt+R and the Start button). */
  start(fromMs) {
    const chart = this.layout.active;
    if (!chart) { toast('No active chart', 'warn'); return; }
    let from = fromMs;
    if (!isFinite(from)) {
      const cr = this.app.hub.crosshair.get(chart);
      const st = chartState(chart);
      const vr = st.visibleRange || {};
      from = cr && cr.time != null ? toMs(cr.time) : vr.from && vr.to ? (toMs(vr.from) + toMs(vr.to)) / 2 : Date.now() - 30 * 86400000;
    }
    try {
      const res = typeof chart.startReplay === 'function' ? chart.startReplay({ from }) : chart.replay?.start(from);
      Promise.resolve(res).then(() => { this.bind(chart, true); }).catch((err) => toast(`Replay failed: ${err.message}`, 'error'));
      this.bind(chart, true);
    } catch (err) {
      toast(`Replay failed: ${err.message}`, 'error');
    }
  }
}
