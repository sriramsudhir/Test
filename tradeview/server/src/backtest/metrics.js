// Backtest metrics (§9): net profit, win rate, profit factor, max drawdown, Sharpe, Sortino,
// trade count, average trade, largest win/loss, exposure (+ a few extras).

const YEAR_MS = 365 * 24 * 3600 * 1000;

/**
 * @param {object} p
 * @param {Array<{pnl:number}>} p.trades
 * @param {Array<{t:number,value:number}>} p.equity   per-bar equity (marked to market)
 * @param {number} p.capital
 * @param {Array} [p.candles]
 * @param {number} [p.barsInMarket]
 * @param {number} [p.tfMs]   bar duration used to annualise ratios (inferred from equity times)
 */
export function computeMetrics({ trades, equity, capital, candles = [], barsInMarket = 0, tfMs } = {}) {
  const pnls = trades.map((t) => t.pnl);
  const wins = pnls.filter((v) => v > 0);
  const losses = pnls.filter((v) => v < 0);
  const grossProfit = sum(wins);
  const grossLoss = -sum(losses); // positive number
  const finalEquity = equity.length ? equity[equity.length - 1].value : capital;
  const netProfit = finalEquity - capital;

  // drawdown on the equity curve
  let peak = capital;
  let maxDd = 0;
  let maxDdPct = 0;
  for (const p of equity) {
    if (p.value > peak) peak = p.value;
    const dd = peak - p.value;
    if (dd > maxDd) maxDd = dd;
    const ddPct = peak > 0 ? (dd / peak) * 100 : 0;
    if (ddPct > maxDdPct) maxDdPct = ddPct;
  }

  // per-bar returns -> Sharpe / Sortino (risk-free 0), annualised
  const rets = [];
  let prev = capital;
  for (const p of equity) {
    if (prev > 0) rets.push(p.value / prev - 1);
    prev = p.value;
  }
  let step = tfMs;
  if (!step && equity.length > 1) step = (equity[equity.length - 1].t - equity[0].t) / (equity.length - 1);
  const periodsPerYear = step > 0 ? YEAR_MS / step : 252;
  const mean = rets.length ? sum(rets) / rets.length : 0;
  const sd = std(rets, mean);
  const downside = Math.sqrt(rets.length ? sum(rets.map((r) => (r < 0 ? r * r : 0))) / rets.length : 0);
  const ann = Math.sqrt(periodsPerYear);
  const sharpe = sd > 0 ? (mean / sd) * ann : 0;
  const sortino = downside > 0 ? (mean / downside) * ann : mean > 0 ? Infinity : 0;

  const bars = equity.length || candles.length;
  const first = candles[0];
  const last = candles[candles.length - 1];
  const buyHoldPct = first && last && first.o > 0 ? ((last.c - first.o) / first.o) * 100 : null;

  return {
    initialCapital: capital,
    finalEquity: round(finalEquity),
    netProfit: round(netProfit),
    netProfitPct: round(capital ? (netProfit / capital) * 100 : 0),
    grossProfit: round(grossProfit),
    grossLoss: round(grossLoss),
    trades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: round(trades.length ? (wins.length / trades.length) * 100 : 0),
    profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss) : grossProfit > 0 ? null : 0,
    maxDrawdown: round(maxDd),
    maxDrawdownPct: round(maxDdPct),
    sharpe: round(sharpe),
    sortino: Number.isFinite(sortino) ? round(sortino) : null,
    avgTrade: round(trades.length ? sum(pnls) / trades.length : 0),
    avgWin: round(wins.length ? grossProfit / wins.length : 0),
    avgLoss: round(losses.length ? -grossLoss / losses.length : 0),
    largestWin: round(wins.length ? Math.max(...wins) : 0),
    largestLoss: round(losses.length ? Math.min(...losses) : 0),
    avgBarsInTrade: round(trades.length ? sum(trades.map((t) => t.bars || 0)) / trades.length : 0),
    exposure: round(bars ? (barsInMarket / bars) * 100 : 0),
    totalCommission: round(sum(trades.map((t) => t.commission || 0))),
    buyHoldPct: buyHoldPct === null ? null : round(buyHoldPct),
  };
}

function sum(a) {
  let s = 0;
  for (const v of a) s += v;
  return s;
}

function std(a, mean) {
  if (a.length < 2) return 0;
  let s = 0;
  for (const v of a) s += (v - mean) ** 2;
  return Math.sqrt(s / (a.length - 1));
}

function round(v, d = 6) {
  if (v === null || v === undefined || !Number.isFinite(v)) return v;
  const f = 10 ** d;
  return Math.round(v * f) / f;
}
