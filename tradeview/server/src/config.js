// Central configuration. Reads tradeview/.env (repo root) via dotenv, then exposes a frozen config object.
// Secrets (API keys, passwords, tokens) are NON-ENUMERABLE properties so that logging or JSON-serialising the
// config never leaks them; read them by name (config.sessionSecret, config.ANTHROPIC_API_KEY, ...).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
/** Absolute path of the tradeview/ workspace root. */
export const ROOT_DIR = path.resolve(here, '..', '..');
/** Absolute path of the server/ package. */
export const SERVER_DIR = path.resolve(here, '..');

// CLAUDE_CODE_OAUTH_TOKEN / ANTHROPIC_API_KEY stay in process.env so the Claude Agent SDK picks them up.
dotenv.config({ path: path.join(ROOT_DIR, '.env'), quiet: true });

const env = process.env;

function int(name, def) {
  const v = env[name];
  if (v === undefined || v === '') return def;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}
function num(name, def) {
  const v = env[name];
  if (v === undefined || v === '') return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}
function str(name, def) {
  const v = env[name];
  return v === undefined || v === '' ? def : v;
}
function list(name, def) {
  const v = env[name];
  if (v === undefined || v.trim() === '') return def;
  return v.split(',').map((s) => s.trim()).filter(Boolean);
}
function parseTrustProxy(v) {
  if (v === undefined || v === '' || v === 'false' || v === '0') return false;
  if (v === 'true') return true;
  if (/^\d+$/.test(v)) return Number(v);
  return v; // address / CIDR list, passed through to Fastify
}

const dbPath = str('DB_PATH', './data/tradeview.db');
const DELTA_REGION = str('DELTA_REGION', 'india').toLowerCase() === 'global' ? 'global' : 'india';
const DEFAULT_DELTA_SYMBOLS = ['delta:BTCUSD', 'delta:ETHUSD', 'delta:SOLUSD', 'delta:XRPUSD', 'delta:BNBUSD', 'delta:DOGEUSD'];
const defaultSymbols = list('DEFAULT_SYMBOLS', DEFAULT_DELTA_SYMBOLS);

const config = {
  env: str('NODE_ENV', 'development'),
  isProd: str('NODE_ENV', 'development') === 'production',
  host: str('HOST', '0.0.0.0'),
  port: int('PORT', 3000),
  logLevel: str('LOG_LEVEL', 'info'),
  rootDir: ROOT_DIR,
  /** Next.js app directory (served in-process, ARCHITECTURE §14). */
  webDir: path.join(ROOT_DIR, 'web'),
  /** WEB=off (or --no-web) boots the API alone. */
  webEnabled: !['off', '0', 'false'].includes(str('WEB', 'on').toLowerCase()) && !process.argv.includes('--no-web'),
  // ':memory:' is kept as is; relative paths are resolved against the tradeview/ root.
  dbPath: dbPath === ':memory:' ? dbPath : path.resolve(ROOT_DIR, dbPath),

  // Delta Exchange: PRIMARY market-data provider (ARCHITECTURE §13.1). Public data needs no API key.
  deltaRegion: DELTA_REGION,
  deltaRest: str('DELTA_REST', DELTA_REGION === 'global' ? 'https://api.delta.exchange' : 'https://api.india.delta.exchange').replace(/\/+$/, ''),
  deltaWs: str('DELTA_WS', DELTA_REGION === 'global' ? 'wss://socket.delta.exchange' : 'wss://socket.india.delta.exchange').replace(/\/+$/, ''),
  /** Delta REST requests per second (token bucket). */
  deltaRateLimit: num('DELTA_RATE_LIMIT', 8),

  // Bybit: second provider.
  bybitRest: str('BYBIT_REST', 'https://api.bybit.com').replace(/\/+$/, ''),
  bybitWs: str('BYBIT_WS', 'wss://stream.bybit.com/v5/public').replace(/\/+$/, ''),
  bybitDumps: str('BYBIT_DUMPS', 'https://public.bybit.com').replace(/\/+$/, ''),
  /** Bybit REST requests per second (token bucket). */
  rateLimit: num('RATE_LIMIT', 10),

  /**
   * Default symbol set. Entries are symbol keys ("delta:BTCUSD", "linear:BTCUSDT") or selectors:
   * "delta:top:N" (top N Delta perpetuals by turnover), "top:N" (top N Bybit linear USDT perps),
   * "group:commodities", "group:forex" (Bybit groups).
   */
  defaultSymbols,
  /** Symbols whose live trades are recorded 24/7 into footprint + the raw trades table. */
  recordSymbols: list('RECORD_SYMBOLS', defaultSymbols),
  /** Raw recorded trades older than this are pruned. */
  tradesRetentionDays: int('TRADES_RETENTION_DAYS', 30),
  /**
   * Recorded footprint bars on the fine timeframes (1m, 3m, 5m) older than this are pruned (0 = keep forever).
   * 15m..1h footprint is always kept. A year of 1m footprint is roughly 1 GB per actively traded symbol.
   */
  footprintRetentionDays: int('FOOTPRINT_RETENTION_DAYS', 90),
  /** Fired-alert history keeps the newest N events. */
  alertEventsMax: int('ALERT_EVENTS_MAX', 10000),
  /** Max time the Laya gate may take before an alert fires anyway (marked laya.skipped). */
  layaGateTimeoutMs: int('LAYA_GATE_TIMEOUT_MS', 30000),
  backfillDays: int('BACKFILL_DAYS', 365),
  /** 'auto' or a positive integer multiplier applied to tickSize for footprint buckets. */
  footprintTickMult: str('FOOTPRINT_TICK_MULT', 'auto'),
  /** Gap-fill on startup (set GAPFILL_ON_START=0 to disable). */
  gapfillOnStart: str('GAPFILL_ON_START', '1') !== '0',

  claudeModel: str('CLAUDE_MODEL', 'claude-opus-5-5'),
  /** claude-code (Claude Pro/Max login via @anthropic-ai/claude-agent-sdk) | anthropic-api | off */
  agentDriver: str('AGENT_DRIVER', 'claude-code'),

  layaMode: str('LAYA_MODE', 'local'),
  layaUrl: str('LAYA_URL', 'http://127.0.0.1:8000').replace(/\/+$/, ''),
  layaThreshold: num('LAYA_THRESHOLD', 0.6),

  /** Fastify trustProxy. Set TRUST_PROXY=true (or hop count / CIDR list) behind a reverse proxy such as Caddy. */
  trustProxy: parseTrustProxy(env.TRUST_PROXY),
  /** Web Push contact (mailto: or https: URL) used in VAPID JWTs. */
  vapidSubject: str('VAPID_SUBJECT', undefined),
  /** Site auth is enabled when AUTH_PASSWORD or AUTH_PASSWORD_HASH is set. */
  authEnabled: !!(env.AUTH_PASSWORD || env.AUTH_PASSWORD_HASH),
  sessionDays: int('SESSION_DAYS', 30),
};

// Secrets: non-enumerable (camelCase + UPPER_CASE names).
const SECRETS = [
  ['anthropicApiKey', 'ANTHROPIC_API_KEY'],
  ['claudeCodeOauthToken', 'CLAUDE_CODE_OAUTH_TOKEN'],
  ['deltaApiKey', 'DELTA_API_KEY'],
  ['deltaApiSecret', 'DELTA_API_SECRET'],
  ['authPassword', 'AUTH_PASSWORD'],
  ['authPasswordHash', 'AUTH_PASSWORD_HASH'],
  ['sessionSecret', 'SESSION_SECRET'],
  ['telegramBotToken', 'TELEGRAM_BOT_TOKEN'],
  ['telegramChatId', 'TELEGRAM_CHAT_ID'],
];
const secret = (obj, name, value) => Object.defineProperty(obj, name, { value, enumerable: false });
for (const [camel, upper] of SECRETS) {
  const v = str(upper, '');
  secret(config, camel, v);
  secret(config, upper, v);
}

// Grouped views and UPPER_CASE aliases so other modules can use whichever style they prefer.
config.claude = { model: config.claudeModel, driver: config.agentDriver };
secret(config.claude, 'apiKey', config.anthropicApiKey);
secret(config.claude, 'oauthToken', config.claudeCodeOauthToken);
config.laya = { mode: config.layaMode, url: config.layaUrl, threshold: config.layaThreshold };
config.delta = { region: config.deltaRegion, rest: config.deltaRest, ws: config.deltaWs };
config.telegram = { enabled: !!(config.telegramBotToken && config.telegramChatId) };
secret(config.telegram, 'botToken', config.telegramBotToken);
secret(config.telegram, 'chatId', config.telegramChatId);
Object.assign(config, {
  PORT: config.port,
  DB_PATH: config.dbPath,
  DELTA_REGION: config.deltaRegion,
  DELTA_REST: config.deltaRest,
  DELTA_WS: config.deltaWs,
  BYBIT_REST: config.bybitRest,
  BYBIT_WS: config.bybitWs,
  RATE_LIMIT: config.rateLimit,
  DEFAULT_SYMBOLS: config.defaultSymbols,
  RECORD_SYMBOLS: config.recordSymbols,
  TRADES_RETENTION_DAYS: config.tradesRetentionDays,
  FOOTPRINT_RETENTION_DAYS: config.footprintRetentionDays,
  ALERT_EVENTS_MAX: config.alertEventsMax,
  BACKFILL_DAYS: config.backfillDays,
  FOOTPRINT_TICK_MULT: config.footprintTickMult,
  CLAUDE_MODEL: config.claudeModel,
  AGENT_DRIVER: config.agentDriver,
  LAYA_MODE: config.layaMode,
  LAYA_URL: config.layaUrl,
  LAYA_THRESHOLD: config.layaThreshold,
});

export default Object.freeze(config);
