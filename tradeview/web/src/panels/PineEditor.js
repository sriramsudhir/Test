// Pine Editor panel: Monaco with Pine Script v6 highlighting, built-in library, local scripts,
// "Add to chart" (validated via POST /api/pine/run, errors shown as line markers) and "Run backtest".
import * as monaco from 'monaco-editor/editor.js';
import 'monaco-editor/features/register.all.js';
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import { registerPine, PINE_LANGUAGE_ID, PINE_THEME, PINE_TEMPLATES } from './pineLanguage.js';
import { h, clear, icon, debounce } from './util/dom.js';
import { popupMenu, promptDialog, confirmDialog, toast } from './util/dialog.js';
import { load, save } from './util/store.js';
import { chartState } from './util/chartHub.js';
import { formatTimeAgo } from './util/fmt.js';

if (!self.MonacoEnvironment) {
  self.MonacoEnvironment = { getWorker: () => new EditorWorker() };
}

const isStrategy = (src) => /^\s*strategy\s*\(/m.test(src || '');
const titleOf = (src) => /^\s*(?:indicator|strategy|library)\s*\(\s*(?:title\s*=\s*)?["']([^"']+)["']/m.exec(src || '')?.[1];

/** Extract { line, column } from a PineTS / server error message when the server does not send them. */
function parseErrorPosition(msg) {
  const s = String(msg || '');
  let m = /line\s*[:#]?\s*(\d+)(?:\s*[,:]\s*col(?:umn)?\s*[:#]?\s*(\d+))?/i.exec(s);
  if (m) return { line: Number(m[1]), column: m[2] ? Number(m[2]) : 1 };
  m = /\((\d+):(\d+)\)/.exec(s) || /:(\d+):(\d+)/.exec(s);
  if (m) return { line: Number(m[1]), column: Number(m[2]) };
  return null;
}

export class PineEditorPanel {
  constructor(el, { layout, api, socket, app }) {
    this.el = el;
    this.layout = layout;
    this.api = api;
    this.app = app;
    this.library = null;
    this.onChart = load('pine.onChart', {}); // script name -> { chartId, indicatorId }
    const current = load('pine.current', null);
    this.name = (current && current.name) || 'Untitled script';
    this.dirty = false;

    el.classList.add('panel', 'pine-panel');
    this.nameInput = h('input.input.input-sm.pine-name', { type: 'text', value: this.name, spellcheck: false, title: 'Script name' });
    this.nameInput.addEventListener('change', () => { this.name = this.nameInput.value.trim() || 'Untitled script'; this.autosave(); });
    this.dirtyDot = h('span.dirty-dot', { title: 'Unsaved changes' });
    this.addBtn = h('button.btn.btn-primary.btn-sm', { type: 'button', title: 'Add to chart (Ctrl+Enter)' }, icon('plus', 14), 'Add to chart');
    this.testBtn = h('button.btn.btn-sm', { type: 'button', title: 'Run backtest in the Strategy Tester' }, icon('flask', 14), 'Run backtest');
    this.status = h('div.pine-status');
    this.console = h('div.pine-console');
    this.host = h('div.pine-editor');

    el.append(
      h('div.subbar.pine-toolbar',
        h('button.btn.btn-ghost.btn-sm', { type: 'button', onclick: (e) => this.openMenu(e.currentTarget) }, icon('folder', 14), 'Open', icon('chevDown', 12)),
        this.nameInput, this.dirtyDot,
        h('button.btn.btn-ghost.btn-sm', { type: 'button', title: 'Save (Ctrl+S)', onclick: () => this.saveScript() }, icon('save', 14), 'Save'),
        h('span.spacer'),
        this.status,
        this.testBtn,
        this.addBtn),
      h('div.pine-main', this.host, this.console));

    registerPine(monaco);
    this.model = monaco.editor.createModel((current && current.source) || PINE_TEMPLATES.indicator, PINE_LANGUAGE_ID);
    this.editor = monaco.editor.create(this.host, {
      model: this.model,
      theme: PINE_THEME,
      automaticLayout: true,
      fontFamily: '"JetBrains Mono", "Fira Code", Menlo, Consolas, monospace',
      fontSize: 13,
      lineHeight: 20,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      renderLineHighlight: 'all',
      tabSize: 4,
      insertSpaces: true,
      glyphMargin: true,
      folding: true,
      smoothScrolling: true,
      padding: { top: 8 },
      fixedOverflowWidgets: true,
      scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
    });
    this.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => this.saveScript());
    this.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => this.addToChart());
    this.model.onDidChangeContent(() => {
      this.dirty = true;
      this.dirtyDot.classList.add('on');
      monaco.editor.setModelMarkers(this.model, 'pine', []);
      this.updateButtons();
      this.autosaveDebounced();
    });
    this.autosaveDebounced = debounce(() => this.autosave(), 600);

    this.addBtn.addEventListener('click', () => this.addToChart());
    this.testBtn.addEventListener('click', () => this.runBacktest());
    this.updateButtons();
    this.log('info', 'Pine Script v6 · Ctrl+Enter adds the script to the active chart, Ctrl+S saves it.');
  }

  getSource() { return this.model.getValue(); }

  setSource(source, name) {
    this.model.setValue(source || '');
    if (name) { this.name = name; this.nameInput.value = name; }
    this.dirty = false;
    this.dirtyDot.classList.remove('on');
    this.autosave();
    this.updateButtons();
    this.editor.focus();
  }

  layoutEditor() { try { this.editor.layout(); } catch { /* ignore */ } }

  autosave() { save('pine.current', { name: this.name, source: this.getSource() }); }

  updateButtons() {
    const strat = isStrategy(this.getSource());
    this.testBtn.style.display = strat ? '' : 'none';
    const onChart = this.onChart[this.name];
    clear(this.addBtn).append(icon(onChart ? 'refresh' : 'plus', 14), onChart ? 'Update on chart' : 'Add to chart');
  }

  // ---------------------------------------------------------------- console / markers

  log(kind, text, pos) {
    const row = h(`div.console-row.${kind}`,
      h('span.console-time', new Date().toLocaleTimeString()),
      icon(kind === 'error' ? 'warn' : kind === 'ok' ? 'check' : 'spark', 13),
      h('span.console-text', text));
    if (pos) {
      row.classList.add('clickable');
      row.addEventListener('click', () => {
        this.editor.revealLineInCenter(pos.line);
        this.editor.setPosition({ lineNumber: pos.line, column: pos.column || 1 });
        this.editor.focus();
      });
    }
    this.console.appendChild(row);
    while (this.console.children.length > 60) this.console.firstChild.remove();
    this.console.scrollTop = this.console.scrollHeight;
  }

  setStatus(text, kind = '') {
    this.status.className = `pine-status ${kind}`;
    this.status.textContent = text;
  }

  showError(message, line, column) {
    const pos = line ? { line: Number(line), column: Number(column) || 1 } : parseErrorPosition(message);
    const markers = [];
    if (pos && pos.line >= 1 && pos.line <= this.model.getLineCount()) {
      const lineLen = this.model.getLineMaxColumn(pos.line);
      markers.push({
        severity: monaco.MarkerSeverity.Error,
        message: String(message),
        startLineNumber: pos.line,
        startColumn: Math.min(pos.column || 1, lineLen - 1) || 1,
        endLineNumber: pos.line,
        endColumn: lineLen,
      });
      this.editor.revealLineInCenterIfOutsideViewport(pos.line);
    }
    monaco.editor.setModelMarkers(this.model, 'pine', markers);
    this.log('error', pos ? `Line ${pos.line}: ${message}` : String(message), pos);
    this.setStatus('Error', 'error');
  }

  /** Compile/run the script on the active chart's data. Returns the run result or null on error. */
  async validate() {
    const chart = this.layout.active;
    const st = chartState(chart);
    const source = this.getSource();
    if (!source.trim()) { this.showError('The script is empty'); return null; }
    this.setStatus('Compiling…', 'busy');
    try {
      const res = await this.api.post('/api/pine/run', { symbol: st.symbol || 'linear:BTCUSDT', tf: st.tf || '1h', source, limit: 500 });
      if (res && res.error) { this.showError(res.error, res.line, res.column); return null; }
      monaco.editor.setModelMarkers(this.model, 'pine', []);
      for (const w of (res && res.warnings) || []) this.log('warn', typeof w === 'string' ? w : w.message || JSON.stringify(w));
      return res || {};
    } catch (err) {
      this.showError(err.data && err.data.error ? err.data.error : err.message, err.data && err.data.line, err.data && err.data.column);
      return null;
    }
  }

  async addToChart() {
    const chart = this.layout.active;
    if (!chart) { toast('No active chart', 'warn'); return; }
    const res = await this.validate();
    if (!res) return;
    const source = this.getSource();
    const title = (res.meta && res.meta.title) || titleOf(source) || this.name;
    try {
      const prev = this.onChart[this.name];
      if (prev && prev.indicatorId != null) {
        const target = this.layout.charts.find((c) => chartState(c).id === prev.chartId) || chart;
        try { target.removeIndicator(prev.indicatorId); } catch { /* already removed */ }
      }
      const id = await chart.addIndicator({ source, name: title, title });
      this.onChart[this.name] = { chartId: chartState(chart).id, indicatorId: id };
      save('pine.onChart', this.onChart);
      this.updateButtons();
      const plots = res.plots ? Object.keys(res.plots).length : 0;
      this.log('ok', `“${title}” ${prev ? 'updated on' : 'added to'} ${chartState(chart).symbol || 'chart'} (${plots} plot${plots === 1 ? '' : 's'})`);
      this.setStatus(prev ? 'Updated' : 'Added', 'ok');
    } catch (err) {
      this.showError(err.message || String(err));
    }
  }

  async runBacktest() {
    const source = this.getSource();
    if (!isStrategy(source)) { toast('Only strategy() scripts can be backtested', 'warn'); return; }
    this.app.showBottom?.('tester');
    this.app.tester?.runWithSource(source, titleOf(source) || this.name);
  }

  // ---------------------------------------------------------------- scripts / library

  scripts() { return load('pine.scripts', {}); }

  async saveScript(asNew = false) {
    let name = this.nameInput.value.trim() || this.name;
    if (asNew || name === 'Untitled script') {
      const n = await promptDialog('Script name', { title: 'Save script', value: titleOf(this.getSource()) || name });
      if (!n || !n.trim()) return;
      name = n.trim();
    }
    const all = this.scripts();
    all[name] = { source: this.getSource(), updated: Date.now() };
    if (!save('pine.scripts', all)) { toast('Could not save: browser storage is unavailable or full', 'error'); return; }
    this.name = name;
    this.nameInput.value = name;
    this.dirty = false;
    this.dirtyDot.classList.remove('on');
    this.autosave();
    this.updateButtons();
    this.setStatus('Saved', 'ok');
    toast(`Saved “${name}”`, 'success', 1500);
  }

  async loadLibrary() {
    if (this.library) return this.library;
    const res = await this.api.get('/api/pine/library');
    this.library = Array.isArray(res) ? res : (res && (res.items || res.library)) || [];
    return this.library;
  }

  async openLibrary(item) {
    try {
      let source = item.source;
      if (!source) {
        const full = await this.api.get(`/api/pine/library/${encodeURIComponent(item.id)}`);
        source = full && full.source;
      }
      if (!source) throw new Error('Library entry has no source');
      await this.confirmDiscard();
      this.setSource(source, item.name || item.id);
      this.log('info', `Opened built-in “${item.name || item.id}”${item.description ? ' — ' + item.description : ''}`);
    } catch (err) {
      toast(`Could not open ${item.name || item.id}: ${err.message}`, 'error');
    }
  }

  async confirmDiscard() {
    if (!this.dirty) return true;
    const all = this.scripts();
    if (all[this.name] && all[this.name].source === this.getSource()) return true;
    // Keep an automatic backup instead of blocking the user.
    all['(autosave) ' + this.name] = { source: this.getSource(), updated: Date.now() };
    save('pine.scripts', all);
    return true;
  }

  async openMenu(anchor) {
    const items = [{ header: 'New' }];
    for (const [k, label] of [['indicator', 'Indicator (overlay)'], ['oscillator', 'Indicator (pane)'], ['strategy', 'Strategy']]) {
      items.push({ label, icon: 'file', onClick: async () => { await this.confirmDiscard(); this.setSource(PINE_TEMPLATES[k], 'Untitled script'); } });
    }
    const mine = Object.entries(this.scripts()).sort((a, b) => b[1].updated - a[1].updated);
    if (mine.length) {
      items.push({ separator: true }, { header: 'My scripts' });
      for (const [name, s] of mine.slice(0, 20)) {
        items.push({ label: name, icon: 'code', hint: formatTimeAgo(s.updated), onClick: async () => { await this.confirmDiscard(); this.setSource(s.source, name); } });
      }
      items.push({ label: 'Delete current script…', icon: 'trash', danger: true, onClick: async () => {
        const all = this.scripts();
        if (!all[this.name]) { toast('This script is not saved', 'info'); return; }
        if (await confirmDialog(`Delete “${this.name}” from your saved scripts?`, { danger: true, okLabel: 'Delete' })) {
          delete all[this.name];
          save('pine.scripts', all);
          toast('Deleted', 'success', 1500);
        }
      } });
    }
    items.push({ separator: true }, { header: 'Built-in library' });
    try {
      const lib = await this.loadLibrary();
      const byCat = new Map();
      for (const it of lib) {
        const c = it.category || (it.type === 'strategy' ? 'Strategies' : 'Indicators');
        if (!byCat.has(c)) byCat.set(c, []);
        byCat.get(c).push(it);
      }
      for (const [cat, list] of [...byCat].sort((a, b) => a[0].localeCompare(b[0]))) {
        items.push({ header: `  ${cat}` });
        for (const it of list) items.push({ label: it.name || it.id, icon: it.type === 'strategy' ? 'flask' : 'code', hint: it.shorttitle && it.shorttitle !== it.name ? it.shorttitle : '', onClick: () => this.openLibrary(it) });
      }
      if (!lib.length) items.push({ label: 'Library is empty', disabled: true });
    } catch (err) {
      items.push({ label: `Library unavailable (${err.message})`, disabled: true });
    }
    const menu = popupMenu(anchor, items);
    menu.classList.add('scroll-menu');
  }
}
