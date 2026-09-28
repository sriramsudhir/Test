import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { TOOLS, CHART_TOOLS, DATA_TOOLS, ALERT_TOOLS } from '../src/agent/tools.js';
import { createExecutor, toChartCommand } from '../src/agent/executor.js';
import { validateInput } from '../src/agent/validate.js';
import { formatContext, SYSTEM_PROMPT } from '../src/agent/prompt.js';
import * as api from '../src/agent/drivers/anthropicApi.js';
import * as cc from '../src/agent/drivers/claudeCode.js';
import { toZodShape } from '../src/agent/drivers/zodSchema.js';
import { runChat, agentStatus, driverName } from '../src/agent/loop.js';

const quiet = { info() {}, warn() {}, error() {}, debug() {} };
const T = Date.UTC(2025, 5, 1);

function fakeChatRepo() {
  const rows = [];
  return {
    rows,
    append: (session, role, content) => rows.push({ id: rows.length + 1, session, role, content: JSON.parse(JSON.stringify(content)), t: T }),
    list: (session, limit = 200) => rows.filter((r) => r.session === session).slice(-limit),
    clear: (session) => rows.splice(0, rows.length, ...rows.filter((r) => r.session !== session)).length,
  };
}

function fakeCtx(extra = {}) {
  const broadcasts = [];
  const alerts = new Map();
  const ctx = {
    log: quiet,
    config: { claudeModel: 'claude-opus-5-5', layaThreshold: 0.6, anthropicApiKey: '' },
    broadcast: (m) => broadcasts.push(m),
    market: {
      getCandles: async ({ limit = 100 }) => Array.from({ length: Math.min(limit, 300) }, (_, i) => ({ t: T + i * 60000, o: 100 + i, h: 101 + i, l: 99 + i, c: 100.5 + i, v: 5 })),
      listSymbols: async ({ q }) => [{ key: 'delta:BTCUSD', group: 'crypto', base: 'BTC', quote: 'USD', tickSize: 0.5 }].filter((s) => !q || s.key.includes(q)),
    },
    live: { lastPrice: () => 250 },
    repos: {
      chat: fakeChatRepo(),
      alerts: {
        list: () => [...alerts.values()],
        get: (id) => alerts.get(id) || null,
        save: (a) => {
          const s = { ...a, id: a.id ?? `al${alerts.size + 1}`, status: a.status ?? 'active' };
          alerts.set(s.id, s);
          return s;
        },
        delete: (id) => alerts.delete(id),
      },
    },
    laya: { status: () => ({ mode: 'off' }), decide: async () => null },
    ...extra,
  };
  return { ctx, broadcasts };
}

// ---------------------------------------------------------------- tools + executor

test('tool definitions cover §7 and are well formed', () => {
  const names = TOOLS.map((t) => t.name);
  assert.deepEqual(names.sort(), [...DATA_TOOLS, ...CHART_TOOLS, ...ALERT_TOOLS].sort());
  for (const t of TOOLS) {
    assert.ok(t.description.length > 20, t.name);
    assert.equal(t.input_schema.type, 'object');
    assert.equal(t.eager_input_streaming, true);
  }
  const draw = TOOLS.find((t) => t.name === 'draw');
  assert.deepEqual(draw.input_schema.properties.type.enum, ['hline', 'trendline', 'ray', 'rectangle', 'fib', 'long_position', 'short_position', 'text', 'arrow']);
  assert.match(TOOLS.find((t) => t.name === 'get_candles').description, /ALWAYS call this before drawing/);
  assert.match(SYSTEM_PROMPT, /Laya/);
});

test('input validator', () => {
  const schema = TOOLS.find((t) => t.name === 'draw').input_schema;
  assert.deepEqual(validateInput(schema, { type: 'hline', points: [{ t: T, price: 1 }] }), []);
  assert.ok(validateInput(schema, { type: 'circle', points: [] }).length >= 2);
  assert.ok(validateInput(schema, { type: 'hline', points: [{ t: 'x', price: 1 }] })[0].includes('points[0].t'));
});

test('chart tools -> ChartCommand {action, chartId?, ...input}, streamed and broadcast', async () => {
  const { ctx, broadcasts } = fakeCtx();
  const events = [];
  const ex = createExecutor(ctx, { emit: (e) => events.push(e) });
  const input = { chartId: 'c2', type: 'trendline', points: [{ t: T, price: 100 }, { t: T + 60000, price: 110 }], color: '#f00' };
  const out = await ex.execute('draw', input);
  assert.equal(out.isError, false);
  const cmd = events[0].command;
  assert.equal(events[0].type, 'chart_command');
  assert.equal(cmd.action, 'draw');
  assert.equal(cmd.chartId, 'c2');
  assert.deepEqual(cmd.points, input.points);
  assert.equal(cmd.color, '#f00');
  assert.ok(cmd.commandId);
  assert.deepEqual(broadcasts[0], { type: 'chart_command', command: cmd });

  for (const [name, inp, expect] of [
    ['set_symbol', { symbol: 'delta:ETHUSD' }, { action: 'set_symbol', symbol: 'delta:ETHUSD' }],
    ['set_timeframe', { chartId: 'a', tf: '4h' }, { action: 'set_timeframe', chartId: 'a', tf: '4h' }],
    ['set_layout', { layout: '4' }, { action: 'set_layout', layout: '4' }],
    ['add_indicator', { builtin: 'rsi', inputs: { Length: 7 } }, { action: 'add_indicator', builtin: 'rsi', inputs: { Length: 7 } }],
    ['remove_indicator', { id: 'ind1' }, { action: 'remove_indicator', id: 'ind1' }],
    ['clear_drawings', {}, { action: 'clear_drawings' }],
    ['set_chart_type', { type: 'footprint' }, { action: 'set_chart_type', type: 'footprint' }],
    ['start_replay', { from: T, speed: 5 }, { action: 'start_replay', from: T, speed: 5 }],
  ]) {
    const { commandId, ...c } = toChartCommand(name, inp);
    assert.deepEqual(c, expect);
    assert.equal((await ex.execute(name, inp)).isError, false, name);
  }
  // validation failures never reach the chart
  const n = events.length;
  assert.equal((await ex.execute('draw', { type: 'trendline', points: [{ t: T, price: 1 }] })).isError, true);
  assert.equal((await ex.execute('draw', { type: 'hline', points: [{ t: 1700000000, price: 1 }] })).isError, true, 'seconds rejected');
  assert.equal((await ex.execute('add_indicator', {})).isError, true);
  assert.equal((await ex.execute('set_timeframe', { tf: '7m' })).isError, true);
  assert.equal((await ex.execute('nope', {})).isError, true);
  assert.equal(events.length, n);
});

test('data tools run server-side', async () => {
  const { ctx } = fakeCtx();
  const ex = createExecutor(ctx, {
    deps: { askLaya: async () => ({ skipped: false, p: 0.7, passed: true, direction: 'bullish', state: { big: true } }) },
  });
  const c = JSON.parse((await ex.execute('get_candles', { symbol: 'delta:BTCUSD', tf: '1h', limit: 3 })).content);
  assert.equal(c.count, 3);
  assert.deepEqual(c.columns, ['t', 'o', 'h', 'l', 'c', 'v']);
  assert.equal(c.summary.high, 103);
  const s = JSON.parse((await ex.execute('get_symbols', { q: 'BTC' })).content);
  assert.equal(s.symbols[0].key, 'delta:BTCUSD');
  const p = JSON.parse((await ex.execute('run_pine', { symbol: 'delta:BTCUSD', tf: '1h', builtin: 'sma', limit: 100 })).content);
  assert.equal(p.title, 'Simple Moving Average');
  assert.equal(p.plots.SMA.length, 5);
  const b = JSON.parse((await ex.execute('run_backtest', { symbol: 'delta:BTCUSD', tf: '1h', strategy: { id: 'ema_cross' } })).content);
  assert.equal(b.mode, 'builtin');
  assert.equal(typeof b.metrics.netProfit, 'number');
  const l = JSON.parse((await ex.execute('laya_decide', { symbol: 'delta:BTCUSD', tf: '1h', question: 'Up?' })).content);
  assert.deepEqual([l.p, l.passed, l.state], [0.7, true, undefined]);
  const bad = await ex.execute('run_pine', { symbol: 'delta:BTCUSD', tf: '1h', source: '//@version=6\nindicator("x")\nplot(nope)' });
  assert.equal(bad.isError, true);
  assert.match(bad.content, /line 3/);
});

test('create_alert creates a real agent alert with Laya on and a loud sound; far levels are rejected', async () => {
  const { ctx, broadcasts } = fakeCtx();
  const events = [];
  const ex = createExecutor(ctx, { emit: (e) => events.push(e) });
  const out = await ex.execute('create_alert', {
    symbol: 'delta:BTCUSD', condition: { kind: 'price', op: 'crosses_up', value: 260 }, laya: { question: 'Breakout holds?' },
  });
  assert.equal(out.isError, false, out.content);
  const alert = events.find((e) => e.type === 'alert_created').alert;
  assert.equal(alert.createdBy, 'agent');
  assert.equal(alert.laya.enabled, true);
  assert.equal(alert.laya.question, 'Breakout holds?');
  assert.equal(alert.sound.preset, 'klaxon');
  assert.equal(alert.sound.loop, true);
  assert.equal(ctx.repos.alerts.get(alert.id).status, 'active');
  assert.ok(broadcasts.some((b) => b.type === 'alert_update'));
  const list = JSON.parse((await ex.execute('list_alerts', {})).content);
  assert.equal(list.count, 1);
  const far = await ex.execute('create_alert', { symbol: 'delta:BTCUSD', condition: { kind: 'price', op: 'above', value: 1000 } });
  assert.equal(far.isError, true);
  assert.match(far.content, /more than 50% away/);
  assert.equal((await ex.execute('delete_alert', { id: alert.id })).isError, false);
  assert.equal((await ex.execute('delete_alert', { id: alert.id })).isError, true);
});

test('formatContext renders the chart context', () => {
  const s = formatContext({ activeChartId: 'c1', charts: [{ id: 'c1', symbol: 'delta:BTCUSD', tf: '1h', lastPrice: 65000, visibleRange: { from: 1, to: 2 }, indicators: [{ id: 'i1', name: 'RSI' }] }] }, T);
  assert.match(s, /^<chart_context>/);
  assert.match(s, /active_chart: c1/);
  assert.match(s, /chart c1: delta:BTCUSD 1h \| last 65000 \| visible 1..2 \| indicators: i1\(RSI\)/);
  assert.match(formatContext(undefined, T), /charts: none reported/);
});

// ---------------------------------------------------------------- anthropic-api driver (mocked client)

function mockClient(script) {
  const calls = [];
  return {
    calls,
    messages: {
      stream(params) {
        calls.push(JSON.parse(JSON.stringify(params)));
        const step = script[calls.length - 1];
        const handlers = {};
        return {
          on(ev, fn) {
            handlers[ev] = fn;
            return this;
          },
          async finalMessage() {
            if (step instanceof Error) throw step;
            for (const d of step.deltas || []) handlers.text?.(d);
            return step.message;
          },
        };
      },
    },
  };
}

test('anthropic-api driver: tool call then final text, streamed and persisted', async () => {
  const { ctx } = fakeCtx();
  const client = mockClient([
    {
      deltas: ['Checking '],
      message: {
        stop_reason: 'tool_use',
        content: [
          { type: 'thinking', thinking: '', signature: 'sig1' },
          { type: 'text', text: 'Checking ' },
          { type: 'tool_use', id: 'tu1', name: 'get_candles', input: { symbol: 'delta:BTCUSD', tf: '1h', limit: 2 } },
          { type: 'tool_use', id: 'tu2', name: 'draw', input: { type: 'hline', points: [{ t: T, price: 101 }] } },
        ],
      },
    },
    { deltas: ['Drew ', 'support.'], message: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Drew support.' }] } },
  ]);
  const events = [];
  await api.run({ ctx, session: 's1', message: 'Draw support', context: { activeChartId: 'c1', charts: [] }, emit: (e) => events.push(e), client, now: T });
  assert.deepEqual(events.filter((e) => e.type === 'text').map((e) => e.delta), ['Checking ', 'Drew ', 'support.']);
  assert.deepEqual(events.filter((e) => e.type === 'tool').map((e) => e.name), ['get_candles', 'draw']);
  assert.equal(events.find((e) => e.type === 'chart_command').command.action, 'draw');
  assert.equal(events.at(-1).type, 'done');
  assert.equal(client.calls.length, 2);
  const first = client.calls[0];
  assert.equal(first.model, 'claude-opus-5-5');
  assert.deepEqual(first.thinking, { type: 'adaptive' });
  assert.equal(first.output_config.effort, 'medium');
  assert.equal(first.tools.length, TOOLS.length);
  assert.equal(first.system[0].text, SYSTEM_PROMPT);
  assert.match(first.messages[0].content[0].text, /<chart_context>/);
  const second = client.calls[1];
  assert.equal(second.messages.length, 3);
  assert.equal(second.messages[1].content[0].type, 'thinking', 'assistant turn replayed verbatim');
  const results = second.messages[2].content;
  assert.deepEqual(results.map((r) => r.tool_use_id), ['tu1', 'tu2']);
  assert.equal(JSON.parse(results[0].content).count, 2);
  // system + tools identical across requests (append-only prefix)
  assert.deepEqual(second.system, first.system);
  assert.deepEqual(second.tools, first.tools);
  assert.deepEqual(ctx.repos.chat.rows.map((r) => r.role), ['user', 'assistant', 'user', 'assistant']);

  // next turn replays the stored history
  const client2 = mockClient([{ message: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] } }]);
  await api.run({ ctx, session: 's1', message: 'thanks', emit: () => {}, client: client2, now: T });
  assert.equal(client2.calls[0].messages.length, 5);
  assert.deepEqual(client2.calls[0].messages.slice(0, 4), second.messages.concat([{ role: 'assistant', content: [{ type: 'text', text: 'Drew support.' }] }]));
});

test('anthropic-api driver: errors, refusal and missing key', async () => {
  const { ctx } = fakeCtx();
  const events = [];
  await api.run({ ctx, session: 'x', message: 'hi', emit: (e) => events.push(e) });
  assert.equal(events[0].type, 'error');
  assert.match(events[0].message, /ANTHROPIC_API_KEY/);
  const ev2 = [];
  await api.run({ ctx, session: 'x', message: 'hi', emit: (e) => ev2.push(e), client: mockClient([{ message: { stop_reason: 'refusal', content: [] } }]) });
  assert.match(ev2.find((e) => e.type === 'error').message, /declined/);
  const ev3 = [];
  await api.run({ ctx, session: 'x', message: 'hi', emit: (e) => ev3.push(e), client: mockClient([new Error('socket hang up'), new Error('again'), new Error('third')]) });
  assert.match(ev3.find((e) => e.type === 'error').message, /third/);
  assert.equal(ev3.at(-1).type, 'done');
});

test('buildHistory windows turns deterministically and strips thinking once trimmed', () => {
  const rows = [];
  for (let i = 0; i < 25; i++) {
    rows.push({ role: 'user', content: [{ type: 'text', text: `q${i}` }] });
    rows.push({ role: 'assistant', content: [{ type: 'thinking', thinking: '', signature: 's' }, { type: 'text', text: `a${i}` }] });
  }
  rows.push({ role: 'meta', content: { sdkSessionId: 'x' } });
  const small = api.buildHistory(rows.slice(0, 10), 20);
  assert.equal(small.trimmed, false);
  assert.equal(small.messages[1].content[0].type, 'thinking');
  const h = api.buildHistory(rows, 20);
  assert.equal(h.trimmed, true);
  assert.equal(h.messages[0].content[0].text, 'q10');
  assert.ok(h.messages.every((m) => !m.content.some?.((b) => b.type === 'thinking')));
  // dangling tool_use tail is dropped
  const d = api.buildHistory([...rows.slice(0, 2), { role: 'user', content: [{ type: 'text', text: 'q' }] }, { role: 'assistant', content: [{ type: 'tool_use', id: 'x', name: 'draw', input: {} }] }], 20);
  assert.equal(d.messages.at(-1).role, 'user');
});

// ---------------------------------------------------------------- claude-code driver (mocked SDK)

function fakeSdk(scenario) {
  const captured = [];
  const sdk = {
    USAGE_LIMIT_ERROR_PREFIXES: ["You've hit your"],
    tool: (name, description, inputSchema, handler) => ({ name, description, inputSchema, handler }),
    createSdkMcpServer: (opts) => ({ type: 'sdk', name: opts.name, instance: opts }),
    query({ prompt, options }) {
      captured.push({ prompt, options });
      return scenario({ prompt, options, n: captured.length });
    },
  };
  return { sdk, captured };
}

const toolOf = (options, name) => options.mcpServers.tradeview.instance.tools.find((t) => t.name === name);

beforeEach(() => cc._reset());

test('claude-code driver: only our MCP tools, partial text streamed, tool calls executed, session resumed', async () => {
  const { ctx, broadcasts } = fakeCtx();
  const { sdk, captured } = fakeSdk(async function* ({ options, n }) {
    yield { type: 'system', subtype: 'init', session_id: 'sdk-1', apiKeySource: 'none' };
    yield { type: 'stream_event', parent_tool_use_id: null, session_id: 'sdk-1', event: { type: 'message_start', message: { id: `m${n}` } } };
    yield { type: 'stream_event', parent_tool_use_id: null, session_id: 'sdk-1', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Look' } } };
    yield { type: 'stream_event', parent_tool_use_id: null, session_id: 'sdk-1', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ing.' } } };
    yield { type: 'assistant', parent_tool_use_id: null, session_id: 'sdk-1', message: { id: `m${n}`, content: [{ type: 'text', text: 'Looking.' }] } };
    const res = await toolOf(options, 'draw').handler({ type: 'hline', points: [{ t: T, price: 101 }] });
    assert.equal(res.isError, undefined);
    assert.equal(JSON.parse(res.content[0].text).ok, true);
    const bad = await toolOf(options, 'set_layout').handler({ layout: '5' });
    assert.equal(bad.isError, true);
    yield { type: 'assistant', parent_tool_use_id: null, session_id: 'sdk-1', message: { id: `m${n}b`, content: [{ type: 'tool_use', id: 't', name: 'mcp__tradeview__draw', input: {} }] } };
    yield { type: 'assistant', parent_tool_use_id: null, session_id: 'sdk-1', message: { id: `m${n}c`, content: [{ type: 'text', text: ' Done.' }] } };
    yield { type: 'result', subtype: 'success', is_error: false, result: 'Looking. Done.', session_id: 'sdk-1' };
  });
  const events = [];
  await cc.run({ ctx, session: 'chat-1', message: 'mark 101', context: { activeChartId: 'c1' }, emit: (e) => events.push(e), sdk, z, now: T });
  const opts = captured[0].options;
  assert.deepEqual(opts.tools, []);
  assert.equal(opts.permissionMode, 'dontAsk');
  assert.equal(opts.includePartialMessages, true);
  assert.equal(opts.maxTurns, 12);
  assert.equal(opts.strictMcpConfig, true);
  assert.deepEqual(opts.settingSources, []);
  assert.equal(opts.systemPrompt, SYSTEM_PROMPT);
  assert.equal(opts.resume, undefined);
  assert.ok(opts.disallowedTools.includes('Bash') && opts.disallowedTools.includes('WebFetch') && opts.disallowedTools.includes('Write'));
  assert.deepEqual(opts.allowedTools.sort(), TOOLS.map((t) => `mcp__tradeview__${t.name}`).sort());
  assert.equal(opts.mcpServers.tradeview.instance.tools.length, TOOLS.length);
  assert.deepEqual((await opts.canUseTool('Bash', {})).behavior, 'deny');
  assert.deepEqual((await opts.canUseTool('mcp__tradeview__draw', { a: 1 })).behavior, 'allow');
  assert.match(captured[0].prompt, /<chart_context>[\s\S]*mark 101$/);
  assert.deepEqual(events.filter((e) => e.type === 'text').map((e) => e.delta), ['Look', 'ing.', ' Done.']);
  assert.ok(events.some((e) => e.type === 'tool' && e.name === 'draw'));
  assert.equal(events.find((e) => e.type === 'chart_command').command.action, 'draw');
  assert.equal(broadcasts[0].type, 'chart_command');
  assert.equal(events.at(-1).type, 'done');
  assert.ok(!events.some((e) => e.type === 'error'));
  assert.deepEqual(ctx.repos.chat.rows.map((r) => r.role), ['user', 'meta', 'tool_calls', 'assistant']);
  assert.deepEqual(ctx.repos.chat.rows[3].content, [{ type: 'text', text: 'Looking. Done.' }]);

  // second message resumes the SDK session (also recoverable from the chat repo after a restart)
  cc._reset();
  await cc.run({ ctx, session: 'chat-1', message: 'again', emit: () => {}, sdk, z, now: T });
  assert.equal(captured[1].options.resume, 'sdk-1');
});

test('claude-code driver: usage limit and auth failures become clear chat errors; stale resume retried', async () => {
  const { ctx } = fakeCtx();
  const reset = Math.floor(Date.now() / 1000) + 3600;
  const resetText = new Date(reset * 1000).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
  const { sdk } = fakeSdk(async function* () {
    yield { type: 'system', subtype: 'init', session_id: 'sdk-2' };
    yield { type: 'rate_limit_event', session_id: 'sdk-2', rate_limit_info: { status: 'rejected', resetsAt: reset, rateLimitType: 'five_hour' } };
    yield { type: 'assistant', parent_tool_use_id: null, session_id: 'sdk-2', error: 'rate_limit', message: { id: 'e', content: [{ type: 'text', text: "You've hit your limit · resets 5pm" }] } };
    yield { type: 'result', subtype: 'success', is_error: true, result: "You've hit your limit · resets 5pm", session_id: 'sdk-2' };
  });
  const events = [];
  await cc.run({ ctx, session: 'u', message: 'hi', emit: (e) => events.push(e), sdk, z });
  const err = events.find((e) => e.type === 'error');
  assert.ok(err.message.startsWith(`Claude usage limit reached, resets at ${resetText}`), err.message);
  assert.equal(events.at(-1).type, 'done');
  const st = await cc.status(ctx, { loader: async () => sdk });
  assert.equal(st.ready, false);
  assert.match(st.detail, /usage limit/);

  cc._reset();
  const auth = fakeSdk(() => ({
    async *[Symbol.asyncIterator]() {
      throw new Error('Invalid API key · Please run /login');
    },
  }));
  const ev2 = [];
  await cc.run({ ctx, session: 'v', message: 'hi', emit: (e) => ev2.push(e), sdk: auth.sdk, z });
  assert.match(ev2.find((e) => e.type === 'error').message, /not logged in on the server/);

  cc._reset();
  ctx.repos.chat.append('w', 'meta', { sdkSessionId: 'gone' });
  const stale = fakeSdk(async function* ({ options }) {
    if (options.resume) {
      yield { type: 'result', subtype: 'error_during_execution', is_error: true, errors: ['No conversation found with session ID: gone'], session_id: 'gone' };
      return;
    }
    yield { type: 'system', subtype: 'init', session_id: 'fresh' };
    yield { type: 'assistant', parent_tool_use_id: null, session_id: 'fresh', message: { id: 'z', content: [{ type: 'text', text: 'hello' }] } };
    yield { type: 'result', subtype: 'success', is_error: false, result: 'hello', session_id: 'fresh' };
  });
  const ev3 = [];
  await cc.run({ ctx, session: 'w', message: 'hi', emit: (e) => ev3.push(e), sdk: stale.sdk, z });
  assert.deepEqual(stale.captured.map((c) => c.options.resume), ['gone', undefined]);
  assert.deepEqual(ev3.map((e) => e.type), ['text', 'done'], 'text emitted from whole assistant message');
});

test('driver selection and /api/agent/status', async () => {
  const { ctx } = fakeCtx();
  assert.equal(driverName(ctx), process.env.AGENT_DRIVER && ['anthropic-api', 'off'].includes(process.env.AGENT_DRIVER) ? process.env.AGENT_DRIVER : 'claude-code');
  const off = { ...ctx, config: { ...ctx.config, agentDriver: 'off' } };
  assert.deepEqual(await agentStatus(off), { driver: 'off', ready: false, detail: 'The agent is disabled (AGENT_DRIVER=off).' });
  const evs = [];
  await runChat({ ctx: off, session: 's', message: 'hi', emit: (e) => evs.push(e) });
  assert.deepEqual(evs.map((e) => e.type), ['error', 'done']);
  const apiCtx = { ...ctx, config: { ...ctx.config, agentDriver: 'anthropic-api', anthropicApiKey: 'sk-test' } };
  assert.deepEqual(await agentStatus(apiCtx), { driver: 'anthropic-api', ready: true, detail: 'Messages API with ANTHROPIC_API_KEY' });
  const ccStatus = await agentStatus({ ...ctx, config: { ...ctx.config, agentDriver: 'claude-code' } });
  assert.equal(ccStatus.driver, 'claude-code');
  assert.equal(typeof ccStatus.ready, 'boolean');
  assert.equal(typeof ccStatus.detail, 'string');
});

test('JSON schema -> zod shape for SDK tools', () => {
  const schema = TOOLS.find((t) => t.name === 'create_alert').input_schema;
  const obj = z.object(toZodShape(z, schema));
  assert.equal(obj.safeParse({ symbol: 'delta:BTCUSD', condition: { kind: 'price', op: 'above', value: 1 } }).success, true);
  assert.equal(obj.safeParse({ symbol: 'delta:BTCUSD' }).success, false);
  assert.equal(obj.safeParse({ symbol: 'delta:BTCUSD', condition: { kind: 'nope' } }).success, false);
  const draw = z.object(toZodShape(z, TOOLS.find((t) => t.name === 'draw').input_schema));
  assert.equal(draw.safeParse({ type: 'hline', points: [{ t: 1, price: 2 }] }).success, true);
  assert.equal(draw.safeParse({ type: 'hline', points: [] }).success, false);
});
