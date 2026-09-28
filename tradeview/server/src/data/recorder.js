// 24/7 trade recorder (ARCHITECTURE §13.1). Delta publishes no historical trade dumps, so the server records
// live trades for every RECORD_SYMBOLS entry: footprint bars for 1m..1h (persisted by LiveHub on every bar roll)
// and raw trades into the `trades` table, pruned after TRADES_RETENTION_DAYS.
import { FOOTPRINT_TFS, MS } from './timeframes.js';
import { parseSymbolKey } from '../bybit/markets.js';

const FLUSH_MS = 1000;
const PRUNE_MS = 60 * 60 * 1000;
const MAX_BUFFER = 50000;

export class Recorder {
  /**
   * @param {{ live: import('./live.js').LiveHub, repos: any, config?: any, log?: any, now?: () => number,
   *   tfs?: string[] }} opts
   */
  constructor({ live, repos, config = {}, log, now, tfs = FOOTPRINT_TFS }) {
    this.live = live;
    this.repos = repos;
    this.config = config;
    this.log = log || console;
    this.now = now || (() => Date.now());
    this.tfs = tfs;
    this.symbols = new Set();
    /** @type {Map<string, any[]>} */
    this.buffer = new Map();
    this.recorded = 0;
    this.dropped = 0;
    this.timers = { flush: null, prune: null };
    this._onTrades = (e) => this._collect(e);
  }

  /**
   * Start recording. Invalid keys are skipped with a warning.
   * @param {string[]} [symbols] defaults to config.recordSymbols
   */
  start(symbols = this.config.recordSymbols || []) {
    this.live.on('trades', this._onTrades);
    for (const spec of symbols) {
      let key;
      try {
        key = parseSymbolKey(spec).key;
      } catch (err) {
        this.log.warn?.(`recorder: skipping "${spec}": ${err.message}`);
        continue;
      }
      if (this.symbols.has(key)) continue;
      this.symbols.add(key);
      for (const tf of this.tfs) this.live.acquire('footprint', key, tf);
    }
    this.timers.flush = setInterval(() => this.flush(), FLUSH_MS);
    this.timers.flush.unref?.();
    this.timers.prune = setInterval(() => this.prune(), PRUNE_MS);
    this.timers.prune.unref?.();
    this.prune();
    if (this.symbols.size) this.log.info?.(`recorder: recording trades + footprint for ${[...this.symbols].join(', ')}`);
    return this;
  }

  _collect({ symbol, trades }) {
    if (!this.symbols.has(symbol) || !trades?.length) return;
    let buf = this.buffer.get(symbol);
    if (!buf) this.buffer.set(symbol, (buf = []));
    if (buf.length + trades.length > MAX_BUFFER) {
      this.dropped += trades.length;
      return;
    }
    buf.push(...trades);
  }

  /** Write buffered trades (one transaction per symbol). */
  flush() {
    for (const [symbol, buf] of this.buffer) {
      if (!buf.length) continue;
      this.buffer.set(symbol, []);
      try {
        this.recorded += this.repos.trades.insertMany(symbol, buf);
      } catch (err) {
        this.log.warn?.(`recorder: writing ${buf.length} trades for ${symbol} failed: ${err.message}`);
      }
    }
  }

  /** Delete raw trades older than the retention window. */
  prune() {
    const days = Number(this.config.tradesRetentionDays ?? 30);
    if (!(days > 0)) return 0;
    try {
      const n = this.repos.trades.prune(this.now() - days * MS.DAY);
      if (n) this.log.info?.(`recorder: pruned ${n} trades older than ${days} days`);
      return n;
    } catch (err) {
      this.log.warn?.(`recorder: prune failed: ${err.message}`);
      return 0;
    }
  }

  status() {
    return { symbols: [...this.symbols], recorded: this.recorded, dropped: this.dropped };
  }

  stop() {
    clearInterval(this.timers.flush);
    clearInterval(this.timers.prune);
    this.flush();
    this.live.off('trades', this._onTrades);
    for (const key of this.symbols) for (const tf of this.tfs) this.live.release('footprint', key, tf);
    this.symbols.clear();
  }
}
