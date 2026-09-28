// Delta Exchange public REST client (ARCHITECTURE §13.1). No auth needed for market data.
// Same surface as bybit/rest.js (getKlines, getKlinesRange, getInstruments, getAllInstruments, getTickers,
// getRecentTrades) so MarketData / Backfiller / Instruments work unchanged through the provider router.
// Field shapes are parsed defensively: unknown rows are logged (once) and skipped.
import { RateLimiter } from '../bybit/rest.js';
import { normalizeTf, tfToMs, floorTime, addBars } from '../data/timeframes.js';
import { resampleCandles } from '../data/aggregate.js';
import { DELTA_RESOLUTIONS, DELTA_DERIVED, toMs } from './timeframes.js';

const sleepReal = (ms) => new Promise((r) => setTimeout(r, ms));
export const MAX_CANDLES_PER_REQUEST = 2000;

export class DeltaError extends Error {
  constructor(message, { code, status, cause, retryable = false } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'DeltaError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

const num = (x) => (x === '' || x == null ? NaN : Number(x));

/**
 * Parse `/v2/history/candles` rows (`{ time(sec), open, high, low, close, volume }`, possibly unordered)
 * into ascending Candle objects. Rows without a valid time/close are skipped.
 */
export function parseDeltaCandles(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const r of list) {
    if (!r || typeof r !== 'object') continue;
    const t = toMs(r.time ?? r.start ?? r.t);
    const c = num(r.close ?? r.c);
    if (!Number.isFinite(t) || !Number.isFinite(c)) continue;
    const o = num(r.open ?? r.o);
    const h = num(r.high ?? r.h);
    const l = num(r.low ?? r.l);
    const v = num(r.volume ?? r.v);
    out.push({
      t,
      o: Number.isFinite(o) ? o : c,
      h: Number.isFinite(h) ? h : c,
      l: Number.isFinite(l) ? l : c,
      c,
      v: Number.isFinite(v) ? v : 0,
      qv: null,
    });
  }
  out.sort((a, b) => a.t - b.t);
  return out.filter((k, i) => i === 0 || k.t !== out[i - 1].t);
}

/** Parse one `/v2/products` row into our Symbol shape, or null if unusable. */
export function parseDeltaProduct(p) {
  if (!p || typeof p !== 'object' || typeof p.symbol !== 'string' || !p.symbol) return null;
  const base = p.underlying_asset?.symbol ?? p.underlying_asset_symbol ?? p.base_asset?.symbol;
  const quote = p.quoting_asset?.symbol ?? p.quoting_asset_symbol ?? p.settling_asset?.symbol;
  const tickSize = num(p.tick_size);
  const contractType = String(p.contract_type || '');
  const isSpot = contractType === 'spot';
  const minQty = num(p.product_specs?.min_order_size ?? p.min_order_size);
  return {
    key: `delta:${p.symbol}`,
    symbol: p.symbol,
    category: 'delta',
    provider: 'delta',
    base: base || p.symbol.replace(/(USDT|USD|INR)$/, ''),
    quote: quote || (p.symbol.match(/(USDT|USD|INR)$/) || [''])[0],
    tickSize,
    // Delta derivatives trade in whole contracts; spot uses the product's min order size when given.
    qtyStep: isSpot && Number.isFinite(minQty) && minQty > 0 ? minQty : 1,
    contractValue: num(p.contract_value),
    status: p.state ?? p.trading_status,
    contractType,
    productId: p.id,
    launchTime: p.launch_time ? Date.parse(p.launch_time) || undefined : undefined,
  };
}

/** Parse `/v2/trades/{symbol}` payloads into `{ t, p, q, side }` ascending. */
export function parseDeltaTrades(result) {
  const list = Array.isArray(result) ? result : Array.isArray(result?.trades) ? result.trades : [];
  return list
    .map((x) => {
      const t = toMs(x.timestamp ?? x.time ?? x.created_at);
      const side = deltaSide(x);
      return { t, p: num(x.price), q: num(x.size ?? x.quantity), side };
    })
    .filter((x) => Number.isFinite(x.t) && Number.isFinite(x.p) && Number.isFinite(x.q) && x.side)
    .sort((a, b) => a.t - b.t);
}

/** Aggressor side of a Delta trade: explicit `side`, else the taker role. */
export function deltaSide(x) {
  const s = String(x.side ?? '').toLowerCase();
  if (s === 'buy') return 'Buy';
  if (s === 'sell') return 'Sell';
  if (x.buyer_role === 'taker') return 'Buy';
  if (x.seller_role === 'taker') return 'Sell';
  return null;
}

export class DeltaRest {
  /**
   * @param {{ baseUrl?: string, rateLimit?: number, fetch?: typeof fetch, log?: any, maxRetries?: number,
   *   timeoutMs?: number, sleep?: (ms:number)=>Promise<void>, limiter?: RateLimiter, baseDelayMs?: number }} [opts]
   */
  constructor(opts = {}) {
    this.baseUrl = (opts.baseUrl || 'https://api.india.delta.exchange').replace(/\/+$/, '');
    this.fetch = opts.fetch || globalThis.fetch.bind(globalThis);
    this.log = opts.log || console;
    this.maxRetries = opts.maxRetries ?? 5;
    this.timeoutMs = opts.timeoutMs ?? 10000;
    this.sleep = opts.sleep || sleepReal;
    this.baseDelayMs = opts.baseDelayMs ?? 500;
    this.limiter = opts.limiter || new RateLimiter(opts.rateLimit ?? 8, { sleep: this.sleep });
    this.stats = { requests: 0, errors: 0, retries: 0, lastOk: 0, lastError: null, consecutiveFailures: 0 };
    this._warned = new Set();
  }

  get health() {
    const s = this.stats;
    if (!s.lastOk && !s.lastError) return 'unknown';
    if (s.consecutiveFailures === 0) return 'ok';
    return s.consecutiveFailures >= 3 ? 'down' : 'degraded';
  }

  _backoff(attempt) {
    return Math.min(30000, this.baseDelayMs * 2 ** attempt) * (0.75 + Math.random() * 0.5);
  }

  _warnOnce(key, msg) {
    if (this._warned.has(key)) return;
    this._warned.add(key);
    this.log.warn?.(msg);
  }

  /**
   * GET a public endpoint and return the full JSON body (`{ success, result, meta }`).
   * @param {string} path
   * @param {Record<string, any>} [params]
   */
  async request(path, params = {}) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
    const url = `${this.baseUrl}${path}${qs.size ? `?${qs}` : ''}`;
    let lastErr;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      await this.limiter.take();
      this.stats.requests++;
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), this.timeoutMs);
      let res;
      try {
        res = await this.fetch(url, { signal: ac.signal, headers: { accept: 'application/json', 'user-agent': 'tradeview/0.1' } });
      } catch (err) {
        clearTimeout(timer);
        lastErr = new DeltaError(`Network error for ${path}: ${err.message}`, { cause: err, retryable: true });
        if (attempt < this.maxRetries) {
          this.stats.retries++;
          await this.sleep(this._backoff(attempt));
          continue;
        }
        break;
      }
      let body = null;
      let text = '';
      try {
        text = await res.text();
        body = text ? JSON.parse(text) : null;
      } catch {
        body = null;
      } finally {
        clearTimeout(timer);
      }
      if (res.status === 429 || res.status >= 500) {
        lastErr = new DeltaError(`Delta ${path} HTTP ${res.status}: ${errorText(body, text)}`, { status: res.status, retryable: true });
        if (attempt < this.maxRetries) {
          this.stats.retries++;
          let delay = this._backoff(attempt);
          // Delta reports the ms until the rate-limit window resets.
          const reset = Number(res.headers?.get?.('x-rate-limit-reset'));
          if (Number.isFinite(reset) && reset > 0) delay = Math.max(delay, Math.min(reset + 50, 30000));
          if (res.status === 429) this.limiter.penalize(delay);
          await this.sleep(delay);
          continue;
        }
        break;
      }
      if (!res.ok || !body || body.success === false) {
        lastErr = new DeltaError(`Delta ${path} failed (HTTP ${res.status}): ${errorText(body, text)}`, {
          status: res.status, code: body?.error?.code,
        });
        break;
      }
      this.stats.lastOk = Date.now();
      this.stats.consecutiveFailures = 0;
      return body;
    }
    this.stats.errors++;
    this.stats.consecutiveFailures++;
    this.stats.lastError = { t: Date.now(), message: lastErr?.message };
    throw lastErr;
  }

  async get(path, params) {
    return (await this.request(path, params))?.result;
  }

  /**
   * One native candle window. `start`/`end` are ms (converted to unix seconds for Delta).
   * @returns {Promise<{t:number,o:number,h:number,l:number,c:number,v:number,qv:null}[]>} ascending
   */
  async getNativeCandles({ symbol, tf, start, end }) {
    const res = DELTA_RESOLUTIONS[normalizeTf(tf)];
    if (!res) throw new DeltaError(`Delta has no native resolution for ${tf}`);
    const result = await this.get('/v2/history/candles', {
      resolution: res, symbol, start: Math.floor(start / 1000), end: Math.floor(end / 1000),
    });
    if (result != null && !Array.isArray(result)) this._warnOnce('candles-shape', 'delta: unexpected candles payload shape');
    return parseDeltaCandles(result).filter((k) => k.t >= start && k.t <= end);
  }

  /** Candles for [start, end] in one call (limit ignored beyond 2000 bars). */
  async getKlines({ symbol, tf, interval, start, end = Date.now(), limit = MAX_CANDLES_PER_REQUEST }) {
    const id = normalizeTf(tf ?? interval);
    const s = start ?? addBars(end, id, -(Math.min(limit, MAX_CANDLES_PER_REQUEST) - 1));
    return this.getKlinesRange({ symbol, tf: id, start: s, end });
  }

  /**
   * All candles with open time in [start, end], paging BACKWARDS in windows of <= 2000 bars so callers can
   * persist incrementally (`onPage(ascendingPage)`). Stops at an empty window (before the listing).
   * Derived timeframes (12h, 1W, 1M) are built from their native source tf.
   */
  async getKlinesRange({ symbol, tf, start, end = Date.now(), onPage, collect = true, limit = MAX_CANDLES_PER_REQUEST }) {
    const id = normalizeTf(tf);
    if (!id) throw new DeltaError(`Unknown timeframe: ${tf}`);
    const src = DELTA_DERIVED[id];
    if (src) {
      const from = floorTime(start, id);
      const lower = await this.getKlinesRange({ symbol, tf: src, start: from, end: addBars(end, id, 1) - 1 });
      const out = resampleCandles(lower, id).filter((k) => k.t >= start && k.t <= end).map((k) => ({ ...k, qv: null }));
      if (out.length && onPage) await onPage(out);
      return collect ? out : [];
    }
    if (!DELTA_RESOLUTIONS[id]) throw new DeltaError(`Timeframe ${id} is not served by Delta (built from live trades)`);
    const step = tfToMs(id);
    const perPage = Math.max(1, Math.min(limit, MAX_CANDLES_PER_REQUEST));
    const out = [];
    let hi = end;
    let guard = 0;
    while (hi >= start && guard++ < 100000) {
      const lo = Math.max(start, floorTime(hi, id) - (perPage - 1) * step);
      const page = await this.getNativeCandles({ symbol, tf: id, start: lo, end: hi });
      if (!page.length) break; // nothing before this window: listing start (or no trading)
      if (onPage) await onPage(page);
      if (collect) out.push(...page);
      if (lo <= start) break;
      hi = lo - 1;
    }
    if (!collect) return [];
    out.sort((a, b) => a.t - b.t);
    return out.filter((k, i) => i === 0 || k.t !== out[i - 1].t);
  }

  /** All products (cursor pagination via meta.after). Only `live` products unless `all`. */
  async getInstruments(_category = 'delta', { all = false } = {}) {
    const out = [];
    let after;
    let guard = 0;
    let skipped = 0;
    do {
      const body = await this.request('/v2/products', { page_size: 500, after });
      const list = Array.isArray(body?.result) ? body.result : [];
      for (const p of list) {
        const it = parseDeltaProduct(p);
        if (!it) {
          skipped++;
          continue;
        }
        if (!all && it.status && it.status !== 'live') continue;
        out.push(it);
      }
      after = body?.meta?.after || undefined;
    } while (after && guard++ < 200);
    if (skipped) this.log.warn?.(`delta: skipped ${skipped} product rows with an unknown shape`);
    return out;
  }

  async getAllInstruments() {
    return this.getInstruments('delta');
  }

  /** Tickers `{ symbol, lastPrice, turnover24h, volume24h, ... }` (perpetuals by default). */
  async getTickers(_category = 'delta', symbol, { contractTypes = 'perpetual_futures' } = {}) {
    const result = symbol ? [await this.get(`/v2/tickers/${encodeURIComponent(symbol)}`)] : await this.get('/v2/tickers', { contract_types: contractTypes });
    return (Array.isArray(result) ? result : [])
      .filter((x) => x && typeof x.symbol === 'string')
      .map((x) => ({
        ...x,
        category: 'delta',
        lastPrice: num(x.close ?? x.mark_price ?? x.spot_price),
        turnover24h: num(x.turnover_usd ?? x.turnover),
        volume24h: num(x.volume),
        highPrice24h: num(x.high),
        lowPrice24h: num(x.low),
      }));
  }

  /** Recent public trades `{ t, p, q, side }` ascending. */
  async getRecentTrades({ symbol }) {
    const result = await this.get(`/v2/trades/${encodeURIComponent(symbol)}`);
    return parseDeltaTrades(result);
  }

  async getServerTime() {
    const body = await this.request('/v2/settings').catch(() => null);
    return toMs(body?.result?.server_time) || Date.now();
  }
}

function errorText(body, text) {
  if (body?.error) return typeof body.error === 'string' ? body.error : JSON.stringify(body.error).slice(0, 200);
  return String(text || '').slice(0, 160);
}
