// Central configuration. Reads tradeview/.env (repo root) via dotenv, then exposes a frozen config object.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
/** Absolute path of the tradeview/ workspace root. */
export const ROOT_DIR = path.resolve(here, '..', '..');
/** Absolute path of the server/ package. */
export const SERVER_DIR = path.resolve(here, '..');

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

const dbPath = str('DB_PATH', './data/tradeview.db');

const config = {
  env: str('NODE_ENV', 'development'),
  isProd: str('NODE_ENV', 'development') === 'production',
  host: str('HOST', '0.0.0.0'),
  port: int('PORT', 8787),
  logLevel: str('LOG_LEVEL', 'info'),
  rootDir: ROOT_DIR,
  webDist: path.join(ROOT_DIR, 'web', 'dist'),
  // ':memory:' is kept as is; relative paths are resolved against the tradeview/ root.
  dbPath: dbPath === ':memory:' ? dbPath : path.resolve(ROOT_DIR, dbPath),

  bybitRest: str('BYBIT_REST', 'https://api.bybit.com').replace(/\/+$/, ''),
  bybitWs: str('BYBIT_WS', 'wss://stream.bybit.com/v5/public').replace(/\/+$/, ''),
  bybitDumps: str('BYBIT_DUMPS', 'https://public.bybit.com').replace(/\/+$/, ''),
  /** REST requests per second (token bucket). */
  rateLimit: num('RATE_LIMIT', 10),
  /**
   * Default symbol set. Entries are symbol keys ("linear:BTCUSDT") or dynamic selectors:
   * "top:N" (top N linear USDT perps by 24h turnover), "group:commodities", "group:forex".
   */
  defaultSymbols: list('DEFAULT_SYMBOLS', ['top:20', 'group:commodities', 'group:forex']),
  backfillDays: int('BACKFILL_DAYS', 365),
  /** 'auto' or a positive integer multiplier applied to tickSize for footprint buckets. */
  footprintTickMult: str('FOOTPRINT_TICK_MULT', 'auto'),
  /** Gap-fill on startup (set GAPFILL_ON_START=0 to disable). */
  gapfillOnStart: str('GAPFILL_ON_START', '1') !== '0',

  anthropicApiKey: str('ANTHROPIC_API_KEY', ''),
  claudeModel: str('CLAUDE_MODEL', 'claude-opus-5-5'),

  layaMode: str('LAYA_MODE', 'local'),
  layaUrl: str('LAYA_URL', 'http://127.0.0.1:8000').replace(/\/+$/, ''),
  layaThreshold: num('LAYA_THRESHOLD', 0.6),

  corsOrigins: list('CORS_ORIGINS', ['http://localhost:5173', 'http://127.0.0.1:5173']),
};

// Grouped views and UPPER_CASE aliases so other modules can use whichever style they prefer.
config.claude = { model: config.claudeModel, apiKey: config.anthropicApiKey };
config.laya = { mode: config.layaMode, url: config.layaUrl, threshold: config.layaThreshold };
Object.assign(config, {
  PORT: config.port,
  DB_PATH: config.dbPath,
  BYBIT_REST: config.bybitRest,
  BYBIT_WS: config.bybitWs,
  RATE_LIMIT: config.rateLimit,
  DEFAULT_SYMBOLS: config.defaultSymbols,
  BACKFILL_DAYS: config.backfillDays,
  FOOTPRINT_TICK_MULT: config.footprintTickMult,
  CLAUDE_MODEL: config.claudeModel,
  ANTHROPIC_API_KEY: config.anthropicApiKey,
  LAYA_MODE: config.layaMode,
  LAYA_URL: config.layaUrl,
  LAYA_THRESHOLD: config.layaThreshold,
});

export default Object.freeze(config);
