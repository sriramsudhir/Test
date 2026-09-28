// Market data REST routes (ARCHITECTURE §4, §13.1): /api/symbols (both providers, `provider` filter),
// /api/candles, /api/footprint, /api/timeframes.
import { TIMEFRAMES, normalizeTf } from '../data/timeframes.js';
import { parseSymbolKey, GROUPS } from '../bybit/markets.js';
import { MAX_LIMIT } from '../data/market.js';
import { PROVIDERS } from '../providers/index.js';

/** Parse an optional numeric query param (ms timestamps; seconds are upgraded to ms). */
export function parseTime(x) {
  if (x === undefined || x === null || x === '') return undefined;
  const n = Number(x);
  if (Number.isFinite(n)) return n < 1e11 ? n * 1000 : n;
  const d = Date.parse(String(x));
  return Number.isFinite(d) ? d : undefined;
}

function badRequest(reply, message) {
  return reply.code(400).send({ error: message });
}

/**
 * @param {import('fastify').FastifyInstance} app
 * @param {any} ctx
 */
export async function register(app, ctx) {
  app.get('/api/timeframes', async () => ({ timeframes: TIMEFRAMES }));

  app.get('/api/symbols', async (req, reply) => {
    const { group, q, category, provider, contractType, all, limit } = req.query || {};
    if (group && !GROUPS.includes(group)) return badRequest(reply, `group must be one of ${GROUPS.join(', ')}`);
    if (provider && !PROVIDERS.includes(provider)) return badRequest(reply, `provider must be one of ${PROVIDERS.join(', ')}`);
    const lim = limit ? Math.max(1, Math.min(5000, Number(limit) || 0)) : undefined;
    // Delta options / dated futures are hidden unless contractType (e.g. call_options) or all=1 is given.
    return ctx.market.listSymbols({ group, q, category, provider, contractType, all: all === '1' || all === 'true', limit: lim });
  });

  app.get('/api/candles', async (req, reply) => {
    const { symbol, tf, from, to, limit } = req.query || {};
    let key;
    try {
      key = parseSymbolKey(symbol).key;
    } catch (err) {
      return badRequest(reply, err.message);
    }
    const tfId = normalizeTf(tf || '1h');
    if (!tfId) return badRequest(reply, `Unknown timeframe: ${tf}`);
    const lim = limit !== undefined ? Number(limit) : undefined;
    if (lim !== undefined && (!Number.isFinite(lim) || lim <= 0)) return badRequest(reply, 'limit must be a positive number');
    const candles = await ctx.market.getCandles({
      symbol: key, tf: tfId, from: parseTime(from), to: parseTime(to), limit: lim && Math.min(lim, MAX_LIMIT),
    });
    return { symbol: key, tf: tfId, candles };
  });

  app.get('/api/footprint', async (req, reply) => {
    const { symbol, tf, from, to, limit } = req.query || {};
    let key;
    try {
      key = parseSymbolKey(symbol).key;
    } catch (err) {
      return badRequest(reply, err.message);
    }
    const tfId = normalizeTf(tf || '1m');
    if (!tfId) return badRequest(reply, `Unknown timeframe: ${tf}`);
    const bars = await ctx.market.getFootprint({
      symbol: key, tf: tfId, from: parseTime(from), to: parseTime(to), limit: limit ? Number(limit) : undefined,
    });
    return { symbol: key, tf: tfId, bars };
  });
}

export default register;
