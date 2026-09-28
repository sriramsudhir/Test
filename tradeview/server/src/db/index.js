// SQLite bootstrap (ARCHITECTURE §3): opens the database in WAL mode, creates the schema and repositories.
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { createCandlesRepo } from './candles.js';
import { createFootprintRepo } from './footprint.js';
import { createBackfillStateRepo } from './backfillState.js';
import { createAlertsRepo } from './alerts.js';
import { createAlertEventsRepo } from './alertEvents.js';
import { createDrawingsRepo } from './drawings.js';
import { createChatRepo } from './chat.js';
import { createKvRepo, createMetaRepo } from './kv.js';
import { createPushRepo } from './push.js';
import { createTradesRepo } from './trades.js';

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS candles(
  symbol TEXT NOT NULL, tf TEXT NOT NULL, t INTEGER NOT NULL,
  o REAL, h REAL, l REAL, c REAL, v REAL, qv REAL,
  PRIMARY KEY(symbol, tf, t)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS footprint(
  symbol TEXT NOT NULL, tf TEXT NOT NULL, t INTEGER NOT NULL, price REAL NOT NULL,
  bid_v REAL, ask_v REAL,
  PRIMARY KEY(symbol, tf, t, price)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS backfill_state(
  symbol TEXT NOT NULL, tf TEXT NOT NULL, oldest INTEGER, newest INTEGER,
  PRIMARY KEY(symbol, tf));
CREATE TABLE IF NOT EXISTS alerts(
  id TEXT PRIMARY KEY, json TEXT NOT NULL, created INTEGER, status TEXT);
CREATE TABLE IF NOT EXISTS alert_events(
  id INTEGER PRIMARY KEY AUTOINCREMENT, alert_id TEXT, t INTEGER, json TEXT);
CREATE INDEX IF NOT EXISTS alert_events_alert ON alert_events(alert_id, t);
CREATE TABLE IF NOT EXISTS drawings(
  id TEXT PRIMARY KEY, symbol TEXT, json TEXT);
CREATE INDEX IF NOT EXISTS drawings_symbol ON drawings(symbol);
CREATE TABLE IF NOT EXISTS chat_messages(
  id INTEGER PRIMARY KEY AUTOINCREMENT, session TEXT, role TEXT, json TEXT, t INTEGER);
CREATE INDEX IF NOT EXISTS chat_messages_session ON chat_messages(session, id);
-- §13.3: generic key/value store (VAPID keys, caches such as the instrument list, session secret).
CREATE TABLE IF NOT EXISTS kv(
  key TEXT PRIMARY KEY, value TEXT);
-- §13.3: Web Push subscriptions.
CREATE TABLE IF NOT EXISTS push_subscriptions(
  endpoint TEXT PRIMARY KEY, json TEXT);
-- §13.1: raw live trades recorded 24/7 for RECORD_SYMBOLS (pruned after TRADES_RETENTION_DAYS).
-- side: 1 = Buy (aggressive buyer), -1 = Sell.
CREATE TABLE IF NOT EXISTS trades(
  symbol TEXT NOT NULL, t INTEGER NOT NULL, p REAL NOT NULL, q REAL NOT NULL, side INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS trades_symbol_t ON trades(symbol, t);
CREATE INDEX IF NOT EXISTS trades_t ON trades(t);
`;

/**
 * Open (and create if needed) the SQLite database.
 * @param {string} dbPath file path or ':memory:'
 * @returns {import('better-sqlite3').Database}
 */
export function openDb(dbPath) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  if (dbPath !== ':memory:') db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('cache_size = -65536'); // 64 MB page cache
  db.pragma('temp_store = MEMORY');
  db.exec(SCHEMA);
  return db;
}

/**
 * Create all repositories bound to a database.
 * @param {import('better-sqlite3').Database} db
 */
export function createRepos(db) {
  return {
    candles: createCandlesRepo(db),
    footprint: createFootprintRepo(db),
    backfillState: createBackfillStateRepo(db),
    alerts: createAlertsRepo(db),
    alertEvents: createAlertEventsRepo(db),
    drawings: createDrawingsRepo(db),
    chat: createChatRepo(db),
    kv: createKvRepo(db),
    push: createPushRepo(db),
    trades: createTradesRepo(db),
    // JSON helper over kv (used for caches: instrument list, turnover ranking, footprint tick sizes).
    meta: createMetaRepo(db),
  };
}

/** Convenience: open the DB and create repositories. */
export function initDb(dbPath) {
  const db = openDb(dbPath);
  return { db, repos: createRepos(db) };
}

/** Quick liveness check used by /api/health. */
export function dbHealthy(db) {
  try {
    return db.prepare('SELECT 1 AS ok').get().ok === 1;
  } catch {
    return false;
  }
}
