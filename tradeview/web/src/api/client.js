// REST + WebSocket client (ARCHITECTURE.md §4, §5, §12).
// - api.get/post/put/patch/delete: JSON over fetch, throws ApiError on non-2xx.
// - api.stream: POST + server-sent events parsed from a fetch ReadableStream.
// - socket: one shared WebSocket, auto-reconnect with backoff, ref-counted subscriptions
//   that are re-sent after every reconnect, connection status events.

export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

function buildUrl(path, params) {
  let url = path;
  if (!/^https?:\/\//.test(url) && !url.startsWith('/api')) {
    url = '/api' + (url.startsWith('/') ? url : '/' + url);
  }
  if (params && typeof params === 'object') {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === '') continue;
      qs.append(k, String(v));
    }
    const s = qs.toString();
    if (s) url += (url.includes('?') ? '&' : '?') + s;
  }
  return url;
}

async function request(method, path, { params, body, signal, headers } = {}) {
  const init = { method, headers: { Accept: 'application/json', ...(headers || {}) }, signal };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(buildUrl(path, params), init);
  } catch (err) {
    if (err && err.name === 'AbortError') throw err;
    throw new ApiError(`Network error: ${err && err.message ? err.message : err}`, 0, null);
  }
  const text = await res.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  if (!res.ok) {
    const msg = (data && typeof data === 'object' && (data.error || data.message)) || res.statusText || `HTTP ${res.status}`;
    throw new ApiError(typeof msg === 'string' ? msg : JSON.stringify(msg), res.status, data);
  }
  return data;
}

/**
 * Parse an SSE byte stream. Calls onEvent(obj) for every `data:` event.
 * Data that is valid JSON is passed as the parsed object (an `event:` name fills in `type` when missing);
 * anything else is passed as { type: eventName || 'message', data: raw }.
 */
async function readSSE(body, onEvent) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const flush = (block) => {
    let eventName = '';
    const dataLines = [];
    for (const rawLine of block.split(/\r?\n/)) {
      if (!rawLine || rawLine.startsWith(':')) continue;
      const idx = rawLine.indexOf(':');
      const field = idx === -1 ? rawLine : rawLine.slice(0, idx);
      let value = idx === -1 ? '' : rawLine.slice(idx + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'data') dataLines.push(value);
      else if (field === 'event') eventName = value;
    }
    if (!dataLines.length) return;
    const raw = dataLines.join('\n');
    if (raw === '[DONE]') { onEvent({ type: 'done' }); return; }
    let evt;
    try {
      evt = JSON.parse(raw);
      if (evt && typeof evt === 'object' && !Array.isArray(evt)) {
        if (!evt.type && eventName) evt.type = eventName;
      } else {
        evt = { type: eventName || 'message', data: evt };
      }
    } catch {
      evt = { type: eventName || 'message', data: raw };
    }
    onEvent(evt);
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let m;
    while ((m = /\r?\n\r?\n/.exec(buf))) {
      const block = buf.slice(0, m.index);
      buf = buf.slice(m.index + m[0].length);
      flush(block);
    }
  }
  buf += decoder.decode();
  if (buf.trim()) flush(buf);
}

export const api = {
  get: (path, params, opts = {}) => request('GET', path, { ...opts, params }),
  post: (path, body, opts = {}) => request('POST', path, { ...opts, body }),
  put: (path, body, opts = {}) => request('PUT', path, { ...opts, body }),
  patch: (path, body, opts = {}) => request('PATCH', path, { ...opts, body }),
  delete: (path, params, opts = {}) => request('DELETE', path, { ...opts, params }),
  /**
   * POST `body` and stream server-sent events to onEvent(evt).
   * @param {string} path
   * @param {object} body
   * @param {(evt: object) => void} onEvent
   * @param {{ signal?: AbortSignal }} [opts]
   * @returns {Promise<void>} resolves when the stream ends; rejects with AbortError when aborted.
   */
  async stream(path, body, onEvent, opts = {}) {
    let res;
    try {
      res = await fetch(buildUrl(path), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify(body ?? {}),
        signal: opts.signal,
      });
    } catch (err) {
      if (err && err.name === 'AbortError') throw err;
      throw new ApiError(`Network error: ${err && err.message ? err.message : err}`, 0, null);
    }
    if (!res.ok) {
      let data = null;
      try { data = await res.json(); } catch { /* not json */ }
      throw new ApiError((data && (data.error || data.message)) || `HTTP ${res.status}`, res.status, data);
    }
    const ctype = res.headers.get('content-type') || '';
    if (!res.body || ctype.includes('application/json')) {
      // Non-streaming fallback: a JSON array of events or a single event.
      const data = await res.json().catch(() => null);
      const list = Array.isArray(data) ? data : data ? [data] : [];
      for (const evt of list) onEvent(evt);
      return;
    }
    await readSSE(res.body, onEvent);
  },
};

// ---------------------------------------------------------------------------------------------
// Socket
// ---------------------------------------------------------------------------------------------

class Emitter {
  constructor() { this._handlers = new Map(); }
  on(type, fn) {
    if (!this._handlers.has(type)) this._handlers.set(type, new Set());
    this._handlers.get(type).add(fn);
    return () => this.off(type, fn);
  }
  once(type, fn) {
    const off = this.on(type, (...a) => { off(); fn(...a); });
    return off;
  }
  off(type, fn) {
    const set = this._handlers.get(type);
    if (set) set.delete(fn);
  }
  emit(type, ...args) {
    const set = this._handlers.get(type);
    if (!set) return;
    for (const fn of [...set]) {
      try { fn(...args); } catch (err) { console.error(`[socket] handler for "${type}" failed`, err); }
    }
  }
}

const subKey = (channel, symbol, tf) => `${channel}|${symbol || ''}|${tf || ''}`;

class Socket extends Emitter {
  constructor() {
    super();
    /** @type {WebSocket|null} */
    this.ws = null;
    /** 'idle' | 'connecting' | 'open' | 'reconnecting' */
    this.state = 'idle';
    this.attempt = 0;
    this.bybit = 'unknown';
    this.lastMessageAt = 0;
    this._subs = new Map(); // key -> { channel, symbol, tf, count }
    this._queue = [];
    this._reconnectTimer = null;
    this._pingTimer = null;
    this._manualClose = false;
    this.url = null;
  }

  _defaultUrl() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}/ws`;
  }

  _setState(state) {
    if (this.state === state) return;
    this.state = state;
    this.emit('connection', { state, attempt: this.attempt });
  }

  get connected() { return this.state === 'open'; }

  connect(url) {
    if (url) this.url = url;
    if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) return this;
    if (typeof WebSocket === 'undefined') return this;
    this._manualClose = false;
    clearTimeout(this._reconnectTimer);
    this._setState(this.attempt > 0 ? 'reconnecting' : 'connecting');
    let ws;
    try {
      ws = new WebSocket(this.url || this._defaultUrl());
    } catch (err) {
      console.warn('[socket] connect failed', err);
      this._scheduleReconnect();
      return this;
    }
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.attempt = 0;
      this._setState('open');
      for (const s of this._subs.values()) {
        this._rawSend({ type: 'subscribe', channel: s.channel, symbol: s.symbol, ...(s.tf ? { tf: s.tf } : {}) });
      }
      const queued = this._queue.splice(0);
      for (const msg of queued) this._rawSend(msg);
      clearInterval(this._pingTimer);
      this._pingTimer = setInterval(() => this._rawSend({ type: 'ping' }), 25000);
    };
    ws.onmessage = (e) => {
      if (this.ws !== ws) return;
      this.lastMessageAt = Date.now();
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'status' && msg.bybit) this.bybit = msg.bybit;
      this.emit(msg.type, msg);
      this.emit('*', msg);
    };
    ws.onerror = () => { /* onclose follows */ };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      clearInterval(this._pingTimer);
      this.ws = null;
      if (this._manualClose) { this._setState('idle'); return; }
      this._scheduleReconnect();
    };
    return this;
  }

  _scheduleReconnect() {
    this.attempt += 1;
    this._setState('reconnecting');
    const base = Math.min(15000, 500 * 2 ** Math.min(this.attempt - 1, 5));
    const delay = base / 2 + Math.random() * base / 2;
    clearTimeout(this._reconnectTimer);
    this._reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  /** Force an immediate reconnect attempt (e.g. user clicked the status badge). */
  reconnect() {
    clearTimeout(this._reconnectTimer);
    if (this.ws) {
      const old = this.ws;
      this.ws = null;
      try { old.close(); } catch { /* ignore */ }
    }
    this.connect();
  }

  close() {
    this._manualClose = true;
    clearTimeout(this._reconnectTimer);
    clearInterval(this._pingTimer);
    if (this.ws) try { this.ws.close(); } catch { /* ignore */ }
  }

  _rawSend(msg) {
    if (this.ws && this.ws.readyState === 1) {
      try { this.ws.send(JSON.stringify(msg)); return true; } catch { return false; }
    }
    return false;
  }

  /** Send a message now, or queue it until the socket is open (subscriptions are handled separately). */
  send(msg) {
    if (this.state === 'idle') this.connect();
    if (this._rawSend(msg)) return true;
    if (msg && (msg.type === 'ping' || msg.type === 'subscribe' || msg.type === 'unsubscribe')) return false;
    this._queue.push(msg);
    if (this._queue.length > 200) this._queue.shift();
    return false;
  }

  /** Ref-counted subscribe. Returns a function that unsubscribes once. */
  subscribe(channel, symbol, tf) {
    if (this.state === 'idle') this.connect();
    const key = subKey(channel, symbol, tf);
    let s = this._subs.get(key);
    if (!s) {
      s = { channel, symbol, tf, count: 0 };
      this._subs.set(key, s);
    }
    s.count += 1;
    if (s.count === 1) this._rawSend({ type: 'subscribe', channel, symbol, ...(tf ? { tf } : {}) });
    let done = false;
    return () => {
      if (done) return;
      done = true;
      this.unsubscribe(channel, symbol, tf);
    };
  }

  unsubscribe(channel, symbol, tf) {
    const key = subKey(channel, symbol, tf);
    const s = this._subs.get(key);
    if (!s) return;
    s.count -= 1;
    if (s.count <= 0) {
      this._subs.delete(key);
      this._rawSend({ type: 'unsubscribe', channel, symbol, ...(tf ? { tf } : {}) });
    }
  }

  /** Current subscriptions (for debugging / status UI). */
  subscriptions() {
    return [...this._subs.values()].map((s) => ({ ...s }));
  }
}

export const socket = new Socket();

if (typeof window !== 'undefined') {
  // Connect lazily on the next tick so importers can attach handlers first.
  queueMicrotask(() => { if (socket.state === 'idle') socket.connect(); });
  window.addEventListener('online', () => { if (!socket.connected) socket.reconnect(); });
}

export default { api, socket };
