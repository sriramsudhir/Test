// Cached instrument catalogue (spot/linear/inverse) with group classification and tick-size lookup.
// Persisted in the `meta` table so symbols are still listed when Bybit is unreachable.
import { classify, parseSymbolKey, GROUPS } from './markets.js';

const CACHE_KEY = 'instruments.v1';
const TTL_MS = 6 * 60 * 60 * 1000;

export class Instruments {
  /**
   * @param {{ rest: import('./rest.js').BybitRest, repos?: any, log?: any, ttlMs?: number }} opts
   */
  constructor({ rest, repos, log, ttlMs = TTL_MS }) {
    this.rest = rest;
    this.repos = repos;
    this.log = log || console;
    this.ttlMs = ttlMs;
    /** @type {Map<string, any>} key -> Symbol */
    this.byKey = new Map();
    this.loadedAt = 0;
    this.source = 'none';
    this._loading = null;
    this._turnover = new Map(); // key -> 24h turnover (for ranking)
  }

  get size() {
    return this.byKey.size;
  }

  _set(list, source, t = Date.now()) {
    const m = new Map();
    for (const it of list) m.set(it.key, { ...it, group: it.group || classify(it) });
    this.byKey = m;
    this.loadedAt = t;
    this.source = source;
  }

  /** Load from cache or Bybit. Never throws; falls back to the DB cache / symbols seen in candles. */
  async load({ force = false } = {}) {
    if (!force && this.byKey.size && Date.now() - this.loadedAt < this.ttlMs) return this;
    if (this._loading) return this._loading;
    // After a failed refresh, wait a minute before hitting Bybit again (offline mode).
    if (!force && this._failedAt && Date.now() - this._failedAt < 60000) {
      if (!this.byKey.size) this._loadCache();
      if (!this.byKey.size) this._loadFromCandles();
      return this;
    }
    this._loading = (async () => {
      if (!this.byKey.size) this._loadCache();
      if (!force && this.byKey.size && Date.now() - this.loadedAt < this.ttlMs) return this;
      try {
        const list = await this.rest.getAllInstruments();
        if (list.length) {
          this._set(list, 'bybit');
          this.repos?.meta?.set(CACHE_KEY, [...this.byKey.values()]);
          this.log.info?.(`instruments: ${list.length} loaded from Bybit`);
        }
        this._failedAt = 0;
      } catch (err) {
        this._failedAt = Date.now();
        this.log.warn?.(`instruments: Bybit unavailable (${err.message}); using ${this.byKey.size ? 'cache' : 'DB symbols'}`);
        if (!this.byKey.size) this._loadFromCandles();
      }
      return this;
    })().finally(() => {
      this._loading = null;
    });
    return this._loading;
  }

  _loadCache() {
    const c = this.repos?.meta?.get(CACHE_KEY);
    if (c?.value?.length) this._set(c.value, 'cache', c.t);
  }

  _loadFromCandles() {
    const keys = this.repos?.candles?.symbols?.() ?? [];
    const list = [];
    for (const key of keys) {
      try {
        const { category, symbol } = parseSymbolKey(key);
        const quote = (symbol.match(/(USDT|USDC|USD|EUR|BTC|ETH)$/) || [''])[0];
        list.push({ key, symbol, category, base: symbol.slice(0, symbol.length - quote.length), quote, tickSize: NaN, qtyStep: NaN });
      } catch {
        /* skip malformed */
      }
    }
    if (list.length) this._set(list, 'candles', 0);
  }

  /** @returns {any|undefined} */
  get(key) {
    try {
      return this.byKey.get(parseSymbolKey(key).key);
    } catch {
      return undefined;
    }
  }

  has(key) {
    return !!this.get(key);
  }

  tickSize(key) {
    const t = this.get(key)?.tickSize;
    return Number.isFinite(t) && t > 0 ? t : undefined;
  }

  qtyStep(key) {
    const q = this.get(key)?.qtyStep;
    return Number.isFinite(q) && q > 0 ? q : undefined;
  }

  groupOf(key) {
    return this.get(key)?.group ?? classify(parseSymbolKey(key));
  }

  /**
   * List symbols in the public API shape.
   * @param {{ group?: string, q?: string, category?: string, limit?: number }} [f]
   */
  list({ group, q, category, limit } = {}) {
    const query = q ? String(q).toUpperCase().replace(/[^A-Z0-9]/g, '') : '';
    let out = [];
    for (const s of this.byKey.values()) {
      if (group && GROUPS.includes(group) && s.group !== group) continue;
      if (category && s.category !== category) continue;
      if (query && !s.symbol.includes(query) && !(s.base || '').toUpperCase().includes(query)) continue;
      out.push(toPublic(s));
    }
    const catRank = { linear: 0, spot: 1, inverse: 2 };
    out.sort((a, b) => {
      if (query) {
        const ea = a.symbol.startsWith(query) ? 0 : 1;
        const eb = b.symbol.startsWith(query) ? 0 : 1;
        if (ea !== eb) return ea - eb;
      }
      const ta = this._turnover.get(a.key) ?? -1;
      const tb = this._turnover.get(b.key) ?? -1;
      if (ta !== tb) return tb - ta;
      return (catRank[a.category] ?? 9) - (catRank[b.category] ?? 9) || a.symbol.localeCompare(b.symbol);
    });
    if (limit) out = out.slice(0, limit);
    return out;
  }

  /** Top N linear USDT perpetuals by 24h turnover (keys). Falls back to cached ranking or well-known majors. */
  async topLinear(n = 20) {
    try {
      const tickers = await this.rest.getTickers('linear');
      for (const t of tickers) this._turnover.set(`linear:${t.symbol}`, t.turnover24h || 0);
      this.repos?.meta?.set('turnover.linear', Object.fromEntries(this._turnover));
    } catch (err) {
      const c = this.repos?.meta?.get('turnover.linear');
      if (c?.value) for (const [k, v] of Object.entries(c.value)) this._turnover.set(k, v);
      this.log.warn?.(`tickers unavailable (${err.message})${c ? ', using cached ranking' : ''}`);
    }
    const perps = [...this.byKey.values()].filter(
      (s) => s.category === 'linear' && s.quote === 'USDT' && (!s.contractType || s.contractType === 'LinearPerpetual') && s.group === 'crypto',
    );
    let ranked = perps
      .filter((s) => this._turnover.has(s.key))
      .sort((a, b) => this._turnover.get(b.key) - this._turnover.get(a.key))
      .map((s) => s.key);
    if (!ranked.length) {
      ranked = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'BNBUSDT', 'ADAUSDT', 'LINKUSDT', 'AVAXUSDT', 'SUIUSDT']
        .map((s) => `linear:${s}`);
    }
    return ranked.slice(0, n);
  }

  /** Keys of a group, optionally restricted to categories. */
  groupKeys(group, categories) {
    return [...this.byKey.values()]
      .filter((s) => s.group === group && (!categories || categories.includes(s.category)))
      .map((s) => s.key);
  }
}

export function toPublic(s) {
  return {
    key: s.key,
    symbol: s.symbol,
    category: s.category,
    group: s.group,
    base: s.base,
    quote: s.quote,
    tickSize: Number.isFinite(s.tickSize) ? s.tickSize : null,
    qtyStep: Number.isFinite(s.qtyStep) ? s.qtyStep : null,
  };
}
