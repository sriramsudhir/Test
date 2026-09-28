import { Emitter } from '../chart/emitter.js';
import { lowerIndex, toMs, toSec } from '../chart/util.js';

export const REPLAY_SPEEDS = [0.5, 1, 2, 3, 5, 10, 25, 50, 100];

/**
 * Client-side bar replay for one ChartView (§9, §12) with paper trading (forward-testing simulation).
 *
 * The cursor is stored as a bar open time, so prepending older history never shifts it.
 * Events: 'tick' { t, index, candle, pnl }, 'state' (snapshot), 'fill' (fill).
 */
export class ReplayController extends Emitter {
  /** @param {import('../chart/ChartView.js').ChartView} view */
  constructor(view) {
    super();
    this.view = view;
    this.active = false;
    this.selecting = false;
    this.playing = false;
    this.speed = 1;
    this.cursorT = null;
    this._timer = null;
    this.capital = 10000;
    this.defaultQty = 1;
    this._resetPaper();
  }

  // ---------------------------------------------------------------- state
  get index() {
    if (this.cursorT == null) return -1;
    return lowerIndex(this.view.candles, this.cursorT);
  }

  get candle() {
    const i = this.index;
    return i >= 0 ? this.view.candles[i] : null;
  }

  get price() {
    return this.candle ? this.candle.c : null;
  }

  get atEnd() {
    return this.index >= this.view.candles.length - 1;
  }

  get interval() {
    return Math.max(10, 1000 / this.speed);
  }

  snapshot() {
    return {
      active: this.active,
      selecting: this.selecting,
      playing: this.playing,
      speed: this.speed,
      time: this.candle ? this.candle.t : null,
      index: this.index,
      total: this.view.candles.length,
      atEnd: this.active && this.atEnd,
      positions: this.positions,
      pnl: this.pnl,
      fills: this.fills.slice(),
      trades: this.trades.slice(),
    };
  }

  _emitState() {
    const s = this.snapshot();
    this.emit('state', s);
    this.view.emit('replay', s);
  }

  // ---------------------------------------------------------------- lifecycle
  /** Enter "select the start bar" mode (scissors cursor); the ChartView calls start(t) on click. */
  select() {
    this.pause();
    this.selecting = true;
    this.view.drawings?.setTool(null);
    this._emitState();
  }

  cancelSelect() {
    if (!this.selecting) return;
    this.selecting = false;
    this._emitState();
  }

  /**
   * Start replay at `fromTime` (ms or anything toMs accepts). Without argument, enters select mode.
   */
  async start(fromTime) {
    if (fromTime == null) return this.select();
    const t = toMs(fromTime);
    this.pause();
    this.selecting = false;
    await this.view.ensureHistory(t);
    const c = this.view.candles;
    if (!c.length) throw new Error('No history to replay');
    let i = lowerIndex(c, t);
    if (i < 0) i = 0;
    const wasActive = this.active;
    this.cursorT = c[i].t;
    this.active = true;
    if (!wasActive) this._resetPaper();
    this.view._onReplayChange({ reset: true, start: true });
    this._updateMarkers();
    this._tick();
    this._emitState();
  }

  play() {
    if (!this.active) return;
    if (this.atEnd) {
      this.pause();
      return;
    }
    this.playing = true;
    this._schedule();
    this._emitState();
  }

  pause() {
    clearTimeout(this._timer);
    this._timer = null;
    if (this.playing) {
      this.playing = false;
      this._emitState();
    }
  }

  togglePlay() {
    if (this.playing) this.pause();
    else this.play();
  }

  _schedule() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => {
      if (!this.playing) return;
      if (!this.stepForward(1)) {
        this.pause();
        return;
      }
      this._schedule();
    }, this.interval);
  }

  stepForward(n = 1) {
    if (!this.active) return false;
    const c = this.view.candles;
    const i = this.index;
    if (i >= c.length - 1) {
      this._emitState();
      return false;
    }
    const j = Math.min(c.length - 1, i + Math.max(1, n | 0));
    this.cursorT = c[j].t;
    this.view._onReplayChange(j === i + 1 ? { step: 1, prevLen: i + 1 } : { reset: true });
    this._updateMarkers();
    this._tick();
    if (!this.playing) this._emitState();
    else if (this.atEnd) this.pause();
    return true;
  }

  stepBack(n = 1) {
    if (!this.active) return false;
    const c = this.view.candles;
    const i = this.index;
    if (i <= 0) return false;
    this.cursorT = c[Math.max(0, i - Math.max(1, n | 0))].t;
    this.view._onReplayChange({ reset: true });
    this._updateMarkers();
    this._tick();
    this._emitState();
    return true;
  }

  setSpeed(x) {
    const v = Math.max(0.5, Math.min(100, +x || 1));
    this.speed = v;
    if (this.playing) this._schedule();
    this._emitState();
  }

  async jumpTo(t) {
    const ms = toMs(t);
    if (ms == null) throw new Error('Invalid date');
    if (!this.active) return this.start(ms);
    this.pause();
    await this.view.ensureHistory(ms);
    const c = this.view.candles;
    let i = lowerIndex(c, ms);
    if (i < 0) i = 0;
    this.cursorT = c[i].t;
    this.view._onReplayChange({ reset: true });
    this._updateMarkers();
    this._tick();
    this._emitState();
  }

  stop() {
    this.pause();
    const was = this.active || this.selecting;
    this.active = false;
    this.selecting = false;
    this.cursorT = null;
    this.view.setMarkers([]);
    this.view.setPositionLine(null);
    if (was) this.view._onReplayChange({ exit: true });
    this._emitState();
  }

  /** Live candles arrived while replaying: they are appended beyond the cursor, nothing to redraw. */
  onLiveData() {
    if (!this.playing) this._emitState();
  }

  destroy() {
    clearTimeout(this._timer);
    this.removeAllListeners();
  }

  _tick() {
    const c = this.candle;
    if (!c) return;
    this.view.setPositionLine(this._pos.qty ? { price: this._pos.avg, qty: this._pos.qty, pnl: this.pnl.unrealized } : null);
    this.emit('tick', { t: c.t, index: this.index, candle: c, pnl: this.pnl });
  }

  // ---------------------------------------------------------------- paper trading
  _resetPaper() {
    this._pos = { qty: 0, avg: 0, openT: null };
    this.realized = 0;
    this.fills = [];
    this.trades = [];
    this._fillSeq = 0;
  }

  resetPaper() {
    this._resetPaper();
    this._updateMarkers();
    this.view.setPositionLine(null);
    this._emitState();
  }

  get positions() {
    const p = this._pos;
    if (!p.qty) return [];
    const price = this.price;
    const unreal = price != null ? (price - p.avg) * p.qty : 0;
    return [{
      symbol: this.view.symbol,
      side: p.qty > 0 ? 'long' : 'short',
      qty: Math.abs(p.qty),
      avgPrice: p.avg,
      openTime: p.openT,
      price,
      unrealized: unreal,
      unrealizedPct: p.avg ? ((price - p.avg) / p.avg) * 100 * Math.sign(p.qty) : 0,
    }];
  }

  get pnl() {
    const price = this.price;
    const unrealized = this._pos.qty && price != null ? (price - this._pos.avg) * this._pos.qty : 0;
    const wins = this.trades.filter((t) => t.pnl > 0).length;
    return {
      realized: this.realized,
      unrealized,
      total: this.realized + unrealized,
      equity: this.capital + this.realized + unrealized,
      trades: this.trades.length,
      winRate: this.trades.length ? (wins / this.trades.length) * 100 : 0,
    };
  }

  buy(qty = this.defaultQty) {
    return this._fill('buy', qty);
  }

  sell(qty = this.defaultQty) {
    return this._fill('sell', qty);
  }

  closeAll() {
    const q = this._pos.qty;
    if (!q) return null;
    return this._fill(q > 0 ? 'sell' : 'buy', Math.abs(q), true);
  }

  _fill(side, qty, isClose = false) {
    if (!this.active) throw new Error('Paper trading is available during replay');
    const c = this.candle;
    qty = +qty;
    if (!c || !(qty > 0)) return null;
    const price = c.c;
    const signed = side === 'buy' ? qty : -qty;
    const p = this._pos;
    let realized = 0;
    if (!p.qty || Math.sign(p.qty) === Math.sign(signed)) {
      p.avg = (p.avg * Math.abs(p.qty) + price * qty) / (Math.abs(p.qty) + qty);
      if (!p.qty) p.openT = c.t;
      p.qty += signed;
    } else {
      const closing = Math.min(Math.abs(p.qty), qty);
      realized = closing * (price - p.avg) * Math.sign(p.qty);
      this.realized += realized;
      this.trades.push({
        side: p.qty > 0 ? 'long' : 'short',
        qty: closing,
        entry: p.avg,
        exit: price,
        entryTime: p.openT,
        exitTime: c.t,
        pnl: realized,
        pnlPct: p.avg ? ((price - p.avg) / p.avg) * 100 * Math.sign(p.qty) : 0,
      });
      const remaining = qty - closing;
      p.qty += Math.sign(signed) * closing;
      if (Math.abs(p.qty) < 1e-12) {
        p.qty = 0;
        p.avg = 0;
        p.openT = null;
      }
      if (remaining > 0) {
        p.qty = Math.sign(signed) * remaining;
        p.avg = price;
        p.openT = c.t;
      }
    }
    const fill = { id: ++this._fillSeq, side, qty, price, t: c.t, realized, close: isClose };
    this.fills.push(fill);
    this._updateMarkers();
    this._tick();
    this.emit('fill', fill);
    this._emitState();
    return fill;
  }

  _updateMarkers() {
    if (!this.active) {
      this.view.setMarkers([]);
      return;
    }
    const cur = this.cursorT;
    const markers = this.fills
      .filter((f) => f.t <= cur)
      .map((f) => ({
        time: toSec(f.t),
        position: f.side === 'buy' ? 'belowBar' : 'aboveBar',
        shape: f.side === 'buy' ? 'arrowUp' : 'arrowDown',
        color: f.side === 'buy' ? '#2962ff' : '#f23645',
        text: `${f.side === 'buy' ? 'Buy' : 'Sell'} ${f.qty}${f.realized ? ` (${f.realized >= 0 ? '+' : ''}${this.view.formatPrice(f.realized)})` : ''}`,
        id: `fill-${f.id}`,
      }))
      .sort((a, b) => a.time - b.time);
    this.view.setMarkers(markers);
  }
}
