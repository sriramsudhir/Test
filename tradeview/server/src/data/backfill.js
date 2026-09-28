// Historical backfill (ARCHITECTURE §3): resumable backwards paging of Bybit klines for every native tf,
// plus optional footprint history from public.bybit.com daily trade dumps (gzipped CSV, stream-parsed).
import zlib from 'node:zlib';
import readline from 'node:readline';
import { Readable } from 'node:stream';
import { NATIVE_TFS, FOOTPRINT_TFS, normalizeTf, floorTime, addBars, MS } from './timeframes.js';
import { FootprintAggregator, footprintTick } from './footprint.js';
import { parseSymbolKey, GROUPS } from '../bybit/markets.js';

const FP_STATE_TF = 'fp'; // backfill_state row tracking footprint days [oldest, newest] (UTC day starts)

// ---------------------------------------------------------------- symbol resolution

/**
 * Expand CLI/config symbol specs into symbol keys.
 * Accepts keys (`delta:BTCUSD`, `linear:BTCUSDT`, bare `BTCUSDT` = Bybit linear), `delta` (all live Delta
 * perpetuals), `delta:top:<N>` (top N Delta perpetuals by turnover), Bybit group names (`crypto`, `forex`,
 * `commodities`, `group:<name>`), `top:<N>` (top N Bybit linear USDT perps) and `default` (config.defaultSymbols).
 * @param {string[]} specs
 * @param {{ instruments: import('../bybit/instruments.js').Instruments, config: any, log?: any }} deps
 * @returns {Promise<string[]>}
 */
export async function resolveSymbols(specs, { instruments, config, log }) {
  const out = new Set();
  const needsCatalogue = specs.some((s) => !s.includes(':') || /(^group:|top:)/i.test(s));
  if (needsCatalogue) await instruments.load();
  const expand = async (spec, depth = 0) => {
    const s = spec.trim();
    if (!s) return;
    const lower = s.toLowerCase();
    if (lower === 'default') {
      if (depth > 2) return;
      for (const d of config.defaultSymbols || []) await expand(d, depth + 1);
      return;
    }
    if (lower.startsWith('delta:top:')) {
      const n = Number.parseInt(lower.slice(10), 10) || 10;
      for (const k of await instruments.topDelta(n)) out.add(k);
      return;
    }
    if (lower === 'delta') {
      const keys = instruments.list({ provider: 'delta', contractType: 'perpetual_futures' }).map((x) => x.key);
      if (!keys.length) log?.warn?.('"delta" resolved to no instruments (is the Delta instrument list reachable?)');
      keys.forEach((k) => out.add(k));
      return;
    }
    if (lower.startsWith('top:')) {
      const n = Number.parseInt(lower.slice(4), 10) || 20;
      for (const k of await instruments.topLinear(n)) out.add(k);
      return;
    }
    const group = lower.startsWith('group:') ? lower.slice(6) : lower;
    if (GROUPS.includes(group)) {
      const keys = group === 'crypto'
        ? instruments.groupKeys('crypto', ['linear']).filter((k) => k.endsWith('USDT'))
        : instruments.groupKeys(group, ['linear', 'spot']);
      if (!keys.length) log?.warn?.(`group "${group}" resolved to no instruments (is the instrument list loaded?)`);
      keys.forEach((k) => out.add(k));
      return;
    }
    out.add(parseSymbolKey(s).key);
  };
  for (const s of specs) await expand(s);
  return [...out];
}

/** Parse `--tf` values: "all" or a comma list (aliases allowed). Returns native Bybit tfs only. */
export function parseTfList(spec) {
  if (!spec || spec === 'all') return [...NATIVE_TFS];
  const tfs = String(spec).split(',').map((x) => normalizeTf(x.trim()));
  const bad = String(spec).split(',').filter((x, i) => !tfs[i] || !NATIVE_TFS.includes(tfs[i]));
  if (bad.length) throw new Error(`Unsupported timeframe(s) for backfill: ${bad.join(', ')} (native: ${NATIVE_TFS.join(' ')})`);
  return [...new Set(tfs)];
}

/** Run `fn` over items with at most `n` in flight. */
export async function runPool(items, n, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(n, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------- trade dumps

/** Normalise a dump timestamp (seconds float, ms, or µs) to ms. */
export function normalizeTimestamp(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return NaN;
  if (n < 1e11) return Math.round(n * 1000); // seconds (possibly fractional)
  if (n < 1e14) return Math.round(n); // ms
  return Math.round(n / 1000); // µs
}

const HEADER_ALIASES = {
  t: ['timestamp', 'time', 'ts', 'trade_time_ms', 'T'],
  side: ['side', 'S'],
  q: ['size', 'volume', 'qty', 'quantity', 'v'],
  p: ['price', 'p'],
};

/**
 * Column layout from a header line, or null if the line is not a header.
 * Linear dump header: `timestamp,symbol,side,size,price,tickDirection,trdMatchID,grossValue,homeNotional,foreignNotional`
 * Spot dump header:   `id,timestamp,price,volume,side`
 */
export function detectColumns(line) {
  const cells = line.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
  // Every Bybit dump data line starts with a number (timestamp or trade id); a header does not.
  if (cells[0] !== '' && Number.isFinite(Number(cells[0]))) return null;
  const lower = cells.map((c) => c.toLowerCase());
  const idx = {};
  for (const [k, names] of Object.entries(HEADER_ALIASES)) {
    idx[k] = lower.findIndex((c) => names.map((n) => n.toLowerCase()).includes(c));
  }
  // Unrecognised header: assume the linear layout.
  if (idx.t < 0 || idx.p < 0 || idx.q < 0 || idx.side < 0) return { ...LINEAR_LAYOUT };
  return idx;
}

/** Default layout for header-less linear dumps: timestamp,symbol,side,size,price,... */
export const LINEAR_LAYOUT = Object.freeze({ t: 0, side: 2, q: 3, p: 4 });

/** Parse one CSV data line using a column layout. Returns null for malformed lines. */
export function parseDumpLine(line, cols = LINEAR_LAYOUT) {
  if (!line) return null;
  const cells = line.split(',');
  const t = normalizeTimestamp(cells[cols.t]);
  const p = Number(cells[cols.p]);
  const q = Number(cells[cols.q]);
  const sideRaw = (cells[cols.side] || '').trim().toLowerCase();
  if (!Number.isFinite(t) || !Number.isFinite(p) || !Number.isFinite(q)) return null;
  const side = sideRaw === 'buy' || sideRaw === 'b' ? 'Buy' : sideRaw === 'sell' || sideRaw === 's' ? 'Sell' : null;
  if (!side) return null;
  return { t, p, q, side };
}

/**
 * Stream-parse a gzipped Bybit trade dump.
 * @param {import('node:stream').Readable} gzStream gzipped CSV bytes
 * @param {(trade: {t:number,p:number,q:number,side:'Buy'|'Sell'}) => void} onTrade
 * @returns {Promise<{ lines: number, trades: number, skipped: number }>}
 */
export async function parseTradeDump(gzStream, onTrade) {
  const gunzip = zlib.createGunzip();
  gzStream.on('error', (e) => gunzip.destroy(e));
  const rl = readline.createInterface({ input: gzStream.pipe(gunzip), crlfDelay: Infinity });
  let cols = null;
  let first = true;
  let lines = 0;
  let trades = 0;
  let skipped = 0;
  for await (const raw of rl) {
    const line = raw.trim();
    if (!line) continue;
    lines++;
    if (first) {
      first = false;
      cols = detectColumns(line);
      if (cols) continue; // header consumed
      cols = LINEAR_LAYOUT;
    }
    const tr = parseDumpLine(line, cols);
    if (tr) {
      trades++;
      onTrade(tr);
    } else skipped++;
  }
  return { lines, trades, skipped };
}

const pad = (n) => String(n).padStart(2, '0');
export function isoDay(t) {
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Candidate dump URLs for a symbol/day (first that exists wins). */
export function dumpUrls(baseUrl, category, symbol, day) {
  const d = isoDay(day);
  if (category === 'spot') {
    return [`${baseUrl}/spot/${symbol}/${symbol}_${d}.csv.gz`, `${baseUrl}/spot/${symbol}/${symbol}${d}.csv.gz`];
  }
  return [`${baseUrl}/trading/${symbol}/${symbol}${d}.csv.gz`];
}

// ---------------------------------------------------------------- Backfiller

export class Backfiller {
  /**
   * @param {{ repos: any, rest: import('../bybit/rest.js').BybitRest, instruments?: any, market?: any,
   *   config?: any, log?: any, fetch?: typeof fetch, now?: () => number }} opts
   */
  constructor({ repos, rest, instruments, market, config = {}, log, fetch: fetchImpl, now }) {
    this.repos = repos;
    this.rest = rest;
    this.instruments = instruments;
    this.market = market;
    this.config = config;
    this.log = log || console;
    this.fetch = fetchImpl || globalThis.fetch.bind(globalThis);
    this.now = now || (() => Date.now());
  }

  /**
   * Backfill one symbol/tf back to `now - days`. Resumable: coverage is tracked in backfill_state and
   * updated after every stored page.
   * @param {{ key: string, tf: string, days?: number, onProgress?: (p: any) => void }} o
   * @returns {Promise<{ key: string, tf: string, stored: number, oldest: number, newest: number, complete: boolean }>}
   */
  async backfillCandles({ key, tf, days = 365, onProgress }) {
    const { category, symbol } = parseSymbolKey(key);
    const now = this.now();
    const target = floorTime(now - days * MS.DAY, tf);
    const lastClosed = addBars(now, tf, -1);
    const repo = this.repos.backfillState;
    let stored = 0;
    let state = repo.get(key, tf);
    const report = (phase) => {
      const st = repo.get(key, tf) || { oldest: now, newest: lastClosed };
      const span = Math.max(1, st.newest - target);
      const pct = Math.max(0, Math.min(100, ((st.newest - Math.max(st.oldest, target)) / span) * 100));
      onProgress?.({ key, tf, phase, stored, oldest: st.oldest, newest: st.newest, target, pct });
    };

    // 1) Forward: bring an existing range up to date.
    if (state && state.newest < lastClosed) {
      await this.rest.getKlinesRange({
        category, symbol, tf, start: state.newest, end: now, collect: false,
        onPage: (page) => {
          stored += this.repos.candles.upsertMany(key, tf, page);
        },
      });
      state = repo.extend(key, tf, { newest: lastClosed });
      report('forward');
    }

    // 2) Backward: page from the oldest covered bar (or now) down to the target.
    if (!state || state.oldest > target) {
      const end = state ? state.oldest - 1 : now;
      await this.rest.getKlinesRange({
        category, symbol, tf, start: target, end, collect: false,
        onPage: (page) => {
          stored += this.repos.candles.upsertMany(key, tf, page);
          const cur = repo.get(key, tf);
          if (!cur) repo.set(key, tf, { oldest: page[0].t, newest: Math.min(lastClosed, page[page.length - 1].t) });
          else repo.set(key, tf, { oldest: Math.min(cur.oldest, page[0].t), newest: cur.newest });
          report('backward');
        },
      });
      // Reached the target or the listing start: mark the whole requested range as covered.
      const cur = repo.get(key, tf);
      repo.set(key, tf, { oldest: Math.min(cur?.oldest ?? target, target), newest: cur?.newest ?? lastClosed });
    }
    const fin = repo.get(key, tf);
    report('done');
    return { key, tf, stored, oldest: fin.oldest, newest: fin.newest, complete: fin.oldest <= target };
  }

  /**
   * Download daily trade dumps and aggregate them into footprint bars for tfs 1m..1h.
   * Resumable per day (backfill_state row `(key, 'fp')`).
   * @param {{ key: string, days?: number, tfs?: string[], onProgress?: (p: any) => void }} o
   */
  async backfillFootprint({ key, days = 365, tfs = FOOTPRINT_TFS, onProgress }) {
    const { category, symbol } = parseSymbolKey(key);
    const now = this.now();
    const today = floorTime(now, '1D');
    const yesterday = today - MS.DAY;
    const target = today - days * MS.DAY;
    const repo = this.repos.backfillState;
    const base = this.config.bybitDumps || 'https://public.bybit.com';
    let tick = this.market?.footprintTickFor?.(key);
    let daysDone = 0;
    let daysMissing = 0;
    let trades = 0;

    const doDay = async (day) => {
      const res = await this._openDump(dumpUrls(base, category, symbol, day));
      if (!res) return false;
      let aggs = null;
      const stats = await parseTradeDump(res, (tr) => {
        if (!aggs) {
          tick ??= this.market?.footprintTickFor?.(key, tr.p)
            ?? footprintTick(tr.p, this.instruments?.tickSize?.(key), this.config.footprintTickMult ?? 'auto');
          aggs = tfs.map((tf) => new FootprintAggregator(tf, tick));
        }
        for (const a of aggs) a.add(tr);
      });
      trades += stats.trades;
      if (aggs) for (const a of aggs) this.repos.footprint.upsertBars(key, a.tf, a.toBars());
      return true;
    };

    const state = repo.get(key, FP_STATE_TF);
    const total = Math.round((yesterday - target) / MS.DAY) + 1;
    const progress = (day, phase) => onProgress?.({ key, day: isoDay(day), phase, daysDone, daysMissing, total, trades });

    // Forward: days after the covered range (ascending, stop at the first unpublished day).
    if (state) {
      for (let d = state.newest + MS.DAY; d <= yesterday; d += MS.DAY) {
        if (!(await doDay(d))) {
          daysMissing++;
          break;
        }
        daysDone++;
        repo.extend(key, FP_STATE_TF, { newest: d });
        progress(d, 'forward');
      }
    }
    // Backward: descending from before the covered range (or yesterday) to the target.
    let d = state ? state.oldest - MS.DAY : yesterday;
    let misses = 0;
    for (; d >= target; d -= MS.DAY) {
      const ok = await doDay(d);
      if (!ok) {
        daysMissing++;
        misses++;
        progress(d, 'missing');
        // Several consecutive missing days = before the listing (or dumps not published): stop.
        if (misses >= 3 && repo.get(key, FP_STATE_TF)) break;
        if (misses >= 7) break;
        continue;
      }
      misses = 0;
      daysDone++;
      const cur = repo.get(key, FP_STATE_TF);
      if (!cur) repo.set(key, FP_STATE_TF, { oldest: d, newest: d });
      else repo.set(key, FP_STATE_TF, { oldest: Math.min(cur.oldest, d), newest: cur.newest });
      progress(d, 'backward');
    }
    return { key, daysDone, daysMissing, trades, tick };
  }

  /** GET the first existing URL as a Node Readable of gzipped bytes, or null if none exist (404). */
  async _openDump(urls) {
    for (const url of urls) {
      let res;
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          res = await this.fetch(url);
        } catch (err) {
          if (attempt === 3) throw new Error(`download ${url} failed: ${err.message}`);
          await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
          continue;
        }
        if (res.status >= 500 || res.status === 429) {
          if (attempt === 3) throw new Error(`download ${url} failed: HTTP ${res.status}`);
          await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
          continue;
        }
        break;
      }
      if (res.status === 404 || res.status === 403) continue;
      if (!res.ok) throw new Error(`download ${url} failed: HTTP ${res.status}`);
      return res.body && typeof res.body.getReader === 'function' ? Readable.fromWeb(res.body) : Readable.from(res.body);
    }
    return null;
  }

  /**
   * Backfill many symbols. Symbols run with `concurrency` in parallel; timeframes of one symbol run in order.
   * @param {{ symbols: string[], days?: number, tfs?: string[], footprint?: boolean, concurrency?: number,
   *   onEvent?: (e: any) => void }} o
   */
  async run({ symbols, days = 365, tfs = NATIVE_TFS, footprint = false, concurrency = 2, onEvent }) {
    const emit = (e) => onEvent?.(e);
    const summary = { symbols: symbols.length, jobs: 0, stored: 0, failed: [], footprint: [] };
    await runPool(symbols, concurrency, async (key) => {
      emit({ type: 'symbol_start', key });
      for (const tf of tfs) {
        const t0 = Date.now();
        try {
          const r = await this.backfillCandles({ key, tf, days, onProgress: (p) => emit({ type: 'progress', ...p }) });
          summary.jobs++;
          summary.stored += r.stored;
          emit({ type: 'tf_done', ...r, ms: Date.now() - t0 });
        } catch (err) {
          summary.failed.push({ key, tf, error: err.message });
          emit({ type: 'error', key, tf, error: err.message });
        }
      }
      if (footprint && parseSymbolKey(key).category === 'delta') {
        // Delta publishes no trade dumps: footprint history accumulates from the live recorder (RECORD_SYMBOLS).
        emit({ type: 'fp_skip', key, reason: 'Delta has no public trade dumps; footprint is recorded live (RECORD_SYMBOLS)' });
      } else if (footprint) {
        try {
          const r = await this.backfillFootprint({ key, days, onProgress: (p) => emit({ type: 'fp_progress', ...p }) });
          summary.footprint.push(r);
          emit({ type: 'fp_done', ...r });
        } catch (err) {
          summary.failed.push({ key, tf: 'footprint', error: err.message });
          emit({ type: 'error', key, tf: 'footprint', error: err.message });
        }
      }
      emit({ type: 'symbol_done', key });
    });
    return summary;
  }
}
