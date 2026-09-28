// Laya routes: GET /api/laya/status, POST /api/laya/decide
import { askLaya } from './gate.js';
import { evaluateDecision, buildQuestions } from './questions.js';

export async function register(app, ctx) {
  app.get('/api/laya/status', async () => {
    const s = ctx.laya?.status?.() || { ready: false, mode: 'off', model: null };
    return s;
  });

  // Body: { symbol, tf, question?, threshold? }  -> builds the market state server-side, or
  //       { state, questions?, threshold? }       -> raw pass-through.
  app.post('/api/laya/decide', async (req, reply) => {
    const b = req.body || {};
    const threshold = Number.isFinite(Number(b.threshold)) ? Number(b.threshold) : ctx.config?.layaThreshold ?? 0.6;
    if (b.state && typeof b.state === 'object') {
      const result = await ctx.laya?.decide?.(b.state, b.questions || buildQuestions(b.question));
      if (!result) return reply.code(503).send({ skipped: true, error: ctx.laya?.status?.().error || 'Laya unavailable', status: ctx.laya?.status?.() });
      return { skipped: false, ...evaluateDecision(result, threshold), usage: result.usage };
    }
    if (typeof b.symbol !== 'string' || !b.tf) return reply.code(400).send({ error: 'symbol and tf (or state) are required' });
    const out = await askLaya(ctx, { symbol: b.symbol, tf: b.tf, question: b.question, threshold });
    if (out.skipped) return reply.code(503).send({ ...out, error: out.reason, status: ctx.laya?.status?.() });
    return out;
  });
}
