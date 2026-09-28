// Bar-by-bar backtest engine (§9).
//
// Rules:
// - Signals are evaluated on bar close; market orders fill at the NEXT bar's open (± slippage).
// - Commission is a percentage of traded notional, charged on entry and exit.
// - Slippage is in ticks (tickSize), always against the trader.
// - Position sizing: {type:'fixed', value: qty} or {type:'percent', value: % of current equity}.
// - Long and short; an opposite entry signal reverses the position at the same fill (or just closes
//   it when that side is disabled).
// - Optional stop-loss / take-profit in % of entry price, checked intrabar from the fill bar on
//   (if both are touched in one bar the stop is assumed first — conservative). Gaps fill at the open.
// - Pyramiding is off: entries in the direction of an open position are ignored.
// - An open position is closed at the last bar's close (exitReason 'end').
import { computeMetrics } from './metrics.js';

/**
 * @typedef {{longEntry:boolean[], longExit:boolean[], shortEntry:boolean[], shortExit:boolean[]}} Signals
 * @typedef {object} BacktestOptions
 * @property {number} [capital=10000]
 * @property {number} [commission=0]     percent per side (0.1 = 0.1%)
 * @property {number} [slippage=0]       ticks per fill
 * @property {number} [tickSize=0.01]
 * @property {{type:'fixed'|'percent', value:number}} [sizing={type:'percent', value:100}]
 * @property {boolean} [allowLong=true]
 * @property {boolean} [allowShort=true]
 * @property {number} [stopLossPct]      e.g. 2 = 2% adverse move
 * @property {number} [takeProfitPct]    e.g. 4 = 4% favourable move
 * @property {number} [tfMs]             bar duration, used to annualise Sharpe/Sortino
 */

/**
 * @param {Array<{t,o,h,l,c,v}>} candles ascending
 * @param {Signals} signals
 * @param {BacktestOptions} [opts]
 * @returns {{trades:Array, equity:Array<{t,value}>, metrics:object}}
 */
export function runBacktest(candles, signals, opts = {}) {
  const capital = num(opts.capital, 10000);
  const commissionRate = num(opts.commission, 0) / 100;
  const slip = num(opts.slippage, 0) * num(opts.tickSize, 0.01);
  const sizing = opts.sizing || { type: 'percent', value: 100 };
  const allowLong = opts.allowLong !== false;
  const allowShort = opts.allowShort !== false;
  const slPct = opts.stopLossPct > 0 ? opts.stopLossPct / 100 : null;
  const tpPct = opts.takeProfitPct > 0 ? opts.takeProfitPct / 100 : null;
  const n = candles.length;
  const sig = (k, i) => !!signals?.[k]?.[i];

  let cash = capital; // realised equity
  /** @type {null|{side:1|-1, qty:number, entryPrice:number, entryBar:number, entryTime:number, entryFee:number, stop:number|null, target:number|null}} */
  let pos = null;
  const trades = [];
  const equity = [];
  let barsInMarket = 0;
  /** pending order decided on the previous bar close: {close:boolean, open:1|-1|0} */
  let pending = null;

  const openPos = (side, i, price, reason) => {
    const fill = side === 1 ? price + slip : price - slip;
    const eq = cash;
    let qty = sizing.type === 'fixed' ? num(sizing.value, 1) : (eq * num(sizing.value, 100)) / 100 / fill / (1 + commissionRate);
    if (!(qty > 0) || !Number.isFinite(qty)) return;
    const fee = qty * fill * commissionRate;
    cash -= fee;
    pos = {
      side, qty, entryPrice: fill, entryBar: i, entryTime: candles[i].t, entryFee: fee, reason,
      stop: slPct ? fill * (1 - side * slPct) : null,
      target: tpPct ? fill * (1 + side * tpPct) : null,
    };
  };

  const closePos = (i, price, reason, t = candles[i].t, applySlip = true) => {
    const s = pos.side;
    const fill = applySlip ? (s === 1 ? price - slip : price + slip) : price;
    const gross = s * (fill - pos.entryPrice) * pos.qty;
    const exitFee = pos.qty * fill * commissionRate;
    cash += gross - exitFee;
    const commission = pos.entryFee + exitFee;
    const pnl = gross - commission;
    trades.push({
      id: trades.length + 1,
      side: s === 1 ? 'long' : 'short',
      qty: pos.qty,
      entryBar: pos.entryBar,
      entryTime: pos.entryTime,
      entryPrice: pos.entryPrice,
      exitBar: i,
      exitTime: t,
      exitPrice: fill,
      commission,
      pnl,
      pnlPct: (pnl / (pos.entryPrice * pos.qty)) * 100,
      bars: i - pos.entryBar + 1,
      exitReason: reason,
    });
    pos = null;
  };

  for (let i = 0; i < n; i++) {
    const k = candles[i];
    // 1) execute orders decided on the previous close, at this bar's open
    if (pending) {
      if (pending.close && pos) closePos(i, k.o, pending.reason);
      if (pending.open && !pos) openPos(pending.open, i, k.o, pending.reason);
      pending = null;
    }
    // 2) intrabar stop-loss / take-profit
    if (pos && (pos.stop !== null || pos.target !== null)) {
      const s = pos.side;
      const hitStop = pos.stop !== null && (s === 1 ? k.l <= pos.stop : k.h >= pos.stop);
      const hitTarget = pos.target !== null && (s === 1 ? k.h >= pos.target : k.l <= pos.target);
      if (hitStop) {
        const gap = s === 1 ? k.o < pos.stop : k.o > pos.stop; // gapped through the stop
        closePos(i, gap ? k.o : pos.stop, 'stop_loss');
      } else if (hitTarget) {
        const gap = s === 1 ? k.o > pos.target : k.o < pos.target;
        closePos(i, gap ? k.o : pos.target, 'take_profit', k.t, false);
      }
    }
    if (pos) barsInMarket++;
    // 3) mark to market at the close
    const open = pos ? pos.side * (k.c - pos.entryPrice) * pos.qty : 0;
    equity.push({ t: k.t, value: cash + open });
    // 4) evaluate signals on this close -> order for next open
    if (i < n - 1) {
      const le = allowLong && sig('longEntry', i);
      const se = allowShort && sig('shortEntry', i);
      let close = false;
      let reason = 'signal';
      let openSide = 0;
      // An opposite entry signal always closes the position (like TradingView's allow_entry_in).
      if (pos?.side === 1 && (sig('longExit', i) || sig('shortEntry', i))) close = true;
      if (pos?.side === -1 && (sig('shortExit', i) || sig('longEntry', i))) close = true;
      const flatAfter = !pos || close;
      if (flatAfter) {
        if (le && !(pos?.side === 1)) openSide = 1;
        else if (se && !(pos?.side === -1)) openSide = -1;
        if (close && openSide) reason = 'reverse';
      }
      if (close || openSide) pending = { close, open: openSide, reason };
    }
  }
  if (pos && n) {
    const last = candles[n - 1];
    closePos(n - 1, last.c, 'end', last.t, false);
    equity[n - 1] = { t: last.t, value: cash };
  }

  const metrics = computeMetrics({ trades, equity, capital, candles, barsInMarket, tfMs: opts.tfMs });
  return { trades, equity, metrics };
}

function num(v, def) {
  const n = Number(v);
  return v === undefined || v === null || v === '' || !Number.isFinite(n) ? def : n;
}

/**
 * Convert per-bar signal plots (long_entry/long_exit/short_entry/short_exit, value > 0 or true) from a
 * normalised Pine result into engine Signals aligned with `candles`. Returns null when none exist.
 */
export function signalsFromPlots(plots, candles) {
  const names = { longEntry: 'long_entry', longExit: 'long_exit', shortEntry: 'short_entry', shortExit: 'short_exit' };
  if (!Object.values(names).some((nm) => plots?.[nm])) return null;
  const idx = new Map(candles.map((k, i) => [k.t, i]));
  const out = {};
  for (const [key, nm] of Object.entries(names)) {
    const arr = new Array(candles.length).fill(false);
    for (const p of plots?.[nm]?.data || []) {
      const i = idx.get(p.t);
      if (i !== undefined) arr[i] = p.value === true || (typeof p.value === 'number' && p.value > 0);
    }
    out[key] = arr;
  }
  return out;
}

/**
 * Build our trade list + equity curve from PineTS strategy trades (normalised by pine/normalize.js).
 * Equity is marked to market at each close using the open trades.
 */
export function fromPineStrategy(strategy, candles, { capital, tfMs } = {}) {
  const cap = num(capital, strategy?.config?.initialCapital ?? 10000);
  const all = [...(strategy?.closedTrades || []), ...(strategy?.openTrades || [])];
  const n = candles.length;
  const last = candles[n - 1];
  const trades = all
    .filter((t) => Number.isInteger(t.entryBar))
    .map((t, j) => {
      const open = t.status !== 'closed' || t.exitBar === null;
      const sign = t.side === 'long' ? 1 : -1;
      const exitPrice = open ? last.c : t.exitPrice;
      const exitBar = open ? n - 1 : t.exitBar;
      const pnl = open ? sign * (exitPrice - t.entryPrice) * t.qty - (t.commission || 0) : t.profit ?? sign * (exitPrice - t.entryPrice) * t.qty;
      return {
        id: j + 1,
        side: t.side,
        qty: t.qty,
        entryBar: t.entryBar,
        entryTime: t.entryTime ?? candles[t.entryBar]?.t,
        entryPrice: t.entryPrice,
        exitBar,
        exitTime: open ? last.t : t.exitTime ?? candles[exitBar]?.t,
        exitPrice,
        commission: t.commission || 0,
        pnl,
        pnlPct: t.entryPrice && t.qty ? (pnl / (t.entryPrice * t.qty)) * 100 : 0,
        bars: exitBar - t.entryBar + 1,
        exitReason: open ? 'end' : t.exitId || 'signal',
        entryId: t.entryId,
      };
    })
    .sort((a, b) => a.entryBar - b.entryBar || a.exitBar - b.exitBar);

  const realisedAt = new Array(n).fill(0);
  for (const t of trades) realisedAt[Math.min(t.exitBar, n - 1)] += t.pnl;
  const equity = [];
  let realised = 0;
  const inMarket = new Array(n).fill(false);
  for (let i = 0; i < n; i++) {
    realised += realisedAt[i];
    let open = 0;
    for (const t of trades) {
      if (t.entryBar <= i && i < t.exitBar) {
        open += (t.side === 'long' ? 1 : -1) * (candles[i].c - t.entryPrice) * t.qty;
        inMarket[i] = true;
      }
      if (t.entryBar <= i && i <= t.exitBar) inMarket[i] = true;
    }
    equity.push({ t: candles[i].t, value: cap + realised + open });
  }
  const barsInMarket = inMarket.filter(Boolean).length;
  const metrics = computeMetrics({ trades, equity, capital: cap, candles, barsInMarket, tfMs });
  return { trades, equity, metrics };
}
