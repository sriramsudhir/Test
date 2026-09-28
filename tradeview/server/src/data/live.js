// LiveHub (ARCHITECTURE §3 Live, §11): ref-counted Bybit WS subscriptions, closed-candle persistence,
// live footprint and seconds bars built from public trades.
import { EventEmitter } from 'node:events';
import { normalizeTf, isSecondsTf, tfToBybit, bybitToTf, addBars, floorTime } from './timeframes.js';
import { CandleBuilder, toPublicCandle, resampleCandles } from './aggregate.js';
import { FootprintAggregator, footprintTick, rowsToBars, mergeBars } from './footprint.js';
import { parseSymbolKey } from '../bybit/markets.js';
import { BybitStreams } from '../bybit/ws.js';
import { klineSource } from '../providers/index.js';

const CHANNELS = new Set(['kline', 'trades', 'footprint']);
const SECOND_HISTORY = 5000; // closed second bars kept in memory per symbol/tf
const FOOTPRINT_EMIT_MS = 250; // throttle for live footprint updates per symbol/tf
const SECOND_EMIT_MS = 100; // throttle for forming second-bar updates

/** Parse a Bybit publicTrade payload into `{ t, p, q, side }` ascending. */
export function parseWsTrades(data) {
  return (Array.isArray(data) ? data : [data])
    .map((x) => ({ t: Number(x.T), p: Number(x.p), q: Number(x.v), side: x.S === 'Sell' ? 'Sell' : 'Buy' }))
    .filter((x) => Number.isFinite(x.t) && Number.isFinite(x.p) && Number.isFinite(x.q))
    .sort((a, b) => a.t - b.t);
}

/** Parse a Bybit kline payload entry. */
export function parseWsKline(d) {
  return {
    candle: {
      t: Number(d.start), o: Number(d.open), h: Number(d.high), l: Number(d.low), c: Number(d.close),
      v: Number(d.volume), qv: Number(d.turnover),
    },
    closed: d.confirm === true,
    interval: String(d.interval),
  };
}

export class LiveHub extends EventEmitter {
  /**
   * @param {{ config?: any, log?: any, repos?: any, instruments?: any, market?: any, streams?: any, now?: () => number }} opts
   */
  constructor({ config = {}, log, repos, instruments, market, streams, now } = {}) {
    super();
    this.setMaxListeners(0);
    this.config = config;
    this.log = log || console;
    this.repos = repos;
    this.instruments = instruments;
    this.market = market;
    this.now = now || (() => Date.now());
    this.streams = streams || new BybitStreams({ baseUrl: config.bybitWs, log: this.log });
    /** @type {Map<string, number>} */
    this.refs = new Map();
    /** @type {Map<string, any>} per symbol key state */
    this.syms = new Map();
    this.bybitStatus = 'connected';
    this._onMessage = (m) => this._handle(m);
    this._onStatus = (s) => this._statusChanged(s);
    this.streams.on('message', this._onMessage);
    this.streams.on('status', this._onStatus);
    this.timer = setInterval(() => this._tick(), 1000);
    this.timer.unref?.();
  }

  _sym(key) {
    let s = this.syms.get(key);
    if (!s) {
      const { category, symbol } = parseSymbolKey(key);
      s = { key, category, symbol, lastPrice: undefined, seconds: new Map(), footprints: new Map(), derived: new Map() };
      this.syms.set(key, s);
    }
    return s;
  }

  static refKey(channel, key, tf) {
    return channel === 'trades' ? `trades|${key}` : `${channel}|${key}|${tf}`;
  }

  _validate(channel, symbol, tf) {
    if (!CHANNELS.has(channel)) throw new Error(`Unknown channel: ${channel}`);
    const { key } = parseSymbolKey(symbol);
    let tfId;
    if (channel !== 'trades') {
      tfId = normalizeTf(tf);
      if (!tfId) throw new Error(`Unknown timeframe: ${tf}`);
      if (channel === 'footprint' && isSecondsTf(tfId)) throw new Error('Footprint needs a minute or higher timeframe');
    }
    return { key, tf: tfId };
  }

  /**
   * Ref-counted subscription. Returns the new refcount.
   * @param {'kline'|'trades'|'footprint'} channel
   * @param {string} symbol key
   * @param {string} [tf]
   */
  acquire(channel, symbol, tf) {
    const v = this._validate(channel, symbol, tf);
    const rk = LiveHub.refKey(channel, v.key, v.tf);
    const n = (this.refs.get(rk) || 0) + 1;
    this.refs.set(rk, n);
    if (n === 1) this._start(channel, v.key, v.tf);
    return n;
  }

  /** Release one reference. Returns the remaining refcount. */
  release(channel, symbol, tf) {
    let v;
    try {
      v = this._validate(channel, symbol, tf);
    } catch {
      return 0;
    }
    const rk = LiveHub.refKey(channel, v.key, v.tf);
    const cur = this.refs.get(rk) || 0;
    if (cur <= 0) return 0;
    if (cur > 1) {
      this.refs.set(rk, cur - 1);
      return cur - 1;
    }
    this.refs.delete(rk);
    this._stop(channel, v.key, v.tf);
    return 0;
  }

  refCount(channel, symbol, tf) {
    try {
      const v = this._validate(channel, symbol, tf);
      return this.refs.get(LiveHub.refKey(channel, v.key, v.tf)) || 0;
    } catch {
      return 0;
    }
  }

  /** Active subscriptions `[{ channel, symbol, tf, refs }]`. */
  subscriptions() {
    return [...this.refs.entries()].map(([k, refs]) => {
      const [channel, symbol, tf] = k.split('|');
      return { channel, symbol, tf, refs };
    });
  }

  _tradeTopic(s) {
    return `publicTrade.${s.symbol}`;
  }

  _start(channel, key, tf) {
    const s = this._sym(key);
    if (channel === 'kline') {
      const src = klineSource(s.category, tf);
      if (src.mode === 'native') {
        this.streams.subscribe(s.category, `kline.${tfToBybit(tf)}.${s.symbol}`);
        return;
      }
      if (src.mode === 'derived') {
        // e.g. Delta 12h from the 6h stream, 1W / 1M from the 1d stream.
        s.derived.set(tf, { from: src.from, periodT: null, closed: new Map(), live: null, current: null, seeded: false, finalized: false });
        this.streams.subscribe(s.category, `kline.${tfToBybit(src.from)}.${s.symbol}`);
        return;
      }
    }
    if (channel === 'kline') {
      s.seconds.set(tf, { builder: new CandleBuilder(tf), history: [], lastEmit: 0, dirty: false });
    } else if (channel === 'footprint') {
      s.footprints.set(tf, { agg: null, current: null, partialStart: null, lastEmit: 0, dirty: false });
    }
    this.streams.subscribe(s.category, this._tradeTopic(s));
  }

  _stop(channel, key, tf) {
    const s = this._sym(key);
    if (channel === 'kline') {
      const src = klineSource(s.category, tf);
      if (src.mode === 'native') {
        this.streams.unsubscribe(s.category, `kline.${tfToBybit(tf)}.${s.symbol}`);
        return;
      }
      if (src.mode === 'derived') {
        s.derived.delete(tf);
        this.streams.unsubscribe(s.category, `kline.${tfToBybit(src.from)}.${s.symbol}`);
        return;
      }
    }
    if (channel === 'kline') s.seconds.delete(tf);
    else if (channel === 'footprint') {
      const fp = s.footprints.get(tf);
      if (fp?.current != null) this._persistFootprint(s, tf, fp, fp.current);
      s.footprints.delete(tf);
    }
    this.streams.unsubscribe(s.category, this._tradeTopic(s));
  }

  /** Last traded / closing price seen on any live stream. */
  lastPrice(symbol) {
    try {
      return this.syms.get(parseSymbolKey(symbol).key)?.lastPrice;
    } catch {
      return undefined;
    }
  }

  /** Closed + forming seconds bars held in memory (ascending). */
  secondBars(symbol, tf) {
    const sec = this.syms.get(parseSymbolKey(symbol).key)?.seconds.get(tf);
    if (!sec) return [];
    const cur = sec.builder.current;
    return cur ? [...sec.history, cur] : [...sec.history];
  }

  /** Live footprint bar(s) not yet (fully) persisted; `partialStart` marks a bar that began mid-bar. */
  footprintBars(symbol, tf) {
    const fp = this.syms.get(parseSymbolKey(symbol).key)?.footprints.get(tf);
    if (!fp?.agg || fp.current == null) return [];
    const bar = fp.agg.bar(fp.current);
    if (!bar) return [];
    return [{ ...bar, partialStart: fp.partialStart === fp.current }];
  }

  _handle({ category, topic, data }) {
    if (!topic) return;
    const dot = topic.indexOf('.');
    const kind = topic.slice(0, dot);
    if (kind === 'kline') {
      const [, interval, symbol] = topic.split('.');
      this._onKline(`${category}:${symbol}`, interval, data);
    } else if (kind === 'publicTrade') {
      this._onTrades(`${category}:${topic.slice(dot + 1)}`, data);
    }
  }

  _onKline(key, interval, data) {
    const s = this._sym(key);
    let tf;
    try {
      tf = bybitToTf(interval);
    } catch {
      return;
    }
    for (const d of Array.isArray(data) ? data : [data]) {
      const { candle, closed } = parseWsKline(d);
      if (!Number.isFinite(candle.t)) continue;
      s.lastPrice = candle.c;
      if (closed) this._persistCandle(key, tf, candle);
      this.emit('kline', { symbol: key, tf, candle: toPublicCandle(candle), closed });
      for (const [dtf, d] of s.derived) if (d.from === tf) this._updateDerived(s, dtf, d, candle, closed);
    }
  }

  /** Maintain a derived higher-timeframe bar from lower-timeframe kline updates. */
  _updateDerived(s, dtf, d, lower, lowerClosed) {
    const period = floorTime(lower.t, dtf);
    if (d.periodT !== null && period < d.periodT) return; // stale
    if (d.periodT !== period) {
      if (d.periodT !== null && d.current && !d.finalized) this._finalizeDerived(s, dtf, d);
      d.periodT = period;
      d.closed = new Map();
      d.live = null;
      d.current = null;
      d.finalized = false;
      d.seeded = lower.t <= period;
      if (!d.seeded) this._seedDerived(s, dtf, d, period, lower.t);
    }
    if (d.finalized) return;
    if (lowerClosed) {
      d.closed.set(lower.t, lower);
      if (d.live?.t === lower.t) d.live = null;
    } else d.live = lower;
    if (!d.seeded) return;
    this._recomputeDerived(s, dtf, d);
    // Last lower bar of the period closed: the derived bar is final.
    if (lowerClosed && addBars(lower.t, d.from, 1) >= addBars(period, dtf, 1)) this._finalizeDerived(s, dtf, d);
  }

  _recomputeDerived(s, dtf, d) {
    const bars = [...d.closed.values()];
    if (d.live && !d.closed.has(d.live.t)) bars.push(d.live);
    if (!bars.length) return;
    bars.sort((a, b) => a.t - b.t);
    const [bar] = resampleCandles(bars, dtf);
    d.current = bar;
    this.emit('kline', { symbol: s.key, tf: dtf, candle: toPublicCandle(bar), closed: false });
  }

  _finalizeDerived(s, dtf, d) {
    if (!d.current) return;
    d.finalized = true;
    this._persistCandle(s.key, dtf, d.current);
    this.emit('kline', { symbol: s.key, tf: dtf, candle: toPublicCandle(d.current), closed: true });
  }

  /** Load the lower bars of the current period that closed before we subscribed (DB first, then REST). */
  _seedDerived(s, dtf, d, period, beforeT) {
    const done = (bars) => {
      if (d.periodT !== period) return;
      for (const b of bars || []) if (b.t >= period && b.t < beforeT && !d.closed.has(b.t)) d.closed.set(b.t, b);
      d.seeded = true;
      this._recomputeDerived(s, dtf, d);
    };
    const load = this.market?.getCandles
      ? this.market.getCandles({ symbol: s.key, tf: d.from, from: period, to: beforeT - 1, limit: 5000 })
      : Promise.resolve(this.repos?.candles.range(s.key, d.from, { from: period, to: beforeT - 1, limit: 5000 }) ?? []);
    Promise.resolve(load).then(done, (err) => {
      this.log.warn?.(`live: seeding ${s.key} ${dtf} failed: ${err.message}`);
      done([]);
    });
  }

  _persistCandle(key, tf, candle) {
    if (!this.repos) return;
    try {
      this.repos.candles.upsert(key, tf, candle);
      const st = this.repos.backfillState.get(key, tf);
      // Extend contiguous coverage only when this bar directly follows it.
      if (st && candle.t > st.newest && addBars(candle.t, tf, -1) <= st.newest) {
        this.repos.backfillState.set(key, tf, { oldest: st.oldest, newest: candle.t });
      }
    } catch (err) {
      this.log.warn?.(`live: persisting candle ${key} ${tf} failed: ${err.message}`);
    }
  }

  _onTrades(key, data) {
    const s = this._sym(key);
    const trades = parseWsTrades(data);
    if (!trades.length) return;
    s.lastPrice = trades[trades.length - 1].p;
    this.emit('trades', { symbol: key, trades });
    const now = this.now();

    for (const [tf, sec] of s.seconds) {
      for (const tr of trades) {
        const { closed } = sec.builder.add(tr);
        if (closed) this._closeSecond(key, tf, sec, closed);
      }
      sec.dirty = true;
      if (now - sec.lastEmit >= SECOND_EMIT_MS) this._emitSecond(key, tf, sec, now);
    }

    for (const [tf, fp] of s.footprints) {
      if (!fp.agg) {
        const tick = this.market?.footprintTickFor?.(key, trades[0].p)
          ?? footprintTick(trades[0].p, this.instruments?.tickSize?.(key), this.config.footprintTickMult ?? 'auto');
        fp.agg = new FootprintAggregator(tf, tick);
      }
      for (const tr of trades) {
        const t = floorTime(tr.t, tf);
        if (fp.current == null) {
          fp.current = t;
          fp.partialStart = t;
        }
        if (t < fp.current) continue; // late trade for an already finalised bar
        if (t > fp.current) this._rollFootprint(s, tf, fp, t);
        fp.agg.add(tr);
      }
      fp.dirty = true;
      if (now - fp.lastEmit >= FOOTPRINT_EMIT_MS) this._emitFootprint(key, tf, fp, now);
    }
  }

  _emitSecond(key, tf, sec, now) {
    const cur = sec.builder.current;
    sec.lastEmit = now;
    sec.dirty = false;
    if (cur) this.emit('kline', { symbol: key, tf, candle: toPublicCandle(cur), closed: false });
  }

  _closeSecond(key, tf, sec, closed) {
    sec.history.push(closed);
    if (sec.history.length > SECOND_HISTORY) sec.history.splice(0, sec.history.length - SECOND_HISTORY);
    this.emit('kline', { symbol: key, tf, candle: toPublicCandle(closed), closed: true });
  }

  _emitFootprint(key, tf, fp, now) {
    fp.lastEmit = now;
    fp.dirty = false;
    const bar = fp.current != null ? fp.agg?.bar(fp.current) : null;
    if (bar) this.emit('footprint', { symbol: key, tf, bar });
  }

  _rollFootprint(s, tf, fp, nextT) {
    const prev = fp.current;
    const bar = fp.agg.bar(prev);
    if (bar) {
      this.emit('footprint', { symbol: s.key, tf, bar });
      this._persistFootprint(s, tf, fp, prev);
    }
    fp.agg.prune(nextT);
    fp.current = nextT;
  }

  _persistFootprint(s, tf, fp, t) {
    if (!this.repos || !fp.agg) return;
    try {
      let bar = fp.agg.bar(t);
      if (!bar) return;
      if (fp.partialStart === t) {
        // Bar began mid-way: merge with whatever an earlier session stored for it.
        const prev = rowsToBars(this.repos.footprint.rows(s.key, tf, { from: t, to: t }), bar.tick)[0];
        if (prev) bar = mergeBars(prev, bar);
      }
      this.repos.footprint.upsertBars(s.key, tf, [bar]);
    } catch (err) {
      this.log.warn?.(`live: persisting footprint ${s.key} ${tf} failed: ${err.message}`);
    }
  }

  /** Periodic housekeeping: close seconds bars on wall-clock time, flush throttled updates. */
  _tick() {
    const now = this.now();
    for (const s of this.syms.values()) {
      for (const [tf, sec] of s.seconds) {
        if (sec.dirty) this._emitSecond(s.key, tf, sec, now);
        const closed = sec.builder.closeIfDue(now);
        if (closed) this._closeSecond(s.key, tf, sec, closed);
      }
      for (const [tf, fp] of s.footprints) {
        if (fp.dirty) this._emitFootprint(s.key, tf, fp, now);
        // Finalise a footprint bar once its period is over even if no new trade arrived.
        if (fp.agg && fp.current != null && addBars(fp.current, tf, 1) <= now - 2000) {
          this._rollFootprint(s, tf, fp, floorTime(now, tf));
        }
      }
    }
  }

  _statusChanged(ev) {
    const overall = this.streams.status === 'reconnecting' ? 'reconnecting' : 'connected';
    const providers = this.streams.statuses?.() ?? { bybit: overall };
    const sig = JSON.stringify([overall, providers]);
    if (sig === this._statusSig) return;
    this._statusSig = sig;
    const prev = this.bybitStatus;
    this.bybitStatus = overall;
    this.providerStatus = providers;
    // `bybit` carries the overall market-data feed status (field name kept from §5); per provider in `providers`.
    this.emit('status', { bybit: overall, providers, category: ev?.category });
    if (prev === 'reconnecting' && overall === 'connected') this._refillAfterReconnect();
  }

  /** After a WS outage, fetch closed candles we missed for every subscribed kline stream. */
  _refillAfterReconnect() {
    if (!this.market?.refresh) return;
    for (const { channel, symbol, tf } of this.subscriptions()) {
      if (channel !== 'kline' || isSecondsTf(tf)) continue;
      this.market.refresh(symbol, tf).catch((err) => this.log.warn?.(`live: refill ${symbol} ${tf} failed: ${err.message}`));
    }
  }

  /** Current Bybit stream status for /api/health and new sockets. */
  status() {
    return { bybit: this.bybitStatus, providers: this.providerStatus ?? this.streams.statuses?.() ?? {}, subscriptions: this.refs.size };
  }

  stop() {
    clearInterval(this.timer);
    for (const s of this.syms.values()) {
      for (const [tf, fp] of s.footprints) if (fp.current != null) this._persistFootprint(s, tf, fp, fp.current);
    }
    this.streams.off('message', this._onMessage);
    this.streams.off('status', this._onStatus);
    this.streams.close();
    this.refs.clear();
  }
}
