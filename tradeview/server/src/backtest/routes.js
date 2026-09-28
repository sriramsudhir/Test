// Backtest routes (§4): POST /api/backtest, GET /api/backtest/strategies
import { backtest } from './index.js';
import { listStrategies } from './strategies.js';
import { listLibrary } from '../pine/library.js';
import { loadCandlesFor } from '../pine/routes.js';
import { tfToMs, isTf } from '../pine/util.js';

export async function register(app, ctx) {
  app.get('/api/backtest/strategies', async () => ({
    builtin: listStrategies(),
    pine: listLibrary().filter((e) => e.type === 'strategy'),
  }));

  app.post('/api/backtest', async (req, reply) => {
    const b = req.body || {};
    if (typeof b.symbol !== 'string' || !b.symbol) return reply.code(400).send({ error: 'symbol is required' });
    if (!isTf(b.tf)) return reply.code(400).send({ error: 'tf is invalid' });
    if (!b.source && !b.strategy) return reply.code(400).send({ error: 'source or strategy is required' });
    let candles;
    try {
      candles = await loadCandlesFor(ctx, { symbol: b.symbol, tf: b.tf, from: b.from, to: b.to, limit: b.limit ?? 5000 });
    } catch (err) {
      return reply.code(err.statusCode || 502).send({ error: `Could not load candles: ${err.message}` });
    }
    let tickSize = Number(b.tickSize);
    if (!(tickSize > 0)) tickSize = await lookupTickSize(ctx, b.symbol);
    try {
      return await backtest({ ...b, candles, tickSize, tfMs: tfToMs(b.tf) });
    } catch (err) {
      const code = err.statusCode || (err.name === 'PineError' ? 400 : 500);
      if (code >= 500) ctx?.log?.error?.({ err }, 'backtest failed');
      return reply.code(code).send({ error: err.message, line: err.line ?? null });
    }
  });
}

/** Best-effort instrument tick size (falls back to 0.01). */
export async function lookupTickSize(ctx, symbol) {
  try {
    const inst = ctx?.bybit?.instruments;
    const info = (await inst?.get?.(symbol)) || (await inst?.getInstrument?.(symbol));
    const ts = Number(info?.tickSize);
    if (ts > 0) return ts;
  } catch {
    /* ignore */
  }
  try {
    const [cat, sym] = symbol.split(':');
    const list = await ctx?.market?.listSymbols?.({ q: sym });
    const hit = (list || []).find((s) => s.key === symbol || (s.symbol === sym && s.category === cat));
    if (Number(hit?.tickSize) > 0) return Number(hit.tickSize);
  } catch {
    /* ignore */
  }
  return 0.01;
}
