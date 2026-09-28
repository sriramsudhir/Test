// Market-data provider router (ARCHITECTURE §13.1). Routes by symbol-key prefix / category:
//   delta:*                      -> Delta Exchange (PRIMARY)   server/src/delta/
//   linear:* | spot:* | inverse:* -> Bybit                     server/src/bybit/
// ProviderRouter exposes the REST surface used by MarketData / Backfiller / Instruments; StreamRouter exposes the
// streams surface used by LiveHub. Both dispatch on `category`.
import { EventEmitter } from 'node:events';
import { DeltaRest } from '../delta/rest.js';
import { DeltaWs } from '../delta/ws.js';
import { deltaSourceTf } from '../delta/timeframes.js';
import { BybitRest } from '../bybit/rest.js';
import { BybitStreams } from '../bybit/ws.js';
import { isSecondsTf } from '../data/timeframes.js';

export const PROVIDERS = Object.freeze(['delta', 'bybit']);

/** Provider name for a category or symbol key. */
export function providerOf(categoryOrKey) {
  const c = String(categoryOrKey || '').split(':')[0].toLowerCase();
  return c === 'delta' ? 'delta' : 'bybit';
}

/**
 * How live klines of a timeframe are produced for a category:
 *   { mode: 'native' }                   provider streams this tf
 *   { mode: 'derived', from: '6h' }      aggregated from a lower native stream (Delta 12h / 1W / 1M)
 *   { mode: 'trades' }                   built from live trades (seconds timeframes)
 */
export function klineSource(category, tf) {
  if (isSecondsTf(tf)) return { mode: 'trades' };
  if (providerOf(category) === 'delta') {
    const from = deltaSourceTf(tf);
    if (from) return { mode: 'derived', from };
  }
  return { mode: 'native' };
}

export class ProviderRouter {
  /**
   * @param {{ delta: import('../delta/rest.js').DeltaRest, bybit: import('../bybit/rest.js').BybitRest, log?: any }} p
   */
  constructor({ delta, bybit, log }) {
    this.delta = delta;
    this.bybit = bybit;
    this.log = log || console;
  }

  for(categoryOrKey) {
    return providerOf(categoryOrKey) === 'delta' ? this.delta : this.bybit;
  }

  getKlines(p) {
    return this.for(p.category).getKlines(p);
  }

  getKlinesRange(p) {
    return this.for(p.category).getKlinesRange(p);
  }

  getRecentTrades(p) {
    return this.for(p.category).getRecentTrades(p);
  }

  getTickers(category = 'linear', symbol) {
    return this.for(category).getTickers(category, symbol);
  }

  getInstruments(category) {
    return this.for(category).getInstruments(category);
  }

  /** Instruments of both providers. Throws only when every provider fails. */
  async getAllInstruments() {
    const results = await Promise.allSettled([this.delta.getAllInstruments(), this.bybit.getAllInstruments()]);
    const out = [];
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') out.push(...r.value.map((x) => ({ ...x, provider: x.provider ?? (i === 0 ? 'delta' : 'bybit') })));
      else this.log.warn?.(`instruments from ${PROVIDERS[i]} unavailable: ${r.reason?.message}`);
    });
    if (results.every((r) => r.status === 'rejected')) throw results[0].reason;
    return out;
  }

  /** Per-provider REST health. */
  get healthByProvider() {
    return { delta: this.delta.health, bybit: this.bybit.health };
  }

  /** Worst-of health ("ok" only if the primary provider is ok or untested). */
  get health() {
    return this.delta.health;
  }

  get stats() {
    return { delta: this.delta.stats, bybit: this.bybit.stats };
  }
}

/**
 * Streams facade over Delta + Bybit WebSockets with the BybitStreams interface.
 * Events: 'message' ({ category, topic, data }), 'status' ({ category, status, overall }).
 */
export class StreamRouter extends EventEmitter {
  /** @param {{ delta: DeltaWs, bybit: BybitStreams, log?: any }} p */
  constructor({ delta, bybit, log }) {
    super();
    this.setMaxListeners(0);
    this.delta = delta;
    this.bybit = bybit;
    this.log = log || console;
    delta.on('message', (m) => this.emit('message', m));
    bybit.on('message', (m) => this.emit('message', m));
    delta.on('status', (status) => this.emit('status', { category: 'delta', provider: 'delta', status, overall: this.status }));
    bybit.on('status', (e) => this.emit('status', { ...e, provider: 'bybit', overall: this.status }));
  }

  subscribe(category, topic) {
    return providerOf(category) === 'delta' ? this.delta.subscribe(topic) : this.bybit.subscribe(category, topic);
  }

  unsubscribe(category, topic) {
    return providerOf(category) === 'delta' ? this.delta.unsubscribe(topic) : this.bybit.unsubscribe(category, topic);
  }

  /** Per-provider stream status: 'connected' | 'reconnecting' | 'idle' | 'closed'. */
  statuses() {
    const d = this.delta.refs.size ? (this.delta.status === 'connected' ? 'connected' : 'reconnecting') : 'idle';
    return { delta: d, bybit: this.bybit.status };
  }

  /** 'reconnecting' if any provider in use is down, else 'connected' / 'idle'. */
  get status() {
    const s = Object.values(this.statuses());
    if (s.includes('reconnecting')) return 'reconnecting';
    return s.includes('connected') ? 'connected' : 'idle';
  }

  close() {
    this.delta.close();
    this.bybit.close();
  }
}

/**
 * Build both providers from config.
 * @param {{ config: any, log?: any, fetch?: typeof fetch, WebSocket?: any }} p
 */
export function createProviders({ config, log, fetch, WebSocket }) {
  const deltaRest = new DeltaRest({ baseUrl: config.deltaRest, rateLimit: config.deltaRateLimit, log, fetch });
  const bybitRest = new BybitRest({ baseUrl: config.bybitRest, rateLimit: config.rateLimit, log, fetch });
  const rest = new ProviderRouter({ delta: deltaRest, bybit: bybitRest, log });
  const deltaWs = new DeltaWs({ url: config.deltaWs, log, WebSocket });
  const bybitStreams = new BybitStreams({ baseUrl: config.bybitWs, log, WebSocket });
  const streams = new StreamRouter({ delta: deltaWs, bybit: bybitStreams, log });
  return { rest, streams, delta: { rest: deltaRest, ws: deltaWs }, bybit: { rest: bybitRest, streams: bybitStreams } };
}
