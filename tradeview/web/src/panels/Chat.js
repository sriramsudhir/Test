// Claude agent panel (§7): streaming chat via SSE, executes chart_commands on the Layout,
// tool-call chips, persisted sessions, suggested prompts, stop button.
import { h, clear, icon, iconButton, uid, throttleRaf } from './util/dom.js';
import { renderMarkdown } from './util/markdown.js';
import { toast, popupMenu, confirmDialog } from './util/dialog.js';
import { load, save, remove } from './util/store.js';
import { formatTimeAgo, splitKey } from './util/fmt.js';

const SUGGESTIONS = [
  'Draw support and resistance on BTC 4h',
  'Set an alert when ETH crosses 4000 and let Laya confirm',
  'Add RSI and MACD',
  'Backtest EMA cross on 1h for the last 6 months',
  'Switch to a 4-chart layout with BTC, ETH, SOL and gold',
  'Show the footprint chart for BTC 5m',
];

const TOOL_LABELS = {
  get_candles: (i) => `Reading ${short(i.symbol)} ${i.tf || ''} candles`,
  get_symbols: () => 'Searching symbols',
  run_pine: () => 'Running Pine script',
  run_backtest: (i) => `Running backtest${i.symbol ? ' on ' + short(i.symbol) : ''}`,
  laya_decide: () => 'Asking Laya',
  list_alerts: () => 'Listing alerts',
  set_symbol: (i) => `Switching to ${short(i.symbol)}`,
  set_timeframe: (i) => `Timeframe ${i.tf || i.timeframe || ''}`,
  set_layout: (i) => `Layout ${i.layout || i.id || ''}`,
  add_indicator: (i) => `Adding ${i.builtin || i.name || i.id || 'indicator'}`,
  remove_indicator: () => 'Removing indicator',
  draw: (i) => `Drawing ${(i.type || i.shape || 'shape').replace(/_/g, ' ')}`,
  clear_drawings: () => 'Clearing drawings',
  set_chart_type: (i) => `Chart type ${i.type || i.chartType || ''}`,
  start_replay: () => 'Starting bar replay',
  create_alert: (i) => `Creating alert${i.symbol ? ' on ' + short(i.symbol) : ''}`,
  delete_alert: () => 'Deleting alert',
};
const CMD_DONE = {
  draw: (c) => `Drew ${(c.type || c.shape || 'shape').replace(/_/g, ' ')}`,
  add_indicator: (c) => `Added ${c.builtin || c.name || 'indicator'}`,
  set_symbol: (c) => `Symbol ${short(c.symbol)}`,
  set_timeframe: (c) => `Timeframe ${c.tf || c.timeframe}`,
  set_layout: (c) => `Layout ${c.layout || c.id}`,
  set_chart_type: (c) => `Chart type ${c.type || c.chartType}`,
  clear_drawings: () => 'Cleared drawings',
  remove_indicator: () => 'Removed indicator',
  start_replay: () => 'Replay started',
};

function short(sym) { return sym ? splitKey(sym).symbol : ''; }

/** Stable signature for de-duplicating chart commands received from both the stream and the socket. */
function commandSignature(cmd) {
  if (cmd && (cmd.commandId || cmd.cmdId || cmd.uid)) return `id:${cmd.commandId || cmd.cmdId || cmd.uid}`;
  const sortKeys = (v) => {
    if (Array.isArray(v)) return v.map(sortKeys);
    if (v && typeof v === 'object') return Object.keys(v).sort().reduce((o, k) => { o[k] = sortKeys(v[k]); return o; }, {});
    return v;
  };
  return JSON.stringify(sortKeys(cmd));
}

export class ChatPanel {
  constructor(el, { layout, api, socket, app }) {
    this.el = el;
    this.layout = layout;
    this.api = api;
    this.app = app;
    this.sessions = load('chat.sessions', []); // [{ id, title, updated }]
    this.session = load('chat.session', null);
    if (!this.session || !this.sessions.some((s) => s.id === this.session)) this.newSession(false);
    this.messages = load(`chat.msgs.${this.session}`, []);
    this.controller = null;
    this.handled = new Map(); // signature -> time
    this.streaming = false;

    el.classList.add('panel', 'chat-panel');
    this.titleEl = h('div.panel-title', 'Agent');
    this.list = h('div.chat-list');
    this.input = h('textarea.chat-input', { rows: 1, placeholder: 'Ask the agent… (Enter to send, Shift+Enter for newline)' });
    this.sendBtn = h('button.chat-send', { type: 'button', title: 'Send' }, icon('send', 18));
    this.ctxChip = h('div.chat-context');
    el.append(
      h('div.panel-header', h('div.chat-head-title', icon('sparkles', 16), this.titleEl),
        h('div.panel-actions',
          iconButton('history', 'Conversations', (e) => this.sessionMenu(e.currentTarget)),
          iconButton('plus', 'New chat', () => this.newSession(true)))),
      this.list,
      h('div.chat-compose', this.ctxChip, h('div.chat-input-row', this.input, this.sendBtn)));

    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); this.send(); }
    });
    this.input.addEventListener('input', () => this.autosize());
    this.sendBtn.addEventListener('click', () => (this.streaming ? this.stop() : this.send()));

    socket.on('chart_command', (m) => {
      if (m.command) this.executeCommand(m.command, { source: 'socket' });
    });
    app.hub.on('active', () => this.renderContext());
    app.hub.on('symbol', () => this.renderContext());
    app.hub.on('tf', () => this.renderContext());
    this.renderAll();
    this.renderContext();
  }

  // ------------------------------------------------------------------ sessions

  newSession(render = true) {
    if (this.streaming) this.stop();
    const id = uid('s_');
    this.session = id;
    this.sessions.unshift({ id, title: 'New chat', updated: Date.now() });
    this.sessions = this.sessions.slice(0, 30);
    this.messages = [];
    save('chat.session', id);
    save('chat.sessions', this.sessions);
    if (render) { this.renderAll(); this.input.focus(); }
  }

  switchSession(id) {
    if (this.streaming) this.stop();
    this.session = id;
    save('chat.session', id);
    this.messages = load(`chat.msgs.${id}`, []);
    this.renderAll();
  }

  persist() {
    const msgs = this.messages.slice(-100).map(({ _el, _body, ...m }) => ({ ...m, streaming: false }));
    if (!save(`chat.msgs.${this.session}`, msgs)) {
      // Storage full: drop the oldest half and retry.
      save(`chat.msgs.${this.session}`, msgs.slice(-50));
    }
    const s = this.sessions.find((x) => x.id === this.session);
    if (s) {
      s.updated = Date.now();
      const first = this.messages.find((m) => m.role === 'user');
      if (first) s.title = first.text.slice(0, 60);
    }
    save('chat.sessions', this.sessions);
  }

  sessionMenu(anchor) {
    const items = [{ header: 'Conversations' }];
    for (const s of this.sessions.slice(0, 15)) {
      items.push({ label: (s.id === this.session ? '• ' : '') + (s.title || 'Chat'), hint: formatTimeAgo(s.updated), onClick: () => this.switchSession(s.id) });
    }
    items.push({ separator: true });
    items.push({ label: 'New chat', icon: 'plus', onClick: () => this.newSession(true) });
    items.push({ label: 'Delete this chat', icon: 'trash', danger: true, onClick: async () => {
      if (!(await confirmDialog('Delete this conversation?', { danger: true, okLabel: 'Delete' }))) return;
      remove(`chat.msgs.${this.session}`);
      this.sessions = this.sessions.filter((x) => x.id !== this.session);
      save('chat.sessions', this.sessions);
      if (this.sessions.length) this.switchSession(this.sessions[0].id); else this.newSession(true);
    } });
    popupMenu(anchor, items, { align: 'right' });
  }

  // ------------------------------------------------------------------ rendering

  autosize() {
    this.input.style.height = 'auto';
    this.input.style.height = `${Math.min(160, this.input.scrollHeight)}px`;
  }

  renderContext() {
    clear(this.ctxChip);
    let ctx = null;
    try { ctx = this.layout.getContext?.(); } catch { /* ignore */ }
    const charts = (ctx && ctx.charts) || [];
    const active = charts.find((c) => c.id === ctx.activeChartId) || charts[0];
    if (!active) return;
    this.ctxChip.append(icon('target', 12), h('span', `Context: ${short(active.symbol)} ${active.tf || ''}${charts.length > 1 ? ` · ${charts.length} charts` : ''}`));
  }

  renderAll() {
    const s = this.sessions.find((x) => x.id === this.session);
    this.titleEl.textContent = s && s.title && s.title !== 'New chat' ? s.title : 'Agent';
    this.titleEl.title = this.titleEl.textContent;
    clear(this.list);
    if (!this.messages.length) {
      this.list.appendChild(h('div.chat-welcome',
        h('div.chat-welcome-icon', icon('sparkles', 28)),
        h('div.chat-welcome-title', 'TradeView agent'),
        h('div.chat-welcome-sub', 'I can read the market, draw on your charts, add indicators, run Pine backtests and set Laya-gated alerts.'),
        h('div.suggestions', SUGGESTIONS.map((p) => h('button.suggestion', { type: 'button', onclick: () => this.send(p) }, p)))));
      return;
    }
    for (const m of this.messages) this.list.appendChild(this.renderMessage(m));
    this.scrollToEnd(true);
  }

  renderMessage(m) {
    if (m.role === 'user') {
      const el = h('div.msg.msg-user', h('div.msg-bubble', m.text));
      m._el = el;
      return el;
    }
    const body = h('div.msg-body');
    const el = h('div.msg.msg-assistant', h('div.msg-avatar', icon('sparkles', 14)), body);
    m._el = el;
    m._body = body;
    this.renderParts(m);
    return el;
  }

  renderParts(m) {
    const body = m._body;
    if (!body) return;
    clear(body);
    for (const p of m.parts) {
      if (p.kind === 'text') {
        body.appendChild(h('div.md', { html: renderMarkdown(p.text) }));
      } else if (p.kind === 'chip') {
        body.appendChild(h(`div.tool-chip.${p.state || 'done'}`,
          p.state === 'running' ? h('span.spinner') : icon(p.state === 'error' ? 'warn' : 'check', 13),
          h('span', p.label + (p.state === 'running' ? '…' : ''))));
      } else if (p.kind === 'error') {
        body.appendChild(h('div.msg-error', icon('warn', 14), h('span', p.text)));
      }
    }
    if (m.streaming && !m.parts.length) body.appendChild(h('div.typing', h('span'), h('span'), h('span')));
    if (m.streaming && m.parts.length && m.parts[m.parts.length - 1].kind === 'text') {
      const last = body.lastElementChild;
      if (last) last.classList.add('caret');
    }
  }

  scrollToEnd(force = false) {
    const nearBottom = this.list.scrollHeight - this.list.scrollTop - this.list.clientHeight < 120;
    if (force || nearBottom) this.list.scrollTop = this.list.scrollHeight;
  }

  // ------------------------------------------------------------------ sending / streaming

  async send(text) {
    const message = (text ?? this.input.value).trim();
    if (!message || this.streaming) return;
    if (text == null) { this.input.value = ''; this.autosize(); }
    if (!this.messages.length) clear(this.list);

    const user = { role: 'user', text: message, t: Date.now() };
    const asst = { role: 'assistant', parts: [], t: Date.now(), streaming: true };
    this.messages.push(user, asst);
    this.persist();
    this.renderAll();

    let context = null;
    try { context = this.layout.getContext?.() || null; } catch (err) { console.warn('getContext failed', err); }

    this.streaming = true;
    this.setSendState();
    this.controller = new AbortController();
    const rerender = throttleRaf(() => { this.renderParts(asst); this.scrollToEnd(); });

    const finishChips = () => { for (const p of asst.parts) if (p.kind === 'chip' && p.state === 'running') p.state = 'done'; };
    const onEvent = (evt) => {
      switch (evt.type) {
        case 'text': {
          const delta = evt.delta ?? evt.text ?? '';
          const last = asst.parts[asst.parts.length - 1];
          finishChips();
          if (last && last.kind === 'text') last.text += delta;
          else asst.parts.push({ kind: 'text', text: delta });
          break;
        }
        case 'tool': {
          finishChips();
          const input = evt.input || {};
          const fn = TOOL_LABELS[evt.name];
          asst.parts.push({ kind: 'chip', state: 'running', tool: evt.name, label: fn ? fn(input) : `Using ${evt.name}` });
          break;
        }
        case 'tool_result': {
          const chip = [...asst.parts].reverse().find((p) => p.kind === 'chip' && p.state === 'running');
          if (chip) chip.state = evt.error ? 'error' : 'done';
          break;
        }
        case 'chart_command': {
          const cmd = evt.command || evt;
          const ok = this.executeCommand(cmd, { source: 'stream' });
          const chip = [...asst.parts].reverse().find((p) => p.kind === 'chip' && p.tool === cmd.action && p.state === 'running');
          const label = (CMD_DONE[cmd.action] || (() => `Chart: ${cmd.action}`))(cmd);
          if (chip) { chip.state = ok ? 'done' : 'error'; chip.label = label; }
          else asst.parts.push({ kind: 'chip', state: ok ? 'done' : 'error', label });
          break;
        }
        case 'alert_created': {
          const a = evt.alert || {};
          this.app.alerts?.upsert(a);
          const chip = [...asst.parts].reverse().find((p) => p.kind === 'chip' && p.tool === 'create_alert');
          const label = `Alert created ✓ ${short(a.symbol)}${a.laya && a.laya.enabled ? ' · Laya gate' : ''}`;
          if (chip) { chip.state = 'done'; chip.label = label; } else asst.parts.push({ kind: 'chip', state: 'done', label });
          break;
        }
        case 'backtest_result':
        case 'backtest': {
          if (evt.result) this.app.showBacktestResult?.(evt.result, evt.request);
          break;
        }
        case 'error':
          finishChips();
          asst.parts.push({ kind: 'error', text: evt.message || 'The agent reported an error' });
          break;
        case 'done':
          finishChips();
          break;
        default:
          break;
      }
      rerender();
    };

    try {
      await this.api.stream('/api/chat', { session: this.session, message, context }, onEvent, { signal: this.controller.signal });
    } catch (err) {
      if (err && err.name === 'AbortError') {
        asst.parts.push({ kind: 'error', text: 'Stopped.' });
      } else {
        asst.parts.push({ kind: 'error', text: `Request failed: ${err.message}` });
      }
    } finally {
      finishChips();
      asst.streaming = false;
      this.streaming = false;
      this.controller = null;
      this.setSendState();
      this.renderParts(asst);
      this.scrollToEnd();
      this.persist();
    }
  }

  stop() {
    if (this.controller) this.controller.abort();
  }

  setSendState() {
    clear(this.sendBtn).appendChild(icon(this.streaming ? 'stop' : 'send', 18));
    this.sendBtn.title = this.streaming ? 'Stop generating' : 'Send';
    this.sendBtn.classList.toggle('stop', this.streaming);
  }

  // ------------------------------------------------------------------ chart commands

  /** Execute a ChartCommand once (commands arrive both via the SSE stream and the socket). */
  executeCommand(cmd, { source } = {}) {
    if (!cmd || !cmd.action) return false;
    const now = Date.now();
    for (const [k, t] of this.handled) if (now - t > 60000) this.handled.delete(k);
    const sig = commandSignature(cmd);
    if (this.handled.has(sig)) return true;
    this.handled.set(sig, now);
    try {
      const r = this.layout.executeCommand(cmd);
      if (r && typeof r.then === 'function') {
        r.catch((err) => toast(`Chart command "${cmd.action}" failed: ${err.message}`, 'error'));
      }
      if (cmd.action === 'start_replay') this.app.showBottom?.('replay');
      if (cmd.action === 'set_layout') setTimeout(() => this.app.hub.sync(), 50);
      if (source === 'socket') toast(`Agent: ${(CMD_DONE[cmd.action] || (() => cmd.action))(cmd)}`, 'info', 2000);
      return true;
    } catch (err) {
      console.error('[chat] chart command failed', cmd, err);
      toast(`Chart command "${cmd.action}" failed: ${err.message}`, 'error');
      return false;
    }
  }
}
