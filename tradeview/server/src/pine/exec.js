// In-process PineTS execution. Used by the worker thread (default) and as a fallback.
import { PineTS, Indicator } from 'pinets';
import { normalizePlots, normalizeMeta, normalizeStrategy, normalizeAlerts, toPineError } from './normalize.js';

export const DEFAULT_MAX_LOOPS = 200000;

/**
 * @param {object} job
 * @param {Array} job.candles     PineTS-shaped candles ({open,high,low,close,volume,openTime,closeTime})
 * @param {string} job.source     Pine Script source
 * @param {object} [job.inputs]   input overrides keyed by input title, variable name or id (in_0)
 * @param {object} [job.props]    declaration overrides (strategy(): initial_capital, commission_value, ...)
 * @param {'realtime'|'all'} [job.alertMode]  'all' reports alert()/alertcondition() on every bar
 * @param {number} [job.maxLoops]
 */
export async function executePine(job) {
  const { candles, source, inputs = {}, props = {}, alertMode = 'all', maxLoops = DEFAULT_MAX_LOOPS } = job;
  if (typeof source !== 'string' || !source.trim()) throw toPineError(new Error('Pine source is empty'));
  if (!candles.length) throw toPineError(new Error('No candles to run the script on'));
  const pineTS = new PineTS(candles);
  pineTS.setMaxLoops(maxLoops);
  pineTS.setAlertMode(alertMode);
  let indicator;
  let inputsMeta = [];
  try {
    indicator = new Indicator(source, { ...inputs });
    try {
      inputsMeta = indicator.getInputsMeta();
    } catch {
      inputsMeta = [];
    }
    for (const [k, v] of Object.entries(props || {})) {
      if (v === undefined || v === null) continue;
      try {
        indicator.prop[k] = v;
      } catch {
        /* prop not applicable to this declaration type */
      }
    }
    const ctx = await pineTS.run(indicator);
    const times = candles.map((c) => c.openTime);
    return {
      plots: normalizePlots(ctx.plots, times),
      meta: normalizeMeta(ctx, inputsMeta),
      strategy: normalizeStrategy(ctx.strategy),
      alerts: normalizeAlerts(ctx.alerts),
      warnings: (ctx.warnings || []).slice(0, 50).map((w) => ({ message: w.message, method: w.method, bar: w.bar })),
    };
  } catch (err) {
    throw toPineError(err, source);
  }
}
