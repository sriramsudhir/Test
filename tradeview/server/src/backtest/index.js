// Backtest service used by the REST route and the agent's run_backtest tool.
import { runPine } from '../pine/runner.js';
import { getLibraryEntry } from '../pine/library.js';
import { runBacktest, signalsFromPlots, fromPineStrategy } from './engine.js';
import { builtinSignals, BUILTIN_STRATEGIES } from './strategies.js';

/**
 * @param {object} req
 * @param {Array} req.candles                 [{t,o,h,l,c,v}] ascending
 * @param {string} [req.source]               Pine strategy() script, or an indicator with long_entry/... plots
 * @param {{id:string, params?:object}|string} [req.strategy]  builtin JS strategy or Pine library id
 * @param {number} [req.capital=10000]
 * @param {number} [req.commission=0.05]      percent per side
 * @param {number} [req.slippage=0]           ticks
 * @param {number} [req.tickSize=0.01]
 * @param {{type:'fixed'|'percent', value:number}} [req.sizing]
 * @param {number} [req.stopLoss]             % (builtin / signal-plot mode)
 * @param {number} [req.takeProfit]           % (builtin / signal-plot mode)
 * @param {boolean} [req.allowLong] @param {boolean} [req.allowShort]
 * @param {object} [req.inputs]               Pine input overrides
 * @param {number} [req.tfMs]
 */
export async function backtest(req) {
  const { candles } = req;
  if (!Array.isArray(candles) || candles.length < 2) throw Object.assign(new Error('Not enough candles for a backtest'), { statusCode: 400 });
  const capital = numOr(req.capital, 10000);
  const commission = numOr(req.commission, 0.05);
  const slippage = numOr(req.slippage, 0);
  const tickSize = numOr(req.tickSize, 0.01);
  const opts = {
    capital, commission, slippage, tickSize, tfMs: req.tfMs,
    sizing: normSizing(req.sizing),
    allowLong: req.allowLong !== false,
    allowShort: req.allowShort !== false,
    stopLossPct: numOr(req.stopLoss, 0),
    takeProfitPct: numOr(req.takeProfit, 0),
  };
  const strat = typeof req.strategy === 'string' ? { id: req.strategy } : req.strategy;
  let source = req.source;
  if (!source && strat?.id && !BUILTIN_STRATEGIES[strat.id]) {
    const lib = getLibraryEntry(strat.id);
    if (!lib) throw Object.assign(new Error(`Unknown strategy '${strat.id}'`), { statusCode: 400 });
    source = lib.source;
  }

  if (source) {
    const props = {
      initial_capital: capital,
      commission_type: 'percent',
      commission_value: commission,
      // PineTS measures slippage in syminfo.mintick ticks; convert ours (instrument ticks).
      slippage: Math.round(slippage * (tickSize / 0.01)),
      pyramiding: 1,
    };
    if (req.sizing) {
      const s = opts.sizing;
      props.default_qty_type = s.type === 'fixed' ? 'fixed' : 'percent_of_equity';
      props.default_qty_value = s.value;
    }
    const res = await runPine({ candles, source, inputs: req.inputs || strat?.params, props, tfMs: req.tfMs });
    const st = res.strategy;
    const pineTrades = st ? st.closedTrades.length + st.openTrades.length : 0;
    if (st && pineTrades > 0) {
      const out = fromPineStrategy(st, candles, { capital, tfMs: req.tfMs });
      return { ...out, meta: { mode: 'pine-strategy', title: res.meta.title, warnings: res.warnings } };
    }
    const signals = signalsFromPlots(res.plots, candles);
    if (signals) {
      const out = runBacktest(candles, signals, opts);
      return { ...out, meta: { mode: 'pine-signals', title: res.meta.title, warnings: res.warnings } };
    }
    if (st) {
      const out = fromPineStrategy(st, candles, { capital, tfMs: req.tfMs });
      return { ...out, meta: { mode: 'pine-strategy', title: res.meta.title, warnings: res.warnings, note: 'Strategy produced no trades on this range' } };
    }
    throw Object.assign(
      new Error('Script is not a strategy() and has no long_entry/long_exit/short_entry/short_exit plots'),
      { statusCode: 400 },
    );
  }

  if (!strat?.id) throw Object.assign(new Error('Provide a Pine `source` or a builtin `strategy`'), { statusCode: 400 });
  const { signals, params } = builtinSignals(strat.id, candles, strat.params);
  const out = runBacktest(candles, signals, opts);
  return { ...out, meta: { mode: 'builtin', strategy: strat.id, title: BUILTIN_STRATEGIES[strat.id].name, params } };
}

function numOr(v, d) {
  const n = Number(v);
  return v === undefined || v === null || v === '' || !Number.isFinite(n) ? d : n;
}

function normSizing(s) {
  if (!s) return { type: 'percent', value: 100 };
  if (typeof s === 'number') return { type: 'percent', value: s };
  const type = s.type === 'fixed' || s.type === 'qty' ? 'fixed' : 'percent';
  const value = numOr(s.value, type === 'fixed' ? 1 : 100);
  return { type, value: value > 0 ? value : type === 'fixed' ? 1 : 100 };
}
