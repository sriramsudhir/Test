// Status bar: browser socket, Bybit feed, Laya status (/api/laya/status), server health (/api/health),
// sound / notification state, UTC clock.
import { h, clear, icon } from './util/dom.js';
import { alarm } from '../audio/alarm.js';
import { notificationPermission, requestNotificationPermission } from '../audio/notify.js';
import { toast } from './util/dialog.js';
import { splitKey } from './util/fmt.js';
import { chartState } from './util/chartHub.js';

export class StatusBar {
  constructor(el, { api, socket, app }) {
    this.el = el;
    this.api = api;
    this.socket = socket;
    this.app = app;
    this.health = null;
    this.laya = null;
    this.bybit = 'unknown';

    this.sockEl = h('button.sb-item', { type: 'button', title: 'Browser ↔ server connection (click to reconnect)', onclick: () => socket.reconnect() });
    this.bybitEl = h('span.sb-item', { title: 'Bybit market data feed' });
    this.layaEl = h('button.sb-item', { type: 'button', title: 'Laya decision engine', onclick: () => this.pollLaya() });
    this.serverEl = h('button.sb-item', { type: 'button', title: 'Server health (click to refresh)', onclick: () => this.pollHealth() });
    this.chartEl = h('span.sb-item.sb-chart');
    this.soundEl = h('button.sb-item', { type: 'button' });
    this.notifEl = h('button.sb-item', { type: 'button' });
    this.clockEl = h('span.sb-item.sb-clock', { title: 'UTC time' });
    el.append(this.sockEl, this.bybitEl, this.layaEl, this.serverEl, this.chartEl, h('span.spacer'), this.soundEl, this.notifEl, this.clockEl);

    socket.on('connection', () => this.renderSocket());
    socket.on('status', (m) => { if (m.bybit) { this.bybit = m.bybit; this.renderBybit(); } });
    alarm.on('state', () => this.renderSound());
    this.soundEl.addEventListener('click', async () => {
      if (alarm.playing) { alarm.stop(); return; }
      await alarm.unlock();
      alarm.play({ preset: 'beep', volume: 0.6, repeat: 1 });
    });
    this.notifEl.addEventListener('click', async () => {
      const p = await requestNotificationPermission();
      if (p === 'denied') toast('Desktop notifications are blocked in the browser settings for this site', 'warn', 5000);
      this.renderNotif();
    });
    app.hub.on('active', () => this.renderChart());
    app.hub.on('symbol', () => this.renderChart());
    app.hub.on('tf', () => this.renderChart());

    this.renderSocket();
    this.renderBybit();
    this.renderSound();
    this.renderNotif();
    this.renderLaya();
    this.renderServer();
    this.tickClock();
    setInterval(() => this.tickClock(), 1000);
    this.pollHealth();
    this.pollLaya();
    setInterval(() => this.pollHealth(), 15000);
    setInterval(() => this.pollLaya(), 30000);
  }

  dot(state) { return h(`span.dot.${state}`); }

  renderSocket() {
    const s = this.socket.state;
    const map = { open: ['ok', 'Live'], connecting: ['warn', 'Connecting…'], reconnecting: ['bad', `Reconnecting${this.socket.attempt > 1 ? ` (${this.socket.attempt})` : ''}…`], idle: ['bad', 'Offline'] };
    const [cls, text] = map[s] || ['bad', s];
    clear(this.sockEl).append(this.dot(cls), text);
    if (s === 'open') this.pollHealth();
  }

  renderBybit() {
    const b = this.bybit;
    const cls = b === 'connected' ? 'ok' : b === 'reconnecting' || b === 'degraded' ? 'warn' : b === 'unknown' ? 'idle' : 'bad';
    const label = b === 'connected' ? 'Bybit connected' : b === 'down' ? 'Bybit offline (cached data)' : b === 'unknown' ? 'Bybit —' : `Bybit ${b}`;
    clear(this.bybitEl).append(this.dot(cls), label);
  }

  renderLaya() {
    const l = this.laya;
    let cls = 'idle';
    let text = 'Laya —';
    if (l) {
      if (l.error && !l.mode) { cls = 'bad'; text = 'Laya unreachable'; }
      else if (l.mode === 'off') { cls = 'idle'; text = 'Laya off'; }
      else if (l.ready) { cls = 'ok'; text = `Laya ${l.mode || ''}`.trim(); }
      else { cls = 'warn'; text = l.loading ? 'Laya loading…' : `Laya ${l.mode || ''} not ready`; }
    }
    clear(this.layaEl).append(this.dot(cls), text);
    this.layaEl.title = l ? `Laya decision engine\nmode: ${l.mode ?? '—'}\nmodel: ${l.model ?? '—'}${l.error ? '\n' + l.error : ''}` : 'Laya decision engine';
  }

  renderServer() {
    const hl = this.health;
    let cls = 'idle';
    let text = 'Server —';
    if (hl) {
      if (hl.error) { cls = 'bad'; text = 'Server down'; }
      else if (hl.ok) { cls = 'ok'; text = 'Server OK'; }
      else { cls = 'warn'; text = hl.db === false ? 'DB error' : 'Server degraded'; }
    }
    clear(this.serverEl).append(this.dot(cls), text);
    if (hl && !hl.error) {
      const d = hl.details || {};
      this.serverEl.title = `Server health\nDB: ${hl.db ? 'ok' : 'error'}\nBybit: ${hl.bybit}${d.subscriptions != null ? `\nLive subscriptions: ${d.subscriptions}` : ''}${d.uptimeSec != null ? `\nUptime: ${Math.round(d.uptimeSec / 60)} min` : ''}`;
    }
  }

  renderChart() {
    const st = chartState(this.app.hub.active);
    clear(this.chartEl);
    if (st.symbol) this.chartEl.append(icon('target', 12), `${splitKey(st.symbol).symbol} · ${st.tf || ''}${st.chartType && st.chartType !== 'candles' ? ' · ' + st.chartType : ''}`);
  }

  renderSound() {
    const s = alarm.state;
    clear(this.soundEl).append(icon(s.unlocked ? 'volume' : 'mute', 13), s.playing ? 'Stop alarm' : s.unlocked ? 'Sound on' : 'Sound locked');
    this.soundEl.classList.toggle('warn', !s.unlocked || s.playing);
    this.soundEl.title = s.unlocked ? 'Alert sounds enabled (click to test)' : 'Click to enable alert sounds';
  }

  renderNotif() {
    const p = notificationPermission();
    const label = { granted: 'Notifications on', denied: 'Notifications blocked', default: 'Enable notifications', unsupported: 'No notifications' }[p];
    clear(this.notifEl).append(icon('bell', 13), label);
    this.notifEl.classList.toggle('warn', p === 'default');
    this.notifEl.disabled = p === 'granted' || p === 'unsupported';
  }

  tickClock() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    this.clockEl.textContent = `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} UTC`;
  }

  async pollHealth() {
    try {
      this.health = await this.api.get('/api/health');
      if (this.health && this.health.bybit) this.bybit = this.health.bybit;
      if (this.health && this.health.laya && typeof this.health.laya === 'object' && !this.laya) this.laya = this.health.laya;
    } catch (err) {
      this.health = { error: err.message };
    }
    this.renderServer();
    this.renderBybit();
    this.renderLaya();
  }

  async pollLaya() {
    try {
      this.laya = await this.api.get('/api/laya/status');
    } catch (err) {
      this.laya = { error: err.message };
    }
    this.renderLaya();
  }
}
