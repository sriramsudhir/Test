// 24/7 trade recorder (ARCHITECTURE §13.1). Delta publishes no historical trade dumps, so the server records
// live trades for every RECORD_SYMBOLS entry: footprint bars for 1m..1h (persisted by LiveHub on every bar roll)
// and raw trades into the `trades` table, pruned after TRADES_RETENTION_DAYS.
import { FOOTPRINT_TFS, MS } from './timeframes.js';
import { parseSymbolKey } from '../bybit/markets.js';

const FLUSH_MS = 1000;
const PRUNE_MS = 60 * 60 * 1000;
const MAX_BUFFER = 50000;
const PRUNE_BATCH = 20000; // rows per DELETE; the rest of a backlog continues on later event-loop turns
/** Footprint timeframes subject to FOOTPRINT_RETENTION_DAYS (15m..1h are small and kept). */
export const FOOTPRINT_PRUNE_TFS = ['1m', '3m', '5m'];

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
    this.pruning = false;
    this.stopped = false;
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

  /**
   * Delete raw trades older than TRADES_RETENTION_DAYS and fine-timeframe footprint older than
   * FOOTPRINT_RETENTION_DAYS. Work is done in bounded batches: the first batch runs synchronously, a larger
   * backlog (e.g. after a long downtime) continues on later event-loop turns so live data keeps flowing.
   * @returns {number} rows deleted synchronously
   */
  prune() {
    if (this.pruning) return 0;
    const jobs = this._pruneJobs();
    if (!jobs.length) return 0;
    this.pruning = true;
    const total = { trades: 0, footprint: 0 };
    let n = 0;
    const step = () => {
      try {
        while (jobs.length) {
          const job = jobs[0];
          const r = job.run();
          total[job.kind] += r.deleted;
          if (r.done) jobs.shift();
          if (r.deleted > 0) return r.deleted; // yield after every non-empty batch
        }
      } catch (err) {
        this.log.warn?.(`recorder: prune failed: ${err.message}`);
        jobs.length = 0;
      }
      return 0;
    };
    const finish = () => {
      this.pruning = false;
      if (total.trades) this.log.info?.(`recorder: pruned ${total.trades} trades older than ${this.config.tradesRetentionDays ?? 30} days`);
      if (total.footprint) this.log.info?.(`recorder: pruned ${total.footprint} footprint rows older than ${this.config.footprintRetentionDays} days`);
    };
    n = step();
    if (!jobs.length) {
      finish();
      return n;
    }
    const again = () => {
      if (this.stopped) {
        this.pruning = false;
        return;
      }
      step();
      if (jobs.length) setImmediate(again);
      else finish();
    };
    setImmediate(again);
    return n;
  }

  _pruneJobs() {
    const jobs = [];
    const now = this.now();
    const days = Number(this.config.tradesRetentionDays ?? 30);
    if (days > 0 && this.repos.trades) {
      const before = now - days * MS.DAY;
      jobs.push({
        kind: 'trades',
        run: () => {
          const deleted = this.repos.trades.pruneBatch
            ? this.repos.trades.pruneBatch(before, PRUNE_BATCH)
            : this.repos.trades.prune(before);
          return { deleted, done: !this.repos.trades.pruneBatch || deleted < PRUNE_BATCH };
        },
      });
    }
    const fpDays = Number(this.config.footprintRetentionDays ?? 0);
    if (fpDays > 0 && this.repos.footprint?.pruneSlice) {
      const before = now - fpDays * MS.DAY;
      let symbols = [];
      try {
        symbols = this.repos.footprint.symbols();
      } catch (err) {
        this.log.warn?.(`recorder: listing footprint symbols failed: ${err.message}`);
      }
      for (const symbol of symbols) {
        for (const tf of FOOTPRINT_PRUNE_TFS) {
          jobs.push({ kind: 'footprint', run: () => this.repos.footprint.pruneSlice(symbol, tf, before) });
        }
      }
    }
    return jobs;
  }

  status() {
    return { symbols: [...this.symbols], recorded: this.recorded, dropped: this.dropped };
  }

  stop() {
    this.stopped = true;
    clearInterval(this.timers.flush);
    clearInterval(this.timers.prune);
    this.flush();
    this.live.off('trades', this._onTrades);
    for (const key of this.symbols) for (const tf of this.tfs) this.live.release('footprint', key, tf);
    this.symbols.clear();
  }
}
