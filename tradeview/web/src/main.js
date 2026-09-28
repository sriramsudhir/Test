// TradeView app shell: top bar, drawing toolbar, chart layout, right sidebar (icon tabs), resizable bottom panel,
// status bar, keyboard shortcuts, persisted UI state, alert alarm handling.
import './styles/app.css';
import { api, socket } from './api/client.js';
import * as LayoutModule from './layout/Layout.js';
import * as ToolbarModule from './layout/Toolbar.js';
import * as DrawingToolbarModule from './layout/DrawingToolbar.js';
import { alarm } from './audio/alarm.js';
import { requestNotificationPermission, notificationPermission, isFlashing } from './audio/notify.js';
import { h, clear, icon, isEditableTarget } from './panels/util/dom.js';
import { closeTopDialog, closeMenu, hasOpenDialog, toast } from './panels/util/dialog.js';
import { load, save } from './panels/util/store.js';
import { ChartHub, chartState } from './panels/util/chartHub.js';
import { formatPrice, splitKey } from './panels/util/fmt.js';
import { SymbolSearch, symbolInfo, fetchSymbols } from './panels/SymbolSearch.js';
import { WatchlistPanel } from './panels/Watchlist.js';
import { AlertsPanel } from './panels/Alerts.js';
import { AlertCenter } from './panels/AlertCenter.js';
import { AlertLogPanel } from './panels/AlertLog.js';
import { ChatPanel } from './panels/Chat.js';
import { StrategyTesterPanel } from './panels/StrategyTester.js';
import { ReplayTradingPanel } from './panels/ReplayTrading.js';
import { ObjectTreePanel } from './panels/ObjectTree.js';
import { DataWindowPanel } from './panels/DataWindow.js';
import { StatusBar } from './panels/StatusBar.js';

const pick = (mod, name) => mod[name] || mod.default;
const Layout = pick(LayoutModule, 'Layout');
const Toolbar = pick(ToolbarModule, 'Toolbar');
const DrawingToolbar = pick(DrawingToolbarModule, 'DrawingToolbar');

const SIDEBAR_TABS = [
  { id: 'watchlist', icon: 'list', title: 'Watchlist' },
  { id: 'alerts', icon: 'alarm', title: 'Alerts' },
  { id: 'chat', icon: 'chat', title: 'Agent' },
  { id: 'objects', icon: 'tree', title: 'Object tree' },
  { id: 'data', icon: 'data', title: 'Data window' },
];
const BOTTOM_TABS = [
  { id: 'pine', icon: 'code', title: 'Pine Editor' },
  { id: 'tester', icon: 'flask', title: 'Strategy Tester' },
  { id: 'replay', icon: 'replay', title: 'Replay Trading' },
  { id: 'alertlog', icon: 'history', title: 'Alert log' },
];
const NARROW = '(max-width: 900px)';

const ui = {
  sidebarTab: 'watchlist',
  sidebarWidth: 320,
  bottomTab: 'pine',
  bottomOpen: false,
  bottomHeight: 300,
  bottomMax: false,
  ...load('ui', {}),
};
const persistUi = () => save('ui', {
  sidebarTab: ui.sidebarTab,
  sidebarWidth: ui.sidebarWidth,
  bottomTab: ui.bottomTab,
  bottomOpen: ui.bottomOpen,
  bottomHeight: ui.bottomHeight,
  bottomMax: ui.bottomMax,
});

// ------------------------------------------------------------------------------------------------ DOM

const $ = (id) => document.getElementById(id);
const els = {
  app: $('app'),
  symbolBtn: $('symbol-btn'),
  toolbar: $('toolbar-mount'),
  topActions: $('top-actions'),
  drawbar: $('drawbar-mount'),
  chartRoot: $('chart-root'),
  center: $('center'),
  bottom: $('bottom-panel'),
  bottomTabs: $('bottom-tabs'),
  bottomContent: $('bottom-content'),
  bottomResizer: $('bottom-resizer'),
  sidebar: $('sidebar'),
  sidebarContent: $('sidebar-content'),
  sidebarResizer: $('sidebar-resizer'),
  sidebarTabs: $('sidebar-tabs'),
  status: $('statusbar'),
};

// ------------------------------------------------------------------------------------------------ Layout

/** Minimal stand-in so panels keep working if the chart layout fails to initialise. */
function nullLayout() {
  return {
    charts: [],
    active: null,
    on() { return () => {}; },
    setLayout() {},
    getContext() { return { charts: [], activeChartId: null }; },
    executeCommand(cmd) { throw new Error(`Chart unavailable (${cmd && cmd.action})`); },
  };
}

let layout;
try {
  if (typeof Layout !== 'function') throw new Error('layout/Layout.js does not export Layout');
  layout = new Layout(els.chartRoot, { api, socket });
} catch (err) {
  console.error('[app] Layout failed to initialise', err);
  els.chartRoot.appendChild(h('div.chart-error', icon('warn', 28), h('div', 'The chart could not be initialised.'), h('pre', String(err && err.message ? err.message : err))));
  layout = nullLayout();
}

const hub = new ChartHub(layout);
const symbolSearch = new SymbolSearch({ api });

const app = {
  api,
  socket,
  layout,
  hub,
  alarm,
  panels: {},
  alerts: null,
  tester: null,
  pine: null,
  openSymbolSearch,
  showSidebar,
  showBottom,
  toggleBottom,
  toast,
  getPineSource: async () => (app.pine ? app.pine.getSource() : load('pine.current', null)?.source || ''),
  getPineSourceSync: () => (app.pine ? app.pine.getSource() : load('pine.current', null)?.source || ''),
  showBacktestResult(result, request) {
    showBottom('tester');
    app.tester?.showResult(result, request);
  },
};
window.tradeview = app;

function openSymbolSearch(opts = {}) {
  return symbolSearch.open({
    onSelect: (key) => {
      const chart = layout.active;
      if (chart && typeof chart.setSymbol === 'function') chart.setSymbol(key);
      else layout.executeCommand({ action: 'set_symbol', symbol: key });
    },
    ...opts,
  });
}

// Toolbars owned by the chart team (layout/Toolbar.js, layout/DrawingToolbar.js).
const toolbarOpts = { layout, api, socket, app, openSymbolSearch, onSymbolSearch: openSymbolSearch };
for (const [Ctor, el, name] of [[Toolbar, els.toolbar, 'Toolbar'], [DrawingToolbar, els.drawbar, 'DrawingToolbar']]) {
  try {
    if (typeof Ctor === 'function') app.panels[name] = new Ctor(el, toolbarOpts);
  } catch (err) {
    console.error(`[app] ${name} failed to initialise`, err);
  }
}

// ------------------------------------------------------------------------------------------------ top bar

function renderSymbolButton() {
  const st = chartState(hub.active);
  const { symbol, category } = splitKey(st.symbol || '');
  clear(els.symbolBtn).append(icon('search', 16), h('span.sym', symbol || 'Symbol'), category && st.symbol ? h(`span.cat-tag.${category}`, category === 'linear' ? 'PERP' : category.toUpperCase()) : null);
}
els.symbolBtn.addEventListener('click', () => openSymbolSearch());
hub.on('active', renderSymbolButton);
hub.on('symbol', renderSymbolButton);
renderSymbolButton();

// Document title follows the active chart's last price.
hub.on('price', ({ chart, data }) => {
  if (chart !== hub.active || isFlashing()) return;
  const st = chartState(chart);
  const price = typeof data === 'number' ? data : data && (data.price ?? data.c ?? data.value);
  if (price == null) return;
  document.title = `${splitKey(st.symbol).symbol} ${formatPrice(price, symbolInfo.get(st.symbol)?.tickSize)} · TradeView`;
});

const topBtn = (ico, label, title, onclick) => h('button.top-btn', { type: 'button', title, onclick }, icon(ico, 17), h('span.top-btn-label', label));
els.topActions.append(
  topBtn('alarm', 'Alert', 'Create alert (Alt+A)', () => app.alerts?.createAtCrosshair()),
  topBtn('replay', 'Replay', 'Bar replay (Alt+R)', () => startReplay()),
  topBtn('code', 'Pine', 'Pine Editor', () => toggleBottom('pine')),
  topBtn('sparkles', 'Agent', 'Ask the agent', () => showSidebar('chat', true)),
);

// ------------------------------------------------------------------------------------------------ sidebar

const sidebarPanes = new Map();
const sidebarButtons = new Map();

for (const t of SIDEBAR_TABS) {
  const pane = h(`div.sidebar-pane.pane-${t.id}`, { hidden: true });
  els.sidebarContent.appendChild(pane);
  sidebarPanes.set(t.id, pane);
  const btn = h('button.side-tab', { type: 'button', title: t.title, 'aria-label': t.title, dataset: { tab: t.id } }, icon(t.icon, 22));
  btn.addEventListener('click', () => showSidebar(t.id));
  els.sidebarTabs.appendChild(btn);
  sidebarButtons.set(t.id, btn);
}
els.sidebarTabs.appendChild(h('div.side-tab-spacer'));
els.sidebarTabs.appendChild(h('button.side-tab', { type: 'button', title: 'Keyboard shortcuts', onclick: showShortcuts }, icon('gear', 20)));

/** Show a sidebar tab; clicking the open tab again collapses the sidebar (unless force). */
function showSidebar(id, force = false) {
  if (!force && ui.sidebarTab === id && !els.sidebar.hidden) id = null;
  ui.sidebarTab = id;
  els.sidebar.hidden = !id;
  els.app.classList.toggle('sidebar-open', !!id);
  for (const [k, pane] of sidebarPanes) pane.hidden = k !== id;
  for (const [k, b] of sidebarButtons) b.classList.toggle('active', k === id);
  if (id) app.panels[id]?.onShow?.();
  if (id === 'chat') setTimeout(() => app.panels.chat?.input.focus(), 30);
  persistUi();
}

function applySidebarWidth() {
  els.app.style.setProperty('--sidebar-w', `${ui.sidebarWidth}px`);
}

// ------------------------------------------------------------------------------------------------ bottom panel

const bottomPanes = new Map();
const bottomButtons = new Map();
const bottomHeaderRight = h('div.bottom-actions');

for (const t of BOTTOM_TABS) {
  const pane = h(`div.bottom-pane.pane-${t.id}`, { hidden: true });
  els.bottomContent.appendChild(pane);
  bottomPanes.set(t.id, pane);
  const btn = h('button.bottom-tab', { type: 'button', dataset: { tab: t.id } }, icon(t.icon, 15), h('span', t.title));
  btn.addEventListener('click', () => toggleBottom(t.id));
  els.bottomTabs.appendChild(btn);
  bottomButtons.set(t.id, btn);
}
const maxBtn = h('button.icon-btn', { type: 'button', title: 'Maximize panel' }, icon('maximize', 16));
const collapseBtn = h('button.icon-btn', { type: 'button', title: 'Collapse panel' }, icon('chevDown', 16));
maxBtn.addEventListener('click', () => { ui.bottomMax = !ui.bottomMax; if (!ui.bottomOpen) ui.bottomOpen = true; applyBottom(); });
collapseBtn.addEventListener('click', () => { ui.bottomOpen = !ui.bottomOpen; applyBottom(); });
bottomHeaderRight.append(maxBtn, collapseBtn);
els.bottomTabs.appendChild(h('span.spacer'));
els.bottomTabs.appendChild(bottomHeaderRight);

function applyBottom() {
  els.app.classList.toggle('bottom-open', ui.bottomOpen);
  els.app.classList.toggle('bottom-max', ui.bottomOpen && ui.bottomMax);
  els.app.style.setProperty('--bottom-h', `${ui.bottomHeight}px`);
  for (const [k, pane] of bottomPanes) pane.hidden = !(ui.bottomOpen && k === ui.bottomTab);
  for (const [k, b] of bottomButtons) b.classList.toggle('active', ui.bottomOpen && k === ui.bottomTab);
  clear(maxBtn).appendChild(icon(ui.bottomMax && ui.bottomOpen ? 'minimize' : 'maximize', 16));
  maxBtn.title = ui.bottomMax ? 'Restore panel' : 'Maximize panel';
  clear(collapseBtn).appendChild(icon(ui.bottomOpen ? 'chevDown' : 'chevUp', 16));
  collapseBtn.title = ui.bottomOpen ? 'Collapse panel' : 'Expand panel';
  if (ui.bottomOpen) ensureBottomPanel(ui.bottomTab);
  persistUi();
}

function showBottom(id) {
  ui.bottomTab = id;
  ui.bottomOpen = true;
  applyBottom();
}

/** Clicking the active tab collapses the panel; clicking another tab switches to it. */
function toggleBottom(id) {
  if (ui.bottomOpen && ui.bottomTab === id) ui.bottomOpen = false;
  else { ui.bottomTab = id; ui.bottomOpen = true; }
  applyBottom();
}

let pineLoading = null;
function ensureBottomPanel(id) {
  if (id === 'pine' && !app.pine && !pineLoading) {
    const pane = bottomPanes.get('pine');
    pane.appendChild(h('div.panel-loading', h('span.spinner.lg'), 'Loading Pine Editor…'));
    // Monaco is large: load it on first use.
    pineLoading = import('./panels/PineEditor.js')
      .then(({ PineEditorPanel }) => {
        clear(pane);
        app.pine = new PineEditorPanel(pane, { layout, api, socket, app });
        app.panels.pine = app.pine;
      })
      .catch((err) => {
        console.error('[app] Pine editor failed to load', err);
        clear(pane).appendChild(h('div.empty.error', `Pine Editor failed to load: ${err.message}`));
        pineLoading = null;
      });
  }
  app.panels[id]?.onShow?.();
  if (id === 'pine' && app.pine) requestAnimationFrame(() => app.pine.layoutEditor());
}

// Resizing: bottom panel (drag the top edge), sidebar (drag the left edge).
function dragResize(handle, onMove, onEnd) {
  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    document.body.classList.add('resizing');
    handle.classList.add('dragging');
    const move = (ev) => onMove(ev);
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      document.body.classList.remove('resizing');
      handle.classList.remove('dragging');
      onEnd && onEnd();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  });
}

dragResize(els.bottomResizer, (e) => {
  const r = els.center.getBoundingClientRect();
  const hgt = Math.round(r.bottom - e.clientY);
  if (!ui.bottomOpen) { ui.bottomOpen = true; }
  ui.bottomMax = false;
  ui.bottomHeight = Math.max(140, Math.min(r.height - 100, hgt));
  els.app.style.setProperty('--bottom-h', `${ui.bottomHeight}px`);
  els.app.classList.add('bottom-open');
  els.app.classList.remove('bottom-max');
}, () => applyBottom());
els.bottomResizer.addEventListener('dblclick', () => { ui.bottomOpen = !ui.bottomOpen; applyBottom(); });

dragResize(els.sidebarResizer, (e) => {
  const tabsW = els.sidebarTabs.getBoundingClientRect().width;
  ui.sidebarWidth = Math.max(240, Math.min(Math.round(window.innerWidth * 0.6), Math.round(window.innerWidth - tabsW - e.clientX)));
  applySidebarWidth();
}, () => persistUi());

// ------------------------------------------------------------------------------------------------ panels

const deps = { layout, api, socket, app };
function mount(name, Ctor, el) {
  try {
    const p = new Ctor(el, deps);
    app.panels[name] = p;
    return p;
  } catch (err) {
    console.error(`[app] panel ${name} failed`, err);
    el.appendChild(h('div.empty.error', `${name} failed to load: ${err.message}`));
    return null;
  }
}
mount('watchlist', WatchlistPanel, sidebarPanes.get('watchlist'));
app.alerts = mount('alerts', AlertsPanel, sidebarPanes.get('alerts'));
mount('chat', ChatPanel, sidebarPanes.get('chat'));
mount('objects', ObjectTreePanel, sidebarPanes.get('objects'));
mount('data', DataWindowPanel, sidebarPanes.get('data'));
app.tester = mount('tester', StrategyTesterPanel, bottomPanes.get('tester'));
app.replay = mount('replay', ReplayTradingPanel, bottomPanes.get('replay'));
mount('alertlog', AlertLogPanel, bottomPanes.get('alertlog'));
app.alertCenter = new AlertCenter(deps);
app.statusBar = new StatusBar(els.status, deps);

applySidebarWidth();
const narrow = window.matchMedia(NARROW);
showSidebar(narrow.matches ? null : ui.sidebarTab, true);
applyBottom();
narrow.addEventListener?.('change', (e) => { if (e.matches && ui.sidebarTab) showSidebar(null, true); });

// Warm the symbol metadata cache (tick sizes for price formatting).
fetchSymbols(api, '', '').catch(() => {});

// ------------------------------------------------------------------------------------------------ replay

function startReplay() {
  showBottom('replay');
  const chart = layout.active;
  if (!chart) { toast('No active chart', 'warn'); return; }
  const active = chart.replay && (chart.replay.active || (typeof chart.replay.state === 'string' && !['idle', 'stopped'].includes(chart.replay.state)));
  if (active) return;
  app.replay?.start();
}

// ------------------------------------------------------------------------------------------------ keyboard

function showShortcuts() {
  import('./panels/util/dialog.js').then(({ openDialog }) => {
    const rows = [
      ['Alt + A', 'Create alert at the crosshair price'],
      ['Alt + R', 'Start bar replay'],
      ['/ or any letter', 'Symbol search'],
      ['Esc', 'Close dialogs / cancel drawing tool'],
      ['Ctrl + Enter', 'Pine Editor: add script to chart'],
      ['Ctrl + S', 'Pine Editor: save script'],
      ['Enter / Shift + Enter', 'Agent: send / new line'],
    ];
    openDialog({
      title: 'Keyboard shortcuts',
      className: 'dialog-sm',
      content: h('div.shortcuts', rows.map(([k, v]) => h('div.shortcut-row', h('kbd', k), h('span', v)))),
    });
  });
}

document.addEventListener('keydown', (e) => {
  if (e.defaultPrevented) return;
  if (e.key === 'Escape') {
    if (closeMenu() || closeTopDialog()) { e.preventDefault(); return; }
    if (alarm.playing) { alarm.stop(); return; }
    try { layout.active?.setDrawingTool?.(null); } catch { /* ignore */ }
    return;
  }
  if (e.altKey && !e.ctrlKey && !e.metaKey) {
    if (e.code === 'KeyA') { e.preventDefault(); app.alerts?.createAtCrosshair(); return; }
    if (e.code === 'KeyR') { e.preventDefault(); startReplay(); return; }
  }
  if (isEditableTarget(e.target) || hasOpenDialog()) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === '/') { e.preventDefault(); openSymbolSearch(); return; }
  if (e.key.length === 1 && /[a-z0-9]/i.test(e.key)) {
    e.preventDefault();
    openSymbolSearch({ initial: e.key.toUpperCase() });
  }
});

// ------------------------------------------------------------------------------------------------ sound unlock banner

function soundBanner() {
  if (alarm.unlocked) return;
  const banner = h('div.sound-banner', { role: 'status' },
    icon('volume', 18),
    h('span', h('b', 'Click anywhere to enable sound alerts.'), ' Browsers block audio until you interact with the page.'),
    notificationPermission() === 'default' ? h('button.btn.btn-sm', { type: 'button', onclick: (e) => { e.stopPropagation(); requestNotificationPermission().then(() => app.statusBar?.renderNotif()); unlock(); } }, 'Also enable desktop notifications') : null,
    h('button.btn.btn-primary.btn-sm', { type: 'button' }, 'Enable sound'));
  document.body.appendChild(banner);
  const unlock = () => {
    alarm.unlock().then((ok) => {
      if (ok) {
        banner.classList.add('closing');
        setTimeout(() => banner.remove(), 250);
        window.removeEventListener('pointerdown', unlock, true);
        window.removeEventListener('keydown', unlock, true);
      }
    });
  };
  window.addEventListener('pointerdown', unlock, true);
  window.addEventListener('keydown', unlock, true);
}
soundBanner();
alarm.on('state', (s) => {
  if (s.blocked) toast('An alert fired but sound is blocked — click anywhere to enable sound', 'warn', 8000);
});

// ------------------------------------------------------------------------------------------------ persisted chart state

function readLayoutId() {
  for (const k of ['layoutId', 'currentLayout', 'id', 'layout']) {
    const v = layout[k];
    if (typeof v === 'string' || typeof v === 'number') return String(v);
  }
  return null;
}

function snapshot() {
  const charts = hub.charts.map((c) => {
    const s = chartState(c);
    return { symbol: s.symbol, tf: s.tf, chartType: s.chartType };
  });
  const sync = {};
  for (const k of ['syncSymbol', 'syncInterval', 'syncCrosshair', 'syncTime']) if (typeof layout[k] === 'boolean') sync[k] = layout[k];
  return { layoutId: readLayoutId(), charts, activeIndex: Math.max(0, hub.charts.indexOf(hub.active)), sync };
}

let lastSnap = '';
function persistCharts() {
  if (!hub.charts.length) return;
  const s = JSON.stringify(snapshot());
  if (s === lastSnap) return;
  lastSnap = s;
  save('charts', JSON.parse(s));
}

function restoreCharts() {
  const saved = load('charts', null);
  if (!saved || !hub.charts.length) return;
  try {
    if (saved.layoutId && saved.layoutId !== readLayoutId() && typeof layout.setLayout === 'function') layout.setLayout(saved.layoutId);
    for (const k of Object.keys(saved.sync || {})) if (typeof layout[k] === 'boolean') layout[k] = saved.sync[k];
    hub.sync();
    (saved.charts || []).forEach((c, i) => {
      const chart = hub.charts[i];
      if (!chart || !c) return;
      const st = chartState(chart);
      if (c.symbol && c.symbol !== st.symbol) chart.setSymbol?.(c.symbol);
      if (c.tf && c.tf !== st.tf) chart.setTimeframe?.(c.tf);
      if (c.chartType && c.chartType !== st.chartType) chart.setChartType?.(c.chartType);
    });
    const act = hub.charts[saved.activeIndex];
    if (act && typeof layout.setActive === 'function') layout.setActive(act);
  } catch (err) {
    console.warn('[app] could not restore chart state', err);
  }
  lastSnap = JSON.stringify(snapshot());
}

restoreCharts();
for (const ev of ['symbol', 'tf', 'chartType', 'active', 'charts']) hub.on(ev, () => setTimeout(persistCharts, 0));
setInterval(persistCharts, 5000);
window.addEventListener('beforeunload', () => { persistCharts(); persistUi(); });

console.info('[tradeview] app shell ready');
