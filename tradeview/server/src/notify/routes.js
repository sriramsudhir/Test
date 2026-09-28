// Push routes (§13.3): GET /api/push/vapid, POST /api/push/subscribe, DELETE /api/push/subscribe, POST /api/push/test
import { getNotifier, start } from './index.js';

export async function register(app, ctx) {
  const n = () => getNotifier() || start(ctx);

  app.get('/api/push/vapid', async (req, reply) => {
    try {
      return { publicKey: n().publicKey(), telegram: n().telegramEnabled() };
    } catch (err) {
      return reply.code(503).send({ error: `push unavailable: ${err.message}` });
    }
  });

  app.post('/api/push/subscribe', async (req, reply) => {
    try {
      const sub = req.body?.subscription ?? req.body;
      const saved = n().subscribe(sub);
      return reply.code(201).send({ ok: true, endpoint: saved.endpoint });
    } catch (err) {
      return reply.code(err.statusCode || 500).send({ error: err.message });
    }
  });

  app.delete('/api/push/subscribe', async (req, reply) => {
    const endpoint = req.body?.endpoint ?? req.body?.subscription?.endpoint ?? req.query?.endpoint;
    if (typeof endpoint !== 'string' || !endpoint) return reply.code(400).send({ error: 'endpoint is required' });
    return { ok: true, removed: n().unsubscribe(endpoint) };
  });

  app.post('/api/push/test', async () => n().test());

  app.get('/api/push/status', async () => n().status());
}
