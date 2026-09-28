// Alerts panel: list/create/edit/delete alerts (§6), alert lines on charts, drag-to-move alert lines.
import { h, clear, icon, iconButton } from './util/dom.js';
import { openDialog, toast, confirmDialog, popupMenu } from './util/dialog.js';
import { formatPrice, formatDateTime, formatTimeAgo, splitKey, categoryLabel, TIMEFRAMES, toDateTimeInput } from './util/fmt.js';
import { chartState, chartDrawings } from './util/chartHub.js';
import { alarm, ALARM_PRESETS } from '../audio/alarm.js';
import { symbolInfo } from './SymbolSearch.js';
import { load, save } from './util/store.js';

export const PRICE_OPS = [
  { id: 'crosses', label: 'Crossing' },
  { id: 'crosses_up', label: 'Crossing Up' },
  { id: 'crosses_down', label: 'Crossing Down' },
  { id: 'above', label: 'Greater Than' },
  { id: 'below', label: 'Less Than' },
  { id: 'enters_channel', label: 'Entering Channel' },
  { id: 'exits_channel', label: 'Exiting Channel' },
];
const DRAWING_OPS = PRICE_OPS.filter((o) => !o.id.includes('channel'));
const TRIGGERS = [
  { id: 'once', label: 'Only once' },
  { id: 'once_per_bar', label: 'Once per bar' },
  { id: 'once_per_bar_close', label: 'Once per bar close' },
  { id: 'every_time', label: 'Every time' },
];
const DEFAULT_LAYA_Q = 'Is this move likely to continue rather than fail?';
const DEFAULT_INDICATOR_SRC = `//@version=6
indicator("Alert signal")
fast = ta.ema(close, 9)
slow = ta.ema(close, 21)
// The alert fires when the plot named "signal" is > 0 on a closed bar
plot(ta.crossover(fast, slow) ? 1 : 0, "signal")
`;

const opLabel = (op) => (PRICE_OPS.find((o) => o.id === op) || { label: op }).label;

export function describeCondition(a) {
  const c = a.condition || {};
  const tick = symbolInfo.get(a.symbol)?.tickSize;
  if (c.kind === 'price') {
    if (c.op === 'enters_channel' || c.op === 'exits_channel') return `${opLabel(c.op)} ${formatPrice(c.value, tick)} – ${formatPrice(c.value2, tick)}`;
    return `${opLabel(c.op)} ${formatPrice(c.value, tick)}`;
  }
  if (c.kind === 'indicator') {
    const title = /(?:indicator|strategy)\s*\(\s*["']([^"']+)/.exec(c.source || '')?.[1];
    return `Indicator: ${title || 'Pine signal'} (${a.tf || ''})`;
  }
  if (c.kind === 'drawing') return `${opLabel(c.op)} drawing ${String(c.drawingId || '').slice(0, 8)}`;
  return 'Custom condition';
}

export class AlertsPanel {
  constructor(el, { layout, api, socket, app }) {
    this.el = el;
    this.layout = layout;
    this.api = api;
    this.socket = socket;
    this.app = app;
    this.alerts = new Map();
    this.filter = load('alerts.filter', 'active');
    this.lines = new Map(); // chart -> Map(alertId -> signature)
    this.patchTimers = new Map();
    this.loaded = false;

    el.classList.add('panel', 'alerts-panel');
    this.tabs = h('div.tabs.tabs-sm');
    this.list = h('div.panel-body.alert-list');
    el.append(
      h('div.panel-header',
        h('div.panel-title', 'Alerts'),
        h('div.panel-actions',
          iconButton('refresh', 'Reload alerts', () => this.load()),
          h('button.btn.btn-primary.btn-sm', { type: 'button', title: 'Create alert (Alt+A)', onclick: () => this.createAtCrosshair() }, icon('plus', 14), 'Create'))),
      this.tabs,
      this.list);

    socket.on('alert_update', (m) => { if (m.alert) this.upsert(m.alert); });
    socket.on('alert', (m) => {
      const ev = m.event || {};
      const a = this.alerts.get(ev.alertId);
      if (a) {
        a.lastFired = ev.t || Date.now();
        a.fireCount = (a.fireCount || 0) + 1;
        if (a.trigger === 'once') a.status = 'triggered';
        this.render();
        this.syncLines();
      }
    });
    socket.on('connection', ({ state }) => { if (state === 'open' && this.loaded) this.load(); });

    // Chart integration: price-click creates an alert, alert lines follow the chart symbol.
    app.hub.onChart((chart) => {
      let off;
      if (typeof chart.onPriceClick === 'function') {
        off = chart.onPriceClick((a, b) => {
          const price = typeof a === 'object' && a ? (a.price ?? a.value) : a;
          const time = typeof a === 'object' && a ? a.time ?? a.t : b;
          if (price == null || !isFinite(price)) return;
          const st = chartState(chart);
          this.openEditor(null, { symbol: st.symbol, tf: st.tf, price: Number(price), time });
        });
      }
      return () => { if (typeof off === 'function') off(); this.lines.delete(chart); };
    });
    // ChartView emits 'alertmove' { id, alert, key: 'value'|'value2', price, patch } when a line is dropped.
    app.hub.on('alertmove', ({ data }) => {
      if (!data) return;
      const id = data.id ?? data.alertId;
      const price = data.price ?? data.value;
      if (id != null && price != null) this.onLineMoved(id, Number(price), data.key);
    });
    app.hub.on('symbol', () => this.syncLines());
    app.hub.on('charts', () => this.syncLines());

    this.renderTabs();
    this.load();
  }

  // ------------------------------------------------------------------ data

  async load() {
    try {
      const res = await this.api.get('/api/alerts');
      const list = Array.isArray(res) ? res : (res && (res.alerts || res.items)) || [];
      this.alerts = new Map(list.map((a) => [a.id, a]));
      this.loaded = true;
      this.render();
      this.syncLines();
    } catch (err) {
      clear(this.list).appendChild(h('div.empty.error', `Could not load alerts: ${err.message}`));
    }
  }

  get(id) { return this.alerts.get(id); }

  upsert(alert) {
    if (!alert || !alert.id) return;
    this.alerts.set(alert.id, { ...(this.alerts.get(alert.id) || {}), ...alert });
    this.render();
    this.syncLines();
  }

  removeLocal(id) {
    this.alerts.delete(id);
    this.render();
    this.syncLines();
  }

  // ------------------------------------------------------------------ list UI

  renderTabs() {
    clear(this.tabs);
    const counts = this.counts();
    for (const [id, label] of [['active', 'Active'], ['triggered', 'Triggered'], ['all', 'All']]) {
      const b = h(`button.tab${this.filter === id ? '.active' : ''}`, { type: 'button' }, label, h('span.tab-count', String(counts[id] ?? 0)));
      b.addEventListener('click', () => { this.filter = id; save('alerts.filter', id); this.renderTabs(); this.render(); });
      this.tabs.appendChild(b);
    }
  }

  counts() {
    const all = [...this.alerts.values()];
    return {
      active: all.filter((a) => a.status === 'active' || a.status === 'paused').length,
      triggered: all.filter((a) => a.status === 'triggered' || a.status === 'expired').length,
      all: all.length,
    };
  }

  render() {
    this.renderTabs();
    clear(this.list);
    let items = [...this.alerts.values()];
    if (this.filter === 'active') items = items.filter((a) => a.status === 'active' || a.status === 'paused');
    else if (this.filter === 'triggered') items = items.filter((a) => a.status === 'triggered' || a.status === 'expired');
    items.sort((a, b) => (b.lastFired || b.created || 0) - (a.lastFired || a.created || 0));
    if (!items.length) {
      this.list.appendChild(h('div.empty-state',
        icon('alarm', 36),
        h('div.empty-title', this.filter === 'triggered' ? 'No triggered alerts' : 'No alerts yet'),
        h('div.empty-sub', 'Alt+A creates an alert at the crosshair price. You can also ask the agent: “alert me when ETH crosses 4000”.'),
        h('button.btn.btn-primary', { type: 'button', onclick: () => this.createAtCrosshair() }, 'Create alert')));
      return;
    }
    for (const a of items) this.list.appendChild(this.renderItem(a));
  }

  renderItem(a) {
    const { symbol, category } = splitKey(a.symbol);
    const statusCls = a.status || 'active';
    const toggle = a.status === 'paused'
      ? iconButton('play', 'Resume', (e) => { e.stopPropagation(); this.setStatus(a, 'active'); }, 'sm')
      : a.status === 'active'
        ? iconButton('pause', 'Pause', (e) => { e.stopPropagation(); this.setStatus(a, 'paused'); }, 'sm')
        : iconButton('refresh', 'Re-arm', (e) => { e.stopPropagation(); this.setStatus(a, 'active'); }, 'sm');
    const item = h(`div.alert-item.${statusCls}`,
      h('div.alert-item-top',
        h(`span.status-dot.${statusCls}`, { title: statusCls }),
        h('span.alert-sym', symbol, h(`span.cat-tag.${category}`, categoryLabel(category))),
        a.tf ? h('span.alert-tf', a.tf) : null,
        h('span.spacer'),
        a.laya && a.laya.enabled ? h('span.chip.chip-laya', { title: `Laya gate: ${a.laya.question || ''} (≥ ${a.laya.threshold})` }, 'Laya') : null,
        a.createdBy === 'agent' ? h('span.chip.chip-agent', { title: 'Created by the agent' }, 'AI') : null,
        h('span.alert-actions',
          toggle,
          iconButton('edit', 'Edit', (e) => { e.stopPropagation(); this.openEditor(a); }, 'sm'),
          iconButton('trash', 'Delete', (e) => { e.stopPropagation(); this.remove(a); }, 'sm'))),
      h('div.alert-cond', describeCondition(a)),
      a.name || a.message ? h('div.alert-msg', a.name || a.message) : null,
      h('div.alert-meta',
        h('span', TRIGGERS.find((t) => t.id === a.trigger)?.label || a.trigger || ''),
        a.sound ? h('span', icon('volume', 12), ` ${a.sound.preset}${a.sound.loop ? ' · loop' : ''}`) : null,
        a.expires ? h('span', { title: formatDateTime(a.expires) }, `expires ${formatDateTime(a.expires)}`) : null,
        a.lastFired ? h('span', `fired ${formatTimeAgo(a.lastFired)}`) : null));
    item.addEventListener('click', () => {
      const chart = this.layout.active;
      if (chart && a.symbol && chartState(chart).symbol !== a.symbol) chart.setSymbol?.(a.symbol);
    });
    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      popupMenu(item, [
        { label: 'Edit…', icon: 'edit', onClick: () => this.openEditor(a) },
        { label: 'Duplicate', icon: 'plus', onClick: () => this.openEditor({ ...a, id: undefined, name: `${a.name || 'Alert'} (copy)` }) },
        { label: 'Test sound', icon: 'volume', onClick: () => { alarm.unlock(); alarm.play({ ...(a.sound || {}), loop: false, repeat: 1 }); } },
        { separator: true },
        { label: 'Delete', icon: 'trash', danger: true, onClick: () => this.remove(a) },
      ]);
    });
    return item;
  }

  async setStatus(a, status) {
    try {
      const res = await this.api.patch(`/api/alerts/${encodeURIComponent(a.id)}`, { status });
      this.upsert(res && res.id ? res : { ...a, status });
    } catch (err) {
      toast(`Could not update alert: ${err.message}`, 'error');
    }
  }

  async remove(a) {
    if (!(await confirmDialog(`Delete alert on ${a.symbol}: ${describeCondition(a)}?`, { title: 'Delete alert', okLabel: 'Delete', danger: true }))) return;
    try {
      await this.api.delete(`/api/alerts/${encodeURIComponent(a.id)}`);
      this.removeLocal(a.id);
      toast('Alert deleted', 'success', 1800);
    } catch (err) {
      toast(`Could not delete alert: ${err.message}`, 'error');
    }
  }

  // ------------------------------------------------------------------ creating

  /** Alt+A: open the create dialog at the crosshair (or last) price of the active chart. */
  createAtCrosshair() {
    const chart = this.app.hub.active;
    const st = chartState(chart);
    const price = this.app.hub.activePrice();
    this.openEditor(null, { symbol: st.symbol, tf: st.tf, price });
  }

  /**
   * Create/edit dialog.
   * @param {object|null} alert existing alert to edit (null = new)
   * @param {{symbol?, tf?, price?}} defaults
   */
  openEditor(alert, defaults = {}) {
    const editing = !!(alert && alert.id);
    const base = alert || {};
    const lastSound = load('alerts.lastSound', { preset: 'siren', volume: 0.9, repeat: 5, loop: true });
    const cond = base.condition || { kind: 'price', op: 'crosses', value: defaults.price ?? '' };
    const st = {
      symbol: base.symbol || defaults.symbol || 'linear:BTCUSDT',
      tf: base.tf || defaults.tf || '1h',
      kind: cond.kind || 'price',
      op: cond.op || 'crosses',
      value: cond.value ?? defaults.price ?? '',
      value2: cond.value2 ?? '',
      source: cond.source || DEFAULT_INDICATOR_SRC,
      drawingId: cond.drawingId || '',
      trigger: base.trigger || 'once',
      expires: base.expires || null,
      name: base.name || '',
      message: base.message || '',
      sound: { preset: 'siren', volume: 0.9, repeat: 5, loop: true, ...lastSound, ...(base.sound || {}) },
      laya: { enabled: false, question: DEFAULT_LAYA_Q, threshold: 0.6, ...(base.laya || {}) },
    };
    if (st.value !== '' && st.value != null) {
      const tick = symbolInfo.get(st.symbol)?.tickSize;
      st.value = tick ? Number((Math.round(Number(st.value) / tick) * tick).toFixed(10)) : Number(Number(st.value).toPrecision(8));
    }
    if (st.value2 === '' && st.value !== '' && (st.op === 'enters_channel' || st.op === 'exits_channel')) st.value2 = st.value;

    // --- fields
    const symbolBtn = h('button.input.input-btn', { type: 'button' }, st.symbol);
    symbolBtn.addEventListener('click', () => {
      this.app.openSymbolSearch({ title: 'Alert symbol', onSelect: (k) => { st.symbol = k; symbolBtn.textContent = k; refreshDrawings(); } });
    });
    const tfSel = select(TIMEFRAMES.map((t) => ({ id: t, label: t })), st.tf, (v) => { st.tf = v; });

    const kindSeg = h('div.segmented');
    const condBox = h('div.cond-box');
    const setKind = (k) => {
      st.kind = k;
      kindSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.k === k));
      renderCond();
    };
    for (const [k, label] of [['price', 'Price'], ['indicator', 'Indicator'], ['drawing', 'Drawing']]) {
      kindSeg.appendChild(h('button', { type: 'button', dataset: { k }, onclick: () => setKind(k) }, label));
    }

    let drawingsCache = [];
    const refreshDrawings = () => {
      const chart = this.app.hub.charts.find((c) => chartState(c).symbol === st.symbol) || this.app.hub.active;
      drawingsCache = chartDrawings(chart).filter((d) => ['trendline', 'ray', 'extended_line', 'horizontal_line', 'horizontal_ray', 'hline'].includes(d.type));
      if (st.kind === 'drawing') renderCond();
    };

    const numInput = (val, onInput) => {
      const inp = h('input.input.num', { type: 'number', step: 'any', value: val === '' || val == null ? '' : String(val) });
      inp.addEventListener('input', () => onInput(inp.value === '' ? '' : Number(inp.value)));
      return inp;
    };

    const renderCond = () => {
      clear(condBox);
      if (st.kind === 'price') {
        const isChannel = st.op === 'enters_channel' || st.op === 'exits_channel';
        const opSel = select(PRICE_OPS, st.op, (v) => { st.op = v; if ((v === 'enters_channel' || v === 'exits_channel') && st.value2 === '') st.value2 = st.value; renderCond(); });
        const useCur = h('button.btn.btn-ghost.btn-sm', { type: 'button', title: 'Use the crosshair / last price' }, icon('target', 14), 'Current');
        const v1 = numInput(st.value, (v) => { st.value = v; });
        useCur.addEventListener('click', () => {
          const p = this.app.hub.activePrice();
          if (p != null) { st.value = Number(Number(p).toPrecision(8)); v1.value = String(st.value); }
        });
        condBox.append(
          field('Condition', opSel),
          h('div.field-row',
            field(isChannel ? 'Upper bound' : 'Value', v1),
            isChannel ? field('Lower bound', numInput(st.value2, (v) => { st.value2 = v; })) : field('', useCur)));
      } else if (st.kind === 'indicator') {
        const ta = h('textarea.input.code', { rows: 8, spellcheck: false }, st.source);
        ta.addEventListener('input', () => { st.source = ta.value; });
        const fromEditor = h('button.btn.btn-ghost.btn-sm', { type: 'button' }, icon('code', 14), 'Use Pine Editor script');
        fromEditor.addEventListener('click', async () => {
          const src = await this.app.getPineSource?.();
          if (src) { st.source = src; ta.value = src; } else toast('The Pine Editor is empty', 'warn');
        });
        condBox.append(
          field('Pine script (fires when the plot named "signal" > 0, or on alertcondition)', ta),
          h('div.field-hint', 'Evaluated server-side on every closed bar of the selected timeframe.', fromEditor));
      } else {
        if (!drawingsCache.length) refreshDrawingsSilently();
        const opts = drawingsCache.map((d) => ({ id: String(d.id), label: `${String(d.type || 'drawing').replace(/_/g, ' ')}${d.name ? ' · ' + d.name : ''} @ ${formatPrice(d.points && d.points[0] ? d.points[0].price : null)}` }));
        if (!st.drawingId && opts.length) st.drawingId = opts[0].id;
        const drawSel = opts.length ? select(opts, st.drawingId, (v) => { st.drawingId = v; }) : h('div.field-hint.warn', 'No trend lines or horizontal lines on a chart with this symbol. Draw one first.');
        condBox.append(
          field('Drawing', drawSel),
          field('Condition', select(DRAWING_OPS, DRAWING_OPS.some((o) => o.id === st.op) ? st.op : (st.op = 'crosses'), (v) => { st.op = v; })));
      }
    };
    const refreshDrawingsSilently = () => {
      const chart = this.app.hub.charts.find((c) => chartState(c).symbol === st.symbol) || this.app.hub.active;
      drawingsCache = chartDrawings(chart);
    };

    const trigSel = select(TRIGGERS, st.trigger, (v) => { st.trigger = v; });

    const expOpen = h('input', { type: 'checkbox', checked: !st.expires });
    const expInput = h('input.input', { type: 'datetime-local', value: toDateTimeInput(st.expires || Date.now() + 30 * 86400000), disabled: !st.expires });
    expOpen.addEventListener('change', () => { expInput.disabled = expOpen.checked; });

    const nameInput = h('input.input', { type: 'text', value: st.name, placeholder: 'Alert name (optional)' });
    const msgInput = h('textarea.input', { rows: 2, placeholder: '{{symbol}} crossed {{price}}' }, st.message);

    // sound
    const volLabel = h('span.range-val', `${Math.round(st.sound.volume * 100)}%`);
    const vol = h('input.range', { type: 'range', min: 0, max: 1, step: 0.05, value: st.sound.volume });
    vol.addEventListener('input', () => { st.sound.volume = Number(vol.value); volLabel.textContent = `${Math.round(st.sound.volume * 100)}%`; });
    const repeat = h('input.input.num.sm', { type: 'number', min: 1, max: 50, value: st.sound.repeat ?? 5 });
    repeat.addEventListener('input', () => { st.sound.repeat = Math.max(1, Number(repeat.value) || 1); });
    const loopCb = h('input', { type: 'checkbox', checked: !!st.sound.loop });
    loopCb.addEventListener('change', () => { st.sound.loop = loopCb.checked; repeat.disabled = loopCb.checked; });
    repeat.disabled = !!st.sound.loop;
    const testBtn = h('button.btn.btn-ghost.btn-sm', { type: 'button' }, icon('volume', 14), 'Test');
    let testHandle = null;
    const setTestLabel = (playing) => { clear(testBtn).append(icon(playing ? 'stop' : 'volume', 14), playing ? 'Stop' : 'Test'); };
    testBtn.addEventListener('click', async () => {
      if (testHandle && alarm.playing) { alarm.stop(); testHandle = null; setTestLabel(false); return; }
      await alarm.unlock();
      testHandle = alarm.play({ ...st.sound, loop: false, repeat: Math.min(st.sound.repeat || 2, 3) });
      setTestLabel(true);
      testHandle.done.then(() => { testHandle = null; setTestLabel(false); });
    });
    const presetSel = select(ALARM_PRESETS.map((p) => ({ id: p, label: p[0].toUpperCase() + p.slice(1) })), st.sound.preset, (v) => { st.sound.preset = v; });

    // laya
    const layaCb = h('input', { type: 'checkbox', checked: !!st.laya.enabled });
    const layaQ = h('textarea.input', { rows: 2 }, st.laya.question || DEFAULT_LAYA_Q);
    layaQ.addEventListener('input', () => { st.laya.question = layaQ.value; });
    const thrLabel = h('span.range-val', Number(st.laya.threshold).toFixed(2));
    const thr = h('input.range', { type: 'range', min: 0.05, max: 0.95, step: 0.01, value: st.laya.threshold });
    thr.addEventListener('input', () => { st.laya.threshold = Number(thr.value); thrLabel.textContent = st.laya.threshold.toFixed(2); });
    const layaBody = h('div.laya-body', field('Question Laya must answer “true” to', layaQ),
      field('Fire when P(true) ≥', h('div.range-row', thr, thrLabel)),
      h('div.field-hint', 'Laya receives recent candles, RSI/EMA/ATR, volume z-score and footprint delta. If Laya is unavailable the alert fires anyway (marked “skipped”).'));
    const syncLaya = () => { layaBody.classList.toggle('disabled', !layaCb.checked); st.laya.enabled = layaCb.checked; };
    layaCb.addEventListener('change', syncLaya);

    const content = h('div.form.alert-form',
      h('div.form-section',
        h('div.field-row', field('Symbol', symbolBtn), field('Timeframe', tfSel)),
        field('Condition type', kindSeg),
        condBox,
        h('div.field-row', field('Trigger', trigSel),
          field('Expiration', h('div.exp-row', h('label.check', expOpen, 'Open-ended'), expInput)))),
      h('div.form-section',
        h('div.section-title', 'Notification'),
        field('Name', nameInput),
        field('Message', msgInput),
        h('div.field-row',
          field('Sound', presetSel),
          field('Volume', h('div.range-row', vol, volLabel))),
        h('div.field-row.align-end',
          field('Repeat', repeat),
          h('label.check', loopCb, 'Loop until acknowledged'),
          testBtn)),
      h('div.form-section',
        h('div.section-title', h('label.check.switch', layaCb, h('span.switch-ui'), 'Laya decision gate')),
        layaBody));

    setKind(st.kind);
    syncLaya();
    refreshDrawings();

    const dlg = openDialog({
      title: editing ? 'Edit alert' : `Create alert on ${splitKey(st.symbol).symbol}`,
      className: 'dialog-alert',
      content,
      onClose: () => { if (testHandle) alarm.stop(); },
      buttons: [
        { label: 'Cancel', kind: 'ghost' },
        {
          label: editing ? 'Save' : 'Create',
          kind: 'primary',
          onClick: async () => {
            const body = this.buildBody(st, { expOpen: expOpen.checked, expValue: expInput.value, name: nameInput.value, message: msgInput.value });
            if (typeof body === 'string') { toast(body, 'error'); return false; }
            save('alerts.lastSound', st.sound);
            try {
              const res = editing
                ? await this.api.patch(`/api/alerts/${encodeURIComponent(base.id)}`, body)
                : await this.api.post('/api/alerts', body);
              const saved = res && res.id ? res : res && res.alert ? res.alert : { ...body, id: base.id };
              if (saved.id) this.upsert(saved);
              else this.load();
              toast(editing ? 'Alert updated' : 'Alert created', 'success', 2000);
              return true;
            } catch (err) {
              toast(`Could not save alert: ${err.message}`, 'error');
              return false;
            }
          },
        },
      ],
    });
    return dlg;
  }

  buildBody(st, { expOpen, expValue, name, message }) {
    let condition;
    if (st.kind === 'price') {
      if (st.value === '' || !isFinite(st.value)) return 'Enter a price value';
      condition = { kind: 'price', op: st.op, value: Number(st.value) };
      if (st.op === 'enters_channel' || st.op === 'exits_channel') {
        if (st.value2 === '' || !isFinite(st.value2)) return 'Enter both channel bounds';
        const hi = Math.max(Number(st.value), Number(st.value2));
        const lo = Math.min(Number(st.value), Number(st.value2));
        condition.value = hi;
        condition.value2 = lo;
      }
    } else if (st.kind === 'indicator') {
      if (!st.source || !st.source.trim()) return 'Enter a Pine script';
      condition = { kind: 'indicator', source: st.source };
    } else {
      if (!st.drawingId) return 'Pick a drawing';
      condition = { kind: 'drawing', drawingId: st.drawingId, op: st.op };
    }
    let expires;
    if (!expOpen) {
      const t = new Date(expValue).getTime();
      if (!isFinite(t)) return 'Invalid expiration date';
      if (t <= Date.now()) return 'Expiration must be in the future';
      expires = t;
    }
    const autoName = `${splitKey(st.symbol).symbol} ${st.kind === 'price' ? opLabel(st.op) + ' ' + st.value : st.kind}`;
    return {
      symbol: st.symbol,
      tf: st.tf,
      name: name.trim() || autoName,
      message: message.trim() || `${autoName}`,
      condition,
      trigger: st.trigger,
      expires: expires ?? null,
      laya: { enabled: !!st.laya.enabled, question: (st.laya.question || DEFAULT_LAYA_Q).trim(), threshold: Number(st.laya.threshold) },
      sound: { preset: st.sound.preset, volume: Number(st.sound.volume), repeat: Number(st.sound.repeat) || 1, loop: !!st.sound.loop },
      createdBy: 'user',
      status: 'active',
    };
  }

  // ------------------------------------------------------------------ chart lines

  syncLines() {
    const active = [...this.alerts.values()].filter((a) => a.status === 'active' && a.condition && a.condition.kind === 'price');
    for (const chart of this.app.hub.charts) {
      if (typeof chart.showAlertLine !== 'function') continue;
      const sym = chartState(chart).symbol;
      const shown = this.lines.get(chart) || new Map();
      this.lines.set(chart, shown);
      const wanted = new Map(active.filter((a) => a.symbol === sym).map((a) => [a.id, a]));
      for (const id of [...shown.keys()]) {
        if (!wanted.has(id)) {
          try { chart.removeAlertLine?.(id); } catch { /* ignore */ }
          shown.delete(id);
        }
      }
      for (const [id, a] of wanted) {
        const sig = `${a.condition.op}|${a.condition.value}|${a.condition.value2 ?? ''}|${a.name || ''}`;
        if (shown.get(id) === sig) continue;
        try {
          if (shown.has(id)) chart.removeAlertLine?.(id);
          chart.showAlertLine(
            { ...a, title: a.name || describeCondition(a), draggable: true },
            { draggable: true, onMove: (price, which) => this.onLineMoved(id, Number(price), which) },
          );
          shown.set(id, sig);
        } catch (err) {
          console.warn('[alerts] showAlertLine failed', err);
        }
      }
    }
  }

  /** An alert line was dragged on a chart: update the level locally and PATCH (debounced). */
  onLineMoved(id, price, which) {
    const a = this.alerts.get(id);
    if (!a || !a.condition || !isFinite(price)) return;
    const cond = { ...a.condition };
    if (which === 'value2') cond.value2 = price;
    else cond.value = price;
    a.condition = cond;
    // mark as already shown with the new value so syncLines does not re-create the line mid-drag
    for (const shown of this.lines.values()) {
      if (shown.has(id)) shown.set(id, `${cond.op}|${cond.value}|${cond.value2 ?? ''}|${a.name || ''}`);
    }
    this.render();
    clearTimeout(this.patchTimers.get(id));
    this.patchTimers.set(id, setTimeout(async () => {
      try {
        const res = await this.api.patch(`/api/alerts/${encodeURIComponent(id)}`, { condition: cond });
        if (res && res.id) this.alerts.set(id, { ...a, ...res });
        toast(`Alert moved to ${formatPrice(price, symbolInfo.get(a.symbol)?.tickSize)}`, 'success', 1500);
      } catch (err) {
        toast(`Could not move alert: ${err.message}`, 'error');
        this.load();
      }
    }, 350));
  }
}

// ------------------------------------------------------------------ small form helpers

function field(label, control) {
  return h('div.field', h('span.field-label', label || '\u00a0'), control);
}

function select(options, value, onChange) {
  const s = h('select.input');
  for (const o of options) s.appendChild(h('option', { value: o.id, selected: o.id === value }, o.label));
  s.value = value;
  s.addEventListener('change', () => onChange(s.value));
  return s;
}

export { field, select, TRIGGERS };
