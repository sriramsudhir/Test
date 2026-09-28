// Alert log: history of fired alert events (GET /api/alerts/events + live socket 'alert'), incl. Laya decisions.
import { h, clear, icon, iconButton } from './util/dom.js';
import { formatPrice, formatDateTime, splitKey } from './util/fmt.js';
import { layaSummary, layaBadge, layaBar } from './util/laya.js';
import { symbolInfo } from './SymbolSearch.js';

export class AlertLogPanel {
  constructor(el, { layout, api, socket, app }) {
    this.el = el;
    this.layout = layout;
    this.api = api;
    this.app = app;
    this.events = [];
    this.filter = '';
    this.expanded = new Set();

    el.classList.add('panel', 'alert-log');
    this.search = h('input.input.input-sm', { type: 'search', placeholder: 'Filter by symbol or text' });
    this.search.addEventListener('input', () => { this.filter = this.search.value.trim().toLowerCase(); this.render(); });
    this.count = h('span.muted');
    this.tbody = h('tbody');
    el.append(
      h('div.subbar', this.search, this.count, h('span.spacer'),
        iconButton('refresh', 'Reload', () => this.load())),
      h('div.table-wrap', h('table.data-table.log-table',
        h('thead', h('tr', h('th', 'Time'), h('th', 'Symbol'), h('th', 'Alert'), h('th.num', 'Price'), h('th', 'Message'), h('th', 'Laya'))),
        this.tbody)));

    socket.on('alert', (m) => {
      const ev = m.event || m;
      if (!ev) return;
      if (ev.id != null && this.events.some((e) => e.id === ev.id)) return;
      this.events.unshift(ev);
      if (this.events.length > 1000) this.events.pop();
      this.render(ev);
    });
    this.load();
  }

  async load() {
    try {
      const res = await this.api.get('/api/alerts/events', { limit: 300 });
      const list = Array.isArray(res) ? res : (res && (res.events || res.items)) || [];
      this.events = list.slice().sort((a, b) => (b.t || 0) - (a.t || 0));
      this.render();
    } catch (err) {
      clear(this.tbody).appendChild(h('tr', h('td.empty.error', { colSpan: 6 }, `Could not load alert history: ${err.message}`)));
    }
  }

  render(fresh) {
    clear(this.tbody);
    const f = this.filter;
    const list = f ? this.events.filter((e) => `${e.symbol} ${e.name} ${e.message}`.toLowerCase().includes(f)) : this.events;
    this.count.textContent = `${list.length} event${list.length === 1 ? '' : 's'}`;
    if (!list.length) {
      this.tbody.appendChild(h('tr', h('td.empty', { colSpan: 6 }, 'No alerts have fired yet.')));
      return;
    }
    for (const ev of list.slice(0, 500)) {
      const key = ev.id ?? `${ev.alertId}|${ev.t}`;
      const tick = symbolInfo.get(ev.symbol)?.tickSize;
      const lay = layaSummary(ev.laya);
      const tr = h(`tr.log-row${ev === fresh ? '.fresh' : ''}`,
        h('td.nowrap', formatDateTime(ev.t, { seconds: true })),
        h('td.nowrap', h('a.link', { href: '#', onclick: (e) => { e.preventDefault(); this.layout.active?.setSymbol?.(ev.symbol); } }, splitKey(ev.symbol).symbol)),
        h('td', ev.name || ''),
        h('td.num', formatPrice(ev.price, tick)),
        h('td.msg', ev.message || ''),
        h('td', lay.present ? h('span.laya-cell', layaBadge(ev.laya), lay.skipped ? null : iconButton(this.expanded.has(key) ? 'chevUp' : 'chevDown', 'Laya answers', () => {
          if (this.expanded.has(key)) this.expanded.delete(key); else this.expanded.add(key);
          this.render();
        }, 'sm')) : h('span.muted', '—')));
      this.tbody.appendChild(tr);
      if (this.expanded.has(key) && lay.present) {
        this.tbody.appendChild(h('tr.log-detail', h('td', { colSpan: 6 },
          h('div.laya-detail',
            h('div.laya-detail-row', h('b', 'P(true)'), layaBar(lay.p, lay.threshold), h('span', lay.p == null ? '—' : `${(lay.p * 100).toFixed(1)}%`),
              h('span', lay.passed === false ? 'blocked' : 'passed')),
            h('pre.json', JSON.stringify(ev.laya.answers ?? ev.laya, null, 2))))));
      }
    }
  }
}

