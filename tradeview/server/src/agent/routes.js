// Chat routes (§7): POST /api/chat streams server-sent events
//   data: {"type":"text","delta":"..."} | {"type":"tool",name,input} | {"type":"chart_command",command}
//       | {"type":"alert_created",alert} | {"type":"done"} | {"type":"error",message}
// plus GET /api/chat/history?session=, DELETE /api/chat/:session and GET /api/agent/status (§13.2).
import { runChat, agentStatus } from './loop.js';
import { forgetSession } from './drivers/claudeCode.js';

const HEARTBEAT_MS = 15000;
const MAX_MESSAGE_CHARS = 20000;

export async function register(app, ctx) {
  app.get('/api/agent/status', async () => agentStatus(ctx));

  app.post('/api/chat', async (req, reply) => {
    const b = req.body || {};
    const session = typeof b.session === 'string' && b.session.trim() ? b.session.trim().slice(0, 200) : null;
    const message = typeof b.message === 'string' ? b.message.trim() : '';
    if (!session) return reply.code(400).send({ error: 'session is required' });
    if (!message) return reply.code(400).send({ error: 'message is required' });
    if (message.length > MAX_MESSAGE_CHARS) return reply.code(400).send({ error: 'message is too long' });

    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      ...reply.getHeaders(), // keeps CORS headers set by hooks
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.flushHeaders?.();

    const ac = new AbortController();
    let closed = false;
    const onClose = () => {
      if (!res.writableFinished) ac.abort();
      closed = true;
    };
    res.on('close', onClose);
    const emit = (ev) => {
      if (closed || res.writableEnded) return;
      try {
        res.write(`data: ${JSON.stringify(ev)}\n\n`);
      } catch {
        /* socket gone */
      }
    };
    const hb = setInterval(() => {
      if (!closed && !res.writableEnded) res.write(': ping\n\n');
    }, HEARTBEAT_MS);

    try {
      await runChat({ ctx, session, message, context: b.context, emit, signal: ac.signal });
    } catch (err) {
      emit({ type: 'error', message: err?.message || String(err) });
      emit({ type: 'done' });
    } finally {
      clearInterval(hb);
      res.off('close', onClose);
      if (!res.writableEnded) res.end();
    }
  });

  app.get('/api/chat/history', async (req, reply) => {
    const session = req.query?.session;
    if (!session) return reply.code(400).send({ error: 'session is required' });
    const rows = ctx.repos?.chat?.list?.(session, Math.min(Number(req.query?.limit) || 200, 2000)) || [];
    // Only user text and assistant text are useful to render; tool traffic is summarised.
    const messages = [];
    for (const r of rows) {
      const blocks = Array.isArray(r.content) ? r.content : [{ type: 'text', text: String(r.content) }];
      if (r.role === 'user') {
        if (blocks.every((x) => x.type === 'tool_result')) continue;
        const texts = blocks.filter((x) => x.type === 'text' && !x.text.startsWith('<chart_context>')).map((x) => x.text);
        if (texts.length) messages.push({ role: 'user', text: texts.join('\n'), t: r.t });
      } else if (r.role === 'assistant') {
        const text = blocks.filter((x) => x.type === 'text').map((x) => x.text).join('');
        const tools = blocks.filter((x) => x.type === 'tool_use').map((x) => ({ name: x.name, input: x.input }));
        if (text || tools.length) messages.push({ role: 'assistant', text, tools, t: r.t });
      } else if (r.role === 'tool_calls' && Array.isArray(r.content)) {
        messages.push({ role: 'assistant', text: '', tools: r.content, t: r.t });
      }
    }
    return { session, agent: await agentStatus(ctx), messages };
  });

  app.delete('/api/chat/:session', async (req) => {
    const n = ctx.repos?.chat?.clear?.(req.params.session) ?? 0;
    forgetSession(req.params.session);
    return { ok: true, deleted: n };
  });
}
