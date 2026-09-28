// "Indicators" dialog (opened by the chart toolbar's 'open-indicators' event): built-in indicators,
// the server Pine library and the user's saved Pine scripts, with search and keyboard navigation.
import { h, clear, icon, debounce } from './util/dom.js';
import { openDialog, toast } from './util/dialog.js';
import { load } from './util/store.js';
import { chartState } from './util/chartHub.js';
import { BUILTIN_INDICATORS } from '../chart/indicators/catalog.js';

const TABS = [
  { id: 'builtin', label: 'Built-ins' },
  { id: 'library', label: 'Pine library' },
  { id: 'mine', label: 'My scripts' },
];

export class IndicatorsDialog {
  constructor({ api }) {
    this.api = api;
    this.library = null;
    this.tab = 'builtin';
  }

  async loadLibrary() {
    if (this.library) return this.library;
    try {
      const res = await this.api.get('/api/pine/library');
      this.library = (Array.isArray(res) ? res : (res && res.items) || []).filter((i) => i.type !== 'strategy');
    } catch {
      this.library = [];
    }
    return this.library;
  }

  items(tab) {
    if (tab === 'builtin') {
      return BUILTIN_INDICATORS.map((b) => ({ key: `b:${b.id}`, name: b.name, sub: b.overlay ? 'Overlay' : 'Separate pane', spec: { builtin: b.id } }));
    }
    if (tab === 'library') {
      return (this.library || []).map((i) => ({ key: `l:${i.id}`, name: i.name || i.id, sub: [i.category, i.description].filter(Boolean).join(' · '), spec: { builtin: i.id } }));
    }
    const mine = load('pine.scripts', {});
    return Object.entries(mine)
      .filter(([, s]) => s && s.source && !/^\s*strategy\s*\(/m.test(s.source))
      .map(([name, s]) => ({ key: `m:${name}`, name, sub: 'Saved Pine script', spec: { source: s.source, name, title: name } }));
  }

  open(chart) {
    if (!chart) { toast('No active chart', 'warn'); return null; }
    let q = '';
    let sel = 0;
    let rows = [];
    const input = h('input.input.search-input', { type: 'text', placeholder: 'Search indicators', autofocus: true, autocomplete: 'off' });
    const tabs = h('div.tabs.search-tabs');
    const list = h('div.search-results');
    const added = h('div.search-status');

    const renderTabs = () => {
      clear(tabs);
      for (const t of TABS) tabs.appendChild(h(`button.tab${t.id === this.tab ? '.active' : ''}`, { type: 'button', onclick: () => { this.tab = t.id; sel = 0; renderTabs(); render(); input.focus(); } }, t.label));
    };
    const add = (it) => {
      try {
        chart.addIndicator(it.spec);
        added.textContent = `Added ${it.name} to ${chartState(chart).symbol || 'chart'}`;
      } catch (err) {
        toast(`Could not add ${it.name}: ${err.message}`, 'error');
      }
    };
    const render = async () => {
      if (this.tab === 'library' && !this.library) {
        clear(list).appendChild(h('div.empty', h('span.spinner'), ' Loading library…'));
        await this.loadLibrary();
      }
      const qq = q.trim().toLowerCase();
      rows = this.items(this.tab).filter((i) => !qq || `${i.name} ${i.sub}`.toLowerCase().includes(qq));
      sel = Math.min(sel, Math.max(0, rows.length - 1));
      clear(list);
      if (!rows.length) {
        list.appendChild(h('div.empty', this.tab === 'mine' ? 'No saved indicator scripts yet — save one from the Pine Editor.' : 'Nothing matches'));
        return;
      }
      rows.forEach((it, i) => {
        const row = h(`div.search-row.ind-row${i === sel ? '.selected' : ''}`, { dataset: { i } },
          h('span.sym-icon', icon(this.tab === 'mine' ? 'code' : 'spark', 14)),
          h('span.sym-name', it.name),
          h('span.sym-desc', it.sub || ''),
          h('span.ind-add', icon('plus', 14)));
        row.addEventListener('click', () => { sel = i; add(it); markSel(); });
        list.appendChild(row);
      });
    };
    const markSel = () => list.querySelectorAll('.search-row').forEach((r) => {
      const on = Number(r.dataset.i) === sel;
      r.classList.toggle('selected', on);
      if (on) r.scrollIntoView({ block: 'nearest' });
    });
    const rerender = debounce(render, 80);
    input.addEventListener('input', () => { q = input.value; sel = 0; rerender(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); if (rows.length) { sel = (sel + 1) % rows.length; markSel(); } }
      else if (e.key === 'ArrowUp') { e.preventDefault(); if (rows.length) { sel = (sel - 1 + rows.length) % rows.length; markSel(); } }
      else if (e.key === 'Enter') { e.preventDefault(); if (rows[sel]) add(rows[sel]); }
    });

    const dlg = openDialog({
      title: 'Indicators',
      className: 'dialog-search',
      content: h('div.search-wrap', h('div.search-bar', icon('search', 18), input), tabs, list,
        h('div.search-foot', added, h('span.hint', 'Enter adds · click adds · Esc closes'))),
    });
    renderTabs();
    render();
    return dlg;
  }
}
