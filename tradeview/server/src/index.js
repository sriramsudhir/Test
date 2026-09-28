// TradeView server entry point: builds the shared ctx (ARCHITECTURE §11), registers every route module,
// starts engines, serves web/dist in production and shuts down gracefully.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';

import config from './config.js';
import { initDb } from './db/index.js';
import { BybitRest } from './bybit/rest.js';
import { Instruments } from './bybit/instruments.js';
import { BybitStreams } from './bybit/ws.js';
import { MarketData } from './data/market.js';
import { LiveHub } from './data/live.js';
import { runGapfill } from './data/gapfill.js';
import * as marketRoutes from './api/market.js';
import * as drawingsRoutes from './api/drawings.js';
import * as healthRoutes from './api/health.js';
import * as wsRoutes from './api/ws.js';
import { createSocketHub } from './api/ws.js';

const SRC_DIR = path.dirname(fileURLToPath(import.meta.url));

/** Intelligence-team modules, registered when present (guarded so the server boots without them). */
const OPTIONAL_ROUTES = ['pine/routes.js', 'backtest/routes.js', 'alerts/routes.js', 'agent/routes.js', 'laya/routes.js'];

/**
 * Import a module relative to src/, returning null (and logging) if it is missing or throws on load.
 * @param {string} rel
 * @param {any} log
 */
export async function importOptional(rel, log) {
  const file = path.join(SRC_DIR, rel);
  if (!fs.existsSync(file)) {
    log.warn(`module ${rel} not found; skipping`);
    return null;
  }
  try {
    return await import(pathToFileURL(file).href);
  } catch (err) {
    log.warn({ err }, `module ${rel} failed to load; skipping (${err.message})`);
    return null;
  }
}

/** Fallback Laya service used when laya/index.js is missing or fails. */
export function offlineLaya(reason = 'unavailable') {
  return {
    status: () => ({ ready: false, mode: 'off', model: null, reason }),
    decide: async () => null,
  };
}

async function createLaya(ctx) {
  const mod = await importOptional('laya/index.js', ctx.log);
  if (!mod) return offlineLaya('laya/index.js missing');
  try {
    let svc;
    if (typeof mod.createLayaService === 'function') svc = await mod.createLayaService(ctx);
    else if (mod.default && typeof mod.default === 'object') svc = mod.default;
    else if (typeof mod.default === 'function') {
      try {
        svc = await mod.default(ctx);
      } catch (err) {
        if (!(err instanceof TypeError && /class constructor/i.test(err.message))) throw err;
        svc = new mod.default(ctx); // eslint-disable-line new-cap
      }
    }
    if (!svc || typeof svc.status !== 'function') throw new Error('laya/index.js did not provide a LayaService');
    if (typeof svc.decide !== 'function') svc.decide = async () => null;
    return svc;
  } catch (err) {
    ctx.log.warn({ err }, `Laya service init failed: ${err.message}`);
    return offlineLaya(err.message);
  }
}

async function registerRoutes(app, ctx, name, mod) {
  const fn = mod?.register ?? (typeof mod?.default === 'function' ? mod.default : null);
  if (typeof fn !== 'function') {
    ctx.log.warn(`route module ${name} has no register(app, ctx) export; skipping`);
    return false;
  }
  try {
    await fn(app, ctx);
    return true;
  } catch (err) {
    ctx.log.warn({ err }, `route module ${name} failed to register: ${err.message}`);
    return false;
  }
}

/**
 * Build the Fastify app and ctx without listening.
 * @param {{ config?: any, logger?: any, gapfill?: boolean, streams?: any, fetch?: typeof fetch,
 *   optionalModules?: boolean }} [opts] optionalModules=false skips the intelligence-team modules (tests)
 */
export async function buildServer(opts = {}) {
  const cfg = opts.config ?? config;
  const app = Fastify({
    logger: opts.logger ?? {
      level: cfg.logLevel,
    },
    bodyLimit: 5 * 1024 * 1024,
    forceCloseConnections: true,
  });
  const log = app.log;

  const { db, repos } = initDb(cfg.dbPath);
  const rest = new BybitRest({ baseUrl: cfg.bybitRest, rateLimit: cfg.rateLimit, log, fetch: opts.fetch });
  const instruments = new Instruments({ rest, repos, log });
  const streams = opts.streams ?? new BybitStreams({ baseUrl: cfg.bybitWs, log });
  const market = new MarketData({ repos, rest, instruments, log, config: cfg });
  const live = new LiveHub({ config: cfg, log, repos, instruments, market, streams });
  market.live = live;
  const hub = createSocketHub({ log });

  const ctx = {
    config: cfg,
    log,
    db,
    repos,
    bybit: { rest, instruments, streams },
    market,
    live,
    sockets: hub,
    broadcast: hub.broadcast,
    laya: offlineLaya('initialising'),
  };
  if (opts.optionalModules !== false) ctx.laya = await createLaya(ctx);

  // Dev CORS for the Vite dev server (and any CORS_ORIGINS).
  if (!cfg.isProd) {
    const allowed = new Set(cfg.corsOrigins);
    app.addHook('onRequest', async (req, reply) => {
      const origin = req.headers.origin;
      if (!origin || !allowed.has(origin)) return;
      reply.header('Access-Control-Allow-Origin', origin);
      reply.header('Vary', 'Origin');
      reply.header('Access-Control-Allow-Credentials', 'true');
      if (req.method === 'OPTIONS') {
        reply.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
        reply.header('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] || 'content-type');
        reply.header('Access-Control-Max-Age', '600');
        return reply.code(204).send();
      }
    });
  }

  await app.register(websocket, { options: { maxPayload: 1024 * 1024 } });

  // Data team routes.
  for (const [name, mod] of [['api/health.js', healthRoutes], ['api/market.js', marketRoutes], ['api/drawings.js', drawingsRoutes], ['api/ws.js', wsRoutes]]) {
    await registerRoutes(app, ctx, name, mod);
  }
  // Intelligence team routes (guarded).
  for (const rel of opts.optionalModules === false ? [] : OPTIONAL_ROUTES) {
    const mod = await importOptional(rel, log);
    if (mod) await registerRoutes(app, ctx, rel, mod);
  }

  // Static web build (production, or SERVE_WEB=1) with SPA fallback.
  const serveWeb = (cfg.isProd || process.env.SERVE_WEB === '1') && fs.existsSync(path.join(cfg.webDist, 'index.html'));
  if (serveWeb) {
    await app.register(fastifyStatic, { root: cfg.webDist, prefix: '/', wildcard: false, index: ['index.html'] });
    log.info(`serving web build from ${cfg.webDist}`);
  } else if (cfg.isProd) {
    log.warn(`web build not found at ${cfg.webDist}; run "npm run build" first`);
  }
  app.setNotFoundHandler((req, reply) => {
    const url = req.url.split('?')[0];
    if (serveWeb && req.method === 'GET' && !url.startsWith('/api/') && url !== '/ws' && !path.extname(url)) {
      return reply.type('text/html').sendFile('index.html');
    }
    return reply.code(404).send({ error: 'not found', path: url });
  });
  app.setErrorHandler((err, req, reply) => {
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    if (status >= 500) req.log.error({ err }, 'request failed');
    reply.code(status).send({ error: err.message || 'internal error' });
  });

  // Engines with lifecycle (guarded).
  let alertsEngine = null;
  const startEngines = async () => {
    if (opts.optionalModules === false) return;
    const mod = await importOptional('alerts/engine.js', log);
    const start = mod?.start ?? mod?.default?.start;
    if (typeof start === 'function') {
      try {
        await start.call(mod.default ?? mod, ctx);
        alertsEngine = mod.default?.stop ? mod.default : mod;
        log.info('alerts engine started');
      } catch (err) {
        log.warn({ err }, `alerts engine failed to start: ${err.message}`);
      }
    } else if (mod) log.warn('alerts/engine.js has no start(ctx) export');
  };

  const startBackground = () => {
    instruments.load().catch((err) => log.warn(`instrument load failed: ${err.message}`));
    if (cfg.gapfillOnStart && opts.gapfill !== false) {
      runGapfill(ctx).catch((err) => log.warn(`gapfill failed: ${err.message}`));
    }
  };

  let closing = null;
  const stop = async () => {
    if (closing) return closing;
    closing = (async () => {
      try {
        if (alertsEngine?.stop) await alertsEngine.stop();
      } catch (err) {
        log.warn(`alerts engine stop failed: ${err.message}`);
      }
      try {
        await ctx.laya?.close?.();
      } catch {
        /* ignore */
      }
      live.stop();
      await app.close();
      try {
        db.close();
      } catch {
        /* ignore */
      }
    })();
    return closing;
  };

  return { app, ctx, startEngines, startBackground, stop };
}

/** Build, listen, start engines and background tasks. */
export async function startServer(opts = {}) {
  const server = await buildServer(opts);
  const cfg = server.ctx.config;
  await server.app.listen({ port: cfg.port, host: cfg.host });
  await server.startEngines();
  server.startBackground();
  return server;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  let server;
  try {
    server = await startServer();
  } catch (err) {
    console.error('TradeView server failed to start:', err);
    process.exit(1);
  }
  const shutdown = (signal) => {
    server.ctx.log.info(`${signal} received, shutting down`);
    const force = setTimeout(() => process.exit(1), 10000);
    force.unref();
    server.stop().then(
      () => process.exit(0),
      (err) => {
        console.error('shutdown error', err);
        process.exit(1);
      },
    );
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (err) => server.ctx.log.error({ err }, 'unhandled rejection'));
}
