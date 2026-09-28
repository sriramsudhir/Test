// Pure helpers that turn a PineTS Context into the TradeView contract shape (§4, §8).
// Kept free of PineTS imports so it can run both in the worker and in tests.

/** Map a TradeView candle ({t,o,h,l,c,v}) or a PineTS-style candle to the shape PineTS expects. */
export function toPineCandles(candles, tfMs) {
  if (!Array.isArray(candles)) throw new PineError('candles must be an array');
  const out = new Array(candles.length);
  let step = tfMs;
  if (!step && candles.length > 1) {
    const a = candles[0].t ?? candles[0].openTime;
    const b = candles[1].t ?? candles[1].openTime;
    step = Math.max(1, b - a);
  }
  if (!step) step = 60000;
  for (let i = 0; i < candles.length; i++) {
    const k = candles[i];
    if ('openTime' in k) {
      out[i] = {
        open: +k.open, high: +k.high, low: +k.low, close: +k.close, volume: +(k.volume ?? 0),
        openTime: +k.openTime, closeTime: +(k.closeTime ?? k.openTime + step - 1),
      };
    } else {
      out[i] = {
        open: +k.o, high: +k.h, low: +k.l, close: +k.c, volume: +(k.v ?? 0),
        openTime: +k.t, closeTime: +k.t + step - 1,
      };
    }
  }
  return out;
}

export class PineError extends Error {
  /** @param {string} message @param {{line?:number, column?:number, kind?:string}} [info] */
  constructor(message, info = {}) {
    super(message);
    this.name = 'PineError';
    this.line = info.line;
    this.column = info.column;
    this.kind = info.kind || 'runtime';
  }
  toJSON() {
    return { message: this.message, line: this.line, column: this.column, kind: this.kind };
  }
}

const INTERNAL_PLOT = /^__.*__$/;

function cleanValue(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return v;
  return null;
}

/**
 * Normalise PineTS `plots` into `{ name: { data:[{t,value,color?}], options } }`.
 * - drops PineTS internal drawing buckets (__labels__, __lines__, ...)
 * - converts NaN/undefined to null
 * - applies `offset=` by shifting values across bar times
 * - keeps a per-point `color` only when it differs from the plot's base colour
 */
export function normalizePlots(plots, times) {
  const out = {};
  if (!plots) return out;
  for (const [name, plot] of Object.entries(plots)) {
    if (INTERNAL_PLOT.test(name)) continue;
    const src = Array.isArray(plot?.data) ? plot.data : [];
    const options = { ...(plot?.options || {}) };
    const baseColor = options.color ?? null;
    const offset = Number.isInteger(options.offset) ? options.offset : 0;
    let data;
    if (offset !== 0 && times && times.length) {
      // value computed on bar i is displayed on bar i + offset
      const idxByTime = new Map();
      for (let i = 0; i < times.length; i++) idxByTime.set(times[i], i);
      data = [];
      for (const p of src) {
        const i = idxByTime.get(p.time);
        if (i === undefined) continue;
        const j = i + offset;
        if (j < 0 || j >= times.length) continue;
        data.push(point(times[j], p, baseColor));
      }
      data.sort((a, b) => a.t - b.t);
      options.offsetApplied = offset;
      delete options.offset;
    } else {
      data = src.map((p) => point(p.time, p, baseColor));
    }
    out[name] = { data, options };
  }
  return out;
}

function point(t, p, baseColor) {
  const o = { t, value: cleanValue(p.value) };
  const c = p.options?.color;
  if (c !== undefined && c !== baseColor) o.color = c;
  return o;
}

/** Declaration metadata (indicator() or strategy()). */
export function normalizeMeta(ctx, inputsMeta = []) {
  const decl = ctx?.indicator || ctx?.strategy?.config || {};
  return {
    type: ctx?.strategy ? 'strategy' : 'indicator',
    title: decl.title || 'Untitled',
    shorttitle: decl.shorttitle || '',
    overlay: !!decl.overlay,
    format: decl.format,
    precision: decl.precision,
    inputs: inputsMeta.map((m) => ({
      id: m.id, name: m.title ?? m.name, type: m.type, defval: m.defval, varId: m.varId,
      ...(m.minval !== undefined ? { minval: m.minval } : {}),
      ...(m.maxval !== undefined ? { maxval: m.maxval } : {}),
      ...(m.step !== undefined ? { step: m.step } : {}),
      ...(m.options !== undefined ? { options: m.options } : {}),
    })),
  };
}

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function normTrade(tr) {
  const size = num(tr.size) ?? 0;
  return {
    id: tr.id,
    entryId: tr.entry_id,
    exitId: tr.exit_id ?? null,
    side: size >= 0 ? 'long' : 'short',
    qty: Math.abs(size),
    entryBar: tr.entry_bar_index,
    entryTime: tr.entry_time,
    entryPrice: num(tr.entry_price),
    exitBar: tr.exit_bar_index ?? null,
    exitTime: tr.exit_time ?? null,
    exitPrice: num(tr.exit_price),
    commission: num(tr.commission) ?? 0,
    profit: num(tr.profit),
    maxDrawdown: num(tr.max_drawdown),
    maxRunup: num(tr.max_runup),
    comment: tr.exit_comment ?? tr.entry_comment ?? null,
    status: tr.status,
  };
}

/** Strategy summary from PineTS' StrategyState. */
export function normalizeStrategy(st) {
  if (!st) return undefined;
  const cfg = st.config || {};
  return {
    config: {
      title: cfg.title,
      initialCapital: cfg.initial_capital,
      currency: cfg.currency,
      defaultQtyType: cfg.default_qty_type,
      defaultQtyValue: cfg.default_qty_value,
      commissionType: cfg.commission_type,
      commissionValue: cfg.commission_value,
      slippage: cfg.slippage,
      pyramiding: cfg.pyramiding,
    },
    closedTrades: (st.closedtrades || []).map(normTrade),
    openTrades: (st.opentrades || []).map(normTrade),
    positionSize: num(st.position_size) ?? 0,
    positionAvgPrice: num(st.position_avg_price),
    equity: num(st.equity),
    netProfit: num(st.netprofit),
    grossProfit: num(st.grossprofit),
    grossLoss: num(st.grossloss),
    openProfit: num(st.openprofit),
    maxDrawdown: num(st.max_drawdown),
    winTrades: st.wintrades ?? 0,
    lossTrades: st.losstrades ?? 0,
    sharpe: num(st.sharpe_ratio),
    sortino: num(st.sortino_ratio),
  };
}

/** alert()/alertcondition() events. */
export function normalizeAlerts(alerts) {
  return (alerts || []).map((a) => ({
    type: a.type, // 'alert' | 'alertcondition'
    id: a.id,
    title: a.title ?? null,
    message: a.message ?? '',
    barIndex: a.bar_index,
    t: a.time,
  }));
}

/**
 * Turn any thrown value from PineTS into a PineError with a best-effort line number.
 * Transpile errors carry "at L:C"; runtime errors do not, so we look for the offending identifier.
 */
export function toPineError(err, source = '') {
  if (err instanceof PineError) return err;
  const raw = String(err?.message ?? err ?? 'Unknown Pine error');
  let m = raw.match(/\bat (\d+):(\d+)\b/);
  if (m) {
    const msg = raw.replace(/^Failed to transpile Pine Script version \d+:\s*/, '');
    return new PineError(`Syntax error: ${msg}`, { line: +m[1], column: +m[2], kind: 'syntax' });
  }
  m = raw.match(/line (\d+)/i);
  if (m) return new PineError(raw, { line: +m[1] });
  let ident = null;
  let text = raw;
  if ((m = raw.match(/^([\w.$]+) is not a function/))) {
    ident = m[1];
    text = `Unknown function '${ident}'`;
  } else if ((m = raw.match(/^([\w$]+) is not defined/))) {
    ident = m[1];
    text = `Undeclared identifier '${ident}'`;
  } else if (err?.method) {
    ident = err.method;
    text = `${err.method}: ${raw}`;
  } else if (/Loop exceeded maximum iterations/.test(raw)) {
    text = 'Loop exceeded maximum iterations (possible infinite loop)';
    ident = /while\b/.test(source) ? 'while' : 'for';
  }
  const line = ident ? findLine(source, ident) : undefined;
  return new PineError(text, { line, kind: 'runtime' });
}

function findLine(source, ident) {
  const lines = String(source).split('\n');
  const esc = ident.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(^|[^\\w.])${esc}(?![\\w])`);
  for (let i = 0; i < lines.length; i++) {
    const code = lines[i].replace(/\/\/.*$/, '');
    if (re.test(code)) return i + 1;
  }
  return undefined;
}
