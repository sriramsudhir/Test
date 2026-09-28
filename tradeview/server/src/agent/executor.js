// Tool executor for the Claude agent (§7).
// - data tools run server-side and return compact JSON for Claude
// - chart tools become ChartCommand objects {action, chartId?, ...input}: emitted into the chat stream
//   and broadcast as {type:'chart_command', command}
// - create_alert creates a real alert (createdBy 'agent', Laya gate on, loud looping sound by default)
import crypto from 'node:crypto';
import { TOOL_SCHEMAS, CHART_TOOLS } from './tools.js';
import { validateInput } from './validate.js';
import { runPine } from '../pine/runner.js';
import { getLibraryEntry } from '../pine/library.js';
import { backtest } from '../backtest/index.js';
import { lookupTickSize } from '../backtest/routes.js';
import { askLaya } from '../laya/gate.js';
import { createAlert, deleteAlert, listAlerts } from '../alerts/service.js';
import { tfToMs } from '../pine/util.js';

const MAX_RESULT_CHARS = 24000;
const r6 = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 1e6) / 1e6 : v);

export class ToolError extends Error {}

/** Build the ChartCommand for a chart tool call. */
export function toChartCommand(name, input = {}) {
  const { chartId, ...rest } = input || {};
  return { action: name, ...(chartId ? { chartId } : {}), ...rest, commandId: crypto.randomUUID() };
}

/**
 * @param {object} ctx     server ctx (§11)
 * @param {object} [opts]
 * @param {(ev:object)=>void} [opts.emit]   stream events to the chat client
 * @param {object} [opts.context]           chart context from the browser
 * @param {object} [opts.deps]              test seams: { runPine, backtest, askLaya, createAlert, deleteAlert, listAlerts }
 */
export function createExecutor(ctx, { emit = () => {}, context, deps = {} } = {}) {
  const d = {
    runPine: deps.runPine || runPine,
    backtest: deps.backtest || backtest,
    askLaya: deps.askLaya || askLaya,
    createAlert: deps.createAlert || createAlert,
    deleteAlert: deps.deleteAlert || deleteAlert,
    listAlerts: deps.listAlerts || listAlerts,
  };

  async function candles(symbol, tf, { limit, from, to } = {}) {
    if (!ctx.market?.getCandles) throw new ToolError('market data unavailable');
    const q = { symbol, tf, limit };
    if (from !== undefined) q.from = from;
    if (to !== undefined) q.to = to;
    const cs = await ctx.market.getCandles(q);
    return Array.isArray(cs) ? cs : cs?.candles || [];
  }

  async function lastPrice(symbol) {
    const lp = ctx.live?.lastPrice?.(symbol);
    if (Number.isFinite(lp)) return lp;
    const chart = (context?.charts || []).find((c) => c.symbol === symbol && Number.isFinite(c.lastPrice));
    if (chart) return chart.lastPrice;
    try {
      const cs = await candles(symbol, '1m', { limit: 1 });
      return cs[cs.length - 1]?.c;
    } catch {
      return undefined;
    }
  }

  const handlers = {
    async get_candles({ symbol, tf, limit = 100, from, to }) {
      const cs = await candles(symbol, tf, { limit: Math.min(limit, 500), from, to });
      if (!cs.length) return { symbol, tf, count: 0, rows: [], note: 'no data for this range' };
      const hi = Math.max(...cs.map((k) => k.h));
      const lo = Math.min(...cs.map((k) => k.l));
      const first = cs[0];
      const last = cs[cs.length - 1];
      return {
        symbol, tf, count: cs.length,
        summary: {
          from: first.t, to: last.t, lastClose: last.c, high: hi, low: lo,
          changePct: r6(((last.c - first.o) / first.o) * 100),
          livePrice: ctx.live?.lastPrice?.(symbol) ?? null,
        },
        columns: ['t', 'o', 'h', 'l', 'c', 'v'],
        rows: cs.map((k) => [k.t, k.o, k.h, k.l, k.c, r6(k.v)]),
      };
    },

    async get_symbols({ q, group, limit = 20 }) {
      if (!ctx.market?.listSymbols) throw new ToolError('symbol list unavailable');
      const list = (await ctx.market.listSymbols({ q, group })) || [];
      return { count: list.length, symbols: list.slice(0, limit).map((s) => ({ key: s.key, group: s.group, base: s.base, quote: s.quote, tickSize: s.tickSize })) };
    },

    async run_pine({ symbol, tf, builtin, source, inputs, limit = 1000 }) {
      const src = source || (builtin && getLibraryEntry(builtin)?.source);
      if (!src) throw new ToolError('provide `source` or a valid `builtin` id');
      const cs = await candles(symbol, tf, { limit: Math.min(limit, 5000) });
      const res = await d.runPine({ candles: cs, source: src, inputs, tfMs: tfToMs(tf) });
      const plots = {};
      for (const [name, p] of Object.entries(res.plots)) {
        if (['hline', 'fill', 'background'].includes(p.options?.style)) continue;
        plots[name] = p.data.slice(-5).map((x) => [x.t, typeof x.value === 'number' ? r6(x.value) : x.value]);
      }
      return {
        title: res.meta?.title, overlay: res.meta?.overlay, type: res.meta?.type, bars: cs.length,
        lastBar: cs[cs.length - 1]?.t, plots,
        recentAlerts: (res.alerts || []).slice(-5),
        ...(res.strategy ? { strategy: { netProfit: res.strategy.netProfit, trades: res.strategy.closedTrades.length, positionSize: res.strategy.positionSize } } : {}),
      };
    },

    async run_backtest(input) {
      const { symbol, tf, from, to } = input;
      const cs = await candles(symbol, tf, { limit: 5000, from, to });
      const tickSize = await lookupTickSize(ctx, symbol);
      const res = await d.backtest({ ...input, candles: cs, tickSize, tfMs: tfToMs(tf) });
      return {
        mode: res.meta?.mode, title: res.meta?.title, bars: cs.length,
        range: cs.length ? { from: cs[0].t, to: cs[cs.length - 1].t } : null,
        metrics: res.metrics,
        lastTrades: res.trades.slice(-10).map((t) => ({
          side: t.side, entryTime: t.entryTime, entryPrice: r6(t.entryPrice), exitTime: t.exitTime,
          exitPrice: r6(t.exitPrice), pnl: r6(t.pnl), pnlPct: r6(t.pnlPct), exitReason: t.exitReason,
        })),
      };
    },

    async laya_decide({ symbol, tf, question, threshold }) {
      const out = await d.askLaya(ctx, { symbol, tf, question, threshold: threshold ?? ctx.config?.layaThreshold ?? 0.6 });
      const { state, ...rest } = out || {};
      return rest.skipped ? { skipped: true, reason: rest.reason, status: ctx.laya?.status?.() } : rest;
    },

    async list_alerts({ symbol, status }) {
      const list = d.listAlerts(ctx, { symbol, status });
      return {
        count: list.length,
        alerts: list.map((a) => ({
          id: a.id, name: a.name, symbol: a.symbol, tf: a.tf, status: a.status, trigger: a.trigger,
          condition: a.condition.kind === 'indicator' ? { kind: 'indicator' } : a.condition,
          laya: a.laya, createdBy: a.createdBy, expires: a.expires,
        })),
      };
    },

    async create_alert(input) {
      const c = input.condition || {};
      if (c.kind === 'price' && Number.isFinite(c.value)) {
        const px = await lastPrice(input.symbol);
        if (Number.isFinite(px) && px > 0) {
          const far = [c.value, c.value2].filter(Number.isFinite).some((v) => Math.abs(v - px) / px > 0.5);
          if (far) throw new ToolError(`level ${c.value}${c.value2 ? `/${c.value2}` : ''} is more than 50% away from the current price ${px}; re-check the level with get_candles`);
        }
      }
      const alert = d.createAlert(ctx, {
        ...input,
        laya: { enabled: true, ...(input.laya || {}) },
        sound: { preset: 'klaxon', volume: 1, repeat: 5, loop: true, ...(input.sound || {}) },
      }, { createdBy: 'agent' });
      emit({ type: 'alert_created', alert });
      return { created: true, id: alert.id, name: alert.name, condition: alert.condition, trigger: alert.trigger, laya: alert.laya, sound: alert.sound };
    },

    async delete_alert({ id }) {
      const ok = d.deleteAlert(ctx, id);
      if (!ok) throw new ToolError(`alert ${id} not found`);
      return { deleted: true, id };
    },
  };

  /**
   * Execute one tool call.
   * @returns {Promise<{content:string, isError:boolean, command?:object}>}
   */
  async function execute(name, input) {
    const schema = TOOL_SCHEMAS[name];
    if (!schema) return { content: `Unknown tool '${name}'`, isError: true };
    const problems = validateInput(schema, input ?? {});
    if (problems.length) return { content: `Invalid input: ${problems.join('; ')}`, isError: true };

    if (CHART_TOOLS.includes(name)) {
      const extra = chartToolCheck(name, input);
      if (extra) return { content: extra, isError: true };
      const command = toChartCommand(name, input);
      emit({ type: 'chart_command', command });
      try {
        ctx.broadcast?.({ type: 'chart_command', command });
      } catch {
        /* ignore */
      }
      return { content: JSON.stringify({ ok: true, sent: command.action, chartId: command.chartId ?? 'active' }), isError: false, command };
    }

    try {
      const out = await handlers[name](input ?? {});
      let text = JSON.stringify(out);
      if (text.length > MAX_RESULT_CHARS) text = `${text.slice(0, MAX_RESULT_CHARS)}...[truncated; request fewer bars]`;
      return { content: text, isError: false };
    } catch (err) {
      return { content: `Error: ${err?.message || String(err)}${err?.line ? ` (line ${err.line})` : ''}`, isError: true };
    }
  }

  return { execute, handlers };
}

function chartToolCheck(name, input) {
  if (name === 'add_indicator' && !input.builtin && !input.source) return 'Invalid input: provide `builtin` or `source`';
  if (name === 'draw') {
    const need = { hline: 1, text: 1, trendline: 2, ray: 2, arrow: 2, rectangle: 2, fib: 2, long_position: 3, short_position: 3 }[input.type];
    if (need && input.points.length < need) return `Invalid input: ${input.type} needs ${need} point(s)`;
    for (const p of input.points) if (p.t < 1e11) return 'Invalid input: point times must be unix MILLISECONDS (13 digits)';
  }
  if (name === 'start_replay' && input.from < 1e11) return 'Invalid input: `from` must be unix MILLISECONDS';
  return null;
}
