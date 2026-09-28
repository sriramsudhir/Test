// Claude tool definitions (§7). The list is built once at import time and never changes during a
// session, so the tools prefix stays byte-identical across requests (prompt cache + thinking blocks).
import { listLibrary } from '../pine/library.js';
import { listStrategies } from '../backtest/strategies.js';
import { PRICE_OPS, TRIGGERS } from '../alerts/conditions.js';

export const TIMEFRAME_IDS = ['1s', '5s', '15s', '30s', '1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '1D', '1W', '1M'];
export const LAYOUT_IDS = ['1', '2h', '2v', '3', '4', '6', '8'];
export const CHART_TYPES = ['candles', 'bars', 'line', 'area', 'heikin', 'footprint', 'renko', 'range'];
export const DRAW_TYPES = ['hline', 'trendline', 'ray', 'rectangle', 'fib', 'long_position', 'short_position', 'text', 'arrow'];
export const CHART_TOOLS = ['set_symbol', 'set_timeframe', 'set_layout', 'add_indicator', 'remove_indicator', 'draw', 'clear_drawings', 'set_chart_type', 'start_replay'];
export const DATA_TOOLS = ['get_candles', 'get_symbols', 'run_pine', 'run_backtest', 'laya_decide', 'list_alerts'];
export const ALERT_TOOLS = ['create_alert', 'delete_alert'];

const LIBRARY_IDS = listLibrary().map((e) => e.id);
const INDICATOR_IDS = listLibrary().filter((e) => e.type === 'indicator').map((e) => e.id);
const STRATEGY_IDS = [...listStrategies().map((s) => s.id), ...listLibrary().filter((e) => e.type === 'strategy').map((e) => e.id)];

const SYMBOL = {
  type: 'string',
  description: 'Symbol key "{category}:{SYMBOL}", category is spot | linear | inverse. Example: "linear:BTCUSDT" (USDT perpetual), "spot:ETHUSDT".',
};
const TF = { type: 'string', enum: TIMEFRAME_IDS, description: 'Timeframe id. Minutes: 1m..30m, hours: 1h..12h, 1D day, 1W week, 1M month; 1s..30s are live-only second charts.' };
const TIME_MS = (what) => ({ type: 'integer', description: `${what} as a unix timestamp in MILLISECONDS UTC (e.g. 1735689600000 = 2025-01-01T00:00:00Z).` });
const CHART_ID = { type: 'string', description: 'Target chart id from the chart context. Omit to act on the active chart.' };
const POINT = {
  type: 'object',
  properties: {
    t: TIME_MS('Point time (bar open time)'),
    price: { type: 'number', description: 'Point price.' },
  },
  required: ['t', 'price'],
};

/** @type {import('@anthropic-ai/sdk').default.Tool[]} */
const DEFS = [
  // ---------------------------------------------------------------- data
  {
    name: 'get_candles',
    description:
      'Fetch OHLCV candles (ascending) for a symbol/timeframe from the local database (gaps are filled from Bybit). ' +
      'ALWAYS call this before drawing, choosing alert levels or quoting prices so you work from real data. ' +
      'Returns compact rows [t, o, h, l, c, v] (t = bar open time, unix ms UTC) plus a summary (last price, range high/low, change).',
    input_schema: {
      type: 'object',
      properties: {
        symbol: SYMBOL,
        tf: TF,
        limit: { type: 'integer', minimum: 1, maximum: 500, description: 'Number of most recent bars (default 100, max 500).' },
        from: TIME_MS('Optional range start'),
        to: TIME_MS('Optional range end'),
      },
      required: ['symbol', 'tf'],
    },
  },
  {
    name: 'get_symbols',
    description: 'Search tradable symbols. Use to resolve a user\'s wording ("gold", "ETH perp", "EURUSD") into a symbol key. Groups: crypto, forex, commodities.',
    input_schema: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Case-insensitive search text, e.g. "BTC", "XAU".' },
        group: { type: 'string', enum: ['crypto', 'forex', 'commodities'] },
        limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Max results (default 20).' },
      },
    },
  },
  {
    name: 'run_pine',
    description:
      'Run a Pine Script v5/v6 indicator (custom `source` or a built-in library id) on a symbol server-side and return the latest values of every plot ' +
      '(last 5 bars), the script title/overlay, and recent alert()/alertcondition() events. Use it to read indicator values (RSI, MACD, bands, ...) ' +
      'before making claims about them. This does NOT show anything on the chart; use add_indicator for that.',
    input_schema: {
      type: 'object',
      properties: {
        symbol: SYMBOL,
        tf: TF,
        builtin: { type: 'string', enum: LIBRARY_IDS, description: 'Built-in library script id (alternative to source).' },
        source: { type: 'string', description: 'Pine Script source (must contain indicator(...) or strategy(...)).' },
        inputs: { type: 'object', description: 'Input overrides keyed by input title, e.g. {"Length": 50}.' },
        limit: { type: 'integer', minimum: 50, maximum: 5000, description: 'Bars of history to run on (default 1000).' },
      },
      required: ['symbol', 'tf'],
    },
  },
  {
    name: 'run_backtest',
    description:
      'Backtest a strategy on historical candles. Either a builtin strategy id (with params) or Pine `source` using strategy() calls ' +
      '(or plots named long_entry/long_exit/short_entry/short_exit). Market orders fill at the next bar open. ' +
      'Returns metrics (net profit, win rate, profit factor, max drawdown, Sharpe, Sortino, trades, exposure...) and the last trades. ' +
      `Builtin/library strategy ids: ${STRATEGY_IDS.join(', ')}.`,
    input_schema: {
      type: 'object',
      properties: {
        symbol: SYMBOL,
        tf: TF,
        from: TIME_MS('Backtest start'),
        to: TIME_MS('Backtest end (default now)'),
        strategy: {
          type: 'object',
          properties: {
            id: { type: 'string', enum: STRATEGY_IDS },
            params: { type: 'object', description: 'Strategy parameters, e.g. {"fast": 9, "slow": 21}.' },
          },
          required: ['id'],
        },
        source: { type: 'string', description: 'Pine strategy source (alternative to strategy).' },
        capital: { type: 'number', description: 'Initial capital (default 10000).' },
        commission: { type: 'number', description: 'Commission percent per side (default 0.05).' },
        slippage: { type: 'number', description: 'Slippage in ticks per fill (default 0).' },
        stopLoss: { type: 'number', description: 'Stop loss in percent from entry (builtin strategies only).' },
        takeProfit: { type: 'number', description: 'Take profit in percent from entry (builtin strategies only).' },
        sizing: {
          type: 'object',
          properties: { type: { type: 'string', enum: ['percent', 'fixed'] }, value: { type: 'number' } },
          required: ['type', 'value'],
          description: 'Position size: percent of equity or fixed quantity (default 100% of equity).',
        },
      },
      required: ['symbol', 'tf'],
    },
  },
  {
    name: 'laya_decide',
    description:
      'Ask Laya (the in-house decision model that gates alerts) a yes/no question about the current market state of a symbol. ' +
      'Returns P(yes) as `p`, whether it passes the threshold, the likely direction (bullish/bearish/neutral) and a confidence score. ' +
      'Returns skipped:true if Laya is unavailable.',
    input_schema: {
      type: 'object',
      properties: {
        symbol: SYMBOL,
        tf: TF,
        question: { type: 'string', description: 'Yes/no question, e.g. "Is this breakout above 65000 likely to continue?"' },
        threshold: { type: 'number', minimum: 0, maximum: 1, description: 'Pass threshold for P(yes) (default 0.6).' },
      },
      required: ['symbol', 'tf', 'question'],
    },
  },
  {
    name: 'list_alerts',
    description: 'List existing alerts (id, name, symbol, condition, trigger, status, Laya gate settings).',
    input_schema: {
      type: 'object',
      properties: {
        symbol: SYMBOL,
        status: { type: 'string', enum: ['active', 'triggered', 'paused', 'expired'] },
      },
    },
  },
  // ---------------------------------------------------------------- chart
  {
    name: 'set_symbol',
    description: 'Switch a chart to another symbol.',
    input_schema: { type: 'object', properties: { chartId: CHART_ID, symbol: SYMBOL }, required: ['symbol'] },
  },
  {
    name: 'set_timeframe',
    description: 'Change a chart\'s timeframe.',
    input_schema: { type: 'object', properties: { chartId: CHART_ID, tf: TF }, required: ['tf'] },
  },
  {
    name: 'set_layout',
    description: 'Change the multi-chart layout: 1 (single), 2h (two side by side), 2v (two stacked), 3, 4, 6 or 8 charts.',
    input_schema: { type: 'object', properties: { layout: { type: 'string', enum: LAYOUT_IDS } }, required: ['layout'] },
  },
  {
    name: 'add_indicator',
    description:
      'Add an indicator to a chart: a built-in library id or custom Pine Script source (rendered as overlay or separate pane per indicator(overlay=...)). ' +
      `Built-in ids: ${INDICATOR_IDS.join(', ')}.`,
    input_schema: {
      type: 'object',
      properties: {
        chartId: CHART_ID,
        builtin: { type: 'string', enum: LIBRARY_IDS },
        source: { type: 'string', description: 'Custom Pine Script source.' },
        inputs: { type: 'object', description: 'Input overrides keyed by input title, e.g. {"Length": 50}.' },
      },
    },
  },
  {
    name: 'remove_indicator',
    description: 'Remove an indicator from a chart by its id (see `indicators` in the chart context).',
    input_schema: { type: 'object', properties: { chartId: CHART_ID, id: { type: 'string' } }, required: ['id'] },
  },
  {
    name: 'draw',
    description:
      'Draw on a chart. Points are {t, price} with t in unix MILLISECONDS (use real bar times from get_candles). ' +
      'hline: 1 point (only price matters). trendline/ray/arrow: 2 points. rectangle: 2 opposite corners. fib: 2 points (swing start, swing end). ' +
      'long_position/short_position: 3 points [entry, stop loss, take profit] sharing the same t. text: 1 point + text.',
    input_schema: {
      type: 'object',
      properties: {
        chartId: CHART_ID,
        type: { type: 'string', enum: DRAW_TYPES },
        points: { type: 'array', items: POINT, minItems: 1, maxItems: 3 },
        text: { type: 'string', description: 'Label text (for text, or as a caption for other shapes).' },
        color: { type: 'string', description: 'CSS color, e.g. "#26a69a".' },
      },
      required: ['type', 'points'],
    },
  },
  {
    name: 'clear_drawings',
    description: 'Remove all drawings from a chart.',
    input_schema: { type: 'object', properties: { chartId: CHART_ID } },
  },
  {
    name: 'set_chart_type',
    description: 'Change the chart type. footprint shows bid/ask volume per price level (1m..1h).',
    input_schema: { type: 'object', properties: { chartId: CHART_ID, type: { type: 'string', enum: CHART_TYPES } }, required: ['type'] },
  },
  {
    name: 'start_replay',
    description: 'Start bar replay on a chart from a past time (unix ms). The chart hides later bars and plays them forward.',
    input_schema: {
      type: 'object',
      properties: {
        chartId: CHART_ID,
        from: TIME_MS('Replay start'),
        speed: { type: 'number', minimum: 0.5, maximum: 100, description: 'Playback speed multiplier (default 1).' },
      },
      required: ['from'],
    },
  },
  // ---------------------------------------------------------------- alerts
  {
    name: 'create_alert',
    description:
      'Create a real server-side alert that rings a loud alarm in the browser when it fires (even if the chart is closed). ' +
      'Before creating a price alert, call get_candles to confirm the exact level relative to the current price, and state the exact level to the user. ' +
      'By default the Laya decision gate is ON for alerts you create: when the condition hits, Laya is asked `laya.question` and the alert only fires if P(yes) >= threshold. ' +
      'Conditions: price (op + value, value2 for channels), indicator (Pine source whose alertcondition() or plot named "signal" > 0 fires on a closed bar), drawing (drawingId + op).',
    input_schema: {
      type: 'object',
      properties: {
        symbol: SYMBOL,
        tf: { ...TF, description: 'Timeframe used for bar-based triggers and indicator conditions (default 1m).' },
        name: { type: 'string', description: 'Short alert name.' },
        message: { type: 'string', description: 'Message shown when it fires. Placeholders: {{price}}, {{symbol}}, {{time}}.' },
        condition: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: ['price', 'indicator', 'drawing'] },
            op: { type: 'string', enum: PRICE_OPS },
            value: { type: 'number', description: 'Price level (price conditions).' },
            value2: { type: 'number', description: 'Second price for enters_channel / exits_channel.' },
            source: { type: 'string', description: 'Pine source (indicator conditions).' },
            drawingId: { type: 'string', description: 'Drawing id (drawing conditions).' },
          },
          required: ['kind'],
        },
        trigger: { type: 'string', enum: TRIGGERS, description: 'once (default), once_per_bar, once_per_bar_close, every_time.' },
        expires: TIME_MS('Optional expiry'),
        laya: {
          type: 'object',
          properties: {
            enabled: { type: 'boolean', description: 'Default true for agent-created alerts.' },
            question: { type: 'string', description: 'Yes/no question Laya answers when the condition hits, e.g. "Is this breakout likely to continue rather than fail?"' },
            threshold: { type: 'number', minimum: 0, maximum: 1, description: 'Fire only if P(yes) >= threshold (default 0.6).' },
          },
        },
        sound: {
          type: 'object',
          properties: {
            preset: { type: 'string', enum: ['siren', 'bell', 'klaxon', 'beep'] },
            volume: { type: 'number', minimum: 0, maximum: 1 },
            repeat: { type: 'integer', minimum: 1, maximum: 100 },
            loop: { type: 'boolean', description: 'Loop until acknowledged.' },
          },
        },
      },
      required: ['symbol', 'condition'],
    },
  },
  {
    name: 'delete_alert',
    description: 'Delete an alert by id (use list_alerts to find ids).',
    input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
];

/** Tool definitions sent to the Messages API (eager input streaming on: inputs are validated before execution). */
export const TOOLS = DEFS.map((t) => ({ ...t, eager_input_streaming: true }));

export const TOOL_SCHEMAS = Object.fromEntries(DEFS.map((t) => [t.name, t.input_schema]));
