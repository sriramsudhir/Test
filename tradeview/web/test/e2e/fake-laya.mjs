#!/usr/bin/env node
// Tiny fake of the Python `laya-serve` for e2e tests: POST /v1/systemone {state, questions} -> {answers, usage}
// in the real system_one schema. The decision probability is controlled with POST /control/laya {p}.
//   node web/test/e2e/fake-laya.mjs [--port 8791]
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export async function startFakeLaya({ port = 8791, host = '127.0.0.1', p = 0.8, log = console } = {}) {
  const st = { p, calls: [], latencyMs: 30 };
  const json = (res, code, body) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const readBody = (req) => new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch { resolve(null); }
    });
  });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'POST' && url.pathname === '/v1/systemone') {
      const body = await readBody(req);
      if (!body || typeof body.state !== 'object' || typeof body.questions !== 'object') {
        return json(res, 422, { detail: 'state and questions are required' });
      }
      st.calls.push({ t: Date.now(), state: body.state, questions: body.questions });
      await new Promise((r) => setTimeout(r, st.latencyMs));
      const answers = {};
      for (const [name, q] of Object.entries(body.questions)) {
        if (q.type === 'noul') answers[name] = { type: 'noul', noul: st.p, probabilities: { true: st.p, false: Number((1 - st.p).toFixed(4)) } };
        else if (q.type === 'choice') {
          const opts = Object.keys(q.criteria || { bullish: 1, bearish: 1, neutral: 1 });
          const probabilities = Object.fromEntries(opts.map((o, i) => [o, i === 0 ? 0.62 : Number((0.38 / (opts.length - 1)).toFixed(4))]));
          answers[name] = { type: 'choice', choice: opts[0], probabilities, confidence: 0.62 };
        } else if (q.type === 'score') {
          answers[name] = { type: 'score', score: 1.6, labels: Array.isArray(q.criteria) ? q.criteria : undefined, probabilities: [0.1, 0.2, 0.7] };
        } else answers[name] = { type: q.type, value: null };
      }
      return json(res, 200, { answers, usage: { input_tokens: 812, output_tokens: 9, latency_ms: st.latencyMs }, model: 'fake-laya-serve' });
    }
    if (req.method === 'POST' && url.pathname === '/control/laya') {
      const body = (await readBody(req)) || {};
      if (Number.isFinite(Number(body.p))) st.p = Number(body.p);
      return json(res, 200, { ok: true, p: st.p });
    }
    if (req.method === 'GET' && url.pathname === '/control/laya') return json(res, 200, { p: st.p, calls: st.calls.length, last: st.calls.at(-1) || null });
    if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true });
    return json(res, 404, { detail: 'Not Found' });
  });
  await new Promise((resolve) => server.listen(port, host, resolve));
  const base = `http://${host}:${server.address().port}`;
  log.info?.(`[fake-laya] ${base}/v1/systemone (p=${st.p})`);
  return {
    url: base,
    state: st,
    setP(v) { st.p = v; },
    async close() {
      server.closeAllConnections?.();
      await new Promise((r) => server.close(() => r()));
    },
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const i = process.argv.indexOf('--port');
  const laya = await startFakeLaya({ port: Number(i > 0 ? process.argv[i + 1] : process.env.FAKE_LAYA_PORT || 8791) });
  process.once('SIGINT', async () => { await laya.close(); process.exit(0); });
  process.once('SIGTERM', async () => { await laya.close(); process.exit(0); });
}
