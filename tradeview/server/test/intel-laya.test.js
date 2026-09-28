import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createLayaService } from '../src/laya/index.js';
import { buildMarketState, buildQuestions, evaluateDecision, answerProbability } from '../src/laya/questions.js';
import { askLaya } from '../src/laya/gate.js';

const quiet = { info() {}, warn() {}, error() {}, debug() {} };

function candles(n = 260) {
  return Array.from({ length: n }, (_, i) => {
    const c = 100 + Math.sin(i / 10) * 5 + i * 0.05;
    return { t: i * 60000, o: c - 0.2, h: c + 0.5, l: c - 0.5, c, v: 10 + (i === n - 1 ? 40 : Math.sin(i) * 2) };
  });
}

async function withServer(handler, fn) {
  const server = http.createServer(handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

test('http mode: POSTs {state, questions} to /v1/systemone and returns answers', async () => {
  const seen = [];
  await withServer(
    (req, res) => {
      let body = '';
      req.on('data', (d) => (body += d));
      req.on('end', () => {
        seen.push({ method: req.method, url: req.url, body: JSON.parse(body) });
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({
          answers: { decision: { noul: 0.72 }, direction: { choice: 'bullish', probabilities: { bullish: 0.6, bearish: 0.2, neutral: 0.2 } }, confidence: { score: 0.8 } },
          usage: { ms: 12 },
          model: 'laya-test',
        }));
      });
    },
    async (url) => {
      const laya = createLayaService({ config: { layaMode: 'http', layaUrl: url + '/' }, log: quiet });
      assert.deepEqual(laya.status().ready, false);
      const state = { symbol: 'linear:BTCUSDT' };
      const questions = buildQuestions('Will it hold?');
      const out = await laya.decide(state, questions);
      assert.equal(seen.length, 1);
      assert.equal(seen[0].method, 'POST');
      assert.equal(seen[0].url, '/v1/systemone');
      assert.deepEqual(seen[0].body, { state, questions });
      assert.equal(out.answers.decision.noul, 0.72);
      assert.deepEqual(out.usage, { ms: 12 });
      const st = laya.status();
      assert.equal(st.ready, true);
      assert.equal(st.mode, 'http');
      assert.equal(st.model, 'laya-test');
    },
  );
});

test('http mode: server errors and unreachable servers resolve to null (never throw)', async () => {
  await withServer(
    (req, res) => {
      res.statusCode = 500;
      res.end('boom');
    },
    async (url) => {
      const laya = createLayaService({ config: { layaMode: 'http', layaUrl: url }, log: quiet });
      assert.equal(await laya.decide({}, buildQuestions()), null);
      assert.equal(laya.status().ready, false);
      assert.match(laya.status().error, /HTTP 500/);
    },
  );
  const dead = createLayaService({ config: { layaMode: 'http', layaUrl: 'http://127.0.0.1:1' }, log: quiet, }, { timeoutMs: 2000 });
  assert.equal(await dead.decide({}, buildQuestions()), null);
  assert.equal(dead.status().state, 'error');
});

test('off mode returns null', async () => {
  const laya = createLayaService({ config: { layaMode: 'off' }, log: quiet });
  assert.deepEqual({ ready: laya.status().ready, mode: laya.status().mode }, { ready: false, mode: 'off' });
  assert.equal(await laya.decide({}, {}), null);
});

test('local mode: lazy import, Laya.load(), systemOne(state, questions)', async () => {
  let loads = 0;
  let imports = 0;
  const calls = [];
  const fakeModule = {
    Laya: {
      async load() {
        loads++;
        return {
          model: { name: 'laya-mini' },
          async systemOne(state, questions) {
            calls.push({ state, questions });
            return { answers: { decision: { noul: 0.4 } }, usage: { tokens: 3 } };
          },
        };
      },
    },
  };
  const laya = createLayaService({ config: { layaMode: 'local' }, log: quiet }, { importer: async () => (imports++, fakeModule) });
  assert.equal(imports, 0, 'not loaded until first use');
  assert.equal(laya.status().state, 'idle');
  const [a, b] = await Promise.all([laya.decide({ x: 1 }, buildQuestions()), laya.decide({ x: 2 }, buildQuestions())]);
  assert.equal(imports, 1);
  assert.equal(loads, 1);
  assert.equal(a.answers.decision.noul, 0.4);
  assert.equal(b.usage.tokens, 3);
  assert.equal(calls.length, 2);
  assert.equal(laya.status().ready, true);
  assert.equal(laya.status().model, 'laya-mini');
});

test('local mode: missing package -> status error, decide null', async () => {
  const laya = createLayaService({ config: { layaMode: 'local' }, log: quiet }, {
    importer: async () => {
      throw new Error("Cannot find package '@receptron/laya'");
    },
  });
  assert.equal(await laya.decide({}, buildQuestions()), null);
  const st = laya.status();
  assert.equal(st.ready, false);
  assert.equal(st.state, 'error');
  assert.match(st.error, /Cannot find package/);
});

test('local mode against the real (uninstalled) package never throws', async () => {
  const laya = createLayaService({ config: { layaMode: 'local' }, log: quiet });
  const out = await laya.decide({}, buildQuestions());
  // In this container @receptron/laya is not installed; if it is, a real answer is fine too.
  if (out === null) assert.equal(laya.status().state, 'error');
  else assert.ok(out.answers);
});

test('buildMarketState: compact candles + indicators + alert distance + footprint delta', () => {
  const cs = candles();
  const state = buildMarketState({
    symbol: 'linear:BTCUSDT', tf: '1m', candles: cs, t: 0,
    alert: { name: 'x', condition: { kind: 'price', op: 'crosses_up', value: 110 } },
    footprint: [{ t: 0, delta: 5 }, { t: 1, levels: [{ p: 1, bid: 1, ask: 4 }] }],
  });
  assert.equal(state.candles.rows.length, 50);
  assert.deepEqual(state.candles.columns, ['t', 'o', 'h', 'l', 'c', 'v']);
  assert.equal(state.candles.rows[49][0], cs[cs.length - 1].t);
  assert.equal(state.price, Math.round(cs[cs.length - 1].c * 1e6) / 1e6);
  for (const k of ['rsi14', 'ema20', 'ema50', 'ema200', 'atr14', 'volumeZ']) assert.equal(typeof state.indicators[k], 'number', k);
  assert.ok(state.indicators.rsi14 >= 0 && state.indicators.rsi14 <= 100);
  assert.ok(state.indicators.volumeZ > 2, 'last bar volume spike');
  assert.equal(state.alert.level, 110);
  assert.ok(Math.abs(state.alert.distance - (state.price - 110)) < 1e-6);
  assert.equal(state.footprint.delta, 8);
  const few = buildMarketState({ symbol: 's', tf: '1m', candles: cs.slice(0, 30) });
  assert.equal(few.indicators.ema200, null);
});

test('questions and decision evaluation', () => {
  const q = buildQuestions('Breakout continues?');
  assert.deepEqual(Object.keys(q), ['decision', 'direction', 'confidence']);
  assert.equal(q.decision.type, 'noul');
  assert.deepEqual(Object.keys(q.direction.criteria), ['bullish', 'bearish', 'neutral']);
  assert.deepEqual(q.confidence.criteria, ['low', 'medium', 'high']);
  assert.equal(answerProbability({ noul: 0.7 }), 0.7);
  assert.equal(answerProbability(0.3), 0.3);
  assert.equal(answerProbability({ probabilities: { true: 0.9, false: 0.1 } }), 0.9);
  assert.equal(answerProbability({}), null);
  const d = evaluateDecision({ answers: { decision: { noul: 0.65 }, direction: { choice: 'bearish' }, confidence: { score: 2 } } }, 0.6);
  assert.deepEqual([d.p, d.passed, d.direction, d.confidence], [0.65, true, 'bearish', 2]);
  assert.equal(evaluateDecision({ answers: { decision: { noul: 0.5 } } }, 0.6).passed, false);
  assert.equal(evaluateDecision({ answers: {} }, 0.6).passed, false);
});

test('askLaya gathers candles/footprint from ctx.market and evaluates the threshold', async () => {
  let got;
  const ctx = {
    market: { getCandles: async () => candles(), getFootprint: async () => [{ t: 0, delta: -3 }] },
    laya: { status: () => ({ mode: 'http' }), decide: async (state, questions) => ((got = { state, questions }), { answers: { decision: { noul: 0.8 } } }) },
  };
  const out = await askLaya(ctx, { symbol: 'linear:BTCUSDT', tf: '5m', question: 'Q?', threshold: 0.75 });
  assert.equal(out.skipped, false);
  assert.equal(out.passed, true);
  assert.equal(out.p, 0.8);
  assert.equal(got.questions.decision.instructions, 'Q?');
  assert.equal(got.state.footprint.delta, -3);
  const off = await askLaya({ laya: { status: () => ({ mode: 'off' }), decide: async () => null } }, { symbol: 's', tf: '1m' });
  assert.equal(off.skipped, true);
  const down = await askLaya({ ...ctx, laya: { status: () => ({ mode: 'http', error: 'down' }), decide: async () => null } }, { symbol: 's', tf: '1m' });
  assert.deepEqual([down.skipped, down.reason], [true, 'down']);
});
