import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { runBacktest, signalsFromPlots, fromPineStrategy } from '../src/backtest/engine.js';
import { computeMetrics } from '../src/backtest/metrics.js';
import { backtest } from '../src/backtest/index.js';
import { listStrategies, resolveParams } from '../src/backtest/strategies.js';
import { ema, sma, rsi, atr } from '../src/backtest/ta.js';
import { closePinePool } from '../src/pine/runner.js';

after(() => closePinePool());

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const bars = (rows) => rows.map(([o, h, l, c], i) => ({ t: i * 60000, o, h, l, c, v: 1 }));
const sig = (n, spec) => {
  const s = { longEntry: [], longExit: [], shortEntry: [], shortExit: [] };
  for (const k of Object.keys(s)) s[k] = new Array(n).fill(false);
  for (const [k, idx] of Object.entries(spec)) for (const i of idx) s[k][i] = true;
  return s;
};

test('long trade: next-bar-open fills, slippage ticks, commission %, equity and metrics', () => {
  const c = bars([
    [100, 101, 99, 100],
    [100, 102, 99, 101], // long entry signal on close
    [102, 104, 101, 103], // fill at 102 + 1 slippage = 103
    [103, 106, 102, 105], // exit signal on close
    [104, 105, 100, 101], // exit at 104 - 1 = 103
    [101, 102, 99, 100],
  ]);
  const res = runBacktest(c, sig(6, { longEntry: [1], longExit: [3] }), {
    capital: 10000, commission: 0.1, slippage: 2, tickSize: 0.5, sizing: { type: 'fixed', value: 10 },
  });
  assert.equal(res.trades.length, 1);
  const t = res.trades[0];
  assert.equal(t.side, 'long');
  assert.equal(t.entryBar, 2);
  assert.equal(t.entryTime, 120000);
  near(t.entryPrice, 103);
  assert.equal(t.exitBar, 4);
  near(t.exitPrice, 103);
  near(t.commission, 2.06);
  near(t.pnl, -2.06);
  assert.equal(t.exitReason, 'signal');
  assert.deepEqual(res.equity.map((e) => Math.round(e.value * 100) / 100), [10000, 10000, 9998.97, 10018.97, 9997.94, 9997.94]);
  const m = res.metrics;
  near(m.netProfit, -2.06);
  assert.equal(m.trades, 1);
  assert.equal(m.winRate, 0);
  assert.equal(m.profitFactor, 0);
  near(m.maxDrawdown, 21.03);
  near(m.maxDrawdownPct, (21.03 / 10018.97) * 100);
  near(m.exposure, (2 / 6) * 100);
  near(m.largestLoss, -2.06);
  near(m.totalCommission, 2.06);
});

test('short trade stopped out intrabar with percent-of-equity sizing', () => {
  const c = bars([
    [100, 100, 100, 100],
    [100, 100, 100, 100], // short entry signal
    [100, 101, 99, 100], // fill short 100, stop = 102
    [101, 103, 100, 102], // high 103 >= 102 -> stopped at 102
    [102, 102, 102, 102],
  ]);
  const res = runBacktest(c, sig(5, { shortEntry: [1] }), { capital: 10000, stopLossPct: 2, sizing: { type: 'percent', value: 100 } });
  assert.equal(res.trades.length, 1);
  const t = res.trades[0];
  assert.equal(t.side, 'short');
  near(t.qty, 100);
  near(t.entryPrice, 100);
  near(t.exitPrice, 102);
  assert.equal(t.exitBar, 3);
  assert.equal(t.exitReason, 'stop_loss');
  near(t.pnl, -200);
  near(res.equity[4].value, 9800);
  near(res.metrics.netProfitPct, -2);
});

test('take profit gap fills at the open; stop has priority when both touched', () => {
  const c = bars([
    [100, 100, 100, 100],
    [100, 100, 100, 100], // long signal
    [100, 101, 99, 100], // fill 100, TP 105
    [107, 108, 106, 107], // gaps above 105 -> filled at open 107
    [107, 107, 107, 107],
  ]);
  const res = runBacktest(c, sig(5, { longEntry: [1] }), { takeProfitPct: 5, sizing: { type: 'fixed', value: 2 } });
  assert.equal(res.trades[0].exitReason, 'take_profit');
  near(res.trades[0].exitPrice, 107);
  near(res.trades[0].pnl, 14);

  const c2 = bars([
    [100, 100, 100, 100],
    [100, 100, 100, 100],
    [100, 106, 97, 100], // both TP(105) and SL(98) touched on the fill bar -> stop first
    [100, 100, 100, 100],
  ]);
  const r2 = runBacktest(c2, sig(4, { longEntry: [1] }), { takeProfitPct: 5, stopLossPct: 2, sizing: { type: 'fixed', value: 1 } });
  assert.equal(r2.trades[0].exitReason, 'stop_loss');
  near(r2.trades[0].exitPrice, 98);
});

test('reversal, pyramiding off, disallowed shorts, end-of-data close', () => {
  const c = bars([
    [10, 10, 10, 10],
    [10, 10, 10, 10], // long
    [11, 11, 11, 11], // fill long 11; another long signal (ignored: pyramiding off)
    [12, 12, 12, 12], // short signal -> reverse
    [13, 13, 13, 13], // close long 13, open short 13
    [12, 12, 12, 12],
    [11, 11, 11, 11], // end: short closed at close 11
  ]);
  const s = sig(7, { longEntry: [1, 2], shortEntry: [3] });
  const res = runBacktest(c, s, { sizing: { type: 'fixed', value: 1 } });
  assert.deepEqual(res.trades.map((t) => [t.side, t.entryBar, t.exitBar, t.entryPrice, t.exitPrice, t.exitReason]), [
    ['long', 2, 4, 11, 13, 'reverse'],
    ['short', 4, 6, 13, 11, 'end'],
  ]);
  near(res.metrics.netProfit, 4);
  near(res.metrics.winRate, 100);

  const longOnly = runBacktest(c, s, { sizing: { type: 'fixed', value: 1 }, allowShort: false });
  assert.deepEqual(longOnly.trades.map((t) => [t.side, t.exitBar, t.exitReason]), [['long', 4, 'signal']]);
});

test('computeMetrics on a hand-built equity curve', () => {
  const equity = [10000, 10100, 10050, 10200, 9900].map((value, i) => ({ t: i * 86400000, value }));
  const trades = [100, -50, 150, -300].map((pnl) => ({ pnl, bars: 2, commission: 1 }));
  const m = computeMetrics({ trades, equity, capital: 10000, barsInMarket: 4, tfMs: 86400000 });
  near(m.netProfit, -100);
  near(m.winRate, 50);
  near(m.profitFactor, 250 / 350);
  near(m.maxDrawdown, 300);
  near(m.maxDrawdownPct, (300 / 10200) * 100);
  near(m.avgTrade, -25);
  near(m.largestWin, 150);
  near(m.largestLoss, -300);
  near(m.exposure, 80);
  near(m.totalCommission, 4);
  const vals = [10000, ...equity.map((e) => e.value)];
  const rets = vals.slice(1).map((v, i) => v / vals[i] - 1);
  const mean = rets.reduce((a, b) => a + b) / rets.length;
  const sd = Math.sqrt(rets.reduce((a, r) => a + (r - mean) ** 2, 0) / (rets.length - 1));
  near(m.sharpe, (mean / sd) * Math.sqrt(365), 1e-5);
  const dd = Math.sqrt(rets.reduce((a, r) => a + (r < 0 ? r * r : 0), 0) / rets.length);
  near(m.sortino, (mean / dd) * Math.sqrt(365), 1e-5);
});

test('TA helpers match Pine semantics on simple data', () => {
  const x = [1, 2, 3, 4, 5, 6];
  assert.deepEqual(sma(x, 3).slice(2), [2, 3, 4, 5]);
  const e = ema(x, 3);
  assert.ok(Number.isNaN(e[1]));
  near(e[2], 2);
  near(e[3], 0.5 * 4 + 0.5 * 2);
  const r = rsi([1, 2, 3, 4, 5, 6, 7], 3);
  near(r[6], 100);
  const a = atr(bars([[1, 2, 0, 1], [1, 3, 1, 2], [2, 4, 1, 3]]), 2);
  near(a[1], (2 + 2) / 2);
});

function synth(n = 500) {
  const out = [];
  let p = 100;
  for (let i = 0; i < n; i++) {
    const o = p;
    p = p * (1 + Math.sin(i / 9) * 0.01 + Math.cos(i / 4) * 0.003);
    out.push({ t: Date.UTC(2024, 0, 1) + i * 3600000, o, h: Math.max(o, p) * 1.003, l: Math.min(o, p) * 0.997, c: p, v: 100 });
  }
  return out;
}

test('backtest(): builtin strategies all run', async () => {
  const candles = synth();
  for (const s of listStrategies()) {
    const res = await backtest({ candles, strategy: { id: s.id }, tfMs: 3600000 });
    assert.equal(res.meta.mode, 'builtin');
    assert.equal(res.equity.length, candles.length);
    assert.equal(typeof res.metrics.netProfit, 'number');
  }
  assert.deepEqual(resolveParams('ema_cross', { fast: '5', slow: 0 }), { fast: 5, slow: 2 });
  await assert.rejects(backtest({ candles, strategy: { id: 'nope' } }), /Unknown strategy/);
});

test('backtest(): Pine strategy uses PineTS trades; signal plots match the JS engine', async () => {
  const candles = synth();
  const pine = await backtest({ candles, strategy: 'strategy_ema_cross', capital: 10000, commission: 0, tfMs: 3600000 });
  assert.equal(pine.meta.mode, 'pine-strategy');
  assert.ok(pine.trades.length > 3);
  for (const t of pine.trades.slice(0, -1)) near(t.entryPrice, candles[t.entryBar].o, 1e-6);
  assert.equal(pine.equity.length, candles.length);

  // Indicator with signal plots -> our engine; must equal the builtin JS EMA cross (long only).
  const src = `//@version=6
indicator("sig")
f = ta.ema(close, 9)
s = ta.ema(close, 21)
plot(ta.crossover(f, s) ? 1 : 0, "long_entry")
plot(ta.crossunder(f, s) ? 1 : 0, "long_exit")`;
  const viaPlots = await backtest({ candles, source: src, allowShort: false, commission: 0.1 });
  assert.equal(viaPlots.meta.mode, 'pine-signals');
  const viaJs = await backtest({ candles, strategy: { id: 'ema_cross', params: { fast: 9, slow: 21 } }, allowShort: false, commission: 0.1 });
  assert.deepEqual(viaPlots.trades.map((t) => [t.entryBar, t.exitBar]), viaJs.trades.map((t) => [t.entryBar, t.exitBar]));
  near(viaPlots.metrics.netProfit, viaJs.metrics.netProfit, 1e-6);

  await assert.rejects(backtest({ candles, source: '//@version=6\nindicator("x")\nplot(close)' }), /not a strategy/);
});

test('signalsFromPlots and fromPineStrategy', () => {
  const c = bars([[1, 1, 1, 1], [2, 2, 2, 2], [3, 3, 3, 3], [4, 4, 4, 4]]);
  const s = signalsFromPlots({ long_entry: { data: [{ t: 60000, value: 1 }, { t: 120000, value: 0 }] }, long_exit: { data: [{ t: 120000, value: true }] } }, c);
  assert.deepEqual(s.longEntry, [false, true, false, false]);
  assert.deepEqual(s.longExit, [false, false, true, false]);
  assert.deepEqual(s.shortEntry, [false, false, false, false]);
  assert.equal(signalsFromPlots({ foo: { data: [] } }, c), null);

  const r = fromPineStrategy({
    config: { initialCapital: 1000 },
    closedTrades: [{ side: 'long', qty: 10, entryBar: 1, entryTime: 60000, entryPrice: 2, exitBar: 3, exitTime: 180000, exitPrice: 4, profit: 19, commission: 1, status: 'closed', exitId: 'x' }],
    openTrades: [],
  }, c, { capital: 1000 });
  assert.deepEqual(r.equity.map((e) => e.value), [1000, 1000, 1010, 1019]);
  near(r.metrics.netProfit, 19);
});
