// Server-side alert engine (§6). Evaluates active alerts on every live trade tick (and on closed
// klines for bar-close / indicator alerts), gates hits through Laya, persists and broadcasts events.
//
// Lifecycle: start(ctx) / stop(). Routes and the agent call getEngine()?.upsert(alert) / remove(id)
// after persisting so changes are picked up immediately.
import { evaluateCondition, canFire, alertLevel, renderMessage } from './conditions.js';
import { askLaya } from '../laya/gate.js';
import { runPine } from '../pine/runner.js';
import { floorTime } from '../data/timeframes.js';
import { tfToMs } from '../pine/util.js';
import { notifyAlert, getNotifier, start as startNotifier } from '../notify/index.js';

const EXPIRY_CHECK_MS = 15000;
const DRAWING_TTL_MS = 5000;
const INDICATOR_BARS = 500;
const EVERY_TIME_COOLDOWN_MS = 1000;

export class AlertEngine {
  /**
   * @param {object} ctx  server ctx (§11)
   * @param {object} [deps] test seams: { runPine, askLaya, now, notify }
   */
  constructor(ctx, deps = {}) {
    this.ctx = ctx;
    this.log = ctx.log || console;
    this.runPine = deps.runPine || runPine;
    this.askLaya = deps.askLaya || askLaya;
    this.notify = deps.notify || notifyAlert;
    this.ownNotifier = !deps.notify;
    this.now = deps.now || (() => Date.now());
    /** @type {Map<string, object>} id -> alert (active only) */
    this.alerts = new Map();
    /** @type {Map<string, object>} id -> runtime state */
    this.state = new Map();
    /** @type {Set<string>} "channel|symbol|tf" currently acquired from LiveHub */
    this.held = new Set();
    this.drawings = new Map();
    this.pending = new Set();
    this.running = false;
    this._onTrades = (m) => this.onTrades(m);
    this._onKline = (m) => this.onKline(m);
  }

  start() {
    if (this.running) return;
    this.running = true;
    // Make sure Web Push / Telegram are initialised even if index.js did not start notify/ itself.
    if (this.ownNotifier && !getNotifier()) {
      try {
        startNotifier(this.ctx);
      } catch (err) {
        this.log.warn?.({ err: err.message }, 'alert engine: notifier init failed (alerts still broadcast)');
      }
    }
    const live = this.ctx.live;
    live?.on?.('trades', this._onTrades);
    live?.on?.('kline', this._onKline);
    this.reload();
    this.timer = setInterval(() => this.checkExpiry(), EXPIRY_CHECK_MS);
    this.timer.unref?.();
  }

  async stop() {
    if (!this.running) return;
    this.running = false;
    clearInterval(this.timer);
    const live = this.ctx.live;
    live?.off?.('trades', this._onTrades);
    live?.off?.('kline', this._onKline);
    for (const key of this.held) this._release(key);
    this.held.clear();
    await Promise.allSettled([...this.pending]);
  }

  /** (Re)load all active alerts from the repository. */
  reload() {
    let list = [];
    try {
      list = this.ctx.repos?.alerts?.list?.({ status: 'active' }) || [];
    } catch (err) {
      this.log.error?.({ err: err.message }, 'alert engine: could not load alerts');
    }
    this.alerts.clear();
    for (const a of list) if (a?.status === 'active') this.alerts.set(a.id, a);
    for (const id of [...this.state.keys()]) if (!this.alerts.has(id)) this.state.delete(id);
    this.sync();
    this.checkExpiry();
  }

  /** Add or refresh an alert (call after persisting it). Non-active alerts are dropped. */
  upsert(alert) {
    if (!alert?.id) return;
    this.drawings.delete(alert.id);
    if (alert.status === 'active') {
      const prev = this.alerts.get(alert.id);
      this.alerts.set(alert.id, alert);
      const condChanged = prev && JSON.stringify(prev.condition) !== JSON.stringify(alert.condition);
      if (!prev || condChanged || prev.trigger !== alert.trigger) this.state.delete(alert.id);
    } else {
      this.alerts.delete(alert.id);
      this.state.delete(alert.id);
    }
    this.sync();
  }

  remove(id) {
    this.alerts.delete(id);
    this.state.delete(id);
    this.drawings.delete(id);
    this.sync();
  }

  list() {
    return [...this.alerts.values()];
  }

  // ---- subscriptions -------------------------------------------------------------------------

  _wanted() {
    const want = new Set();
    for (const a of this.alerts.values()) {
      const byClose = a.condition?.kind === 'indicator' || a.trigger === 'once_per_bar_close';
      if (byClose) want.add(`kline|${a.symbol}|${a.tf}`);
      else want.add(`trades|${a.symbol}|`);
    }
    return want;
  }

  sync() {
    if (!this.running) return;
    const want = this._wanted();
    for (const key of want) if (!this.held.has(key)) this._acquire(key);
    for (const key of [...this.held]) if (!want.has(key)) this._release(key);
  }

  _acquire(key) {
    const [channel, symbol, tf] = key.split('|');
    try {
      this.ctx.live?.acquire?.(channel, symbol, tf || undefined);
      this.held.add(key);
    } catch (err) {
      this.log.warn?.({ err: err.message, key }, 'alert engine: acquire failed');
    }
  }

  _release(key) {
    const [channel, symbol, tf] = key.split('|');
    try {
      this.ctx.live?.release?.(channel, symbol, tf || undefined);
    } catch (err) {
      this.log.warn?.({ err: err.message, key }, 'alert engine: release failed');
    }
    this.held.delete(key);
  }

  _st(id) {
    let s = this.state.get(id);
    if (!s) {
      s = { prev: undefined, prevT: undefined, prevClose: undefined, lastFiredAt: 0, lastFiredBar: undefined, rejectedBar: undefined, busy: false };
      this.state.set(id, s);
    }
    return s;
  }

  _barTime(t, tf) {
    try {
      return floorTime(t, tf);
    } catch {
      const ms = tfToMs(tf);
      return Math.floor(t / ms) * ms;
    }
  }

  _drawing(alert) {
    const c = alert.condition;
    if (c.drawing && !c.drawingId) return c.drawing;
    const hit = this.drawings.get(alert.id);
    const now = this.now();
    if (hit && now - hit.at < DRAWING_TTL_MS) return hit.d;
    let d = null;
    try {
      d = this.ctx.repos?.drawings?.get?.(c.drawingId) || c.drawing || null;
    } catch {
      d = c.drawing || null;
    }
    this.drawings.set(alert.id, { d, at: now });
    return d;
  }

  // ---- evaluation ----------------------------------------------------------------------------

  onTrades({ symbol, trades } = {}) {
    if (!this.running || !Array.isArray(trades) || !trades.length) return;
    const now = this.now();
    for (const alert of this.alerts.values()) {
      if (alert.symbol !== symbol) continue;
      if (alert.condition.kind === 'indicator' || alert.trigger === 'once_per_bar_close') continue;
      if (this._expired(alert, now)) continue;
      const s = this._st(alert.id);
      const drawing = alert.condition.kind === 'drawing' ? this._drawing(alert) : undefined;
      if (alert.condition.kind === 'drawing' && !drawing) continue;
      for (const tr of trades) {
        const cur = Number(tr.p ?? tr.price);
        const t = Number(tr.t ?? tr.time ?? now);
        if (!Number.isFinite(cur)) continue;
        if (s.prev === undefined) {
          // Seed from the hub's last price so the first tick after (re)start can already cross.
          const lp = this.ctx.live?.lastPrice?.(symbol);
          if (Number.isFinite(lp) && lp !== cur) {
            s.prev = lp;
            s.prevT = t;
          }
        }
        const hit = evaluateCondition(alert.condition, { prev: s.prev, cur, prevT: s.prevT, t, drawing });
        s.prev = cur;
        s.prevT = t;
        if (hit) this._maybeFire(alert, s, { price: cur, t, drawing });
        if (!this.alerts.has(alert.id)) break;
      }
    }
  }

  onKline({ symbol, tf, candle, closed } = {}) {
    if (!this.running || !closed || !candle) return;
    const now = this.now();
    for (const alert of this.alerts.values()) {
      if (alert.symbol !== symbol || alert.tf !== tf) continue;
      if (this._expired(alert, now)) continue;
      const s = this._st(alert.id);
      if (alert.condition.kind === 'indicator') {
        if (!s.busy) this._track(this._evalIndicator(alert, s, candle));
        continue;
      }
      if (alert.trigger !== 'once_per_bar_close') continue;
      const drawing = alert.condition.kind === 'drawing' ? this._drawing(alert) : undefined;
      if (alert.condition.kind === 'drawing' && !drawing) continue;
      const prev = s.prevClose ?? candle.o;
      const closeT = candle.t + tfToMs(tf) - 1;
      const hit = evaluateCondition(alert.condition, { prev, cur: candle.c, prevT: s.prevCloseT ?? candle.t, t: closeT, drawing });
      s.prevClose = candle.c;
      s.prevCloseT = closeT;
      if (hit) this._maybeFire(alert, s, { price: candle.c, t: closeT, bar: candle.t, drawing });
    }
  }

  async _evalIndicator(alert, s, candle) {
    s.busy = true;
    try {
      let candles = [];
      try {
        candles = (await this.ctx.market?.getCandles?.({ symbol: alert.symbol, tf: alert.tf, limit: INDICATOR_BARS })) || [];
      } catch (err) {
        this.log.warn?.({ err: err.message }, 'alert engine: candles for indicator alert failed');
      }
      candles = candles.filter((k) => k.t < candle.t);
      candles.push({ t: candle.t, o: candle.o, h: candle.h, l: candle.l, c: candle.c, v: candle.v });
      if (candles.length < 2) return;
      const res = await this.runPine({ candles, source: alert.condition.source, inputs: alert.condition.inputs, tfMs: tfToMs(alert.tf) });
      const lastT = candle.t;
      const pineAlert = (res.alerts || []).find((a) => a.t === lastT);
      const sig = res.plots?.signal?.data?.find((p) => p.t === lastT)?.value;
      const hit = !!pineAlert || sig === true || (typeof sig === 'number' && sig > 0);
      s.lastError = undefined;
      if (hit) {
        s.busy = false;
        await this._maybeFire(alert, s, {
          price: candle.c,
          t: lastT + tfToMs(alert.tf) - 1,
          bar: candle.t,
          detail: pineAlert ? pineAlert.message || pineAlert.title : 'signal',
        });
      }
    } catch (err) {
      s.lastError = err.message;
      this.log.warn?.({ err: err.message, alert: alert.id }, 'alert engine: indicator evaluation failed');
    } finally {
      s.busy = false;
    }
  }

  _track(p) {
    this.pending.add(p);
    p.finally(() => this.pending.delete(p));
    return p;
  }

  _maybeFire(alert, s, hit) {
    if (s.busy) return;
    const bar = hit.bar ?? this._barTime(hit.t, alert.tf);
    if (s.rejectedBar !== undefined && s.rejectedBar === bar) return; // Laya said no on this bar already
    if (!canFire(alert.trigger, s, bar, this.now(), EVERY_TIME_COOLDOWN_MS)) return;
    return this._track(this._fire(alert, s, { ...hit, bar }));
  }

  async _fire(alert, s, { price, t, bar, detail, drawing }) {
    s.busy = true;
    try {
      let laya;
      if (alert.laya?.enabled) {
        const level = alertLevel(alert, t, drawing);
        const alertForState = alert.condition.kind === 'drawing' ? { ...alert, condition: { ...alert.condition, level } } : alert;
        let res;
        try {
          res = await this.askLaya(this.ctx, {
            symbol: alert.symbol, tf: alert.tf, question: alert.laya.question,
            threshold: alert.laya.threshold ?? 0.6, alert: alertForState, price, t,
          });
        } catch (err) {
          res = { skipped: true, reason: err?.message || String(err) };
        }
        if (res?.skipped || !res) {
          laya = { skipped: true, reason: res?.reason || 'laya unavailable' };
        } else {
          laya = { p: res.p, passed: res.passed, threshold: res.threshold, direction: res.direction, confidence: res.confidence, answers: res.answers };
          if (!res.passed) {
            s.rejectedBar = bar;
            const cur = this.alerts.get(alert.id);
            if (cur) {
              const updated = { ...cur, lastCheck: { t, price, laya } };
              this._save(updated, false);
              this._broadcast({ type: 'alert_update', alert: updated });
            }
            return;
          }
        }
      }
      if (!this.alerts.has(alert.id)) return; // deleted / paused while waiting for Laya
      const now = this.now();
      s.lastFiredAt = now;
      s.lastFiredBar = bar;
      const vars = { price, symbol: alert.symbol, name: alert.name, tf: alert.tf, time: new Date(t).toISOString(), detail: detail ?? '' };
      const event = {
        alertId: alert.id,
        name: alert.name,
        symbol: alert.symbol,
        tf: alert.tf,
        t,
        price,
        message: renderMessage(alert.message || alert.name, vars),
        condition: alert.condition.kind === 'indicator' ? { kind: 'indicator' } : alert.condition,
        trigger: alert.trigger,
        sound: alert.sound,
        createdBy: alert.createdBy,
        ...(detail ? { detail } : {}),
        ...(laya ? { laya } : {}),
      };
      let stored = event;
      try {
        stored = this.ctx.repos?.alertEvents?.add?.(event) || event;
      } catch (err) {
        this.log.error?.({ err: err.message }, 'alert engine: could not persist event (broadcasting anyway)');
      }
      this._broadcast({ type: 'alert', event: stored });
      this._notify(stored);
      const cur = this.alerts.get(alert.id) || alert;
      const updated = {
        ...cur,
        lastTriggered: t,
        lastPrice: price,
        triggerCount: (cur.triggerCount || 0) + 1,
        ...(laya ? { lastCheck: { t, price, laya } } : {}),
        ...(cur.trigger === 'once' ? { status: 'triggered' } : {}),
      };
      this._save(updated, true);
      this._broadcast({ type: 'alert_update', alert: updated });
      this.log.info?.({ alert: alert.id, price, laya: laya ? (laya.skipped ? 'skipped' : laya.p) : 'off' }, 'alert fired');
    } finally {
      s.busy = false;
    }
  }

  _save(alert, refresh) {
    try {
      this.ctx.repos?.alerts?.save?.(alert);
    } catch (err) {
      this.log.error?.({ err: err.message }, 'alert engine: could not save alert');
    }
    if (alert.status === 'active') this.alerts.set(alert.id, alert);
    else if (refresh) {
      this.alerts.delete(alert.id);
      this.sync();
    }
  }

  _expired(alert, now) {
    if (!alert.expires || now < alert.expires) return false;
    const updated = { ...alert, status: 'expired' };
    this.alerts.delete(alert.id);
    this.state.delete(alert.id);
    this._save(updated, false);
    this._broadcast({ type: 'alert_update', alert: updated });
    this.sync();
    return true;
  }

  checkExpiry() {
    const now = this.now();
    for (const a of [...this.alerts.values()]) this._expired(a, now);
  }

  /** Web Push / Telegram: fire-and-forget, a failure never blocks or cancels the alert. */
  _notify(event) {
    try {
      const p = Promise.resolve(this.notify(event)).catch((err) => this.log.warn?.({ err: err?.message }, 'alert engine: notification failed'));
      this._track(p);
    } catch (err) {
      this.log.warn?.({ err: err?.message }, 'alert engine: notification failed');
    }
  }

  _broadcast(msg) {
    try {
      this.ctx.broadcast?.(msg);
    } catch (err) {
      this.log.warn?.({ err: err.message }, 'alert engine: broadcast failed');
    }
  }

  /** Wait for in-flight fires (tests). */
  async idle() {
    while (this.pending.size) await Promise.allSettled([...this.pending]);
  }
}

let engine = null;

/** Start the singleton engine (§11). */
export function start(ctx) {
  if (engine) return engine;
  engine = new AlertEngine(ctx);
  engine.start();
  return engine;
}

export async function stop() {
  const e = engine;
  engine = null;
  if (e) await e.stop();
}

/** The running engine, or null (routes/agent tolerate null). */
export function getEngine() {
  return engine;
}
