// TradeView app shell: top bar, drawing toolbar, chart layout, right sidebar (icon tabs), resizable bottom panel,
// status bar, keyboard shortcuts, persisted UI state, alert alarm handling, login gate, PWA.
//
// Mounted from Next.js (web/app/page.jsx, §14):  const cleanup = mountApp(rootEl)
// Importing this module has no DOM side effects; global CSS is imported by web/app/layout.jsx.
import { api, socket, auth } from './api/client.js';
import { Layout } from './layout/Layout.js';
import { Toolbar } from './layout/Toolbar.js';
import { DrawingToolbar } from './layout/DrawingToolbar.js';
import { alarm } from './audio/alarm.js';
import { requestNotificationPermission, notificationPermission, isFlashing, stopFlash } from './audio/notify.js';
import { checkSession, showLogin, logout } from './panels/Login.js';
import { registerServiceWorker } from './panels/util/push.js';
import { h, clear, icon, isEditableTarget } from './panels/util/dom.js';
import { closeTopDialog, closeMenu, hasOpenDialog, toast, popupMenu, openDialog } from './panels/util/dialog.js';
import { load, save } from './panels/util/store.js';
import { ChartHub, chartState } from './panels/util/chartHub.js';
import { formatPrice, splitKey, categoryLabel } from './panels/util/fmt.js';
import { SymbolSearch, symbolInfo, fetchSymbols } from './panels/SymbolSearch.js';
import { IndicatorsDialog } from './panels/IndicatorsDialog.js';
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
import { PineEditorPanel } from './panels/PineEditor.js';

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

const SKELETON = `
<div id="app" class="app">
  <header id="topbar" class="topbar">
    <a class="logo" href="/" title="TradeView" aria-label="TradeView">
      <svg width="28" height="28" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="14" fill="#2962ff"/><path d="M14 42l10-12 8 7 10-15 8 9" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <span class="logo-text">TradeView</span>
    </a>
    <button id="symbol-btn" class="symbol-btn" type="button" title="Symbol search (/ or start typing)"></button>
    <div id="toolbar-mount" class="toolbar-mount"></div>
    <div id="top-actions" class="top-actions"></div>
  </header>
  <div id="workspace" class="workspace">
    <aside id="drawbar-mount" class="drawbar" aria-label="Drawing tools"></aside>
    <main id="center" class="center">
      <div id="chart-root" class="chart-root"></div>
      <div id="bottom-resizer" class="bottom-resizer" title="Drag to resize · double-click to collapse"></div>
      <section id="bottom-panel" class="bottom-panel">
        <div id="bottom-tabs" class="bottom-tabs" role="tablist"></div>
        <div id="bottom-content" class="bottom-content"></div>
      </section>
    </main>
    <aside id="sidebar" class="sidebar" hidden>
      <div id="sidebar-resizer" class="sidebar-resizer" title="Drag to resize"></div>
      <div id="sidebar-content" class="sidebar-content"></div>
    </aside>
    <nav id="sidebar-tabs" class="sidebar-tabs" aria-label="Panels"></nav>
  </div>
  <footer id="statusbar" class="statusbar"></footer>
</div>`;

/**
 * Mount the whole application into rootEl.
 * @param {HTMLElement} rootEl
 * @returns {() => void} cleanup (unmounts everything; safe to call before boot has finished)
 */
export function mountApp(rootEl) {
  const disposers = [];
  const ctx = { disposed: false, cleanup: null };
  boot(rootEl, disposers, ctx).catch((err) => {
    console.error('[tradeview] boot failed', err);
    if (!ctx.disposed) {
      rootEl.replaceChildren(h('div.boot-error', icon('warn', 28), h('h2', 'TradeView failed to start'), h('pre', String(err && err.stack ? err.stack : err))));
    }
  });
  return () => {
    if (ctx.disposed) return;
    ctx.disposed = true;
    for (const d of disposers.splice(0).reverse()) {
      try { d(); } catch (err) { console.warn('[tradeview] cleanup step failed', err); }
    }
    rootEl.replaceChildren();
  };
}

async function boot(rootEl, disposers, ctx) {
  const listen = (target, type, fn, opts) => {
    if (!target) return;
    target.addEventListener(type, fn, opts);
    disposers.push(() => target.removeEventListener(type, fn, opts));
  };
  const every = (fn, ms) => { const t = setInterval(fn, ms); disposers.push(() => clearInterval(t)); };
  const track = (off) => { if (typeof off === 'function') disposers.push(off); return off; };

  // Panels get a socket facade whose handlers/subscriptions are released on unmount.
  const scopedSocket = {
    on: (type, fn) => track(socket.on(type, fn)),
    once: (type, fn) => track(socket.once(type, fn)),
    off: (type, fn) => socket.off(type, fn),
    send: (msg) => socket.send(msg),
    subscribe: (...a) => track(socket.subscribe(...a)),
    unsubscribe: (...a) => socket.unsubscribe(...a),
    reconnect: () => socket.reconnect(),
    get state() { return socket.state; },
    get attempt() { return socket.attempt; },
    get connected() { return socket.connected; },
    get bybit() { return socket.bybit; },
  };

  // ---------------------------------------------------------------- auth gate (§13.3)
  rootEl.replaceChildren(h('div.boot-splash', h('span.spinner.lg'), h('span', 'Loading TradeView…')));
  const session = await checkSession();
  if (ctx.disposed) return;
  if (!session.authenticated) {
    socket.pause();
    rootEl.replaceChildren();
    await showLogin();
    if (ctx.disposed) return;
    Object.assign(session, await checkSession());
  }
  socket.resume();
  disposers.push(() => socket.close());

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

  // ---------------------------------------------------------------- DOM skeleton
  rootEl.innerHTML = SKELETON;
  const $ = (id) => rootEl.querySelector(`#${id}`);
  const els = {
    app: $('app'),
    symbolBtn: $('symbol-btn'),
    toolbar: $('toolbar-mount'),
    topActions: $('top-actions'),
    drawbar: $('drawbar-mount'),
    chartRoot: $('chart-root'),
    center: $('center'),
    bottomTabs: $('bottom-tabs'),
    bottomContent: $('bottom-content'),
    bottomResizer: $('bottom-resizer'),
    sidebar: $('sidebar'),
    sidebarContent: $('sidebar-content'),
    sidebarResizer: $('sidebar-resizer'),
    sidebarTabs: $('sidebar-tabs'),
    status: $('statusbar'),
  };
  disposers.push(() => {
    for (const id of ['overlay-root', 'toast-root']) document.getElementById(id)?.remove();
    document.querySelector('.sound-banner')?.remove();
    closeMenu();
    stopFlash();
    alarm.stop();
  });

  // ---------------------------------------------------------------- chart layout (chart team, §12)
  let layout;
  try {
    // The shell hosts the top toolbar and the drawing toolbar itself (top bar / left column).
    layout = new Layout(els.chartRoot, { api, socket, toolbar: false, drawingToolbar: false });
    disposers.push(() => layout.destroy?.());
  } catch (err) {
    console.error('[app] Layout failed to initialise', err);
    els.chartRoot.appendChild(h('div.chart-error', icon('warn', 28), h('div', 'The chart could not be initialised.'), h('pre', String(err && err.message ? err.message : err))));
    layout = nullLayout();
  }
  for (const [Ctor, el, name] of [[Toolbar, els.toolbar, 'toolbar'], [DrawingToolbar, els.drawbar, 'drawingToolbar']]) {
    try {
      const t = new Ctor(el, layout);
      disposers.push(() => t.destroy?.());
    } catch (err) {
      console.error(`[app] ${name} failed to initialise`, err);
    }
  }

  const hub = new ChartHub(layout);
  disposers.push(() => hub.destroy());
  const symbolSearch = new SymbolSearch({ api });
  const indicatorsDialog = new IndicatorsDialog({ api });

  const app = {
    api,
    socket: scopedSocket,
    layout,
    hub,
    alarm,
    session,
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
  disposers.push(() => { if (window.tradeview === app) delete window.tradeview; });

  function openSymbolSearch(opts = {}) {
    const target = opts.chart || layout.active;
    return symbolSearch.open({
      onSelect: (key) => {
        if (target && typeof target.setSymbol === 'function') target.setSymbol(key);
        else Promise.resolve(layout.executeCommand({ action: 'set_symbol', symbol: key })).catch((err) => toast(err.message, 'error'));
      },
      ...opts,
    });
  }

  // Layout events: toolbar / chart legend buttons.
  if (typeof layout.on === 'function') {
    track(layout.on('symbol-search', (p) => openSymbolSearch({ chart: p && p.chart })));
    track(layout.on('open-indicators', (p) => indicatorsDialog.open((p && p.chart) || layout.active)));
    track(layout.on('screenshot', (p) => {
      const canvas = p && p.canvas;
      if (!canvas || typeof canvas.toDataURL !== 'function') return;
      const st = chartState(p.chart);
      const a = h('a', { href: canvas.toDataURL('image/png'), download: `${splitKey(st.symbol).symbol || 'chart'}-${st.tf || ''}-${Date.now()}.png` });
      a.click();
    }));
  }

  // ---------------------------------------------------------------- top bar
  function renderSymbolButton() {
    const st = chartState(hub.active);
    const { symbol, category } = splitKey(st.symbol || '');
    clear(els.symbolBtn).append(icon('search', 16), h('span.sym', symbol || 'Symbol'),
      st.symbol ? h(`span.cat-tag.${category}`, categoryLabel(category)) : null);
  }
  listen(els.symbolBtn, 'click', () => openSymbolSearch());
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
    h('button.top-btn.user-btn', { type: 'button', title: 'Account', 'aria-label': 'Account menu', onclick: (e) => userMenu(e.currentTarget) }, icon('user', 18)),
  );

  let installPrompt = null;
  listen(window, 'beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; });

  function userMenu(anchor) {
    const items = [{ header: session.authEnabled ? `Signed in${session.user ? ' as ' + session.user : ''}` : 'Authentication disabled' }];
    if (installPrompt) {
      items.push({ label: 'Install TradeView app', icon: 'download', onClick: async () => { installPrompt.prompt(); await installPrompt.userChoice.catch(() => {}); installPrompt = null; } });
    }
    items.push(
      { label: 'Push alerts on this device…', icon: 'bell', onClick: () => showSidebar('alerts', true) },
      { label: 'Test alarm sound', icon: 'volume', onClick: async () => { await alarm.unlock(); alarm.play({ preset: 'siren', volume: 0.8, repeat: 1 }); } },
      { label: 'Keyboard shortcuts', icon: 'gear', onClick: showShortcuts },
    );
    if (session.authEnabled) items.push({ separator: true }, { label: 'Log out', icon: 'logout', danger: true, onClick: doLogout });
    popupMenu(anchor, items, { align: 'right' });
  }

  async function doLogout() {
    await logout();
    session.authenticated = false;
    socket.pause();
    alarm.stop();
    await showLogin({ reason: 'You have been signed out.' });
    afterLogin();
  }

  /** After a (re-)login: reconnect the socket and reload everything that came from the server. */
  function afterLogin() {
    if (ctx.disposed) return;
    session.authenticated = true;
    socket.resume();
    const p = app.panels;
    p.alerts?.load();
    p.alertlog?.load();
    p.watchlist?.refreshAll();
    p.tester?.loadStrategies();
    p.chat?.loadStatus();
    app.statusBar?.pollHealth();
    app.statusBar?.pollLaya();
    for (const c of hub.charts) c.reload?.();
  }

  track(auth.on('unauthorized', () => {
    if (!session.authenticated) return;
    session.authenticated = false;
    socket.pause();
    showLogin({ reason: 'Your session has expired. Please sign in again.' }).then(afterLogin);
  }));

  // ---------------------------------------------------------------- sidebar
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
  const applySidebarWidth = () => els.app.style.setProperty('--sidebar-w', `${ui.sidebarWidth}px`);

  // ---------------------------------------------------------------- bottom panel
  const bottomPanes = new Map();
  const bottomButtons = new Map();
  for (const t of BOTTOM_TABS) {
    const pane = h(`div.bottom-pane.pane-${t.id}`, { hidden: true });
    els.bottomContent.appendChild(pane);
    bottomPanes.set(t.id, pane);
    const btn = h('button.bottom-tab', { type: 'button', role: 'tab', dataset: { tab: t.id } }, icon(t.icon, 15), h('span', t.title));
    btn.addEventListener('click', () => toggleBottom(t.id));
    els.bottomTabs.appendChild(btn);
    bottomButtons.set(t.id, btn);
  }
  const maxBtn = h('button.icon-btn', { type: 'button', title: 'Maximize panel' }, icon('maximize', 16));
  const collapseBtn = h('button.icon-btn', { type: 'button', title: 'Collapse panel' }, icon('chevDown', 16));
  maxBtn.addEventListener('click', () => { ui.bottomMax = !ui.bottomMax; ui.bottomOpen = true; applyBottom(); });
  collapseBtn.addEventListener('click', () => { ui.bottomOpen = !ui.bottomOpen; applyBottom(); });
  els.bottomTabs.append(h('span.spacer'), h('div.bottom-actions', maxBtn, collapseBtn));

  function applyBottom() {
    els.app.classList.toggle('bottom-open', ui.bottomOpen);
    els.app.classList.toggle('bottom-max', ui.bottomOpen && ui.bottomMax);
    els.app.style.setProperty('--bottom-h', `${ui.bottomHeight}px`);
    for (const [k, pane] of bottomPanes) pane.hidden = !(ui.bottomOpen && k === ui.bottomTab);
    for (const [k, b] of bottomButtons) {
      b.classList.toggle('active', ui.bottomOpen && k === ui.bottomTab);
      b.setAttribute('aria-selected', ui.bottomOpen && k === ui.bottomTab ? 'true' : 'false');
    }
    clear(maxBtn).appendChild(icon(ui.bottomMax && ui.bottomOpen ? 'minimize' : 'maximize', 16));
    maxBtn.title = ui.bottomMax ? 'Restore panel' : 'Maximize panel';
    clear(collapseBtn).appendChild(icon(ui.bottomOpen ? 'chevDown' : 'chevUp', 16));
    collapseBtn.title = ui.bottomOpen ? 'Collapse panel' : 'Expand panel';
    if (ui.bottomOpen) {
      app.panels[ui.bottomTab]?.onShow?.();
      if (ui.bottomTab === 'pine') app.pine?.activate();
    }
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

  // Resizing: bottom panel (drag its top edge), sidebar (drag its left edge).
  function dragResize(handle, onMove, onEnd) {
    listen(handle, 'pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      document.body.classList.add('resizing');
      handle.classList.add('dragging');
      const up = () => {
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
        document.body.classList.remove('resizing');
        handle.classList.remove('dragging');
        onEnd && onEnd();
      };
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    });
  }
  dragResize(els.bottomResizer, (e) => {
    const r = els.center.getBoundingClientRect();
    ui.bottomOpen = true;
    ui.bottomMax = false;
    ui.bottomHeight = Math.max(140, Math.min(r.height - 100, Math.round(r.bottom - e.clientY)));
    els.app.style.setProperty('--bottom-h', `${ui.bottomHeight}px`);
    els.app.classList.add('bottom-open');
    els.app.classList.remove('bottom-max');
  }, () => applyBottom());
  listen(els.bottomResizer, 'dblclick', () => { ui.bottomOpen = !ui.bottomOpen; applyBottom(); });
  dragResize(els.sidebarResizer, (e) => {
    const tabsW = els.sidebarTabs.getBoundingClientRect().width;
    ui.sidebarWidth = Math.max(240, Math.min(Math.round(window.innerWidth * 0.6), Math.round(window.innerWidth - tabsW - e.clientX)));
    applySidebarWidth();
  }, () => persistUi());

  // ---------------------------------------------------------------- panels
  const deps = { layout, api, socket: scopedSocket, app };
  function mount(name, Ctor, el) {
    try {
      const p = new Ctor(el, deps);
      app.panels[name] = p;
      disposers.push(() => p.destroy?.());
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
  app.pine = mount('pine', PineEditorPanel, bottomPanes.get('pine'));
  app.tester = mount('tester', StrategyTesterPanel, bottomPanes.get('tester'));
  app.replay = mount('replay', ReplayTradingPanel, bottomPanes.get('replay'));
  mount('alertlog', AlertLogPanel, bottomPanes.get('alertlog'));
  app.alertCenter = new AlertCenter(deps);
  app.statusBar = new StatusBar(els.status, deps);
  disposers.push(() => app.statusBar.destroy?.());

  applySidebarWidth();
  const narrow = window.matchMedia(NARROW);
  showSidebar(narrow.matches ? null : ui.sidebarTab, true);
  applyBottom();
  listen(narrow, 'change', (e) => { if (e.matches && ui.sidebarTab) showSidebar(null, true); });

  // Warm the symbol metadata cache (tick sizes for price formatting).
  fetchSymbols(api, '', '').catch(() => {});

  // ---------------------------------------------------------------- replay
  function startReplay() {
    showBottom('replay');
    const chart = layout.active;
    if (!chart) { toast('No active chart', 'warn'); return; }
    if (chart.replay && (chart.replay.active || chart.replay.selecting)) return;
    app.replay?.start();
  }

  // ---------------------------------------------------------------- keyboard
  function showShortcuts() {
    const rows = [
      ['Alt + A', 'Create alert at the crosshair price'],
      ['Alt + R', 'Start bar replay'],
      ['/ or any letter', 'Symbol search'],
      ['Esc', 'Close dialogs / stop alarm / cancel drawing tool'],
      ['Ctrl + Enter', 'Pine Editor: add script to chart'],
      ['Ctrl + S', 'Pine Editor: save script'],
      ['Enter / Shift + Enter', 'Agent: send / new line'],
    ];
    openDialog({
      title: 'Keyboard shortcuts',
      className: 'dialog-sm',
      content: h('div.shortcuts', rows.map(([k, v]) => h('div.shortcut-row', h('kbd', k), h('span', v)))),
    });
  }

  listen(document, 'keydown', (e) => {
    if (e.defaultPrevented || document.querySelector('.login-screen')) return;
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

  // ---------------------------------------------------------------- sound unlock banner
  if (!alarm.unlocked) {
    const unlock = () => {
      alarm.unlock().then((ok) => {
        if (!ok) return;
        banner.classList.add('closing');
        setTimeout(() => banner.remove(), 250);
        window.removeEventListener('pointerdown', unlock, true);
        window.removeEventListener('keydown', unlock, true);
      });
    };
    const banner = h('div.sound-banner', { role: 'status' },
      icon('volume', 18),
      h('span', h('b', 'Click anywhere to enable sound alerts.'), ' Browsers block audio until you interact with the page.'),
      notificationPermission() === 'default'
        ? h('button.btn.btn-sm', { type: 'button', onclick: (e) => { e.stopPropagation(); requestNotificationPermission().then(() => app.statusBar?.renderNotif()); unlock(); } }, 'Also enable desktop notifications')
        : null,
      h('button.btn.btn-primary.btn-sm', { type: 'button' }, 'Enable sound'));
    document.body.appendChild(banner);
    listen(window, 'pointerdown', unlock, true);
    listen(window, 'keydown', unlock, true);
  }
  track(alarm.on('state', (s) => {
    if (s.blocked) toast('An alert fired but sound is blocked — click anywhere to enable sound', 'warn', 8000);
  }));

  // Chart layout/symbols/timeframes/indicators are persisted by Layout itself (localStorage 'tv.layout.v1');
  // panel state (sidebar tab, bottom panel) is persisted here.
  listen(window, 'beforeunload', () => persistUi());

  // ---------------------------------------------------------------- PWA / deep links
  registerServiceWorker();
  function handleDeepLink(params) {
    const sym = params.get('symbol');
    const panel = params.get('panel');
    if (sym && layout.active) layout.active.setSymbol?.(sym);
    if (panel && SIDEBAR_TABS.some((t) => t.id === panel)) showSidebar(panel, true);
    else if (panel && BOTTOM_TABS.some((t) => t.id === panel)) showBottom(panel);
  }
  const qs = new URLSearchParams(location.search);
  if (qs.has('symbol') || qs.has('panel')) {
    handleDeepLink(qs);
    history.replaceState(null, '', location.pathname);
  }
  listen(navigator.serviceWorker, 'message', (e) => {
    const m = e.data || {};
    if (m.type !== 'push-click') return;
    const d = m.data || {};
    if (d.event) app.alertCenter?.onAlert(d.event);
    try { handleDeepLink(new URL(d.url || '/', location.origin).searchParams); } catch { /* ignore */ }
  });

  console.info('[tradeview] app shell ready');
}

/** Minimal stand-in so panels keep working if the chart layout fails to initialise. */
function nullLayout() {
  return {
    charts: [],
    active: null,
    on() { return () => {}; },
    emit() {},
    setLayout() {},
    getContext() { return { charts: [], activeChartId: null }; },
    executeCommand(cmd) { return Promise.reject(new Error(`Chart unavailable (${cmd && cmd.action})`)); },
  };
}

export default mountApp;
