// Site authentication (ARCHITECTURE §13.3).
//   POST /api/auth/login {password} -> signed httpOnly cookie (30 days, SameSite=Lax, Secure over HTTPS)
//   POST /api/auth/logout, GET /api/auth/me
// Every /api/* route except /api/auth/* and /api/health, and the /ws upgrade, require the cookie.
// Disabled (with a loud warning) when neither AUTH_PASSWORD nor AUTH_PASSWORD_HASH is set.
import crypto from 'node:crypto';
import { hashPassword, parseHash, verifyPassword } from './password.js';

export const COOKIE_NAME = 'tv_session';
const LOGIN_LIMIT = 5;
const LOGIN_WINDOW_MS = 60 * 1000;

/** Parse a Cookie header into a plain object. */
export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k || k in out) continue;
    let v = part.slice(i + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

/** Serialise a Set-Cookie value. */
export function serializeCookie(name, value, { maxAge, secure, httpOnly = true, sameSite = 'Lax', path = '/' } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`, `SameSite=${sameSite}`];
  if (maxAge !== undefined) {
    parts.push(`Max-Age=${Math.floor(maxAge)}`);
    parts.push(`Expires=${new Date(Date.now() + maxAge * 1000).toUTCString()}`);
  }
  if (httpOnly) parts.push('HttpOnly');
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

/** Sliding-window limiter: `hit(key)` returns { ok, retryAfterSec }. */
export class LoginLimiter {
  constructor({ limit = LOGIN_LIMIT, windowMs = LOGIN_WINDOW_MS, now = () => Date.now() } = {}) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.now = now;
    this.hits = new Map();
  }

  hit(key) {
    const now = this.now();
    const arr = (this.hits.get(key) || []).filter((t) => now - t < this.windowMs);
    if (arr.length >= this.limit) {
      this.hits.set(key, arr);
      return { ok: false, retryAfterSec: Math.max(1, Math.ceil((arr[0] + this.windowMs - now) / 1000)) };
    }
    arr.push(now);
    this.hits.set(key, arr);
    if (this.hits.size > 10000) this._gc(now);
    return { ok: true, retryAfterSec: 0 };
  }

  _gc(now) {
    for (const [k, arr] of this.hits) if (!arr.some((t) => now - t < this.windowMs)) this.hits.delete(k);
  }
}

/**
 * Stateless signed session tokens: base64url(JSON{iat,exp,n}).hmac. The HMAC key mixes SESSION_SECRET with a
 * fingerprint of the configured password, so changing the password invalidates every existing session.
 */
export class SessionSigner {
  constructor(secret, fingerprint = '') {
    this.key = crypto.createHash('sha256').update(`${secret}|${fingerprint}`).digest();
  }

  sign(payload) {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const mac = crypto.createHmac('sha256', this.key).update(body).digest('base64url');
    return `${body}.${mac}`;
  }

  /** @returns {object|null} payload when valid and not expired */
  verify(token, now = Date.now()) {
    if (typeof token !== 'string' || token.length > 4096) return null;
    const i = token.lastIndexOf('.');
    if (i <= 0) return null;
    const body = token.slice(0, i);
    const mac = Buffer.from(token.slice(i + 1), 'base64url');
    const expect = crypto.createHmac('sha256', this.key).update(body).digest();
    if (mac.length !== expect.length || !crypto.timingSafeEqual(mac, expect)) return null;
    try {
      const p = JSON.parse(Buffer.from(body, 'base64url').toString());
      if (!p || typeof p.exp !== 'number' || p.exp <= now) return null;
      return p;
    } catch {
      return null;
    }
  }
}

/**
 * Canonical form of a request path for access decisions: query dropped, percent-escapes decoded (repeatedly, so
 * `/%2561pi` cannot sneak through either), duplicate slashes collapsed, `.`/`..` segments resolved, lower-cased.
 * Fastify's router decodes escapes such as `/%61pi/alerts` into `/api/alerts` before matching, so the check must
 * look at the same decoded path (otherwise `/%61pi/...` would reach protected routes without a session).
 */
export function canonicalPath(url) {
  let p = String(url || '').split(/[?#]/)[0];
  for (let i = 0; i < 4 && /%[0-9a-f]{2}/i.test(p); i++) {
    try {
      p = decodeURIComponent(p);
    } catch {
      p = p.replace(/%([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
    }
  }
  p = p.replace(/\\/g, '/');
  const out = [];
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  return `/${out.join('/')}`.toLowerCase();
}

/** True when the path needs a session (all /api/* except auth + health, and /ws). */
export function isProtectedPath(url) {
  const path = canonicalPath(url);
  if (path === '/ws' || path.startsWith('/ws/')) return true;
  if (!path.startsWith('/api/') && path !== '/api') return false;
  if (path === '/api/health' || path.startsWith('/api/auth/')) return false;
  return true;
}

/** Route patterns (as registered) that are reachable without a session. */
const PUBLIC_ROUTES = new Set(['/api/health', '/api/auth/login', '/api/auth/logout', '/api/auth/me']);

/**
 * Access decision for a request: protected when either the canonical URL path or the matched route pattern is.
 * The route check covers every way the router might match a protected route (encodings, future router options).
 */
export function requestNeedsSession(req) {
  if (isProtectedPath(req.url)) return true;
  const route = req.routeOptions?.url;
  if (!route || PUBLIC_ROUTES.has(route)) return false;
  return route === '/ws' || route.startsWith('/ws/') || route === '/api' || route.startsWith('/api/');
}

/**
 * Build the auth service. Resolves the password hash and session secret (generated and persisted in kv when
 * SESSION_SECRET is unset).
 * @param {any} ctx
 */
export async function createAuth(ctx) {
  const { config, log } = ctx;
  const plain = config.authPassword || '';
  const hashStr = config.authPasswordHash || '';
  const enabled = !!(plain || hashStr);
  let hash = null;
  if (hashStr) {
    hash = parseHash(hashStr);
    if (!hash) throw new Error('AUTH_PASSWORD_HASH is malformed; generate one with: node server/src/auth/hash.js');
  } else if (plain) {
    hash = parseHash(await hashPassword(plain));
  }

  let secret = config.sessionSecret || '';
  if (enabled && !secret) {
    secret = ctx.repos?.kv?.get('auth:session_secret') || '';
    if (!secret) {
      secret = crypto.randomBytes(32).toString('base64url');
      ctx.repos?.kv?.set('auth:session_secret', secret);
    }
    log.warn('SESSION_SECRET is not set: using a generated secret stored in the database (set SESSION_SECRET to control it)');
  }
  // Fingerprint of the configured credential (not reversible: HMAC of the stored hash/plain with the secret).
  const fingerprint = enabled
    ? crypto.createHmac('sha256', secret).update(hashStr || `plain:${plain}`).digest('base64url')
    : '';
  const signer = new SessionSigner(secret || 'disabled', fingerprint);
  const maxAgeSec = Math.max(1, Number(config.sessionDays ?? 30)) * 86400;
  const limiter = new LoginLimiter();

  const auth = {
    enabled,
    cookieName: COOKIE_NAME,
    limiter,
    /** Session payload for a request (or a synthetic one when auth is disabled). */
    session(req) {
      if (!enabled) return { anonymous: true };
      const token = parseCookies(req.headers?.cookie)[COOKIE_NAME];
      return token ? signer.verify(token) : null;
    },
    isAuthenticated(req) {
      return !!auth.session(req);
    },
    async checkPassword(password) {
      if (!enabled || typeof password !== 'string' || !password || password.length > 1024) return false;
      return verifyPassword(password, hash);
    },
    issue() {
      const now = Date.now();
      return signer.sign({ iat: now, exp: now + maxAgeSec * 1000, n: crypto.randomBytes(8).toString('base64url') });
    },
    cookie(req, token, { clear = false } = {}) {
      const mode = String(process.env.COOKIE_SECURE ?? 'auto').toLowerCase();
      const https = req.protocol === 'https';
      const secure = mode === 'true' ? true : mode === 'false' ? false : https;
      return serializeCookie(COOKIE_NAME, clear ? '' : token, { maxAge: clear ? 0 : maxAgeSec, secure });
    },
  };
  return auth;
}

/**
 * Register auth routes and the protecting hook on the root app (must run before other routes are added).
 * @param {import('fastify').FastifyInstance} app
 * @param {any} ctx
 */
export async function register(app, ctx) {
  const auth = ctx.auth || (ctx.auth = await createAuth(ctx));
  if (!auth.enabled) {
    const bar = '!'.repeat(78);
    ctx.log.warn(`${bar}\n  AUTH DISABLED: AUTH_PASSWORD / AUTH_PASSWORD_HASH not set. Anyone who can reach this port can use\n  the app (and the Claude agent). Set AUTH_PASSWORD before exposing the server to the internet.\n${bar}`);
  }

  app.addHook('onRequest', async (req, reply) => {
    if (!auth.enabled || req.method === 'OPTIONS') return;
    if (!requestNeedsSession(req)) return;
    if (auth.isAuthenticated(req)) return;
    reply.code(401).header('cache-control', 'no-store').send({ error: 'unauthorized', login: '/api/auth/login' });
    return reply;
  });

  app.post('/api/auth/login', async (req, reply) => {
    if (!auth.enabled) return { ok: true, authenticated: true, authEnabled: false };
    const rl = auth.limiter.hit(req.ip || 'unknown');
    if (!rl.ok) {
      reply.header('retry-after', String(rl.retryAfterSec));
      return reply.code(429).send({ error: 'too many login attempts, try again later', retryAfter: rl.retryAfterSec });
    }
    const password = req.body && typeof req.body === 'object' ? req.body.password : undefined;
    if (!(await auth.checkPassword(password))) {
      ctx.log.warn({ ip: req.ip }, 'failed login attempt');
      return reply.code(401).send({ error: 'invalid password' });
    }
    reply.header('set-cookie', auth.cookie(req, auth.issue()));
    reply.header('cache-control', 'no-store');
    return { ok: true, authenticated: true, authEnabled: true };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    reply.header('set-cookie', auth.cookie(req, '', { clear: true }));
    return { ok: true, authenticated: false, authEnabled: auth.enabled };
  });

  app.get('/api/auth/me', async (req, reply) => {
    reply.header('cache-control', 'no-store');
    const s = auth.session(req);
    return { authenticated: !!s, authEnabled: auth.enabled, expires: s?.exp ?? null };
  });
}

export default register;
