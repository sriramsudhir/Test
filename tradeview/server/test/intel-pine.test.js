import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { runPine, closePinePool, PineError } from '../src/pine/runner.js';
import { loadLibrary, listLibrary, getLibraryEntry } from '../src/pine/library.js';
import { normalizePlots, toPineCandles, toPineError } from '../src/pine/normalize.js';

after(() => closePinePool());

function synth(n = 400, tf = 3600000) {
  const t0 = Date.UTC(2024, 0, 1);
  const out = [];
  let p = 100;
  for (let i = 0; i < n; i++) {
    const o = p;
    p = p * (1 + Math.sin(i / 8) * 0.012 + Math.cos(i / 3) * 0.004);
    out.push({ t: t0 + i * tf, o, h: Math.max(o, p) * 1.004, l: Math.min(o, p) * 0.996, c: p, v: 100 + 50 * Math.sin(i) + 60 });
  }
  return out;
}

const candles = synth();

test('library has the required indicators and strategies', () => {
  const ids = listLibrary().map((e) => e.id);
  for (const id of ['sma', 'ema', 'wma', 'vwap', 'bollinger', 'keltner', 'donchian', 'rsi', 'macd', 'stochastic', 'stoch_rsi', 'cci', 'atr',
    'adx_dmi', 'obv', 'mfi', 'supertrend', 'ichimoku', 'parabolic_sar', 'williams_r', 'volume',
    'strategy_ema_cross', 'strategy_rsi_mean_reversion', 'strategy_supertrend']) {
    assert.ok(ids.includes(id), `missing ${id}`);
  }
  const macd = getLibraryEntry('macd');
  assert.equal(macd.type, 'indicator');
  assert.equal(macd.overlay, false);
  assert.equal(getLibraryEntry('strategy_ema_cross').type, 'strategy');
  assert.equal(getLibraryEntry('nope'), null);
});

for (const entry of loadLibrary()) {
  test(`library script runs: ${entry.id}`, async () => {
    const res = await runPine({ candles, source: entry.source, tfMs: 3600000 });
    const names = Object.keys(res.plots);
    assert.ok(names.length > 0, 'has plots');
    assert.ok(!names.some((n) => n.startsWith('__')), 'internal plots dropped');
    assert.equal(res.meta.type, entry.type);
    assert.equal(res.meta.overlay, entry.overlay);
    // at least one plot has real numbers near the end of the series
    const numeric = names.filter((n) => res.plots[n].data.slice(-60).some((p) => typeof p.value === 'number'));
    assert.ok(numeric.length > 0, 'numeric output');
    for (const n of names) {
      for (const p of res.plots[n].data) {
        assert.equal(typeof p.t, 'number');
        assert.ok(p.value === null || ['number', 'boolean', 'string'].includes(typeof p.value));
        if (typeof p.value === 'number') assert.ok(Number.isFinite(p.value));
      }
    }
    if (entry.type === 'strategy') {
      assert.ok(res.strategy, 'strategy output');
      assert.ok(res.strategy.closedTrades.length > 0, 'strategy trades');
    }
  });
}

test('runPine normalises plots, meta, inputs and alerts', async () => {
  const src = `//@version=6
indicator("Test Ind", shorttitle="TI", overlay=true)
len = input.int(20, "Length")
plot(ta.sma(close, len), "MA", color=color.red)
plot(close, "Shifted", offset=2)
alertcondition(ta.crossover(close, ta.sma(close, len)), "Up", "crossed up")
`;
  const small = candles.slice(0, 60);
  const res = await runPine({ candles: small, source: src, inputs: { Length: 5 } });
  assert.equal(res.meta.title, 'Test Ind');
  assert.equal(res.meta.shorttitle, 'TI');
  assert.equal(res.meta.overlay, true);
  assert.equal(res.meta.type, 'indicator');
  assert.deepEqual(res.meta.inputs.map((i) => [i.name, i.type, i.defval]), [['Length', 'int', 20]]);
  const ma = res.plots.MA;
  assert.equal(ma.data.length, small.length);
  assert.equal(ma.data[0].t, small[0].t);
  assert.equal(ma.data[3].value, null, 'warm-up is null (length 5 applied)');
  const expected = small.slice(0, 5).reduce((s, k) => s + k.c, 0) / 5;
  assert.ok(Math.abs(ma.data[4].value - expected) < 1e-6, 'input override applied');
  assert.equal(ma.options.color, '#F23645');
  // offset=2: value from bar i shown on bar i+2
  const sh = res.plots.Shifted;
  assert.equal(sh.data[0].t, small[2].t);
  assert.ok(Math.abs(sh.data[0].value - small[0].c) < 1e-9);
  assert.equal(sh.options.offsetApplied, 2);
  // alerts come back with bar time
  for (const a of res.alerts) {
    assert.equal(a.type, 'alertcondition');
    assert.equal(a.title, 'Up');
    assert.ok(small.some((k) => k.t === a.t));
  }
});

test('runPine exposes PineTS strategy data', async () => {
  const res = await runPine({ candles, source: getLibraryEntry('strategy_ema_cross').source, props: { initial_capital: 5000 } });
  assert.equal(res.meta.type, 'strategy');
  assert.equal(res.meta.title, 'EMA Cross Strategy');
  assert.equal(res.strategy.config.initialCapital, 5000);
  const tr = res.strategy.closedTrades[0];
  assert.ok(['long', 'short'].includes(tr.side));
  assert.ok(tr.qty > 0);
  // market orders fill at the next bar open
  assert.ok(Math.abs(tr.entryPrice - candles[tr.entryBar].o) < 1e-6);
  assert.equal(tr.entryTime, candles[tr.entryBar].t);
});

test('syntax errors carry line and column', async () => {
  await assert.rejects(
    runPine({ candles, source: '//@version=6\nindicator("x")\na = (close +\nplot(a)' }),
    (err) => err instanceof PineError && err.kind === 'syntax' && err.line === 4 && /Syntax error/.test(err.message),
  );
});

test('runtime errors get a best-effort line number', async () => {
  await assert.rejects(
    runPine({ candles, source: '//@version=6\nindicator("x")\n\na = ta.foo(close)\nplot(a)' }),
    (err) => err.line === 4 && /Unknown function 'ta.foo'/.test(err.message),
  );
  await assert.rejects(
    runPine({ candles, source: '//@version=6\nindicator("x")\nplot(undefinedVar)' }),
    (err) => err.line === 3 && /undefinedVar/.test(err.message),
  );
});

test('runaway scripts are terminated by the timeout and the pool recovers', async () => {
  const src = `//@version=6
indicator("slow")
s = 0.0
for i = 0 to 100000
    for j = 0 to 100000
        s += 1
plot(s)`;
  const t0 = Date.now();
  await assert.rejects(runPine({ candles: candles.slice(0, 50), source: src, timeoutMs: 400 }), (err) => err.kind === 'timeout');
  assert.ok(Date.now() - t0 < 5000);
  const ok = await runPine({ candles, source: getLibraryEntry('sma').source });
  assert.ok(ok.plots.SMA);
});

test('input validation', async () => {
  await assert.rejects(runPine({ candles: [], source: 'indicator("x")' }), /No candles/);
  await assert.rejects(runPine({ candles, source: '  ' }), /empty/);
});

test('pure helpers: toPineCandles / normalizePlots / toPineError', () => {
  const pc = toPineCandles([{ t: 0, o: 1, h: 2, l: 0.5, c: 1.5, v: 10 }, { t: 60000, o: 1, h: 2, l: 0.5, c: 1.5, v: 10 }]);
  assert.deepEqual(pc[0], { open: 1, high: 2, low: 0.5, close: 1.5, volume: 10, openTime: 0, closeTime: 59999 });
  const plots = normalizePlots({
    A: { data: [{ time: 0, value: NaN, options: { color: '#fff' } }, { time: 1, value: 2, options: { color: '#000' } }], options: { color: '#fff' } },
    __labels__: { data: [] },
  }, [0, 1]);
  assert.deepEqual(Object.keys(plots), ['A']);
  assert.deepEqual(plots.A.data, [{ t: 0, value: null }, { t: 1, value: 2, color: '#000' }]);
  const e = toPineError(new Error('Failed to transpile Pine Script version 6: Expected RPAREN but got EOF at 7:3'));
  assert.equal(e.line, 7);
  assert.equal(e.column, 3);
});
