// MarketData (ARCHITECTURE §11): DB-first candle/footprint access that fills missing ranges from Bybit.
import {
  normalizeTf, isSecondsTf, floorTime, addBars, barsBetween, FOOTPRINT_TFS,
} from './timeframes.js';
import { toPublicCandle } from './aggregate.js';
import { rowsToBars, footprintTick, tradesToFootprint, mergeBars } from './footprint.js';
import { parseSymbolKey } from '../bybit/markets.js';

export const MAX_LIMIT = 5000;
export const DEFAULT_LIMIT = 1000;
// Refuse to page more than this many bars from Bybit for one request (keeps API latency bounded).
const MAX_FETCH_BARS = 50000;
// Minimum interval between "top-up" fetches of the forming bar for the same symbol/tf.
const TOPUP_INTERVAL_MS = 5000;

export class MarketData {
  /**
   * @param {{ repos: any, rest: import('../bybit/rest.js').BybitRest, instruments?: import('../bybit/instruments.js').Instruments,
   *   log?: any, config?: any, live?: any, now?: () => number }} opts
   */
  constructor({ repos, rest, instruments, log, config, live, now }) {
    this.repos = repos;
    this.rest = rest;
    this.instruments = instruments;
    this.log = log || console;
    this.config = config || {};
    /** Set by index.js after LiveHub is created (for seconds timeframes and live footprint). */
    this.live = live || null;
    this.now = now || (() => Date.now());
    this.inflight = new Map();
    this.lastTopUp = new Map();
    this.fetchFailures = 0;
  }

  /**
   * Candles ascending, DB first; missing ranges are fetched from Bybit and stored. Never throws for
   * network failures: returns what the DB has.
   * @param {{ symbol: string, tf: string, from?: number, to?: number, limit?: number, fill?: boolean }} q
   * @returns {Promise<{t:number,o:number,h:number,l:number,c:number,v:number}[]>}
   */
  async getCandles({ symbol, tf, from, to, limit, fill = true }) {
    const { key } = parseSymbolKey(symbol);
    const tfId = normalizeTf(tf);
    if (!tfId) throw new Error(`Unknown timeframe: ${tf}`);
    const lim = clampLimit(limit);
    const now = this.now();
    const hasFrom = Number.isFinite(from);
    const toT = Number.isFinite(to) ? Math.min(to, now) : now;

    if (isSecondsTf(tfId)) {
      const bars = this.live?.secondBars?.(key, tfId) ?? [];
      return bars.filter((b) => (!hasFrom || b.t >= from) && b.t <= toT).slice(-lim).map(toPublicCandle);
    }

    // Requested window. Without `from`, look back `lim` bars from `to`.
    const lastBar = floorTime(toT, tfId);
    const fromT = hasFrom ? floorTime(from, tfId) : addBars(lastBar, tfId, -(lim - 1));
    if (fill && this.rest) {
      try {
        await this.ensureRange(key, tfId, fromT, toT);
      } catch (err) {
        this.fetchFailures++;
        this.log.warn?.(`candles ${key} ${tfId}: ${key.startsWith('delta:') ? 'Delta' : 'Bybit'} fill failed (${err.message}); serving DB data`);
      }
    }
    const rows = this.repos.candles.range(key, tfId, {
      from: hasFrom ? fromT : 0,
      to: toT,
      limit: lim,
      anchor: hasFrom && !Number.isFinite(to) ? 'start' : 'end',
    });
    return rows;
  }

  /**
   * Make sure the DB holds every bar Bybit serves in [from, to]. Uses backfill_state as the contiguous
   * coverage marker. Concurrent identical requests share one fetch.
   */
  async ensureRange(key, tf, from, to) {
    const id = `${key}|${tf}|${from}|${to}`;
    if (this.inflight.has(id)) return this.inflight.get(id);
    const p = this._ensureRange(key, tf, from, to).finally(() => this.inflight.delete(id));
    this.inflight.set(id, p);
    return p;
  }

  async _ensureRange(key, tf, from, to) {
    const now = this.now();
    const lastClosed = addBars(now, tf, -1); // open time of the latest closed bar
    const end = Math.min(floorTime(to, tf), floorTime(now, tf));
    if (end < from) return;
    const state = this.repos.backfillState.get(key, tf);

    if (!state) {
      if (barsBetween(from, end, tf) > MAX_FETCH_BARS) return this._fetchUntracked(key, tf, from, end);
      await this._fetchAndStore(key, tf, from, end);
      this.repos.backfillState.set(key, tf, { oldest: from, newest: Math.min(end, lastClosed) });
      this.lastTopUp.set(`${key}|${tf}`, now);
      return;
    }

    let { oldest, newest } = state;
    // Disjoint request far away from the covered range: fetch only what was asked, unless the DB
    // already holds (nearly) every bar of it.
    const gapBefore = end < oldest ? barsBetween(end, oldest, tf) : 0;
    const gapAfter = from > newest ? barsBetween(newest, from, tf) : 0;
    if (gapBefore > MAX_FETCH_BARS || gapAfter > MAX_FETCH_BARS) return this._fetchUntracked(key, tf, from, end);

    // Older side.
    if (from < oldest) {
      if (barsBetween(from, oldest, tf) > MAX_FETCH_BARS) return this._fetchUntracked(key, tf, from, end);
      await this._fetchAndStore(key, tf, from, oldest);
      oldest = from;
      this.repos.backfillState.set(key, tf, { oldest, newest });
    }
    // Newer side (includes the forming bar, throttled).
    if (end > newest) {
      const onlyForming = end === floorTime(now, tf) && newest >= lastClosed;
      const topKey = `${key}|${tf}`;
      if (onlyForming && now - (this.lastTopUp.get(topKey) || 0) < TOPUP_INTERVAL_MS) return;
      if (barsBetween(newest, end, tf) > MAX_FETCH_BARS) return this._fetchUntracked(key, tf, from, end);
      this.lastTopUp.set(topKey, now);
      await this._fetchAndStore(key, tf, newest, end);
      newest = Math.max(newest, Math.min(end, lastClosed));
      this.repos.backfillState.set(key, tf, { oldest, newest });
    }
  }

  async _fetchUntracked(key, tf, from, end) {
    const expected = barsBetween(from, end, tf);
    const have = this.repos.candles.count(key, tf, from, end);
    if (have >= expected * 0.98) return;
    const capped = Math.max(from, addBars(end, tf, -(MAX_FETCH_BARS - 1)));
    await this._fetchAndStore(key, tf, capped, end);
  }

  async _fetchAndStore(key, tf, from, end) {
    const { category, symbol } = parseSymbolKey(key);
    let stored = 0;
    await this.rest.getKlinesRange({
      category,
      symbol,
      tf,
      start: from,
      end,
      collect: false,
      onPage: (page) => {
        stored += this.repos.candles.upsertMany(key, tf, page);
      },
    });
    this.fetchFailures = 0;
    return stored;
  }

  /**
   * Footprint bars from the DB, merged with the live in-memory bar(s). If nothing is stored for a recent
   * window, a best-effort snapshot is built from Bybit's recent trades.
   * @param {{ symbol: string, tf: string, from?: number, to?: number, limit?: number }} q
   */
  async getFootprint({ symbol, tf, from, to, limit }) {
    const { key, category, symbol: sym } = parseSymbolKey(symbol);
    const tfId = normalizeTf(tf);
    if (!tfId) throw new Error(`Unknown timeframe: ${tf}`);
    const now = this.now();
    const toT = Number.isFinite(to) ? to : now;
    const maxBars = Math.min(clampLimit(limit ?? 500), 2000);
    const fromT = Number.isFinite(from) ? from : 0;
    const tick = this.footprintTickFor(key);
    const rows = this.repos.footprint.rows(key, tfId, { from: fromT, to: toT, maxBars: Number.isFinite(from) ? undefined : maxBars });
    let bars = rowsToBars(rows, tick);

    // Merge live accumulation (current/unpersisted bars).
    const liveBars = this.live?.footprintBars?.(key, tfId) ?? [];
    if (liveBars.length) {
      const byT = new Map(bars.map((b) => [b.t, b]));
      for (const lb of liveBars) {
        if (lb.t < fromT || lb.t > toT) continue;
        const cur = byT.get(lb.t);
        // Live bars that were already persisted replace the stored copy (live holds the full bar).
        byT.set(lb.t, cur && lb.partialStart ? mergeBars(cur, lb) : lb);
      }
      bars = [...byT.values()].sort((a, b) => a.t - b.t);
    }

    const recentWindow = toT >= now - 60 * 60 * 1000;
    if (!bars.length && recentWindow && this.rest && FOOTPRINT_TFS.includes(tfId)) {
      try {
        const trades = await this.rest.getRecentTrades({ category, symbol: sym, limit: 1000 });
        const t = tick ?? this.footprintTickFor(key, trades.at(-1)?.p) ?? footprintTick(trades.at(-1)?.p, 0);
        bars = tradesToFootprint(trades.filter((x) => x.t >= fromT && x.t <= toT), tfId, t);
      } catch (err) {
        this.log.debug?.(`footprint ${key}: recent trades unavailable (${err.message})`);
      }
    }
    return bars.slice(-maxBars);
  }

  /**
   * Bucket size used for a symbol's footprint (instrument tickSize x FOOTPRINT_TICK_MULT, or auto from price).
   * Determined once per symbol and cached (memory + meta table) so stored and live bars share one grid.
   * @param {string} key
   * @param {number} [refPrice] price to size an automatic bucket when nothing is cached yet
   * @returns {number|undefined}
   */
  footprintTickFor(key, refPrice) {
    this._fpTicks ??= new Map();
    const mult = this.config.footprintTickMult ?? 'auto';
    const cacheKey = `fptick:${key}:${mult}`;
    if (this._fpTicks.has(cacheKey)) return this._fpTicks.get(cacheKey);
    const cached = this.repos.meta?.get(cacheKey)?.value;
    if (cached > 0) {
      this._fpTicks.set(cacheKey, cached);
      return cached;
    }
    const ts = this.instruments?.tickSize(key);
    const price = refPrice ?? this.live?.lastPrice?.(key) ?? this.repos.candles.last(key, '1m')?.c
      ?? this.repos.candles.last(key, '1D')?.c;
    if (!ts && !price) return undefined;
    const tick = footprintTick(price, ts, mult);
    if (price > 0 && (ts || mult !== 'auto')) {
      this._fpTicks.set(cacheKey, tick);
      this.repos.meta?.set(cacheKey, tick);
    }
    return tick;
  }

  /**
   * Public symbol list (§4).
   * @param {{ group?: string, q?: string, category?: string, limit?: number }} [f]
   */
  async listSymbols(f = {}) {
    if (!this.instruments) return [];
    await this.instruments.load();
    return this.instruments.list(f);
  }

  /** Bring one symbol/tf up to date (used by gap filler and after WS reconnects). */
  async refresh(key, tf) {
    const state = this.repos.backfillState.get(key, tf);
    const now = this.now();
    const from = state ? state.oldest : addBars(now, tf, -(DEFAULT_LIMIT - 1));
    await this.ensureRange(key, tf, from, now);
  }
}

function clampLimit(limit) {
  const n = Number(limit);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.floor(n));
}
