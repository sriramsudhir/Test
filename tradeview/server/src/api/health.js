// GET /api/health -> { ok, bybit, db, laya, ... }
import { dbHealthy } from '../db/index.js';

/**
 * @param {import('fastify').FastifyInstance} app
 * @param {any} ctx
 */
export async function register(app, ctx) {
  const started = Date.now();
  app.get('/api/health', async () => {
    const db = dbHealthy(ctx.db);
    const rest = ctx.bybit?.rest?.health ?? 'unknown';
    const ws = ctx.live?.status?.().bybit ?? 'unknown';
    // "connected" when REST is fine (or untested) and streams are up; "reconnecting" during WS outages;
    // "down" when REST calls keep failing (offline mode, cached data only).
    let bybit = 'connected';
    if (rest === 'down') bybit = 'down';
    else if (ws === 'reconnecting') bybit = 'reconnecting';
    else if (rest === 'degraded') bybit = 'degraded';
    let laya = { ready: false, mode: 'off', model: null };
    try {
      laya = (await ctx.laya?.status?.()) ?? laya;
    } catch (err) {
      laya = { ready: false, mode: 'error', model: null, error: err.message };
    }
    return {
      ok: db,
      bybit,
      db,
      laya,
      details: {
        rest,
        restStats: ctx.bybit?.rest?.stats,
        ws,
        subscriptions: ctx.live?.subscriptions?.().length ?? 0,
        instruments: ctx.bybit?.instruments?.size ?? 0,
        instrumentsSource: ctx.bybit?.instruments?.source,
        sockets: ctx.sockets?.size ?? 0,
        uptimeSec: Math.round((Date.now() - started) / 1000),
      },
    };
  });
}

export default register;
