// Bybit v5 public REST client with a token-bucket rate limiter and retry/backoff.
import { tfToBybit, normalizeTf, bybitToTf } from '../data/timeframes.js';

const sleepReal = (ms) => new Promise((r) => setTimeout(r, ms));

/** Error thrown for non-retryable or exhausted Bybit failures. */
export class BybitError extends Error {
  constructor(message, { retCode, status, cause, retryable = false } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'BybitError';
    this.retCode = retCode;
    this.status = status;
    this.retryable = retryable;
  }
}

/**
 * Token bucket. `take()` resolves when a token is available. FIFO fairness.
 */
export class RateLimiter {
  /**
   * @param {number} rate tokens per second
   * @param {{ burst?: number, now?: () => number, sleep?: (ms:number) => Promise<void> }} [opts]
   */
  constructor(rate, { burst, now = () => Date.now(), sleep = sleepReal } = {}) {
    if (!(rate > 0)) throw new Error('rate must be > 0');
    this.rate = rate;
    this.capacity = burst ?? Math.max(1, Math.ceil(rate));
    this.tokens = this.capacity;
    this.now = now;
    this.sleep = sleep;
    this.last = now();
    this.queue = Promise.resolve();
  }

  _refill() {
    const t = this.now();
    const dt = Math.max(0, t - this.last) / 1000;
    this.last = t;
    this.tokens = Math.min(this.capacity, this.tokens + dt * this.rate);
  }

  /** Wait until a token is available and consume it. */
  take() {
    const run = async () => {
      for (;;) {
        this._refill();
        if (this.tokens >= 1) {
          this.tokens -= 1;
          return;
        }
        const waitMs = Math.ceil(((1 - this.tokens) / this.rate) * 1000);
        await this.sleep(Math.max(1, waitMs));
      }
    };
    // Chain to keep FIFO order among concurrent callers.
    const p = this.queue.then(run);
    this.queue = p.catch(() => {});
    return p;
  }

  /** Temporarily drain the bucket (e.g. after a server-side rate limit response). */
  penalize(ms) {
    this._refill();
    this.tokens = Math.min(this.tokens, 0) - (ms / 1000) * this.rate;
  }
}

const num = (x) => (x === '' || x == null ? NaN : Number(x));

/**
 * Parse Bybit kline rows (descending string arrays
 * `[startTime, open, high, low, close, volume, turnover]`) into ascending Candle objects.
 * @param {string[][]} list
 * @returns {{t:number,o:number,h:number,l:number,c:number,v:number,qv:number}[]}
 */
export function parseKlines(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const r of list) {
    const t = num(r[0]);
    if (!Number.isFinite(t)) continue;
    out.push({ t, o: num(r[1]), h: num(r[2]), l: num(r[3]), c: num(r[4]), v: num(r[5]), qv: num(r[6]) });
  }
  out.sort((a, b) => a.t - b.t);
  // Deduplicate identical open times (can happen across paged responses).
  return out.filter((k, i) => i === 0 || k.t !== out[i - 1].t);
}

/** Parse one instruments-info entry into our Symbol shape (without group). */
export function parseInstrument(category, it) {
  const lot = it.lotSizeFilter || {};
  return {
    key: `${category}:${it.symbol}`,
    symbol: it.symbol,
    category,
    base: it.baseCoin,
    quote: it.quoteCoin,
    tickSize: num(it.priceFilter?.tickSize),
    qtyStep: num(lot.qtyStep ?? lot.basePrecision),
    minQty: num(lot.minOrderQty),
    status: it.status,
    contractType: it.contractType ?? (category === 'spot' ? 'Spot' : undefined),
    launchTime: it.launchTime ? num(it.launchTime) : undefined,
  };
}

/** Parse recent-trade entries into `{ t, p, q, side }`, ascending by time. */
export function parseTrades(list) {
  return (list || [])
    .map((x) => ({ t: num(x.time), p: num(x.price), q: num(x.size), side: x.side === 'Sell' ? 'Sell' : 'Buy', id: x.execId }))
    .filter((x) => Number.isFinite(x.t) && Number.isFinite(x.p))
    .sort((a, b) => a.t - b.t);
}

const RETRY_RETCODES = new Set([10006, 10016, 10002 /* timestamp drift */, 10000 /* server timeout */]);

export class BybitRest {
  /**
   * @param {{ baseUrl?: string, rateLimit?: number, fetch?: typeof fetch, log?: any, maxRetries?: number,
   *   timeoutMs?: number, sleep?: (ms:number)=>Promise<void>, limiter?: RateLimiter, baseDelayMs?: number }} [opts]
   */
  constructor(opts = {}) {
    this.baseUrl = (opts.baseUrl || 'https://api.bybit.com').replace(/\/+$/, '');
    this.fetch = opts.fetch || globalThis.fetch.bind(globalThis);
    this.log = opts.log || console;
    this.maxRetries = opts.maxRetries ?? 5;
    this.timeoutMs = opts.timeoutMs ?? 10000;
    this.sleep = opts.sleep || sleepReal;
    this.baseDelayMs = opts.baseDelayMs ?? 500;
    this.limiter = opts.limiter || new RateLimiter(opts.rateLimit ?? 10, { sleep: this.sleep });
    this.stats = { requests: 0, errors: 0, retries: 0, lastOk: 0, lastError: null, consecutiveFailures: 0 };
  }

  /** 'ok' | 'degraded' | 'down' | 'unknown' based on recent request outcomes. */
  get health() {
    const s = this.stats;
    if (!s.lastOk && !s.lastError) return 'unknown';
    if (s.consecutiveFailures === 0) return 'ok';
    return s.consecutiveFailures >= 3 ? 'down' : 'degraded';
  }

  _backoff(attempt) {
    const exp = this.baseDelayMs * 2 ** attempt;
    return Math.min(30000, exp) * (0.75 + Math.random() * 0.5);
  }

  /**
   * GET a public v5 endpoint, returning `result`.
   * @param {string} path e.g. /v5/market/kline
   * @param {Record<string, any>} [params]
   */
  async get(path, params = {}) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
    const url = `${this.baseUrl}${path}${qs.size ? `?${qs}` : ''}`;
    let lastErr;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      await this.limiter.take();
      this.stats.requests++;
      let res;
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), this.timeoutMs);
      try {
        res = await this.fetch(url, { signal: ac.signal, headers: { accept: 'application/json' } });
      } catch (err) {
        clearTimeout(timer);
        lastErr = new BybitError(`Network error for ${path}: ${err.message}`, { cause: err, retryable: true });
        if (attempt < this.maxRetries) {
          this.stats.retries++;
          await this.sleep(this._backoff(attempt));
          continue;
        }
        break;
      }
      let body;
      let text = '';
      try {
        text = await res.text();
        body = text ? JSON.parse(text) : null;
      } catch {
        body = null;
      } finally {
        clearTimeout(timer);
      }
      if (res.status === 429 || res.status >= 500 || (body?.retCode != null && RETRY_RETCODES.has(body.retCode))) {
        const retCode = body?.retCode;
        lastErr = new BybitError(`Bybit ${path} ${res.status}${retCode != null ? ` retCode ${retCode}` : ''}: ${body?.retMsg ?? text.slice(0, 120)}`, {
          retCode, status: res.status, retryable: true,
        });
        if (attempt < this.maxRetries) {
          this.stats.retries++;
          let delay = this._backoff(attempt);
          // Honour Bybit's reset timestamp header when present.
          const reset = Number(res.headers?.get?.('x-bapi-limit-reset-timestamp'));
          if (Number.isFinite(reset) && reset > Date.now()) delay = Math.max(delay, Math.min(reset - Date.now() + 50, 30000));
          if (res.status === 429 || retCode === 10006) this.limiter.penalize(delay);
          await this.sleep(delay);
          continue;
        }
        break;
      }
      if (!res.ok || !body || body.retCode !== 0) {
        lastErr = new BybitError(
          `Bybit ${path} failed (HTTP ${res.status}${body?.retCode != null ? `, retCode ${body.retCode}` : ''}): ${body?.retMsg ?? text.slice(0, 160)}`,
          { retCode: body?.retCode, status: res.status },
        );
        break;
      }
      this.stats.lastOk = Date.now();
      this.stats.consecutiveFailures = 0;
      return body.result;
    }
    this.stats.errors++;
    this.stats.consecutiveFailures++;
    this.stats.lastError = { t: Date.now(), message: lastErr?.message };
    throw lastErr;
  }

  /** Server time in ms. */
  async getServerTime() {
    const r = await this.get('/v5/market/time');
    return Math.floor(Number(r.timeNano) / 1e6) || Number(r.timeSecond) * 1000;
  }

  /**
   * One kline page. Returns ascending candles.
   * @param {{ category?: string, symbol: string, interval?: string, tf?: string, start?: number, end?: number, limit?: number }} p
   */
  async getKlines({ category = 'linear', symbol, interval, tf, start, end, limit = 1000 }) {
    const iv = toBybitInterval(interval ?? tf);
    const r = await this.get('/v5/market/kline', { category, symbol, interval: iv, start, end, limit: Math.min(1000, limit) });
    return parseKlines(r?.list);
  }

  /**
   * All klines with open time in [start, end], paging backwards from `end` (Bybit returns the most recent
   * `limit` bars of a window). Stops when a page is short or empty (listing start). Calls `onPage(candles)`
   * (ascending page) after each page so callers can persist incrementally. Resolves ascending candles
   * (unless `collect` is false, in which case it resolves []).
   * @returns {Promise<{t:number,o:number,h:number,l:number,c:number,v:number,qv:number}[]>}
   */
  async getKlinesRange({ category = 'linear', symbol, tf, start, end = Date.now(), onPage, collect = true, limit = 1000 }) {
    const out = [];
    let cursor = end;
    let guard = 0;
    while (cursor >= start && guard++ < 100000) {
      const page = await this.getKlines({ category, symbol, tf, start, end: cursor, limit });
      const inRange = page.filter((k) => k.t >= start && k.t <= end);
      if (inRange.length) {
        if (onPage) await onPage(inRange);
        if (collect) out.push(...inRange);
      }
      if (page.length < limit || !page.length) break; // reached listing start or start of window
      const oldest = page[0].t;
      if (oldest <= start) break;
      const nextCursor = oldest - 1;
      if (nextCursor >= cursor) break; // safety against no progress
      cursor = nextCursor;
    }
    if (!collect) return [];
    out.sort((a, b) => a.t - b.t);
    return out.filter((k, i) => i === 0 || k.t !== out[i - 1].t);
  }

  /** All instruments in a category (paginated by cursor). Only instruments currently Trading unless `all`. */
  async getInstruments(category = 'linear', { all = false } = {}) {
    const out = [];
    let cursor;
    let guard = 0;
    do {
      const r = await this.get('/v5/market/instruments-info', { category, limit: 1000, cursor });
      for (const it of r?.list || []) {
        if (!all && it.status && it.status !== 'Trading') continue;
        out.push(parseInstrument(category, it));
      }
      cursor = r?.nextPageCursor || undefined;
    } while (cursor && guard++ < 100);
    return out;
  }

  /** Instruments of spot, linear and inverse. Categories that fail are logged and skipped. */
  async getAllInstruments(categories = ['linear', 'spot', 'inverse']) {
    const results = await Promise.allSettled(categories.map((c) => this.getInstruments(c)));
    const out = [];
    let failures = 0;
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') out.push(...r.value);
      else {
        failures++;
        this.log.warn?.(`instruments ${categories[i]} failed: ${r.reason?.message}`);
      }
    });
    if (failures === categories.length) throw results[0].reason;
    return out;
  }

  /** Tickers `{ symbol, lastPrice, turnover24h, volume24h, price24hPcnt, ... }` with numeric fields. */
  async getTickers(category = 'linear', symbol) {
    const r = await this.get('/v5/market/tickers', { category, symbol });
    return (r?.list || []).map((x) => ({
      ...x,
      category,
      lastPrice: num(x.lastPrice),
      turnover24h: num(x.turnover24h),
      volume24h: num(x.volume24h),
      price24hPcnt: num(x.price24hPcnt),
      highPrice24h: num(x.highPrice24h),
      lowPrice24h: num(x.lowPrice24h),
    }));
  }

  /** Recent public trades `{ t, p, q, side }` ascending. */
  async getRecentTrades({ category = 'linear', symbol, limit = 1000 }) {
    const max = category === 'spot' ? 60 : 1000;
    const r = await this.get('/v5/market/recent-trade', { category, symbol, limit: Math.min(limit, max) });
    return parseTrades(r?.list);
  }
}

/** Accept canonical tf ids, aliases or raw Bybit codes. */
export function toBybitInterval(x) {
  const tf = normalizeTf(x);
  if (tf) {
    const code = tfToBybit(tf);
    if (!code) throw new BybitError(`Timeframe ${tf} is not served by Bybit`);
    return code;
  }
  bybitToTf(x); // throws if unknown
  return String(x);
}
