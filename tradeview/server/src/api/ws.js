// Browser WebSocket gateway at /ws (ARCHITECTURE §5). Per-socket subscriptions map to LiveHub.acquire/release;
// everything is released when the socket closes. Also provides ctx.broadcast.
import { parseSymbolKey } from '../bybit/markets.js';
import { normalizeTf } from '../data/timeframes.js';

const HEARTBEAT_MS = 30000;
const MAX_BUFFERED = 8 * 1024 * 1024; // drop live updates for sockets that cannot keep up
const MAX_SUBS_PER_SOCKET = 200;
const CHANNELS = new Set(['kline', 'footprint', 'trades']);

/**
 * Registry of connected browser sockets with a broadcast helper. index.js creates one and sets
 * `ctx.broadcast = hub.broadcast` before any module is registered.
 */
export function createSocketHub({ log } = {}) {
  /** @type {Set<{ socket: any, subs: Set<string>, alive: boolean }>} */
  const clients = new Set();
  /** @type {Map<string, Set<any>>} subscription key -> clients */
  const index = new Map();

  function send(client, msg) {
    const s = client.socket;
    if (s.readyState !== 1) return false;
    if (s.bufferedAmount > MAX_BUFFERED) return false;
    try {
      s.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
      return true;
    } catch (err) {
      log?.debug?.(`ws send failed: ${err.message}`);
      return false;
    }
  }

  /** Send a JSON message to every connected browser socket. */
  function broadcast(msg) {
    const data = JSON.stringify(msg);
    let n = 0;
    for (const c of clients) if (send(c, data)) n++;
    return n;
  }

  /** Send to sockets subscribed to a key. */
  function publish(key, msg) {
    const set = index.get(key);
    if (!set?.size) return 0;
    const data = JSON.stringify(msg);
    let n = 0;
    for (const c of set) if (send(c, data)) n++;
    return n;
  }

  return {
    clients,
    index,
    send,
    broadcast,
    publish,
    get size() {
      return clients.size;
    },
  };
}

export function subKey(channel, symbol, tf) {
  return channel === 'trades' ? `trades|${symbol}` : `${channel}|${symbol}|${tf}`;
}

/** Validate and normalise a subscribe/unsubscribe message. Throws with a readable message. */
export function parseSubscription(msg) {
  const channel = msg.channel;
  if (!CHANNELS.has(channel)) throw new Error(`channel must be one of ${[...CHANNELS].join(', ')}`);
  const { key } = parseSymbolKey(msg.symbol);
  if (channel === 'trades') return { channel, symbol: key, tf: undefined };
  const tf = normalizeTf(msg.tf);
  if (!tf) throw new Error(`Unknown timeframe: ${msg.tf}`);
  return { channel, symbol: key, tf };
}

/**
 * @param {import('fastify').FastifyInstance} app (with @fastify/websocket registered)
 * @param {any} ctx
 */
export async function register(app, ctx) {
  const hub = ctx.sockets || createSocketHub({ log: ctx.log });
  if (!ctx.sockets) {
    ctx.sockets = hub;
    ctx.broadcast = hub.broadcast;
  }
  const live = ctx.live;

  // Route LiveHub events to subscribed sockets.
  const onKline = (e) => hub.publish(subKey('kline', e.symbol, e.tf), { type: 'kline', symbol: e.symbol, tf: e.tf, candle: e.candle, closed: e.closed });
  const onFootprint = (e) => hub.publish(subKey('footprint', e.symbol, e.tf), { type: 'footprint', symbol: e.symbol, tf: e.tf, bar: e.bar });
  const onTrades = (e) => hub.publish(subKey('trades', e.symbol), { type: 'trade', symbol: e.symbol, trades: e.trades });
  const onStatus = (e) => hub.broadcast({ type: 'status', bybit: e.bybit, providers: e.providers });
  if (live) {
    live.on('kline', onKline);
    live.on('footprint', onFootprint);
    live.on('trades', onTrades);
    live.on('status', onStatus);
  }

  const heartbeat = setInterval(() => {
    for (const c of hub.clients) {
      if (!c.alive) {
        try {
          c.socket.terminate();
        } catch {
          /* ignore */
        }
        continue;
      }
      c.alive = false;
      try {
        c.socket.ping();
      } catch {
        /* ignore */
      }
    }
  }, HEARTBEAT_MS);
  heartbeat.unref?.();

  app.addHook('onClose', async () => {
    clearInterval(heartbeat);
    if (live) {
      live.off('kline', onKline);
      live.off('footprint', onFootprint);
      live.off('trades', onTrades);
      live.off('status', onStatus);
    }
    for (const c of hub.clients) {
      try {
        c.socket.close(1001, 'server shutting down');
      } catch {
        /* ignore */
      }
    }
  });

  function subscribe(client, sub) {
    const key = subKey(sub.channel, sub.symbol, sub.tf);
    if (client.subs.has(key)) return false;
    if (client.subs.size >= MAX_SUBS_PER_SOCKET) throw new Error('too many subscriptions on this socket');
    live?.acquire(sub.channel, sub.symbol, sub.tf);
    client.subs.add(key);
    let set = hub.index.get(key);
    if (!set) hub.index.set(key, (set = new Set()));
    set.add(client);
    return true;
  }

  function unsubscribe(client, key) {
    if (!client.subs.delete(key)) return false;
    const set = hub.index.get(key);
    set?.delete(client);
    if (set && !set.size) hub.index.delete(key);
    const [channel, symbol, tf] = key.split('|');
    try {
      live?.release(channel, symbol, tf);
    } catch (err) {
      ctx.log?.warn?.(`ws release ${key} failed: ${err.message}`);
    }
    return true;
  }

  app.get('/ws', { websocket: true }, (socket) => {
    const client = { socket, subs: new Set(), alive: true };
    hub.clients.add(client);
    socket.on('pong', () => {
      client.alive = true;
    });
    const st = live?.status?.() ?? {};
    hub.send(client, { type: 'status', bybit: st.bybit ?? 'connected', providers: st.providers });

    socket.on('message', (raw) => {
      // After cleanup (error/close) a late message must not acquire LiveHub refs that nothing would release.
      if (!hub.clients.has(client)) return;
      client.alive = true;
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        hub.send(client, { type: 'error', message: 'invalid JSON' });
        return;
      }
      if (!msg || typeof msg !== 'object') return;
      try {
        switch (msg.type) {
          case 'ping':
            hub.send(client, { type: 'pong', t: Date.now() });
            break;
          case 'subscribe': {
            const sub = parseSubscription(msg);
            subscribe(client, sub);
            hub.send(client, { type: 'subscribed', channel: sub.channel, symbol: sub.symbol, tf: sub.tf });
            break;
          }
          case 'unsubscribe': {
            const sub = parseSubscription(msg);
            unsubscribe(client, subKey(sub.channel, sub.symbol, sub.tf));
            hub.send(client, { type: 'unsubscribed', channel: sub.channel, symbol: sub.symbol, tf: sub.tf });
            break;
          }
          default:
            hub.send(client, { type: 'error', message: `unknown message type: ${msg.type}` });
        }
      } catch (err) {
        hub.send(client, { type: 'error', message: err.message, request: msg });
      }
    });

    const cleanup = () => {
      if (!hub.clients.has(client)) return;
      hub.clients.delete(client);
      for (const key of [...client.subs]) unsubscribe(client, key);
    };
    socket.on('close', cleanup);
    socket.on('error', (err) => {
      ctx.log?.debug?.(`ws client error: ${err.message}`);
      cleanup();
    });
  });
}

export default register;
