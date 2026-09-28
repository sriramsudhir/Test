// GET /api/health -> { ok, bybit, delta, db, laya, auth, details } (public: not behind auth)
import { dbHealthy } from '../db/index.js';

/**
 * @param {import('fastify').FastifyInstance} app
 * @param {any} ctx
 */
export async function register(app, ctx) {
  const started = Date.now();
  app.get('/api/health', async () => {
    const db = dbHealthy(ctx.db);
    const restHealth = ctx.providers?.rest?.healthByProvider ?? { bybit: ctx.bybit?.rest?.health ?? 'unknown' };
    const live = ctx.live?.status?.() ?? {};
    const streams = live.providers ?? {};
    // Per provider: "down" when REST calls keep failing (offline: cached data only), "reconnecting" during a
    // WS outage, "degraded" after sporadic REST failures, else "connected".
    const providerState = (name) => {
      const rest = restHealth[name] ?? 'unknown';
      if (rest === 'down') return 'down';
      if (streams[name] === 'reconnecting') return 'reconnecting';
      if (rest === 'degraded') return 'degraded';
      return 'connected';
    };
    let laya = { ready: false, mode: 'off', model: null };
    try {
      laya = (await ctx.laya?.status?.()) ?? laya;
    } catch (err) {
      laya = { ready: false, mode: 'error', model: null, error: err.message };
    }
    return {
      ok: db,
      bybit: providerState('bybit'),
      delta: providerState('delta'),
      db,
      laya,
      auth: { enabled: !!ctx.auth?.enabled },
      details: {
        rest: restHealth,
        restStats: ctx.providers?.rest?.stats ?? ctx.bybit?.rest?.stats,
        streams,
        subscriptions: live.subscriptions ?? 0,
        recorder: ctx.recorder?.status?.(),
        instruments: ctx.bybit?.instruments?.size ?? 0,
        instrumentsSource: ctx.bybit?.instruments?.source,
        sockets: ctx.sockets?.size ?? 0,
        uptimeSec: Math.round((Date.now() - started) / 1000),
      },
    };
  });
}

export default register;
