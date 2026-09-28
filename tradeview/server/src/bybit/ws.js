// Bybit v5 public WebSocket client: one connection per category, ping every 20s, auto-reconnect with
// exponential backoff, topic ref-counting and re-subscribe on reconnect. Max 10 args per subscribe message.
import { EventEmitter } from 'node:events';
import WebSocketImpl from 'ws';

export const MAX_ARGS_PER_MESSAGE = 10;
const PING_MS = 20000;

/** Split an array into chunks of at most n items. */
export function chunk(arr, n = MAX_ARGS_PER_MESSAGE) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/**
 * A single category connection (`wss://stream.bybit.com/v5/public/{category}`).
 * Events: 'message' ({ topic, type, ts, data }), 'status' ('connected'|'reconnecting'|'closed'),
 *         'subscribe_error' ({ topics, message }).
 */
export class BybitWs extends EventEmitter {
  /**
   * @param {{ baseUrl?: string, category: string, WebSocket?: any, log?: any, pingMs?: number,
   *   maxBackoffMs?: number, idleCloseMs?: number }} opts
   */
  constructor(opts) {
    super();
    this.category = opts.category;
    this.url = `${(opts.baseUrl || 'wss://stream.bybit.com/v5/public').replace(/\/+$/, '')}/${opts.category}`;
    this.WebSocket = opts.WebSocket || WebSocketImpl;
    this.log = opts.log || console;
    this.pingMs = opts.pingMs ?? PING_MS;
    this.maxBackoffMs = opts.maxBackoffMs ?? 30000;
    // Close the socket after this long with no topics (keeps idle categories disconnected).
    this.idleCloseMs = opts.idleCloseMs ?? 60000;
    /** @type {Map<string, number>} topic -> refcount */
    this.refs = new Map();
    /** topics confirmed/sent on the current socket */
    this.active = new Set();
    this.pending = new Map(); // req_id -> topics
    this.ws = null;
    this.status = 'idle';
    this.attempt = 0;
    this.closedByUser = false;
    this.reqSeq = 0;
    this.timers = { ping: null, reconnect: null, idle: null, pongWatch: null };
    this.lastMessageAt = 0;
    // Backoff resets only after a connection stayed up this long (see delta/ws.js STABLE_MS).
    this.stableMs = opts.stableMs ?? 30000;
    this.openedAt = 0;
  }

  get connected() {
    return this.ws?.readyState === 1;
  }

  /** Topics with refcount > 0. */
  topics() {
    return [...this.refs.keys()];
  }

  /** Increase refcount; sends a subscribe when the topic becomes active. */
  subscribe(topic) {
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

  /** Decrease refcount; sends an unsubscribe when it reaches zero. */
  unsubscribe(topic) {
    const n = (this.refs.get(topic) || 0) - 1;
    if (n > 0) {
      this.refs.set(topic, n);
      return n;
    }
    if (!this.refs.has(topic)) return 0;
    this.refs.delete(topic);
    if (this.connected && this.active.has(topic)) this._send('unsubscribe', [topic]);
    this.active.delete(topic);
    if (this.refs.size === 0 && this.idleCloseMs >= 0) {
      clearTimeout(this.timers.idle);
      this.timers.idle = setTimeout(() => {
        if (this.refs.size === 0) this._teardown('idle');
      }, this.idleCloseMs);
      this.timers.idle.unref?.();
    }
    return 0;
  }

  refCount(topic) {
    return this.refs.get(topic) || 0;
  }

  connect() {
    if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) return;
    if (this.timers.reconnect) return; // reconnect already scheduled
    this.closedByUser = false;
    let ws;
    try {
      ws = new this.WebSocket(this.url);
    } catch (err) {
      this.log.warn?.(`bybit ws ${this.category} connect failed: ${err.message}`);
      this._scheduleReconnect();
      return;
    }
    this.ws = ws;
    const on = (ev, fn) => (ws.on ? ws.on(ev, fn) : ws.addEventListener(ev, fn));
    on('open', () => this._onOpen(ws));
    on('message', (data) => this._onMessage(data?.data ?? data));
    on('error', (err) => {
      this.log.debug?.(`bybit ws ${this.category} error: ${err?.message ?? err}`);
    });
    on('close', () => this._onClose(ws));
  }

  _onOpen(ws) {
    if (ws !== this.ws) return;
    this.openedAt = Date.now();
    this.active.clear();
    this.lastMessageAt = Date.now();
    this._setStatus('connected');
    const topics = this.topics();
    if (topics.length) this._send('subscribe', topics);
    clearInterval(this.timers.ping);
    this.timers.ping = setInterval(() => this._ping(), this.pingMs);
    this.timers.ping.unref?.();
    if (!topics.length && this.idleCloseMs >= 0) {
      this.timers.idle = setTimeout(() => this.refs.size === 0 && this._teardown('idle'), this.idleCloseMs);
      this.timers.idle.unref?.();
    }
  }

  _ping() {
    if (!this.connected) return;
    // If nothing (not even a pong) arrived for 3 ping intervals the connection is dead: force reconnect.
    if (Date.now() - this.lastMessageAt > this.pingMs * 3) {
      this.log.warn?.(`bybit ws ${this.category} stale, reconnecting`);
      try {
        this.ws.terminate ? this.ws.terminate() : this.ws.close();
      } catch {
        /* ignore */
      }
      return;
    }
    this._raw({ op: 'ping', req_id: `p${++this.reqSeq}` });
  }

  _onMessage(raw) {
    this.lastMessageAt = Date.now();
    let msg;
    try {
      msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString());
    } catch {
      return;
    }
    if (msg.topic) {
      this.emit('message', { category: this.category, topic: msg.topic, type: msg.type, ts: msg.ts, data: msg.data });
      return;
    }
    if (msg.op === 'pong' || msg.ret_msg === 'pong' || msg.op === 'ping') return;
    if (msg.op === 'subscribe' || msg.op === 'unsubscribe') {
      const topics = this.pending.get(msg.req_id) || [];
      this.pending.delete(msg.req_id);
      if (msg.success === false) {
        this.log.warn?.(`bybit ws ${this.category} ${msg.op} failed: ${msg.ret_msg} (${topics.join(',')})`);
        if (msg.op === 'subscribe') {
          for (const t of topics) this.active.delete(t);
          this.emit('subscribe_error', { category: this.category, topics, message: msg.ret_msg });
        }
      }
    }
  }

  _onClose(ws) {
    if (ws !== this.ws) return;
    if (this.openedAt && Date.now() - this.openedAt >= this.stableMs) this.attempt = 0;
    this.openedAt = 0;
    clearInterval(this.timers.ping);
    this.timers.ping = null;
    this.ws = null;
    this.active.clear();
    this.pending.clear();
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

  _send(op, topics) {
    for (const args of chunk(topics, MAX_ARGS_PER_MESSAGE)) {
      const req_id = `${op[0]}${++this.reqSeq}`;
      this.pending.set(req_id, args);
      if (op === 'subscribe') args.forEach((t) => this.active.add(t));
      this._raw({ op, args, req_id });
    }
  }

  _raw(obj) {
    try {
      this.ws?.send(JSON.stringify(obj));
    } catch (err) {
      this.log.debug?.(`bybit ws ${this.category} send failed: ${err.message}`);
    }
  }

  _setStatus(s) {
    if (this.status === s) return;
    this.status = s;
    this.emit('status', s);
  }

  _teardown(reason) {
    clearInterval(this.timers.ping);
    clearTimeout(this.timers.reconnect);
    this.timers.ping = this.timers.reconnect = null;
    const ws = this.ws;
    this.ws = null;
    this.active.clear();
    if (ws) {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    }
    this._setStatus(reason === 'idle' ? 'idle' : 'closed');
  }

  /** Close permanently (until connect() is called again). */
  close() {
    this.closedByUser = true;
    clearTimeout(this.timers.idle);
    this._teardown('closed');
  }
}

/**
 * Pool of per-category connections.
 * Events: 'message' (with `category`), 'status' ({ category, status, overall }).
 */
export class BybitStreams extends EventEmitter {
  constructor({ baseUrl, WebSocket, log, pingMs, idleCloseMs } = {}) {
    super();
    this.opts = { baseUrl, WebSocket, log, pingMs, idleCloseMs };
    this.log = log || console;
    /** @type {Map<string, BybitWs>} */
    this.clients = new Map();
  }

  client(category) {
    let c = this.clients.get(category);
    if (!c) {
      c = new BybitWs({ ...this.opts, category });
      c.on('message', (m) => this.emit('message', m));
      c.on('status', (status) => this.emit('status', { category, status, overall: this.status }));
      c.on('subscribe_error', (e) => this.emit('subscribe_error', e));
      this.clients.set(category, c);
    }
    return c;
  }

  subscribe(category, topic) {
    return this.client(category).subscribe(topic);
  }

  unsubscribe(category, topic) {
    return this.clients.get(category)?.unsubscribe(topic) ?? 0;
  }

  /** 'connected' if every client with topics is connected, 'reconnecting' if any is not, 'idle' if none are in use. */
  get status() {
    let used = false;
    for (const c of this.clients.values()) {
      if (c.refs.size === 0) continue;
      used = true;
      if (c.status !== 'connected') return 'reconnecting';
    }
    return used ? 'connected' : 'idle';
  }

  close() {
    for (const c of this.clients.values()) c.close();
  }
}
