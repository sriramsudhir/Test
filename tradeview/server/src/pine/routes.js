// Pine routes (§4): POST /api/pine/run, GET /api/pine/library, GET /api/pine/library/:id
import { runPine } from './runner.js';
import { listLibrary, getLibraryEntry } from './library.js';
import { tfToMs, isTf } from './util.js';

const MAX_BARS = 5000;

/**
 * Resolve the candles a script should run on.
 * @returns {Promise<Array>} ascending candles
 */
export async function loadCandlesFor(ctx, { symbol, tf, from, to, limit }) {
  if (!ctx?.market?.getCandles) throw Object.assign(new Error('Market data service unavailable'), { statusCode: 503 });
  const lim = Math.min(Math.max(Number(limit) || (from ? MAX_BARS : 1000), 1), MAX_BARS);
  const q = { symbol, tf, limit: lim };
  if (from !== undefined && from !== null) q.from = Number(from);
  if (to !== undefined && to !== null) q.to = Number(to);
  const candles = await ctx.market.getCandles(q);
  return Array.isArray(candles) ? candles : candles?.candles || [];
}

export async function register(app, ctx) {
  app.get('/api/pine/library', async () => ({ items: listLibrary() }));

  app.get('/api/pine/library/:id', async (req, reply) => {
    const entry = getLibraryEntry(req.params.id);
    if (!entry) return reply.code(404).send({ error: `Unknown library script '${req.params.id}'` });
    return entry;
  });

  app.post('/api/pine/run', async (req, reply) => {
    const body = req.body || {};
    const { symbol, tf, from, to, limit, inputs } = body;
    let source = body.source;
    if (!source && body.builtin) source = getLibraryEntry(body.builtin)?.source;
    if (typeof symbol !== 'string' || !symbol) return reply.code(400).send({ error: 'symbol is required' });
    if (!isTf(tf)) return reply.code(400).send({ error: 'tf is invalid' });
    if (typeof source !== 'string' || !source.trim()) return reply.code(400).send({ error: 'source (or builtin) is required' });
    let candles;
    try {
      candles = await loadCandlesFor(ctx, { symbol, tf, from, to, limit });
    } catch (err) {
      return reply.code(err.statusCode || 502).send({ error: `Could not load candles: ${err.message}` });
    }
    try {
      const res = await runPine({ candles, source, inputs, tfMs: tfToMs(tf) });
      return { plots: res.plots, meta: res.meta, alerts: res.alerts, strategy: res.strategy, warnings: res.warnings };
    } catch (err) {
      ctx?.log?.debug?.({ err: err.message }, 'pine run failed');
      return { plots: {}, meta: null, error: err.message, line: err.line ?? null, column: err.column ?? null, kind: err.kind || 'runtime' };
    }
  });
}
