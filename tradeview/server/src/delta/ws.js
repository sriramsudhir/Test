// Delta Exchange public WebSocket client (ARCHITECTURE §13.1).
// Exposes the same interface as bybit/ws.js BybitWs (subscribe/unsubscribe by Bybit-style topic, ref-counted,
// 'message' / 'status' events) and NORMALISES Delta payloads into Bybit-shaped messages so LiveHub handles both:
//   all_trades           -> { topic: 'publicTrade.SYM', data: [{ T, S, v, p }] }
//   candlestick_{res}    -> { topic: 'kline.{bybitCode}.SYM', data: [{ start, open, high, low, close, volume, confirm, interval }] }
// Delta candlesticks carry no "closed" flag: a bar is confirmed when a newer bar starts, or when its period plus a
// grace delay has elapsed. Heartbeat: {"type":"enable_heartbeat"}; reconnect if nothing arrives for 35s.
import { EventEmitter } from 'node:events';
import WebSocketImpl from 'ws';
import { tfToBybit, addBars } from '../data/timeframes.js';
import { topicToChannel, toMs } from './timeframes.js';
import { deltaSide } from './rest.js';
import { chunk } from '../bybit/ws.js';

const SILENCE_MS = 35000;
const CLOSE_GRACE_MS = 3000;
const MAX_SYMBOLS_PER_CHANNEL_MSG = 50;
// The reconnect backoff resets only after a connection stayed up this long. Resetting on 'open' alone lets a peer
// that accepts and immediately drops (rate limit, bad subscription, proxy) cause a reconnect every second forever.
export const STABLE_MS = 30000;

export class DeltaWs extends EventEmitter {
  /**
   * @param {{ url?: string, WebSocket?: any, log?: any, silenceMs?: number, maxBackoffMs?: number,
   *   idleCloseMs?: number, checkMs?: number, now?: () => number }} [opts]
   */
  constructor(opts = {}) {
    super();
    this.category = 'delta';
    this.url = (opts.url || 'wss://socket.india.delta.exchange').replace(/\/+$/, '');
    this.WebSocket = opts.WebSocket || WebSocketImpl;
    this.log = opts.log || console;
    this.silenceMs = opts.silenceMs ?? SILENCE_MS;
    this.maxBackoffMs = opts.maxBackoffMs ?? 30000;
    this.idleCloseMs = opts.idleCloseMs ?? 60000;
    this.checkMs = opts.checkMs ?? 1000;
    this.stableMs = opts.stableMs ?? STABLE_MS;
    this.openedAt = 0;
    this.now = opts.now || (() => Date.now());
    /** @type {Map<string, number>} Bybit-style topic -> refcount */
    this.refs = new Map();
    this.ws = null;
    this.status = 'idle';
    this.attempt = 0;
    this.closedByUser = false;
    this.lastMessageAt = 0;
    /** @type {Map<string, {start:number, tf:string, symbol:string, data:any, confirmed:boolean}>} */
    this.candles = new Map();
    this.timers = { check: null, reconnect: null, idle: null };
  }

  get connected() {
    return this.ws?.readyState === 1;
  }

  topics() {
    return [...this.refs.keys()];
  }

  refCount(topic) {
    return this.refs.get(topic) || 0;
  }

  subscribe(topic) {
    if (!topicToChannel(topic)) {
      this.log.warn?.(`delta ws: unsupported topic ${topic}`);
      return 0;
    }
    const n = (this.refs.get(topic) || 0) + 1;
    this.refs.set(topic, n);
    if (n === 1) {
      clearTimeout(this.timers.idle);
      this.timers.idle = null;
      if (this.connected) this._send('subscribe', [topic]);
      else this.connect();
    }
    return n;
  }

  unsubscribe(topic) {
    const cur = this.refs.get(topic) || 0;
    if (cur > 1) {
      this.refs.set(topic, cur - 1);
      return cur - 1;
    }
    if (!cur) return 0;
    this.refs.delete(topic);
    if (this.connected) this._send('unsubscribe', [topic]);
    const ch = topicToChannel(topic);
    if (ch?.tf) this.candles.delete(`${ch.tf}|${ch.symbol}`);
    if (this.refs.size === 0 && this.idleCloseMs >= 0) {
      clearTimeout(this.timers.idle);
      this.timers.idle = setTimeout(() => this.refs.size === 0 && this._teardown('idle'), this.idleCloseMs);
      this.timers.idle.unref?.();
    }
    return 0;
  }

  connect() {
    if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) return;
    if (this.timers.reconnect) return;
    this.closedByUser = false;
    let ws;
    try {
      ws = new this.WebSocket(this.url);
    } catch (err) {
      this.log.warn?.(`delta ws connect failed: ${err.message}`);
      this._scheduleReconnect();
      return;
    }
    this.ws = ws;
    const on = (ev, fn) => (ws.on ? ws.on(ev, fn) : ws.addEventListener(ev, fn));
    on('open', () => this._onOpen(ws));
    on('message', (data) => this._onMessage(data?.data ?? data));
    on('error', (err) => this.log.debug?.(`delta ws error: ${err?.message ?? err}`));
    on('close', () => this._onClose(ws));
  }

  _onOpen(ws) {
    if (ws !== this.ws) return;
    this.openedAt = this.now();
    this.lastMessageAt = this.now();
    this._setStatus('connected');
    this._raw({ type: 'enable_heartbeat' });
    const topics = this.topics();
    if (topics.length) this._send('subscribe', topics);
    clearInterval(this.timers.check);
    this.timers.check = setInterval(() => this._check(), this.checkMs);
    this.timers.check.unref?.();
  }

  /** Watchdog: reconnect on silence; confirm candles whose period has ended. */
  _check() {
    const now = this.now();
    if (this.connected && now - this.lastMessageAt > this.silenceMs) {
      this.log.warn?.('delta ws: no message for 35s, reconnecting');
      try {
        this.ws.terminate ? this.ws.terminate() : this.ws.close();
      } catch {
        /* ignore */
      }
      return;
    }
    for (const c of this.candles.values()) {
      if (!c.confirmed && now >= addBars(c.start, c.tf, 1) + CLOSE_GRACE_MS) this._confirm(c);
    }
  }

  _confirm(c) {
    c.confirmed = true;
    this._emitKline(c, true);
  }

  _emitKline(c, confirm) {
    const code = tfToBybit(c.tf);
    const d = c.data;
    this.emit('message', {
      category: 'delta',
      topic: `kline.${code}.${c.symbol}`,
      type: 'snapshot',
      ts: this.now(),
      data: [{
        start: c.start, end: addBars(c.start, c.tf, 1) - 1, interval: code,
        open: d.open, high: d.high, low: d.low, close: d.close, volume: d.volume ?? 0, turnover: '',
        confirm, timestamp: this.now(),
      }],
    });
  }

  _onMessage(raw) {
    this.lastMessageAt = this.now();
    let msg;
    try {
      msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString());
    } catch {
      return;
    }
    const type = String(msg?.type || '');
    if (type === 'all_trades') {
      const side = deltaSide(msg);
      const T = toMs(msg.timestamp ?? msg.created_at);
      const p = Number(msg.price);
      const v = Number(msg.size);
      if (!side || !Number.isFinite(T) || !Number.isFinite(p) || !Number.isFinite(v) || !msg.symbol) return;
      this.emit('message', {
        category: 'delta', topic: `publicTrade.${msg.symbol}`, type: 'snapshot', ts: T,
        data: [{ T, s: msg.symbol, S: side, v: String(v), p: String(p) }],
      });
      return;
    }
    if (type.startsWith('candlestick_')) {
      const topicInfo = topicToChannel(`kline.${resToCode(type.slice('candlestick_'.length))}.${msg.symbol}`);
      if (!topicInfo?.tf || !msg.symbol) return;
      const start = toMs(msg.candle_start_time ?? msg.start ?? msg.time);
      if (!Number.isFinite(start)) return;
      const key = `${topicInfo.tf}|${msg.symbol}`;
      const prev = this.candles.get(key);
      if (prev && start < prev.start) return; // stale update
      if (prev && start === prev.start && prev.confirmed) return; // late update of a bar already confirmed
      if (prev && start > prev.start && !prev.confirmed) this._confirm(prev);
      const cur = { start, tf: topicInfo.tf, symbol: msg.symbol, data: msg, confirmed: false };
      this.candles.set(key, cur);
      this._emitKline(cur, false);
      return;
    }
    if (type === 'error') {
      this.log.warn?.(`delta ws error message: ${JSON.stringify(msg).slice(0, 300)}`);
      this.emit('subscribe_error', { category: 'delta', message: msg.message ?? msg.error ?? 'error' });
    }
    // heartbeat, subscriptions acks, snapshots (all_trades_snapshot is ignored to avoid double counting).
  }

  _onClose(ws) {
    if (ws !== this.ws) return;
    if (this.openedAt && this.now() - this.openedAt >= this.stableMs) this.attempt = 0;
    this.openedAt = 0;
    clearInterval(this.timers.check);
    this.timers.check = null;
    this.ws = null;
    if (this.closedByUser) {
      this._setStatus('closed');
      return;
    }
    if (this.refs.size === 0) {
      this._setStatus('idle');
      return;
    }
    this._scheduleReconnect();
  }

  _scheduleReconnect() {
    if (this.closedByUser || this.timers.reconnect) return;
    this._setStatus('reconnecting');
    const delay = Math.min(this.maxBackoffMs, 1000 * 2 ** this.attempt) * (0.8 + Math.random() * 0.4);
    this.attempt++;
    this.timers.reconnect = setTimeout(() => {
      this.timers.reconnect = null;
      if (!this.closedByUser && this.refs.size > 0) this.connect();
    }, delay);
    this.timers.reconnect.unref?.();
  }

  /** Group topics into `{ name, symbols }` channel entries and send them. */
  _send(type, topics) {
    const byName = new Map();
    for (const t of topics) {
      const ch = topicToChannel(t);
      if (!ch) continue;
      if (!byName.has(ch.name)) byName.set(ch.name, []);
      byName.get(ch.name).push(ch.symbol);
    }
    for (const [name, symbols] of byName) {
      for (const part of chunk(symbols, MAX_SYMBOLS_PER_CHANNEL_MSG)) {
        this._raw({ type, payload: { channels: [{ name, symbols: part }] } });
      }
    }
  }

  _raw(obj) {
    try {
      this.ws?.send(JSON.stringify(obj));
    } catch (err) {
      this.log.debug?.(`delta ws send failed: ${err.message}`);
    }
  }

  _setStatus(s) {
    if (this.status === s) return;
    this.status = s;
    this.emit('status', s);
  }

  _teardown(reason) {
    clearInterval(this.timers.check);
    clearTimeout(this.timers.reconnect);
    this.timers.check = this.timers.reconnect = null;
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    }
    this._setStatus(reason === 'idle' ? 'idle' : 'closed');
  }

  close() {
    this.closedByUser = true;
    clearTimeout(this.timers.idle);
    this._teardown('closed');
  }
}

function resToCode(res) {
  const map = { '1m': '1', '3m': '3', '5m': '5', '15m': '15', '30m': '30', '1h': '60', '2h': '120', '4h': '240', '6h': '360', '1d': 'D' };
  return map[String(res).toLowerCase()] ?? res;
}
