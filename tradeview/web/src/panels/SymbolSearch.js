// Symbol search modal: tabs All / Crypto / Forex / Commodities, GET /api/symbols?group=&q=, keyboard navigation.
import { h, clear, debounce, icon, escapeHtml } from './util/dom.js';
import { openDialog } from './util/dialog.js';
import { categoryLabel } from './util/fmt.js';

const GROUPS = [
  { id: '', label: 'All' },
  { id: 'crypto', label: 'Crypto' },
  { id: 'forex', label: 'Forex' },
  { id: 'commodities', label: 'Commodities' },
];

const cache = new Map(); // `${group}|${q}` -> symbols
const MAX_ROWS = 300;

/** Shared symbol metadata cache (tickSize etc.), filled by any search. */
export const symbolInfo = new Map();

export async function fetchSymbols(api, group = '', q = '') {
  const key = `${group}|${q.toLowerCase()}`;
  if (cache.has(key)) return cache.get(key);
  const res = await api.get('/api/symbols', { group: group || undefined, q: q || undefined });
  const list = Array.isArray(res) ? res : (res && (res.symbols || res.items)) || [];
  for (const s of list) if (s && s.key) symbolInfo.set(s.key, s);
  cache.set(key, list);
  if (cache.size > 100) cache.delete(cache.keys().next().value);
  return list;
}

function highlight(text, q) {
  const safe = escapeHtml(text);
  if (!q) return safe;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i === -1) return safe;
  return escapeHtml(text.slice(0, i)) + '<mark>' + escapeHtml(text.slice(i, i + q.length)) + '</mark>' + escapeHtml(text.slice(i + q.length));
}

function rank(s, q) {
  if (!q) return 0;
  const u = q.toUpperCase();
  const sym = String(s.symbol || '').toUpperCase();
  if (sym === u) return 0;
  if (String(s.base || '').toUpperCase() === u) return 1;
  if (sym.startsWith(u)) return 2;
  if (sym.includes(u)) return 3;
  return 4;
}

export class SymbolSearch {
  /** @param {{ api: object }} deps */
  constructor({ api }) {
    this.api = api;
    this.group = '';
    this.dlg = null;
  }

  /**
   * Open the dialog.
   * @param {{ initial?: string, title?: string, onSelect: (key: string, sym: object) => void, multi?: boolean }} opts
   */
  open(opts = {}) {
    if (this.dlg && !this.dlg.closed) this.dlg.close();
    const onSelect = opts.onSelect || (() => {});
    let results = [];
    let sel = 0;
    let q = opts.initial || '';
    let reqId = 0;

    const input = h('input.input.search-input', { type: 'text', placeholder: 'Symbol, e.g. BTCUSDT', value: q, autofocus: true, spellcheck: false, autocomplete: 'off' });
    const tabs = h('div.tabs.search-tabs');
    const list = h('div.search-results', { role: 'listbox' });
    const status = h('div.search-status');

    const renderTabs = () => {
      clear(tabs);
      for (const g of GROUPS) {
        const b = h(`button.tab${g.id === this.group ? '.active' : ''}`, { type: 'button' }, g.label);
        b.addEventListener('click', () => { this.group = g.id; renderTabs(); run(); input.focus(); });
        tabs.appendChild(b);
      }
    };

    const choose = (s) => {
      if (!s) return;
      onSelect(s.key, s);
      if (!opts.multi) this.dlg.close();
      else {
        status.textContent = `Added ${s.symbol}`;
      }
    };

    const renderList = () => {
      clear(list);
      if (!results.length) {
        list.appendChild(h('div.empty', q ? `No symbols match “${q}”` : 'No symbols'));
        return;
      }
      results.slice(0, MAX_ROWS).forEach((s, i) => {
        const row = h(`div.search-row${i === sel ? '.selected' : ''}`, { role: 'option', 'aria-selected': i === sel ? 'true' : 'false', dataset: { i } },
          h('span.sym-icon', (s.base || s.symbol || '?').slice(0, 1)),
          h('span.sym-name', { html: highlight(s.symbol || s.key, q) }),
          h('span.sym-desc', `${s.base || ''}${s.quote ? ' / ' + s.quote : ''}`),
          h('span.sym-group', s.group || ''),
          h(`span.cat-tag.${s.category}`, categoryLabel(s.category)),
          h('span.sym-exch', 'BYBIT'));
        row.addEventListener('mousemove', () => {
          if (sel !== i) { sel = i; markSel(); }
        });
        row.addEventListener('click', () => choose(s));
        list.appendChild(row);
      });
      if (results.length > MAX_ROWS) list.appendChild(h('div.empty', `${results.length - MAX_ROWS} more — refine the search`));
    };

    const markSel = () => {
      list.querySelectorAll('.search-row').forEach((r) => {
        const on = Number(r.dataset.i) === sel;
        r.classList.toggle('selected', on);
        r.setAttribute('aria-selected', on ? 'true' : 'false');
        if (on) r.scrollIntoView({ block: 'nearest' });
      });
    };

    const run = async () => {
      const my = ++reqId;
      status.textContent = 'Searching…';
      try {
        const list0 = await fetchSymbols(this.api, this.group, q.trim());
        if (my !== reqId) return;
        const qq = q.trim();
        results = list0
          .filter((s) => !qq || `${s.symbol} ${s.base} ${s.quote} ${s.key}`.toUpperCase().includes(qq.toUpperCase()))
          .sort((a, b) => rank(a, qq) - rank(b, qq) || String(a.symbol).localeCompare(String(b.symbol)));
        sel = 0;
        status.textContent = `${results.length} symbol${results.length === 1 ? '' : 's'}`;
        renderList();
      } catch (err) {
        if (my !== reqId) return;
        results = [];
        status.textContent = '';
        clear(list).appendChild(h('div.empty.error', `Could not load symbols: ${err.message}`));
        // Allow a typed raw key like "linear:BTCUSDT" even when the server is down.
        const raw = q.trim().toUpperCase();
        if (/^[A-Z0-9]{3,}$/.test(raw) || /^(LINEAR|SPOT|INVERSE):[A-Z0-9]+$/.test(raw)) {
          const key = raw.includes(':') ? raw.replace(/^[A-Z]+/, (c) => c.toLowerCase()) : `linear:${raw}`;
          results = [{ key, symbol: key.split(':')[1], category: key.split(':')[0], base: '', quote: '' }];
          renderList();
        }
      }
    };
    const runDebounced = debounce(run, 140);

    input.addEventListener('input', () => { q = input.value; runDebounced(); });
    input.addEventListener('keydown', (e) => {
      const n = Math.min(results.length, MAX_ROWS);
      if (e.key === 'ArrowDown') { e.preventDefault(); if (n) { sel = (sel + 1) % n; markSel(); } }
      else if (e.key === 'ArrowUp') { e.preventDefault(); if (n) { sel = (sel - 1 + n) % n; markSel(); } }
      else if (e.key === 'PageDown') { e.preventDefault(); if (n) { sel = Math.min(n - 1, sel + 10); markSel(); } }
      else if (e.key === 'PageUp') { e.preventDefault(); if (n) { sel = Math.max(0, sel - 10); markSel(); } }
      else if (e.key === 'Enter') { e.preventDefault(); runDebounced.cancel(); if (results[sel]) choose(results[sel]); else run(); }
      else if (e.key === 'Tab') {
        e.preventDefault();
        const idx = GROUPS.findIndex((g) => g.id === this.group);
        this.group = GROUPS[(idx + (e.shiftKey ? GROUPS.length - 1 : 1)) % GROUPS.length].id;
        renderTabs();
        run();
      }
    });

    this.dlg = openDialog({
      title: opts.title || 'Symbol Search',
      className: 'dialog-search',
      content: h('div.search-wrap',
        h('div.search-bar', icon('search', 18), input),
        tabs,
        list,
        h('div.search-foot', status, h('span.hint', '↑↓ navigate · Enter select · Tab switch group · Esc close'))),
    });
    renderTabs();
    run();
    requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    });
    return this.dlg;
  }
}
