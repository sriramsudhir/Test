// Laya decision gate helpers shared by the alert engine, the agent and the REST route.
import { buildMarketState, buildQuestions, evaluateDecision } from './questions.js';

const STATE_BARS = 250; // enough history for EMA200

/**
 * Gather market context for a symbol/tf and ask Laya.
 * Never throws. Returns {skipped:true, reason} when Laya is unavailable.
 * @param {object} ctx
 * @param {object} p
 * @param {string} p.symbol @param {string} p.tf
 * @param {string} [p.question] @param {number} [p.threshold]
 * @param {object} [p.alert] @param {number} [p.price] @param {number} [p.t]
 * @param {Array} [p.candles]  optional pre-loaded candles
 */
export async function askLaya(ctx, { symbol, tf, question, threshold = 0.6, alert, price, t, candles } = {}) {
  const laya = ctx?.laya;
  if (!laya || typeof laya.decide !== 'function') return { skipped: true, reason: 'laya service not configured' };
  const st = laya.status?.();
  if (st && st.mode === 'off') return { skipped: true, reason: 'laya is off' };
  let state;
  try {
    let cs = candles;
    if (!cs && ctx.market?.getCandles) cs = await ctx.market.getCandles({ symbol, tf, limit: STATE_BARS });
    let footprint = [];
    if (ctx.market?.getFootprint && cs?.length) {
      try {
        const from = cs[Math.max(0, cs.length - 10)].t;
        footprint = (await ctx.market.getFootprint({ symbol, tf, from })) || [];
      } catch {
        footprint = [];
      }
    }
    state = buildMarketState({ symbol, tf, price, candles: cs || [], alert, footprint, t });
  } catch (err) {
    return { skipped: true, reason: `could not build market state: ${err?.message || err}` };
  }
  const questions = buildQuestions(question);
  const result = await laya.decide(state, questions);
  if (!result) return { skipped: true, reason: laya.status?.().error || 'laya unavailable', state };
  const decision = evaluateDecision(result, threshold);
  return { skipped: false, ...decision, usage: result.usage, state };
}
