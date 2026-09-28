/**
 * Builtin indicator catalog (ids match server/src/pine/library/*.pine).
 * The authoritative list comes from GET /api/pine/library; this is used for defaults, labels and
 * as an offline fallback.
 */
export const BUILTIN_INDICATORS = [
  { id: 'sma', name: 'Moving Average (SMA)', overlay: true, inputs: { length: 20 } },
  { id: 'ema', name: 'Moving Average Exponential (EMA)', overlay: true, inputs: { length: 20 } },
  { id: 'bb', name: 'Bollinger Bands', overlay: true, inputs: { length: 20, mult: 2 } },
  { id: 'vwap', name: 'VWAP', overlay: true, inputs: {} },
  { id: 'supertrend', name: 'Supertrend', overlay: true, inputs: { length: 10, factor: 3 } },
  { id: 'ichimoku', name: 'Ichimoku Cloud', overlay: true, inputs: {} },
  { id: 'rsi', name: 'Relative Strength Index (RSI)', overlay: false, inputs: { length: 14 } },
  { id: 'macd', name: 'MACD', overlay: false, inputs: { fast: 12, slow: 26, signal: 9 } },
  { id: 'stoch', name: 'Stochastic', overlay: false, inputs: { k: 14, d: 3, smooth: 3 } },
  { id: 'atr', name: 'Average True Range (ATR)', overlay: false, inputs: { length: 14 } },
];

const ALIASES = {
  'moving average': 'sma', ma: 'sma', 'simple moving average': 'sma', 'exponential moving average': 'ema',
  bollinger: 'bb', 'bollinger bands': 'bb', bbands: 'bb', 'relative strength index': 'rsi', stochastic: 'stoch',
  'average true range': 'atr',
};

export function normalizeBuiltinId(id) {
  if (!id) return null;
  const s = String(id).trim().toLowerCase();
  return ALIASES[s] || s.replace(/\.pine$/, '');
}

export function builtinInfo(id) {
  const n = normalizeBuiltinId(id);
  return BUILTIN_INDICATORS.find((b) => b.id === n) || null;
}
