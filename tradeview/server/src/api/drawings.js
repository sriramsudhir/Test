// Persisted chart drawings (ARCHITECTURE §4):
//   GET    /api/drawings?symbol=     -> { drawings: Drawing[] }
//   GET    /api/drawings/:id         -> { drawing }
//   PUT    /api/drawings/:id         body: Drawing (must include symbol) -> { drawing }
//   POST   /api/drawings             body: Drawing (id optional)         -> { drawing }
//   DELETE /api/drawings/:id         -> { ok }
//   DELETE /api/drawings?symbol=     -> { ok, deleted }  (clear all drawings of a symbol)
import { randomUUID } from 'node:crypto';
import { parseSymbolKey } from '../bybit/markets.js';

const MAX_BYTES = 256 * 1024;

function normSymbol(s) {
  try {
    return parseSymbolKey(s).key;
  } catch {
    return undefined;
  }
}

/**
 * @param {import('fastify').FastifyInstance} app
 * @param {any} ctx
 */
export async function register(app, ctx) {
  const repo = ctx.repos.drawings;

  app.get('/api/drawings', async (req) => {
    const symbol = req.query?.symbol ? normSymbol(req.query.symbol) ?? req.query.symbol : undefined;
    return { drawings: repo.list(symbol) };
  });

  app.get('/api/drawings/:id', async (req, reply) => {
    const d = repo.get(req.params.id);
    if (!d) return reply.code(404).send({ error: 'drawing not found' });
    return { drawing: d };
  });

  const save = (id, body, reply) => {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return reply.code(400).send({ error: 'JSON object body required' });
    if (JSON.stringify(body).length > MAX_BYTES) return reply.code(413).send({ error: 'drawing too large' });
    const symbol = normSymbol(body.symbol);
    if (!symbol) return reply.code(400).send({ error: 'drawing.symbol required (e.g. linear:BTCUSDT)' });
    const drawing = repo.put({ ...body, id, symbol, updated: Date.now() });
    return { drawing };
  };

  app.put('/api/drawings/:id', async (req, reply) => save(String(req.params.id), req.body, reply));
  app.post('/api/drawings', async (req, reply) => save(String(req.body?.id || randomUUID()), req.body, reply));

  app.delete('/api/drawings/:id', async (req, reply) => {
    if (!repo.delete(req.params.id)) return reply.code(404).send({ error: 'drawing not found' });
    return { ok: true };
  });

  app.delete('/api/drawings', async (req, reply) => {
    const symbol = normSymbol(req.query?.symbol);
    if (!symbol) return reply.code(400).send({ error: 'symbol query parameter required' });
    return { ok: true, deleted: repo.clear(symbol) };
  });
}

export default register;
