// Laya market state + question set (§6).
import { rsi, ema, atr, zscoreLast } from '../backtest/ta.js';
import { toCandle } from '../pine/util.js';

export const DEFAULT_QUESTION = 'Is this move likely to continue in the direction of the alert rather than fail?';

const r = (v, d = 6) => (v === null || v === undefined || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);
const lastNum = (a) => {
  for (let i = a.length - 1; i >= 0; i--) if (Number.isFinite(a[i])) return a[i];
  return null;
};

/**
 * Build the state object Laya reasons over.
 * @param {object} p
 * @param {string} p.symbol
 * @param {string} p.tf
 * @param {number} [p.price]           current price (defaults to last close)
 * @param {Array} p.candles            recent candles, ascending (>= 200 recommended for EMA200)
 * @param {object} [p.alert]           Alert (for the level + direction context)
 * @param {Array} [p.footprint]        recent footprint bars ({t, delta, levels})
 * @param {number} [p.t]               event time (ms)
 */
export function buildMarketState({ symbol, tf, price, candles = [], alert, footprint = [], t = Date.now() }) {
  const cs = candles.map(toCandle).filter((k) => Number.isFinite(k.c));
  const closes = cs.map((k) => k.c);
  const last = cs[cs.length - 1];
  const px = Number.isFinite(price) ? price : last?.c ?? null;
  const atr14 = cs.length > 14 ? lastNum(atr(cs, 14)) : null;
  const level = alertLevel(alert, px);
  const recentFp = footprint.slice(-10);
  const fpDelta = recentFp.reduce((s, b) => s + (Number.isFinite(b?.delta) ? b.delta : levelsDelta(b)), 0);
  const state = {
    symbol,
    tf,
    time: new Date(t).toISOString(),
    price: r(px),
    candles: {
      columns: ['t', 'o', 'h', 'l', 'c', 'v'],
      rows: cs.slice(-50).map((k) => [k.t, r(k.o), r(k.h), r(k.l), r(k.c), r(k.v, 4)]),
    },
    indicators: {
      rsi14: closes.length > 14 ? r(lastNum(rsi(closes, 14)), 2) : null,
      ema20: closes.length >= 20 ? r(lastNum(ema(closes, 20))) : null,
      ema50: closes.length >= 50 ? r(lastNum(ema(closes, 50))) : null,
      ema200: closes.length >= 200 ? r(lastNum(ema(closes, 200))) : null,
      atr14: r(atr14),
      volumeZ: cs.length > 5 ? r(zscoreLast(cs.map((k) => k.v), 20), 3) : null,
      change24Bars: closes.length > 24 ? r(((px - closes[closes.length - 25]) / closes[closes.length - 25]) * 100, 3) : null,
    },
    alert: alert
      ? {
          name: alert.name || null,
          condition: alert.condition?.kind === 'indicator' ? { kind: 'indicator' } : alert.condition,
          level: r(level),
          distance: level !== null && px !== null ? r(px - level) : null,
          distancePct: level ? r(((px - level) / level) * 100, 4) : null,
          distanceAtr: level !== null && atr14 ? r((px - level) / atr14, 3) : null,
        }
      : null,
    footprint: recentFp.length
      ? { bars: recentFp.length, delta: r(fpDelta, 4), lastDelta: r(recentFp[recentFp.length - 1]?.delta ?? levelsDelta(recentFp[recentFp.length - 1]), 4) }
      : null,
  };
  return state;
}

function levelsDelta(bar) {
  if (!bar?.levels) return 0;
  return bar.levels.reduce((s, l) => s + (l.ask || 0) - (l.bid || 0), 0);
}

function alertLevel(alert, px) {
  const c = alert?.condition;
  if (!c) return null;
  if (c.kind === 'price') {
    if (Number.isFinite(c.value2) && Number.isFinite(px)) {
      // channel: nearest edge
      return Math.abs(px - c.value) <= Math.abs(px - c.value2) ? c.value : c.value2;
    }
    return Number.isFinite(c.value) ? c.value : null;
  }
  if (c.kind === 'drawing' && Number.isFinite(c.level)) return c.level;
  return null;
}

/**
 * The typed question set of §6:
 * { decision: noul(question), direction: choice{bullish,bearish,neutral}, confidence: score[low,medium,high] }
 */
export function buildQuestions(question = DEFAULT_QUESTION) {
  return {
    decision: { type: 'noul', question: question || DEFAULT_QUESTION },
    direction: {
      type: 'choice',
      question: 'What is the most likely direction of the next several bars?',
      choices: ['bullish', 'bearish', 'neutral'],
    },
    confidence: {
      type: 'score',
      question: 'How confident is this assessment given the data?',
      scale: ['low', 'medium', 'high'],
    },
  };
}

/** Extract a probability in [0,1] from a noul-style answer. */
export function answerProbability(a) {
  if (a === null || a === undefined) return null;
  if (typeof a === 'number') return clamp01(a);
  for (const k of ['noul', 'p', 'probability', 'value', 'score']) {
    if (typeof a[k] === 'number') return clamp01(a[k]);
  }
  const probs = a.probabilities || a.probs;
  if (probs && typeof probs === 'object') {
    for (const k of ['true', 'yes', 'True', 'Yes']) if (typeof probs[k] === 'number') return clamp01(probs[k]);
  }
  return null;
}

function clamp01(v) {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : null;
}

/**
 * Evaluate a Laya result against a threshold.
 * @returns {{p:number|null, passed:boolean, direction:string|null, confidence:any, answers:object}}
 */
export function evaluateDecision(result, threshold = 0.6) {
  const answers = result?.answers || {};
  const p = answerProbability(answers.decision);
  const dir = answers.direction;
  const conf = answers.confidence;
  return {
    p,
    passed: p !== null && p >= threshold,
    threshold,
    direction: dir?.choice ?? (typeof dir === 'string' ? dir : null),
    confidence: conf?.score ?? conf?.choice ?? (typeof conf === 'string' || typeof conf === 'number' ? conf : null),
    answers,
  };
}
