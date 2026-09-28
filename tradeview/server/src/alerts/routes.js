// Alert routes (§4): GET/POST /api/alerts, GET/PATCH/DELETE /api/alerts/:id, GET /api/alerts/events
import { listAlerts, getAlert, createAlert, updateAlert, deleteAlert, listEvents } from './service.js';

function fail(reply, err) {
  const code = err.statusCode || 500;
  return reply.code(code).send({ error: err.message });
}

export async function register(app, ctx) {
  app.get('/api/alerts', async (req, reply) => {
    try {
      return { alerts: listAlerts(ctx, { status: req.query?.status, symbol: req.query?.symbol }) };
    } catch (err) {
      return fail(reply, err);
    }
  });

  // Registered before /:id so "events" is not captured as an id.
  app.get('/api/alerts/events', async (req, reply) => {
    try {
      const limit = Math.min(Math.max(Number(req.query?.limit) || 100, 1), 1000);
      return { events: listEvents(ctx, { limit, alertId: req.query?.alertId }) };
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.get('/api/alerts/:id', async (req, reply) => {
    try {
      const a = getAlert(ctx, req.params.id);
      if (!a) return reply.code(404).send({ error: 'alert not found' });
      return a;
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post('/api/alerts', async (req, reply) => {
    try {
      const createdBy = req.body?.createdBy === 'agent' ? 'agent' : 'user';
      const alert = createAlert(ctx, req.body, { createdBy });
      return reply.code(201).send(alert);
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.patch('/api/alerts/:id', async (req, reply) => {
    try {
      const a = updateAlert(ctx, req.params.id, req.body);
      if (!a) return reply.code(404).send({ error: 'alert not found' });
      return a;
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.delete('/api/alerts/:id', async (req, reply) => {
    try {
      const ok = deleteAlert(ctx, req.params.id);
      if (!ok) return reply.code(404).send({ error: 'alert not found' });
      return { ok: true };
    } catch (err) {
      return fail(reply, err);
    }
  });
}
