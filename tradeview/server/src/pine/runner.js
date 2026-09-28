// Pine Script runner (§8, §11). `runPine({candles, source, inputs?})` -> {plots, meta, strategy?, alerts, warnings}.
//
// Scripts run in a small pool of worker threads so that a runaway script (infinite loop, huge
// allocation) is killed after `timeoutMs` without blocking the server's event loop. Candles use the
// TradeView shape ({t,o,h,l,c,v}); PineTS-shaped candles are accepted too.
import { Worker } from 'node:worker_threads';
import os from 'node:os';
import { toPineCandles, PineError } from './normalize.js';
import { executePine } from './exec.js';

export { PineError } from './normalize.js';

export const DEFAULT_TIMEOUT_MS = 15000;
const POOL_SIZE = Math.max(1, Math.min(4, (os.availableParallelism?.() ?? os.cpus().length) - 1));
const WORKER_URL = new URL('./worker.js', import.meta.url);
/** Jobs waiting for a worker beyond this are refused instead of queueing without bound. */
export const MAX_QUEUE = 64;
/** Per-worker heap cap: a script that allocates without bound kills its worker, not the server. */
const WORKER_HEAP_MB = 512;

class PineWorker {
  constructor(pool) {
    this.pool = pool;
    this.job = null;
    this.worker = new Worker(WORKER_URL, { resourceLimits: { maxOldGenerationSizeMb: WORKER_HEAP_MB } });
    this.worker.unref();
    this.worker.on('message', (msg) => this._settle(msg));
    this.worker.on('error', (err) => this._crash(err));
    this.worker.on('exit', (code) => {
      if (this.job) this._crash(new Error(`Pine worker exited (code ${code})`));
      this.dead = true;
      this.pool._remove(this);
      this.pool._drain();
    });
  }
  run(entry) {
    this.job = entry;
    this.worker.ref();
    entry.timer = setTimeout(() => {
      const job = this.job;
      this.job = null;
      this.dead = true;
      this.worker.terminate().catch(() => {});
      job.reject(new PineError(`Script timed out after ${job.timeoutMs} ms (infinite loop or too much work?)`, { kind: 'timeout' }));
      this.pool._remove(this);
      this.pool._drain();
    }, entry.timeoutMs);
    this.worker.postMessage({ id: entry.id, job: entry.job });
  }
  _settle(msg) {
    const job = this.job;
    if (!job || msg.id !== job.id) return;
    clearTimeout(job.timer);
    this.job = null;
    this.worker.unref();
    if (msg.ok) job.resolve(msg.result);
    else job.reject(new PineError(msg.error.message, msg.error));
    this.pool._drain();
  }
  _crash(err) {
    const job = this.job;
    this.job = null;
    if (job) {
      clearTimeout(job.timer);
      job.reject(new PineError(`Pine engine crashed: ${err?.message || err}`, { kind: 'crash' }));
    }
  }
}

export class PinePool {
  constructor(size) {
    this.size = size;
    this.workers = new Set();
    this.queue = [];
    this.seq = 0;
    this.disabled = false;
  }
  exec(job, timeoutMs) {
    if (this.queue.length >= MAX_QUEUE) {
      return Promise.reject(new PineError('Pine engine is busy (too many queued scripts); try again shortly', { kind: 'busy' }));
    }
    return new Promise((resolve, reject) => {
      this.queue.push({ id: ++this.seq, job, timeoutMs, resolve, reject });
      this._drain();
    });
  }
  _remove(w) {
    this.workers.delete(w);
  }
  _drain() {
    while (this.queue.length) {
      let idle = [...this.workers].find((w) => !w.job && !w.dead);
      if (!idle && this.workers.size < this.size) {
        idle = new PineWorker(this);
        this.workers.add(idle);
      }
      if (!idle) return;
      idle.run(this.queue.shift());
    }
  }
  async close() {
    for (const q of this.queue.splice(0)) q.reject(new PineError('Pine engine shut down', { kind: 'crash' }));
    const ws = [...this.workers];
    this.workers.clear();
    await Promise.all(ws.map((w) => w.worker.terminate().catch(() => {})));
  }
}

let pool = null;
function getPool() {
  if (!pool) pool = new PinePool(POOL_SIZE);
  return pool;
}

/** Terminate the worker pool (tests / shutdown). */
export async function closePinePool() {
  if (pool) await pool.close();
  pool = null;
}

/**
 * Run a Pine Script over candles.
 * @param {object} opts
 * @param {Array} opts.candles           [{t,o,h,l,c,v}] ascending (or PineTS-shaped candles)
 * @param {string} opts.source           Pine Script v5/v6 source
 * @param {object} [opts.inputs]         input overrides keyed by input title, variable name or id
 * @param {object} [opts.props]          declaration overrides (e.g. {initial_capital, commission_value})
 * @param {number} [opts.tfMs]           bar duration (used for closeTime); inferred when omitted
 * @param {number} [opts.timeoutMs]      default 15000
 * @param {boolean} [opts.isolate]       run in a worker thread (default true)
 * @param {'realtime'|'all'} [opts.alertMode] default 'all' (report alerts on every bar)
 * @returns {Promise<{plots:object, meta:object, strategy?:object, alerts:Array, warnings:Array}>}
 * @throws {PineError} with `.line` / `.column` when known
 */
export async function runPine({ candles, source, inputs, props, tfMs, timeoutMs = DEFAULT_TIMEOUT_MS, isolate = true, alertMode = 'all' } = {}) {
  if (typeof source !== 'string' || !source.trim()) throw new PineError('Pine source is empty', { kind: 'input' });
  if (!Array.isArray(candles) || candles.length === 0) throw new PineError('No candles available for this symbol/timeframe', { kind: 'input' });
  const job = { candles: toPineCandles(candles, tfMs), source, inputs: inputs || {}, props: props || {}, alertMode };
  if (isolate) {
    try {
      return await getPool().exec(job, timeoutMs);
    } catch (err) {
      if (err instanceof PineError) throw err;
      throw new PineError(err?.message || String(err));
    }
  }
  let timer;
  try {
    return await Promise.race([
      executePine(job),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new PineError(`Script timed out after ${timeoutMs} ms`, { kind: 'timeout' })), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Last non-null numeric value of a normalised plot, or null. */
export function lastValue(plot) {
  const d = plot?.data;
  if (!d) return null;
  for (let i = d.length - 1; i >= 0; i--) {
    const v = d[i].value;
    if (typeof v === 'number') return v;
    if (typeof v === 'boolean') return v ? 1 : 0;
  }
  return null;
}
