// TradeView server entry point (ARCHITECTURE §11, §13, §14): one process, one port.
// Builds the shared ctx, registers auth + every route module, starts engines and the 24/7 trade recorder,
// and hands every non-/api, non-/ws request to the in-process Next.js app (dev or production build).
//   node src/index.js            API + Next (dev unless NODE_ENV=production)
//   node src/index.js --no-web   API only (or WEB=off)
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Fastify from 'fastify';
import websocket from '@fastify/websocket';

import config from './config.js';
import { initDb } from './db/index.js';
import { createProviders } from './providers/index.js';
import { Instruments } from './bybit/instruments.js';
import { MarketData } from './data/market.js';
import { LiveHub } from './data/live.js';
import { Recorder } from './data/recorder.js';
import { runGapfill } from './data/gapfill.js';
import * as authRoutes from './auth/index.js';
import * as marketRoutes from './api/market.js';
import * as drawingsRoutes from './api/drawings.js';
import * as healthRoutes from './api/health.js';
import * as wsRoutes from './api/ws.js';
import { createSocketHub } from './api/ws.js';

const SRC_DIR = path.dirname(fileURLToPath(import.meta.url));
const gzip = promisify(zlib.gzip);
/** JSON responses at least this large are gzipped when the client accepts it (candle pages shrink ~9x). */
export const COMPRESS_MIN_BYTES = 8 * 1024;

/**
 * onSend hook: gzip large JSON API responses. Streams / hijacked replies (SSE chat, Next.js) are not touched.
 * No dependency: node:zlib on the libuv threadpool, level 4 (about 1 ms for a 2000-bar page).
 */
export async function compressJson(req, reply, payload) {
  if (payload == null || reply.getHeader('content-encoding')) return payload;
  if (typeof payload !== 'string' && !Buffer.isBuffer(payload)) return payload;
  if (Buffer.byteLength(payload) < COMPRESS_MIN_BYTES) return payload;
  if (!/json/i.test(String(reply.getHeader('content-type') || ''))) return payload;
  if (!/\bgzip\b/i.test(String(req.headers['accept-encoding'] || ''))) return payload;
  const out = await gzip(payload, { level: 4 });
  reply.header('content-encoding', 'gzip');
  reply.header('vary', 'accept-encoding');
  reply.removeHeader('content-length');
  return out;
}

/** Other teams' route modules, registered when present (guarded so the server boots without them). */
const OPTIONAL_ROUTES = [
  'pine/routes.js', 'backtest/routes.js', 'alerts/routes.js', 'agent/routes.js', 'laya/routes.js', 'notify/routes.js',
];
/**
 * Engines with start(ctx)/stop(). The notifier (notify/index.js) is started by the alert engine itself.
 */
const ENGINES = [{ name: 'alerts engine', file: 'alerts/engine.js' }];

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
 * Create and prepare the in-process Next.js app. Returns null (with a warning) when it cannot start, so the
 * API keeps working.
 */
async function createNext(cfg, log) {
  const dev = !cfg.isProd;
  if (!fs.existsSync(path.join(cfg.webDir, 'package.json'))) {
    log.warn(`web app not found at ${cfg.webDir}; serving the API only`);
    return null;
  }
  if (!dev && !fs.existsSync(path.join(cfg.webDir, '.next'))) {
    log.warn('no Next.js production build found (web/.next); run "npm run build" first. Serving the API only');
    return null;
  }
  try {
    const { default: next } = await import('next');
    const nextApp = next({ dev, dir: cfg.webDir, hostname: 'localhost', port: cfg.port });
    await nextApp.prepare();
    log.info(`Next.js ${dev ? 'dev server' : 'production build'} ready (${cfg.webDir})`);
    // The router-server upgrade handler is what Next itself attaches for dev HMR (`/_next/hmr`);
    // getUpgradeHandler() only reaches the inner render server, so prefer the former.
    let upgrade = null;
    try {
      upgrade = nextApp.upgradeHandler ?? null;
    } catch {
      upgrade = null;
    }
    if (!upgrade && typeof nextApp.getUpgradeHandler === 'function') upgrade = nextApp.getUpgradeHandler();
    return {
      app: nextApp,
      handle: nextApp.getRequestHandler(),
      upgrade,
      close: () => nextApp.close?.(),
    };
  } catch (err) {
    log.warn({ err }, `Next.js failed to start (${err.message}); serving the API only`);
    return null;
  }
}

/**
 * Build the Fastify app and ctx without listening.
 * @param {{ config?: any, logger?: any, gapfill?: boolean, streams?: any, fetch?: typeof fetch, WebSocket?: any,
 *   optionalModules?: boolean, web?: boolean, record?: boolean }} [opts]
 *   optionalModules=false skips the other teams' modules; web=false skips Next.js; record=false skips the recorder.
 */
export async function buildServer(opts = {}) {
  const cfg = opts.config ?? config;
  const app = Fastify({
    logger: opts.logger ?? { level: cfg.logLevel },
    bodyLimit: 5 * 1024 * 1024,
    forceCloseConnections: true,
    trustProxy: cfg.trustProxy ?? false,
  });
  const log = app.log;

  const { db, repos } = initDb(cfg.dbPath);
  const providers = createProviders({ config: cfg, log, fetch: opts.fetch, WebSocket: opts.WebSocket });
  const rest = providers.rest;
  const streams = opts.streams ?? providers.streams;
  const instruments = new Instruments({ rest, repos, log });
  const market = new MarketData({ repos, rest, instruments, log, config: cfg });
  const live = new LiveHub({ config: cfg, log, repos, instruments, market, streams });
  market.live = live;
  const hub = createSocketHub({ log });
  const recorder = new Recorder({ live, repos, config: cfg, log });

  const ctx = {
    config: cfg,
    log,
    db,
    repos,
    // `rest` routes by symbol prefix (delta:* -> Delta, linear:/spot:/inverse:* -> Bybit).
    providers: { rest, streams, delta: providers.delta, bybit: providers.bybit },
    bybit: { rest, instruments, streams, client: providers.bybit.rest },
    delta: { rest: providers.delta.rest, ws: providers.delta.ws },
    market,
    live,
    recorder,
    sockets: hub,
    broadcast: hub.broadcast,
    laya: offlineLaya('initialising'),
    auth: null,
  };
  if (opts.optionalModules !== false) ctx.laya = await createLaya(ctx);

  await app.register(websocket, { options: { maxPayload: 1024 * 1024 } });

  // Auth first: its onRequest hook protects /api/* and /ws for every route.
  await registerRoutes(app, ctx, 'auth/index.js', authRoutes);
  if (!ctx.auth) throw new Error('auth failed to initialise');

  // Data team routes.
  for (const [name, mod] of [['api/health.js', healthRoutes], ['api/market.js', marketRoutes], ['api/drawings.js', drawingsRoutes], ['api/ws.js', wsRoutes]]) {
    await registerRoutes(app, ctx, name, mod);
  }
  // Other teams' routes (guarded).
  for (const rel of opts.optionalModules === false ? [] : OPTIONAL_ROUTES) {
    const mod = await importOptional(rel, log);
    if (mod) await registerRoutes(app, ctx, rel, mod);
  }

  app.addHook('onSend', compressJson);

  app.setErrorHandler((err, req, reply) => {
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    if (status >= 500) req.log.error({ err }, 'request failed');
    reply.code(status).send({ error: err.message || 'internal error' });
  });

  // Next.js: catch-all after /api and /ws, plus non-/ws upgrade requests (dev HMR).
  const web = (opts.web ?? cfg.webEnabled) ? await createNext(cfg, log) : null;
  if (web) {
    await app.register(async (scope) => {
      // Leave request bodies unread so Next receives the raw stream.
      scope.removeAllContentTypeParsers();
      scope.addContentTypeParser('*', (req, payload, done) => done(null));
      scope.all('/*', (req, reply) => {
        const url = req.raw.url || '/';
        if (url === '/api' || url.startsWith('/api/') || url.startsWith('/api?')) {
          return reply.code(404).send({ error: 'not found', path: url.split('?')[0] });
        }
        reply.hijack();
        Promise.resolve(web.handle(req.raw, reply.raw)).catch((err) => {
          log.error({ err }, 'Next.js handler failed');
          if (!reply.raw.headersSent) {
            reply.raw.statusCode = 500;
            reply.raw.end('Internal Server Error');
          }
        });
      });
    });
    if (web.upgrade) {
      // Single upgrade dispatcher: /ws -> @fastify/websocket, everything else (dev HMR) -> Next.
      const server = app.server;
      const wsListeners = server.listeners('upgrade');
      const upgraded = new Set();
      server.removeAllListeners('upgrade');
      server.on('upgrade', (req, socket, head) => {
        const p = (req.url || '').split('?')[0];
        if (p === '/ws') {
          for (const l of wsListeners) l.call(server, req, socket, head);
          return;
        }
        upgraded.add(socket);
        socket.once('close', () => upgraded.delete(socket));
        Promise.resolve(web.upgrade(req, socket, head)).catch(() => socket.destroy());
      });
      // Next dev also tries to attach its own 'upgrade' listener to the server on the first request; two
      // handlers answering the same handshake break HMR, so later 'upgrade' listeners are ignored.
      const on = server.on.bind(server);
      server.on = server.addListener = (ev, fn) => (ev === 'upgrade' ? server : on(ev, fn));
      // Upgraded sockets are not closed by forceCloseConnections; end them so shutdown does not hang.
      app.addHook('preClose', async () => {
        for (const s of upgraded) s.destroy();
      });
    }
  } else {
    app.setNotFoundHandler((req, reply) => reply.code(404).send({ error: 'not found', path: req.url.split('?')[0] }));
  }

  // Engines with lifecycle (guarded).
  const engines = [];
  const startEngines = async () => {
    if (opts.optionalModules === false) return;
    for (const { name, file } of ENGINES) {
      const mod = await importOptional(file, log);
      const owner = mod?.start ? mod : mod?.default?.start ? mod.default : null;
      if (!owner) {
        if (mod) log.warn(`${file} has no start(ctx) export`);
        continue;
      }
      try {
        await owner.start(ctx);
        engines.push({ name, owner });
        log.info(`${name} started`);
      } catch (err) {
        log.warn({ err }, `${name} failed to start: ${err.message}`);
      }
    }
  };

  const background = new AbortController();
  const startBackground = () => {
    instruments.load().catch((err) => log.warn(`instrument load failed: ${err.message}`));
    if (opts.record !== false) recorder.start(cfg.recordSymbols);
    if (cfg.gapfillOnStart && opts.gapfill !== false) {
      runGapfill(ctx, { signal: background.signal }).catch((err) => log.warn(`gapfill failed: ${err.message}`));
    }
  };

  let closing = null;
  const stop = async () => {
    if (closing) return closing;
    closing = (async () => {
      background.abort(); // stop the startup gap-fill before the DB closes
      for (const e of engines.reverse()) {
        try {
          await e.owner.stop?.();
        } catch (err) {
          log.warn(`${e.name} stop failed: ${err.message}`);
        }
      }
      try {
        await ctx.laya?.close?.();
      } catch {
        /* ignore */
      }
      recorder.stop();
      live.stop();
      await app.close();
      try {
        const { closePinePool } = await import('./pine/runner.js');
        await closePinePool();
      } catch {
        /* pine module unavailable */
      }
      try {
        await web?.close();
      } catch {
        /* ignore */
      }
      try {
        db.close();
      } catch {
        /* ignore */
      }
    })();
    return closing;
  };

  return { app, ctx, web, startEngines, startBackground, stop };
}

/** Build, listen, start engines and background tasks. */
export async function startServer(opts = {}) {
  const server = await buildServer(opts);
  const cfg = server.ctx.config;
  await server.app.listen({ port: cfg.port, host: cfg.host });
  await server.startEngines();
  server.startBackground();
  server.ctx.log.info(`TradeView on http://localhost:${cfg.port}${server.web ? '' : ' (API only)'}`);
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
