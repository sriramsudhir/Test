import { REPLAY_SPEEDS } from './ReplayController.js';
import { ICONS } from '../layout/icons.js';
import { el, toMs } from '../chart/util.js';
import { formatDateTime, formatSigned, formatPercent } from '../chart/format.js';

const pad = (n) => String(n).padStart(2, '0');
const toLocalInput = (ms) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
};

/**
 * Replay control bar (bottom of a chart) + paper-trading strip, and the "scissors" start-bar selector overlay.
 */
export class ReplayBar {
  constructor(chartRoot, replay, view) {
    this.replay = replay;
    this.view = view;
    this.root = el('div', { class: 'tv-replay-bar', hidden: true });
    chartRoot.append(this.root);

    // selector overlay (vertical cut line + dimmed future)
    this.cut = el('div', { class: 'tv-replay-cut', hidden: true }, [el('div', { class: 'tv-replay-cut-line' }, [el('span', { class: 'tv-replay-cut-icon', html: ICONS.scissors })]), el('div', { class: 'tv-replay-cut-shade' })]);
    view.canvasHost.append(this.cut);
    this._onMove = (e) => this._moveCut(e);
    this._onLeave = () => (this.cut.hidden = true);
    view.canvasHost.addEventListener('mousemove', this._onMove);
    view.canvasHost.addEventListener('mouseleave', this._onLeave);

    this._build();
    this._offs = [replay.on('state', (s) => this._render(s)), replay.on('tick', () => this._renderPnl())];
    this._onKey = (e) => this._key(e);
    document.addEventListener('keydown', this._onKey);
    this._render(replay.snapshot());
  }

  destroy() {
    for (const off of this._offs) off();
    document.removeEventListener('keydown', this._onKey);
    this.view.canvasHost.removeEventListener('mousemove', this._onMove);
    this.view.canvasHost.removeEventListener('mouseleave', this._onLeave);
    this.root.remove();
    this.cut.remove();
  }

  _btn(iconName, title, onclick, cls = '') {
    return el('button', { class: `tv-rb-btn ${cls}`, title, html: ICONS[iconName], onclick });
  }

  _build() {
    const r = this.replay;
    this.selectBtn = el('button', { class: 'tv-rb-btn tv-rb-select', title: 'Select bar', html: `${ICONS.scissors}<span>Select bar</span>`, onclick: () => r.select() });
    this.backBtn = this._btn('step_back', 'Step back (Shift+←)', () => r.stepBack(1));
    this.playBtn = this._btn('play', 'Play (Shift+↓)', () => r.togglePlay(), 'tv-rb-play');
    this.fwdBtn = this._btn('step_fwd', 'Step forward (Shift+→)', () => r.stepForward(1));
    this.speedSel = el('select', { class: 'tv-rb-speed', title: 'Replay speed' });
    for (const s of REPLAY_SPEEDS) this.speedSel.append(el('option', { value: String(s), text: `${s}x` }));
    this.speedSel.addEventListener('change', () => r.setSpeed(+this.speedSel.value));

    this.dateInput = el('input', { type: 'datetime-local', class: 'tv-rb-date', title: 'Jump to date (UTC)' });
    const goBtn = el('button', {
      class: 'tv-rb-btn tv-rb-go',
      title: 'Jump to date',
      html: ICONS.calendar,
      onclick: () => {
        const v = this.dateInput.value;
        if (!v) return;
        const ms = toMs(v.length === 16 ? `${v}:00Z` : `${v}Z`);
        if (ms != null) r.jumpTo(ms).catch((e) => this._flash(e.message));
      },
    });
    this.dateInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') goBtn.click();
    });
    this.timeLabel = el('span', { class: 'tv-rb-time' });

    // paper trading
    this.qtyInput = el('input', { type: 'number', class: 'tv-rb-qty', min: '0', step: 'any', value: String(r.defaultQty), title: 'Order quantity' });
    this.qtyInput.addEventListener('keydown', (e) => e.stopPropagation());
    const qty = () => {
      const q = +this.qtyInput.value;
      return q > 0 ? q : r.defaultQty;
    };
    this.buyBtn = el('button', { class: 'tv-rb-trade tv-rb-buy', title: 'Buy at replay price', onclick: () => this._trade(() => r.buy(qty())) }, [el('span', { text: 'Buy' }), el('b', { class: 'tv-rb-px' })]);
    this.sellBtn = el('button', { class: 'tv-rb-trade tv-rb-sell', title: 'Sell at replay price', onclick: () => this._trade(() => r.sell(qty())) }, [el('span', { text: 'Sell' }), el('b', { class: 'tv-rb-px' })]);
    this.closeBtn = el('button', { class: 'tv-rb-btn tv-rb-flat', title: 'Close position', text: 'Close', onclick: () => this._trade(() => r.closeAll()) });
    this.posLabel = el('span', { class: 'tv-rb-pos' });
    this.pnlLabel = el('span', { class: 'tv-rb-pnl' });
    this.exitBtn = el('button', { class: 'tv-rb-btn tv-rb-exit', title: 'Exit replay', html: ICONS.close, onclick: () => r.stop() });

    this.hint = el('span', { class: 'tv-rb-hint', text: 'Click on the chart to select the replay starting bar' });
    this.cancelSel = el('button', { class: 'tv-rb-btn tv-rb-flat', text: 'Cancel', onclick: () => r.stop() });

    const sep = () => el('span', { class: 'tv-rb-sep' });
    this.controls = el('div', { class: 'tv-rb-group' }, [this.selectBtn, sep(), this.backBtn, this.playBtn, this.fwdBtn, this.speedSel, sep(), this.dateInput, goBtn, this.timeLabel]);
    this.trading = el('div', { class: 'tv-rb-group tv-rb-trading' }, [this.qtyInput, this.sellBtn, this.buyBtn, this.closeBtn, this.posLabel, this.pnlLabel]);
    this.selecting = el('div', { class: 'tv-rb-group tv-rb-selecting' }, [el('span', { class: 'tv-rb-scissors', html: ICONS.scissors }), this.hint, this.cancelSel]);
    this.root.append(this.selecting, this.controls, el('div', { class: 'tv-rb-spacer' }), this.trading, this.exitBtn);
    this.root.addEventListener('mousedown', (e) => e.stopPropagation());
  }

  _trade(fn) {
    try {
      fn();
    } catch (e) {
      this._flash(e.message);
    }
  }

  _flash(msg) {
    this.hint.textContent = msg;
    this.root.classList.add('tv-rb-flash');
    setTimeout(() => this.root.classList.remove('tv-rb-flash'), 1500);
  }

  _key(e) {
    const r = this.replay;
    if (!r.active || !this.view.drawings._focused) return;
    if (/INPUT|TEXTAREA|SELECT/.test(e.target?.tagName || '')) return;
    if (e.shiftKey && e.key === 'ArrowRight') {
      e.preventDefault();
      r.stepForward(1);
    } else if (e.shiftKey && e.key === 'ArrowLeft') {
      e.preventDefault();
      r.stepBack(1);
    } else if (e.shiftKey && e.key === 'ArrowDown') {
      e.preventDefault();
      r.togglePlay();
    }
  }

  _moveCut(e) {
    if (!this.replay.selecting) {
      this.cut.hidden = true;
      return;
    }
    const rect = this.view.canvasHost.getBoundingClientRect();
    const size = this.view.chart.paneSize(0);
    const x = e.clientX - rect.left;
    if (x < 0 || x > size.width) {
      this.cut.hidden = true;
      return;
    }
    // snap to bar centre
    const t = this.view.xToTime(x, true);
    const sx = this.view.timeToX(t) ?? x;
    this.cut.hidden = false;
    this.cut.style.left = `${sx}px`;
    this.cut.style.height = `${size.height}px`;
    this.cut.querySelector('.tv-replay-cut-shade').style.width = `${Math.max(0, size.width - sx)}px`;
  }

  _render(s) {
    const visible = s.active || s.selecting;
    this.root.hidden = !visible;
    this.view.canvasHost.classList.toggle('tv-replay-selecting', !!s.selecting);
    if (!s.selecting) this.cut.hidden = true;
    this.root.classList.toggle('tv-rb-is-selecting', !!s.selecting && !s.active);
    this.selecting.hidden = !(s.selecting && !s.active);
    this.controls.hidden = !s.active && !s.selecting ? true : !s.active && s.selecting;
    this.trading.hidden = !s.active;
    if (s.selecting && s.active) {
      this.selectBtn.classList.add('tv-on');
    } else this.selectBtn.classList.remove('tv-on');
    this.playBtn.innerHTML = s.playing ? ICONS.pause : ICONS.play;
    this.playBtn.title = s.playing ? 'Pause (Shift+↓)' : 'Play (Shift+↓)';
    this.playBtn.disabled = !s.active || s.atEnd;
    this.fwdBtn.disabled = !s.active || s.atEnd;
    this.backBtn.disabled = !s.active || s.index <= 0;
    if (String(s.speed) !== this.speedSel.value) {
      if (![...this.speedSel.options].some((o) => o.value === String(s.speed))) this.speedSel.append(el('option', { value: String(s.speed), text: `${s.speed}x` }));
      this.speedSel.value = String(s.speed);
    }
    if (s.time != null) {
      this.timeLabel.textContent = formatDateTime(s.time) + (s.atEnd ? ' · end' : '');
      if (document.activeElement !== this.dateInput) this.dateInput.value = toLocalInput(s.time);
    }
    this._renderPnl();
  }

  _renderPnl() {
    const r = this.replay;
    if (!r.active) return;
    const price = r.price;
    const f = (v) => this.view.formatPrice(v);
    for (const b of [this.buyBtn, this.sellBtn]) b.querySelector('.tv-rb-px').textContent = price != null ? f(price) : '';
    const pos = r.positions[0];
    if (pos) {
      this.posLabel.innerHTML = `<span class="${pos.side === 'long' ? 'tv-up' : 'tv-down'}">${pos.side.toUpperCase()} ${pos.qty}</span> @ ${f(pos.avgPrice)}`;
    } else this.posLabel.innerHTML = '<span class="tv-muted">Flat</span>';
    const p = r.pnl;
    const cls = (v) => (v > 0 ? 'tv-up' : v < 0 ? 'tv-down' : 'tv-muted');
    this.pnlLabel.innerHTML =
      `<span title="Unrealised P&L">Open <b class="${cls(p.unrealized)}">${formatSigned(p.unrealized, this.view.precision)}</b>${pos ? ` <small class="${cls(p.unrealized)}">${formatPercent(pos.unrealizedPct)}</small>` : ''}</span>` +
      `<span title="Realised P&L">Realised <b class="${cls(p.realized)}">${formatSigned(p.realized, this.view.precision)}</b></span>` +
      `<span title="Closed trades · win rate">${p.trades} trades${p.trades ? ` · ${p.winRate.toFixed(0)}% win` : ''}</span>`;
    this.closeBtn.disabled = !pos;
  }
}
