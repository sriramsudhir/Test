// Market group classification (ARCHITECTURE §1) and symbol-key helpers.
// Extend GROUP_RULES to reclassify instruments; first matching rule wins, default group is `crypto`.

export const GROUPS = Object.freeze(['crypto', 'forex', 'commodities']);
// `delta` = Delta Exchange (primary provider, §13.1); the others are Bybit v5 categories.
export const CATEGORIES = Object.freeze(['delta', 'linear', 'spot', 'inverse']);

const FIAT = [
  'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'NZD', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'TRY', 'ZAR',
  'MXN', 'BRL', 'ARS', 'CLP', 'COP', 'PEN', 'SGD', 'HKD', 'CNH', 'CNY', 'KRW', 'INR', 'IDR', 'THB', 'PHP',
  'MYR', 'VND', 'TWD', 'ILS', 'AED', 'SAR', 'KZT', 'UAH', 'NGN', 'KES', 'GHS', 'EGP', 'PKR', 'BDT', 'RUB',
];
const FIAT_RE = FIAT.join('|');

/**
 * Ordered rules. `test` receives { symbol, base, quote, category } (upper case strings).
 * @type {{ group: 'crypto'|'forex'|'commodities', name: string, test: (s: {symbol:string, base:string, quote:string, category:string}) => boolean }[]}
 */
export const GROUP_RULES = [
  // Gold / silver / platinum / palladium tokens and synthetic metal contracts.
  { group: 'commodities', name: 'gold-tokens', test: (s) => /^(XAUT|PAXG|XAU|GOLD|KAU|DGX|PMGT)/.test(s.base || s.symbol) },
  { group: 'commodities', name: 'metals', test: (s) => /^(XAG|XPT|XPD|SILVER|KAG|COPPER|XCU)/.test(s.base || s.symbol) },
  { group: 'commodities', name: 'energy', test: (s) => /OIL|^(WTI|BRENT|UKOIL|USOIL|NATGAS|NGAS|XNG|XBR|XTI)/.test(s.symbol) },
  { group: 'commodities', name: 'agri', test: (s) => /^(WHEAT|CORN|SOYBEAN|COFFEE|SUGAR|COCOA|COTTON)/.test(s.base || s.symbol) },
  // Fiat-denominated pairs: fiat base (EURUSDT, BRLUSDT), fiat-backed stablecoins of non-USD fiat (EURC, EURI),
  // and crypto-quoted-in-fiat spot pairs are NOT forex (BTCEUR stays crypto).
  { group: 'forex', name: 'fiat-base', test: (s) => new RegExp(`^(${FIAT_RE})$`).test(s.base) },
  { group: 'forex', name: 'fiat-stable', test: (s) => /^(EURC|EURI|EURT|EURS|EUROC|AEUR|GBPT|XSGD|BRZ|TRYB|JPYC|CADC|MXNT|BIDR|IDRT|BVND)$/.test(s.base) },
  { group: 'forex', name: 'fx-symbol', test: (s) => !s.base && new RegExp(`^(${FIAT_RE})(USD|USDT|USDC)$`).test(s.symbol) },
];

/**
 * Classify an instrument into a market group.
 * @param {{ symbol: string, base?: string, quote?: string, category?: string }} inst
 * @returns {'crypto'|'forex'|'commodities'}
 */
export function classify(inst) {
  const s = {
    symbol: String(inst.symbol || '').toUpperCase(),
    base: String(inst.base || inst.baseCoin || '').toUpperCase(),
    quote: String(inst.quote || inst.quoteCoin || '').toUpperCase(),
    category: String(inst.category || ''),
  };
  for (const r of GROUP_RULES) if (r.test(s)) return r.group;
  return 'crypto';
}

/** Exchange symbol (after the category prefix). */
export const SYMBOL_RE = /^[A-Z0-9][A-Z0-9_.-]{1,39}$/;

/**
 * Parse a symbol key. Bare symbols default to `linear`.
 * @param {string} key e.g. "delta:BTCUSD", "linear:BTCUSDT" or "BTCUSDT"
 * @returns {{ category: string, symbol: string, key: string }}
 */
export function parseSymbolKey(key) {
  const s = String(key || '').trim();
  if (!s) throw new Error('symbol required');
  const i = s.indexOf(':');
  let category = 'linear';
  let symbol = s;
  if (i >= 0) {
    category = s.slice(0, i).toLowerCase();
    symbol = s.slice(i + 1);
  }
  symbol = symbol.toUpperCase();
  if (!CATEGORIES.includes(category)) throw new Error(`Unknown category "${category}" in symbol ${key}`);
  // Must start with a letter/digit: symbols end up as URL path segments (Delta `/v2/trades/{symbol}`, Bybit dump
  // paths), so `..`-style values must never pass.
  if (!SYMBOL_RE.test(symbol)) throw new Error(`Invalid symbol: ${key}`);
  return { category, symbol, key: `${category}:${symbol}` };
}

export function symbolKey(category, symbol) {
  return `${category}:${symbol}`;
}

/** Normalise a key ("BTCUSDT" -> "linear:BTCUSDT"). */
export function normalizeKey(key) {
  return parseSymbolKey(key).key;
}
