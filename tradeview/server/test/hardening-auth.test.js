// Hardening: auth cannot be bypassed with encoded / non-canonical paths (HTTP routes and the /ws upgrade).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import baseConfig from '../src/config.js';
import { buildServer } from '../src/index.js';
import { canonicalPath, isProtectedPath } from '../src/auth/index.js';

class FakeStreams extends EventEmitter {
  constructor() {
    super();
    this.status = 'connected';
  }
  subscribe() {}
  unsubscribe() {}
  statuses() {
    return {};
  }
  close() {}
}

const blockedFetch = async () => ({ ok: false, status: 403, headers: new Map(), text: async () => 'blocked' });

async function makeServer(extra = {}) {
  return buildServer({
    config: { ...baseConfig, dbPath: ':memory:', logLevel: 'silent', port: 0, host: '127.0.0.1', gapfillOnStart: false, authPassword: 'pw', authPasswordHash: '', ...extra },
    logger: false, fetch: blockedFetch, streams: new FakeStreams(), optionalModules: true, web: false, record: false, gapfill: false,
  });
}

test('canonicalPath decodes, collapses and resolves dot segments', () => {
  assert.equal(canonicalPath('/%61pi/alerts?x=1'), '/api/alerts');
  assert.equal(canonicalPath('/%2561pi/alerts'), '/api/alerts');
  assert.equal(canonicalPath('//api//alerts/'), '/api/alerts');
  assert.equal(canonicalPath('/api/health/../alerts'), '/api/alerts');
  assert.equal(canonicalPath('/API/Alerts'), '/api/alerts');
  assert.equal(canonicalPath('/%77s'), '/ws');
  assert.ok(canonicalPath('/api/%E0%A4%A').startsWith('/api/')); // malformed escape does not throw
  for (const p of ['/%61pi/alerts', '/api/%61lerts', '/%2561pi/candles', '/api/health/../alerts', '/%77s', '/Api/alerts']) {
    assert.equal(isProtectedPath(p), true, p);
  }
  for (const p of ['/', '/_next/static/x.js', '/api/health', '/api/auth/login', '/%61pi/health']) {
    assert.equal(isProtectedPath(p), false, p);
  }
});

test('encoded paths cannot reach protected routes without a session', async () => {
  const server = await makeServer();
  const { app } = server;
  try {
    const urls = [
      '/api/alerts', '/%61pi/alerts', '/%61%70%69/alerts', '/api/%61lerts', '/%2561pi/alerts', '/api/dr%61wings?symbol=delta:BTCUSD',
      '/%61pi/alerts/events', '/%61pi/pine/library', '/%61pi/chat/history?session=x', '/%61pi/push/vapid',
      '/%61pi/candles?symbol=delta:BTCUSD&tf=1m', '/%61pi/symbols', '/%61pi/laya/status', '/%61pi/agent/status',
    ];
    for (const url of urls) {
      const r = await app.inject({ method: 'GET', url });
      assert.ok(r.statusCode === 401 || r.statusCode === 404, `${url} -> ${r.statusCode} ${r.body.slice(0, 80)}`);
      assert.notEqual(r.statusCode, 200, url);
    }
    for (const [method, url] of [['POST', '/%61pi/alerts'], ['DELETE', '/%61pi/drawings?symbol=delta:BTCUSD'], ['POST', '/%61pi/pine/run']]) {
      const r = await app.inject({ method, url, payload: {} });
      assert.equal(r.statusCode, 401, `${method} ${url}`);
    }
    // Public routes stay public, also when encoded.
    assert.equal((await app.inject({ method: 'GET', url: '/api/health' })).statusCode, 200);
    assert.equal((await app.inject({ method: 'GET', url: '/%61pi/health' })).statusCode, 200);
    assert.equal((await app.inject({ method: 'GET', url: '/api/auth/me' })).statusCode, 200);

    // With the session cookie the encoded path works like the plain one (no false lock-out).
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'pw' } });
    const cookie = login.headers['set-cookie'].split(';')[0];
    assert.equal((await app.inject({ method: 'GET', url: '/%61pi/alerts', headers: { cookie } })).statusCode, 200);
  } finally {
    await server.stop();
  }
});

test('the /ws upgrade is refused without a session, also via /%77s', async () => {
  const server = await makeServer();
  await server.app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = server.app.server.address();
  const tryWs = (path, headers = {}) => new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, { headers });
    ws.on('open', () => {
      ws.close();
      resolve('open');
    });
    ws.on('unexpected-response', (req, res) => resolve(res.statusCode));
    ws.on('error', (err) => resolve(`error: ${err.message}`));
  });
  try {
    assert.equal(await tryWs('/ws'), 401);
    assert.equal(await tryWs('/%77s'), 401);
    assert.equal(await tryWs('/%2577s'), 401);
    const login = await server.app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'pw' } });
    const cookie = login.headers['set-cookie'].split(';')[0];
    assert.equal(await tryWs('/ws', { cookie }), 'open');
  } finally {
    await server.stop();
  }
});

test('/api/health stays public but hides operational details from anonymous callers', async () => {
  const server = await makeServer();
  try {
    const anon = (await server.app.inject({ method: 'GET', url: '/api/health' })).json();
    assert.equal(anon.ok, true);
    assert.equal(anon.details, undefined);
    const login = await server.app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'pw' } });
    const cookie = login.headers['set-cookie'].split(';')[0];
    const authed = (await server.app.inject({ method: 'GET', url: '/api/health', headers: { cookie } })).json();
    assert.ok(authed.details && typeof authed.details.uptimeSec === 'number');
  } finally {
    await server.stop();
  }
});
