// Watchlist: grouped symbol lists with live last price and daily change (socket kline 1D + trades).
import { h, clear, icon, iconButton } from './util/dom.js';
import { popupMenu, promptDialog, confirmDialog, toast } from './util/dialog.js';
import { formatPrice, formatPct, formatSigned, splitKey, categoryLabel } from './util/fmt.js';
import { load, save } from './util/store.js';
import { symbolInfo } from './SymbolSearch.js';
import { chartState } from './util/chartHub.js';

const DEFAULT_GROUPS = [
  { name: 'Delta', collapsed: false, symbols: ['delta:BTCUSD', 'delta:ETHUSD', 'delta:SOLUSD', 'delta:XRPUSD', 'delta:DOGEUSD', 'delta:BNBUSD'] },
  { name: 'Bybit', collapsed: false, symbols: ['linear:BTCUSDT', 'linear:ETHUSDT', 'spot:BTCUSDT'] },
  { name: 'Commodities', collapsed: false, symbols: ['linear:XAUTUSDT', 'spot:PAXGUSDT'] },
  { name: 'Forex', collapsed: false, symbols: ['spot:EURUSDT'] },
];

export class WatchlistPanel {
  constructor(el, { layout, api, socket, app }) {
    this.el = el;
    this.layout = layout;
    this.api = api;
    this.socket = socket;
    this.app = app;
    this.groups = load('watchlist.v2', null) || structuredClone(DEFAULT_GROUPS);
    this.quotes = new Map(); // key -> { last, ref, prevLast, t }
    this.rows = new Map(); // key -> row elements
    this.subs = new Map(); // key -> unsubscribe
    this.activeSymbol = null;

    el.classList.add('panel', 'watchlist');
    this.header = h('div.panel-header',
      h('div.panel-title', 'Watchlist'),
      h('div.panel-actions',
        iconButton('plus', 'Add symbol', () => this.addSymbol(this.groups[0])),
        iconButton('list', 'Watchlist menu', (e) => this.menu(e.currentTarget))));
    this.colHead = h('div.wl-cols', h('span', 'Symbol'), h('span', 'Last'), h('span', 'Chg'), h('span', 'Chg%'));
    this.body = h('div.panel-body.wl-body');
    el.append(this.header, this.colHead, this.body);

    socket.on('kline', (m) => {
      if (m.tf !== '1D' || !m.candle) return;
      this.onPrice(m.symbol, Number(m.candle.c), Number(m.candle.o), Number(m.candle.t));
    });
    socket.on('trade', (m) => {
      if (!m.trades || !m.trades.length || !this.rows.has(m.symbol)) return;
      const last = m.trades[m.trades.length - 1];
      this.onPrice(m.symbol, Number(last.p));
    });
    socket.on('connection', ({ state }) => { if (state === 'open') this.refreshAll(); });

    app.hub.on('active', () => this.markActive());
    app.hub.on('symbol', () => this.markActive());
    this.render();
    this.refreshAll();
  }

  persist() { save('watchlist.v2', this.groups); }

  allKeys() {
    return [...new Set(this.groups.flatMap((g) => g.symbols))];
  }

  render() {
    clear(this.body);
    this.rows.clear();
    for (const g of this.groups) {
      const caret = icon(g.collapsed ? 'chevRight' : 'chevDown', 14);
      const head = h('div.wl-group-head',
        caret,
        h('span.wl-group-name', g.name),
        h('span.wl-group-count', String(g.symbols.length)),
        h('span.spacer'),
        iconButton('plus', `Add symbol to ${g.name}`, (e) => { e.stopPropagation(); this.addSymbol(g); }, 'sm'),
        iconButton('list', 'Group menu', (e) => { e.stopPropagation(); this.groupMenu(e.currentTarget, g); }, 'sm'));
      head.addEventListener('click', () => { g.collapsed = !g.collapsed; this.persist(); this.render(); });
      this.body.appendChild(head);
      if (g.collapsed) continue;
      if (!g.symbols.length) {
        this.body.appendChild(h('div.wl-empty', 'Empty — click + to add symbols'));
      }
      for (const key of g.symbols) this.body.appendChild(this.renderRow(key, g));
    }
    this.syncSubscriptions();
    this.markActive();
  }

  renderRow(key, group) {
    const { category, symbol } = splitKey(key);
    const last = h('span.wl-last', '—');
    const chg = h('span.wl-chg', '—');
    const pct = h('span.wl-pct', '—');
    const rm = iconButton('x', 'Remove from watchlist', (e) => {
      e.stopPropagation();
      group.symbols = group.symbols.filter((s) => s !== key);
      this.persist();
      this.render();
    }, 'sm wl-remove');
    const row = h('div.wl-row', { dataset: { key }, title: key, draggable: true },
      h('span.wl-sym', h('span.wl-sym-name', symbol), h(`span.cat-tag.${category}`, categoryLabel(category))),
      last, chg, pct, rm);
    row.addEventListener('click', () => this.load(key));
    row.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/x-wl', JSON.stringify({ key, from: this.groups.indexOf(group) }));
      e.dataTransfer.effectAllowed = 'move';
    });
    row.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('text/x-wl')) { e.preventDefault(); row.classList.add('drop-target'); } });
    row.addEventListener('dragleave', () => row.classList.remove('drop-target'));
    row.addEventListener('drop', (e) => {
      row.classList.remove('drop-target');
      let d;
      try { d = JSON.parse(e.dataTransfer.getData('text/x-wl')); } catch { return; }
      e.preventDefault();
      const from = this.groups[d.from];
      if (!from) return;
      from.symbols = from.symbols.filter((s) => s !== d.key);
      const idx = group.symbols.indexOf(key);
      group.symbols = group.symbols.filter((s) => s !== d.key);
      group.symbols.splice(idx < 0 ? group.symbols.length : idx, 0, d.key);
      this.persist();
      this.render();
    });
    const entry = this.rows.get(key) || [];
    entry.push({ row, last, chg, pct });
    this.rows.set(key, entry);
    const q = this.quotes.get(key);
    if (q) this.paint(key, false);
    return row;
  }

  load(key) {
    const chart = this.layout.active;
    if (chart && typeof chart.setSymbol === 'function') chart.setSymbol(key);
    else this.layout.executeCommand?.({ action: 'set_symbol', symbol: key });
    this.activeSymbol = key;
    this.markActive();
  }

  markActive() {
    const st = chartState(this.app.hub.active);
    this.activeSymbol = st.symbol || this.activeSymbol;
    for (const [key, entries] of this.rows) for (const e of entries) e.row.classList.toggle('active', key === this.activeSymbol);
  }

  syncSubscriptions() {
    const keys = new Set(this.allKeys());
    for (const [key, off] of this.subs) {
      if (!keys.has(key)) { off(); this.subs.delete(key); }
    }
    for (const key of keys) {
      if (!this.subs.has(key)) this.subs.set(key, this.socket.subscribe('kline', key, '1D'));
    }
  }

  async refreshAll() {
    const keys = this.allKeys();
    await Promise.all(keys.map((k) => this.refresh(k)));
  }

  async refresh(key) {
    try {
      const res = await this.api.get('/api/candles', { symbol: key, tf: '1D', limit: 2 });
      const candles = (res && res.candles) || (Array.isArray(res) ? res : []);
      if (!candles.length) return;
      const last = candles[candles.length - 1];
      const prev = candles.length > 1 ? candles[candles.length - 2] : null;
      const q = this.quotes.get(key) || {};
      q.t = Number(last.t);
      q.ref = prev ? Number(prev.c) : Number(last.o);
      if (q.last == null || !q.live) q.last = Number(last.c);
      this.quotes.set(key, q);
      this.paint(key, false);
    } catch {
      /* offline or unknown symbol: keep dashes */
    }
  }

  onPrice(key, price, dayOpen, dayT) {
    if (!this.rows.has(key) || !isFinite(price)) return;
    const q = this.quotes.get(key) || {};
    if (dayT && q.t && dayT > q.t) {
      // New daily bar: yesterday's close becomes the reference.
      q.ref = q.last ?? dayOpen;
      q.t = dayT;
    } else if (dayT && !q.t) {
      q.t = dayT;
    }
    if (q.ref == null && isFinite(dayOpen)) q.ref = dayOpen;
    q.prevLast = q.last;
    q.last = price;
    q.live = true;
    this.quotes.set(key, q);
    this.paint(key, q.prevLast != null && q.prevLast !== price);
  }

  paint(key, flash) {
    const q = this.quotes.get(key);
    const entries = this.rows.get(key);
    if (!q || !entries) return;
    const tick = symbolInfo.get(key)?.tickSize;
    const change = q.ref != null && q.last != null ? q.last - q.ref : null;
    const pctV = change != null && q.ref ? (change / q.ref) * 100 : null;
    const dir = change == null ? '' : change > 0 ? 'up' : change < 0 ? 'down' : '';
    for (const e of entries) {
      e.last.textContent = formatPrice(q.last, tick);
      e.chg.textContent = change == null ? '—' : formatSigned(change, Math.min(8, Math.max(2, (formatPrice(q.last, tick).split('.')[1] || '').length)));
      e.pct.textContent = formatPct(pctV);
      e.chg.className = `wl-chg ${dir}`;
      e.pct.className = `wl-pct ${dir}`;
      if (flash) {
        const up = q.last > q.prevLast;
        e.last.classList.remove('flash-up', 'flash-down');
        void e.last.offsetWidth; // restart the animation
        e.last.classList.add(up ? 'flash-up' : 'flash-down');
      }
    }
  }

  addSymbol(group) {
    if (!group) {
      group = { name: 'Watchlist', collapsed: false, symbols: [] };
      this.groups.push(group);
    }
    this.app.openSymbolSearch({
      title: `Add symbol to ${group.name}`,
      multi: true,
      onSelect: (key) => {
        if (group.symbols.includes(key)) { toast(`${key} is already in ${group.name}`, 'info', 1800); return; }
        group.symbols.push(key);
        group.collapsed = false;
        this.persist();
        this.render();
        this.refresh(key);
      },
    });
  }

  groupMenu(anchor, g) {
    popupMenu(anchor, [
      { label: 'Add symbol…', icon: 'plus', onClick: () => this.addSymbol(g) },
      { label: 'Add active chart symbol', icon: 'target', onClick: () => {
        const s = chartState(this.app.hub.active).symbol;
        if (s && !g.symbols.includes(s)) { g.symbols.push(s); this.persist(); this.render(); this.refresh(s); }
      } },
      { label: 'Rename group…', icon: 'edit', onClick: async () => {
        const name = await promptDialog('Group name', { title: 'Rename group', value: g.name });
        if (name && name.trim()) { g.name = name.trim(); this.persist(); this.render(); }
      } },
      { label: 'Sort A→Z', icon: 'list', onClick: () => { g.symbols.sort((a, b) => splitKey(a).symbol.localeCompare(splitKey(b).symbol)); this.persist(); this.render(); } },
      { separator: true },
      { label: 'Delete group', icon: 'trash', danger: true, onClick: async () => {
        if (await confirmDialog(`Delete group “${g.name}” and its ${g.symbols.length} symbols?`, { danger: true, okLabel: 'Delete' })) {
          this.groups = this.groups.filter((x) => x !== g);
          this.persist();
          this.render();
        }
      } },
    ], { align: 'right' });
  }

  menu(anchor) {
    popupMenu(anchor, [
      { label: 'New group…', icon: 'plus', onClick: async () => {
        const name = await promptDialog('Group name', { title: 'New watchlist group', value: 'My list' });
        if (name && name.trim()) { this.groups.push({ name: name.trim(), collapsed: false, symbols: [] }); this.persist(); this.render(); }
      } },
      { label: 'Refresh quotes', icon: 'refresh', onClick: () => this.refreshAll() },
      { label: 'Reset to defaults', icon: 'history', onClick: async () => {
        if (await confirmDialog('Replace your watchlist with the default lists?', { okLabel: 'Reset' })) {
          this.groups = structuredClone(DEFAULT_GROUPS);
          this.persist();
          this.render();
          this.refreshAll();
        }
      } },
    ], { align: 'right' });
  }
}
