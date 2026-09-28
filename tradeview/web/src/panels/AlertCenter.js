// Handles fired alerts ({type:'alert', event} on the socket): loud alarm, big modal with Laya decision,
// desktop notification and tab-title flashing until acknowledged.
import { h, clear, icon } from './util/dom.js';
import { openDialog, toast } from './util/dialog.js';
import { formatPrice, formatDateTime, splitKey } from './util/fmt.js';
import { layaSummary, layaBar } from './util/laya.js';
import { alarm } from '../audio/alarm.js';
import { notify, flashTitle, stopFlash } from '../audio/notify.js';
import { symbolInfo } from './SymbolSearch.js';

const DEFAULT_SOUND = { preset: 'siren', volume: 1, repeat: 5, loop: true };

export class AlertCenter {
  constructor({ layout, api, socket, app }) {
    this.layout = layout;
    this.api = api;
    this.app = app;
    this.pending = []; // unacknowledged events
    this.dlg = null;
    this.listEl = null;
    this.seen = new Set();
    socket.on('alert', (m) => this.onAlert(m.event || m));
  }

  async lookupAlert(id) {
    const local = this.app.alerts && this.app.alerts.get(id);
    if (local) return local;
    try { return await this.api.get(`/api/alerts/${encodeURIComponent(id)}`); } catch { return null; }
  }

  async onAlert(event) {
    if (!event) return;
    const key = event.id != null ? `id:${event.id}` : `${event.alertId}|${event.t}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    if (this.seen.size > 500) this.seen.delete(this.seen.values().next().value);

    const alert = await this.lookupAlert(event.alertId);
    if (event.laya && event.laya.passed === false && !event.laya.skipped) {
      // Condition hit but Laya vetoed it: log only, no alarm.
      const p = layaSummary(event.laya).p;
      toast(`${splitKey(event.symbol).symbol}: alert condition hit, Laya blocked it (P ${p == null ? '—' : Math.round(p * 100) + '%'})`, 'warn', 6000);
      return;
    }
    const sound = { ...DEFAULT_SOUND, ...((alert && alert.sound) || event.sound || {}) };
    this.pending.unshift({ event, alert, sound });
    alarm.play(sound);
    const sym = splitKey(event.symbol).symbol;
    const tick = symbolInfo.get(event.symbol)?.tickSize;
    const title = `${sym} ${formatPrice(event.price, tick)}`;
    flashTitle(`${sym} alert`);
    const lay = layaSummary(event.laya);
    notify({
      title: `Alert: ${event.name || (alert && alert.name) || sym}`,
      body: `${title}\n${event.message || ''}${lay.present && lay.p != null ? `\nLaya P(true) ${(lay.p * 100).toFixed(0)}%${lay.direction ? ' · ' + lay.direction : ''}` : ''}`,
      tag: `alert-${event.alertId}`,
      onClick: () => this.show(),
    });
    this.show();
    this.app.onAlertFired?.(event);
  }

  show() {
    if (!this.dlg || this.dlg.closed) {
      this.listEl = h('div.fired-list');
      this.dlg = openDialog({
        title: h('span.fired-title', icon('bell', 20, 'ring'), 'Alert triggered'),
        className: 'dialog-fired',
        content: this.listEl,
        onClose: () => this.acknowledgeAll(),
        buttons: [
          { label: 'Open chart', kind: 'ghost', onClick: () => {
            const first = this.pending[0];
            if (first && this.layout.active) this.layout.active.setSymbol?.(first.event.symbol);
          } },
          { label: 'Acknowledge', kind: 'danger' },
        ],
      });
      this.dlg.el.querySelector('.btn-danger')?.focus();
    }
    this.renderList();
  }

  renderList() {
    if (!this.listEl) return;
    clear(this.listEl);
    for (const { event, alert } of this.pending.slice(0, 8)) {
      const sym = splitKey(event.symbol).symbol;
      const tick = symbolInfo.get(event.symbol)?.tickSize;
      const lay = layaSummary(event.laya);
      const layaEl = !lay.present ? null : lay.skipped
        ? h('div.fired-laya.skipped', h('div.fired-laya-head', 'Laya decision'), h('div', 'Skipped — Laya was unavailable, the alert fired without the gate.'))
        : h(`div.fired-laya.${lay.passed === false ? 'blocked' : 'passed'}`,
          h('div.fired-laya-head', 'Laya decision',
            h('span.fired-p', lay.p == null ? '—' : `P(true) ${(lay.p * 100).toFixed(1)}%`)),
          layaBar(lay.p, alert && alert.laya ? alert.laya.threshold : lay.threshold),
          h('div.fired-laya-row',
            lay.direction ? h(`span.dir.${lay.direction.toLowerCase()}`, icon(lay.direction.toLowerCase() === 'bearish' ? 'down' : lay.direction.toLowerCase() === 'bullish' ? 'up' : 'target', 14), lay.direction) : null,
            lay.confidence ? h('span', `confidence: ${lay.confidence}`) : null,
            alert && alert.laya && alert.laya.question ? h('span.fired-q', `“${alert.laya.question}”`) : null));
      this.listEl.appendChild(h('div.fired-item',
        h('div.fired-main',
          h('div.fired-sym', sym, h('span.fired-key', event.symbol)),
          h('div.fired-price', formatPrice(event.price, tick))),
        h('div.fired-name', event.name || (alert && alert.name) || 'Alert'),
        event.message ? h('div.fired-msg', event.message) : null,
        h('div.fired-time', formatDateTime(event.t || Date.now(), { seconds: true })),
        layaEl));
    }
    if (this.pending.length > 8) this.listEl.appendChild(h('div.empty', `+${this.pending.length - 8} more (see Alert log)`));
  }

  acknowledgeAll() {
    alarm.stop();
    stopFlash();
    this.pending = [];
    this.dlg = null;
    this.listEl = null;
  }
}
