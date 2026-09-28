// Mock TradeView backend for app-shell testing: fake /api/* + /ws on PORT (default 8787).
// Run:  node web/test/shell/mock-server.mjs        (MOCK_AUTH=1 requires login with password "secret")
// Then: TRADEVIEW_API_PROXY=http://127.0.0.1:8787 npx next dev -p 3000   (in web/)
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { tfToMs, floorTime } from '../../src/chart/timeframes.js';

const PORT = Number(process.env.PORT || 8787);
let AUTH = process.env.MOCK_AUTH === '1';

const SYMBOLS = [
  ['delta:BTCUSD', 'BTCUSD', 'delta', 'crypto', 'BTC', 'USD', 0.5, 64000],
  ['delta:ETHUSD', 'ETHUSD', 'delta', 'crypto', 'ETH', 'USD', 0.05, 3100],
  ['delta:SOLUSD', 'SOLUSD', 'delta', 'crypto', 'SOL', 'USD', 0.01, 145],
  ['delta:XRPUSD', 'XRPUSD', 'delta', 'crypto', 'XRP', 'USD', 0.0001, 0.58],
  ['delta:DOGEUSD', 'DOGEUSD', 'delta', 'crypto', 'DOGE', 'USD', 0.00001, 0.12],
  ['delta:BNBUSD', 'BNBUSD', 'delta', 'crypto', 'BNB', 'USD', 0.05, 560],
  ['linear:BTCUSDT', 'BTCUSDT', 'bybit', 'crypto', 'BTC', 'USDT', 0.1, 64010],
  ['linear:ETHUSDT', 'ETHUSDT', 'bybit', 'crypto', 'ETH', 'USDT', 0.01, 3101],
  ['spot:BTCUSDT', 'BTCUSDT', 'bybit', 'crypto', 'BTC', 'USDT', 0.01, 64005],
  ['linear:XAUTUSDT', 'XAUTUSDT', 'bybit', 'commodities', 'XAUT', 'USDT', 0.01, 2380],
  ['spot:PAXGUSDT', 'PAXGUSDT', 'bybit', 'commodities', 'PAXG', 'USDT', 0.01, 2385],
  ['spot:EURUSDT', 'EURUSDT', 'bybit', 'forex', 'EUR', 'USDT', 0.0001, 1.085],
].map(([key, symbol, provider, group, base, quote, tickSize, px]) => ({
  key, symbol, provider, group, base, quote, tickSize, qtyStep: 0.001,
  category: key.split(':')[0], contractType: key.startsWith('spot') ? 'spot' : 'perpetual_futures', _px: px,
}));
const BY_KEY = new Map(SYMBOLS.map((s) => [s.key, s]));

const hash = (n) => { const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); };
function priceAt(sym, t) {
  const b = BY_KEY.get(sym)?._px || 100;
  const d = t / 3600000;
  return b * (1 + 0.06 * Math.sin(d / 150) + 0.03 * Math.sin(d / 21) + 0.01 * Math.sin(d / 3.3) + 0.003 * (hash(Math.floor(t / 60000)) - 0.5));
}
function candleAt(sym, tf, t) {
  const ms = tfToMs(tf);
  const o = priceAt(sym, t);
  const c = priceAt(sym, Math.min(t + ms, Date.now()));
  const r = Math.abs(c - o) + o * 0.002 * (0.3 + hash(t / ms));
  const tick = BY_KEY.get(sym)?.tickSize || 0.01;
  const rd = (x) => Math.round(x / tick) * tick;
  return { t, o: rd(o), h: rd(Math.max(o, c) + r * hash(t / ms + 1) * 0.7), l: rd(Math.min(o, c) - r * hash(t / ms + 2) * 0.7), c: rd(c), v: +(100 + 900 * hash(t / ms + 3)).toFixed(3) };
}
function candles(sym, tf, { from, to, limit = 1000 }) {
  const ms = tfToMs(tf) || 3600000;
  const now = Date.now();
  const last = floorTime(Math.min(to ? +to : now, now), tf);
  const first = from ? floorTime(+from, tf) : last - (Math.min(+limit, 5000) - 1) * ms;
  const out = [];
  for (let t = Math.max(first, last - 4999 * ms); t <= last; t += ms) out.push(candleAt(sym, tf, t));
  return out.slice(-Math.min(+limit || 5000, 5000));
}

// ------------------------------------------------------------------ state
const alerts = new Map();
const events = [];
let seq = 1;
const now = Date.now();
alerts.set('a1', {
  id: 'a1', symbol: 'delta:BTCUSD', tf: '1h', name: 'BTC breakout', message: 'BTC crossed 66k',
  condition: { kind: 'price', op: 'crosses_up', value: 66000 }, trigger: 'once', laya: { enabled: true, question: 'Is this breakout likely to continue rather than fail?', threshold: 0.6 },
  sound: { preset: 'siren', volume: 0.9, repeat: 3, loop: true }, createdBy: 'agent', status: 'active', created: now - 3600e3,
  lastCheck: { t: now - 600e3, price: 65990, laya: { p: 0.42, passed: false, threshold: 0.6, direction: 'bearish', confidence: 'medium' } },
});
alerts.set('a2', {
  id: 'a2', symbol: 'delta:ETHUSD', tf: '4h', name: 'ETH channel', message: 'ETH left the channel',
  condition: { kind: 'price', op: 'exits_channel', value: 3300, value2: 2950 }, trigger: 'once_per_bar_close', laya: { enabled: false, question: '', threshold: 0.6 },
  sound: { preset: 'bell', volume: 0.7, repeat: 2, loop: false }, createdBy: 'user', status: 'active', created: now - 7200e3,
});
events.push({ id: 1, alertId: 'a0', symbol: 'delta:SOLUSD', t: now - 86400e3, price: 151.2, name: 'SOL > 150', message: 'SOL broke 150', laya: { p: 0.77, passed: true, answers: { decision: { noul: 0.77 }, direction: { choice: 'bullish' }, confidence: { score: 'high' } } } });

// ------------------------------------------------------------------ helpers
function send(res, code, body, headers = {}) {
  res.writeHead(code, { 'Content-Type': 'application/json', ...headers });
  res.end(body === undefined ? '' : JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve) => {
    let d = '';
    req.on('data', (c) => { d += c; });
    req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch { resolve({}); } });
  });
}
const authed = (req) => !AUTH || /(?:^|;\s*)tv_session=ok/.test(req.headers.cookie || '');

const clients = new Set();
function broadcast(msg) {
  const s = JSON.stringify(msg);
  for (const ws of clients) if (ws.readyState === 1) ws.send(s);
}

const PINE_LIB = [
  { id: 'sma', name: 'Moving Average', type: 'indicator', category: 'Moving averages', overlay: true },
  { id: 'ema', name: 'EMA', type: 'indicator', category: 'Moving averages', overlay: true },
  { id: 'rsi', name: 'Relative Strength Index', type: 'indicator', category: 'Oscillators', overlay: false },
  { id: 'macd', name: 'MACD', type: 'indicator', category: 'Oscillators', overlay: false },
  { id: 'ema_cross_strategy', name: 'EMA Cross Strategy', type: 'strategy', category: 'Strategies', overlay: true },
];
const pineSource = (id) => id.includes('strategy')
  ? `//@version=6\nstrategy("EMA Cross Strategy", overlay=true)\nf = ta.ema(close, 9)\ns = ta.ema(close, 21)\nif ta.crossover(f, s)\n    strategy.entry("L", strategy.long)\nif ta.crossunder(f, s)\n    strategy.close("L")\n`
  : `//@version=6\nindicator("${id.toUpperCase()}", overlay=${id === 'rsi' || id === 'macd' ? 'false' : 'true'})\nlen = input.int(14, "Length")\nplot(ta.${id === 'macd' ? 'ema' : id}(close, len), "${id}")\n`;

function sma(vals, n) {
  const out = [];
  let s = 0;
  vals.forEach((v, i) => { s += v; if (i >= n) s -= vals[i - n]; out.push(i >= n - 1 ? s / n : null); });
  return out;
}

async function chatStream(req, res, body) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  const write = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const msg = String(body.message || '');
  if (/limit/i.test(msg)) {
    await wait(200);
    write({ type: 'error', message: `Claude AI usage limit reached|${Math.floor(Date.now() / 1000) + 7200}` });
    write({ type: 'done' });
    return res.end();
  }
  const ctx = body.context || {};
  const chart = (ctx.charts || []).find((c) => c.id === ctx.activeChartId) || (ctx.charts || [])[0] || {};
  const sym = chart.symbol || 'delta:BTCUSD';
  const last = chart.lastPrice || BY_KEY.get(sym)?._px || 100;
  const chunks = ['I looked at **', sym.split(':')[1], '** on the ', chart.tf || '1h', ' chart.\n\n', 'Key levels:\n\n', `- Resistance near \`${(last * 1.03).toFixed(1)}\`\n`, `- Support near \`${(last * 0.97).toFixed(1)}\`\n\n`];
  for (const c of chunks) { write({ type: 'text', delta: c }); await wait(60); }
  write({ type: 'tool', name: 'get_candles', input: { symbol: sym, tf: chart.tf || '1h' } });
  await wait(300);
  write({ type: 'tool_result', name: 'get_candles', ok: true });
  const cmds = [
    { action: 'draw', type: 'horizontal_line', points: [{ t: Date.now(), price: +(last * 1.03).toFixed(1) }], color: '#f23645', text: 'Resistance' },
    { action: 'draw', type: 'horizontal_line', points: [{ t: Date.now(), price: +(last * 0.97).toFixed(1) }], color: '#089981', text: 'Support' },
  ];
  for (const command of cmds) {
    write({ type: 'tool', name: 'draw', input: command });
    await wait(250);
    const commandId = `cmd_${seq++}`;
    write({ type: 'chart_command', command, commandId });
    broadcast({ type: 'chart_command', command, commandId }); // also on the socket: must be de-duplicated
  }
  if (/alert/i.test(msg)) {
    write({ type: 'tool', name: 'create_alert', input: { symbol: sym } });
    await wait(300);
    const a = { id: `a${seq++}`, symbol: sym, tf: chart.tf || '1h', name: `${sym.split(':')[1]} > ${(last * 1.03).toFixed(0)}`, message: 'Agent alert', condition: { kind: 'price', op: 'crosses_up', value: +(last * 1.03).toFixed(1) }, trigger: 'once', laya: { enabled: true, question: 'Will it continue?', threshold: 0.6 }, sound: { preset: 'klaxon', volume: 1, repeat: 3, loop: true }, createdBy: 'agent', status: 'active', created: Date.now() };
    alerts.set(a.id, a);
    write({ type: 'alert_created', alert: a });
  }
  for (const c of ['\n', '| Level | Price |\n', '|---|---:|\n', `| R1 | ${(last * 1.03).toFixed(1)} |\n`, `| S1 | ${(last * 0.97).toFixed(1)} |\n`, '\nDrawn on your chart. Want an alert on either level?']) { write({ type: 'text', delta: c }); await wait(50); }
  write({ type: 'done' });
  res.end();
}

// ------------------------------------------------------------------ routes
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;
  const q = Object.fromEntries(url.searchParams);
  if (!p.startsWith('/api/')) return send(res, 404, { error: 'not found' });

  if (p === '/api/_test/auth') { AUTH = q.on === '1'; return send(res, 200, { auth: AUTH }); }
  if (p === '/api/health') return send(res, 200, { ok: true, db: true, bybit: 'connected', delta: 'connected', laya: { ready: true, mode: 'local', model: 'laya-mini' }, details: { subscriptions: 3, uptimeSec: 1234 } });
  if (p === '/api/auth/me') return authed(req) ? send(res, 200, { authenticated: true, authEnabled: AUTH, user: 'admin' }) : send(res, 401, { error: 'unauthorized' });
  if (p === '/api/auth/login' && req.method === 'POST') {
    const b = await readBody(req);
    if (b.password === 'secret' || !AUTH) return send(res, 200, { ok: true }, { 'Set-Cookie': 'tv_session=ok; Path=/; HttpOnly; SameSite=Lax' });
    return send(res, 401, { error: 'invalid password' });
  }
  if (p === '/api/auth/logout') return send(res, 200, { ok: true }, { 'Set-Cookie': 'tv_session=; Path=/; Max-Age=0' });
  if (!authed(req)) return send(res, 401, { error: 'unauthorized' });

  if (p === '/api/laya/status') return send(res, 200, { ready: true, mode: 'local', model: 'laya-mini' });
  if (p === '/api/agent/status') return send(res, 200, { driver: 'claude-code', ready: true, detail: 'Signed in with Claude Max via the claude CLI' });
  if (p === '/api/symbols') {
    const qq = (q.q || '').toUpperCase();
    return send(res, 200, SYMBOLS.filter((s) => (!q.group || s.group === q.group) && (!q.provider || s.provider === q.provider) && (!qq || s.symbol.includes(qq) || s.base.includes(qq))).map(({ _px, ...s }) => s));
  }
  if (p === '/api/candles') return send(res, 200, { candles: candles(q.symbol, q.tf || '1h', q) });
  if (p === '/api/footprint') return send(res, 200, { bars: [] });
  if (p.startsWith('/api/drawings')) return req.method === 'GET' ? send(res, 200, { drawings: [] }) : send(res, 200, { ok: true });
  if (p === '/api/pine/library') return send(res, 200, { items: PINE_LIB });
  if (p.startsWith('/api/pine/library/')) {
    const id = decodeURIComponent(p.split('/').pop());
    const it = PINE_LIB.find((x) => x.id === id);
    return it ? send(res, 200, { ...it, source: pineSource(id) }) : send(res, 404, { error: 'unknown' });
  }
  if (p === '/api/pine/run') {
    const b = await readBody(req);
    const lines = String(b.source || '').split('\n');
    const bad = lines.findIndex((l) => /\bfoo\b/.test(l));
    if (bad !== -1) return send(res, 200, { plots: {}, meta: null, error: 'Undeclared identifier "foo"', line: bad + 1, column: lines[bad].indexOf('foo') + 1, kind: 'compile' });
    const cs = candles(b.symbol, b.tf || '1h', { limit: b.limit || 500 });
    const vals = sma(cs.map((c) => c.c), 20);
    const title = /(?:indicator|strategy)\s*\(\s*"([^"]+)"/.exec(b.source)?.[1] || 'Script';
    return send(res, 200, { plots: { Plot: { data: cs.map((c, i) => ({ t: c.t, value: vals[i] })).filter((d) => d.value != null), options: { color: '#2962ff' } } }, meta: { title, overlay: !/overlay\s*=\s*false/.test(b.source) }, warnings: [] });
  }
  if (p === '/api/backtest/strategies') return send(res, 200, { builtin: [{ id: 'ema_cross', name: 'EMA Cross', description: 'Long when the fast EMA crosses above the slow EMA.', params: { fast: { type: 'int', default: 9, min: 1 }, slow: { type: 'int', default: 21, min: 2 } } }, { id: 'rsi_reversion', name: 'RSI Mean Reversion', description: 'Buy oversold, sell overbought.', params: { length: { type: 'int', default: 14 }, lower: { type: 'int', default: 30 }, upper: { type: 'int', default: 70 } } }], pine: PINE_LIB.filter((x) => x.type === 'strategy') });
  if (p === '/api/backtest') {
    const b = await readBody(req);
    const cs = candles(b.symbol, b.tf, { from: b.from, to: b.to, limit: 5000 });
    const capital = b.capital || 10000;
    const trades = [];
    let eq = capital;
    const equity = [];
    for (let i = 30; i < cs.length - 10; i += 37) {
      const long = (i / 37) % 2 < 1;
      const e = cs[i];
      const x = cs[i + 9];
      const qty = +(capital / e.c).toFixed(4);
      const pnl = (long ? x.c - e.c : e.c - x.c) * qty - e.c * qty * 0.001;
      trades.push({ id: trades.length + 1, side: long ? 'long' : 'short', qty, entryTime: e.t, entryPrice: e.c, exitTime: x.t, exitPrice: x.c, pnl, pnlPct: (pnl / (e.c * qty)) * 100, bars: 10, exitReason: 'signal', commission: e.c * qty * 0.001 });
    }
    let ti = 0;
    for (const c of cs) { while (ti < trades.length && trades[ti].exitTime <= c.t) eq += trades[ti++].pnl; equity.push({ t: c.t, value: eq }); }
    const wins = trades.filter((t) => t.pnl > 0);
    const gp = wins.reduce((s, t) => s + t.pnl, 0);
    const gl = -trades.filter((t) => t.pnl <= 0).reduce((s, t) => s + t.pnl, 0);
    let peak = 0; let dd = 0;
    for (const e of equity) { peak = Math.max(peak, e.value); dd = Math.max(dd, peak - e.value); }
    return send(res, 200, { trades, equity, metrics: { initialCapital: capital, finalEquity: eq, netProfit: eq - capital, netProfitPct: ((eq - capital) / capital) * 100, grossProfit: gp, grossLoss: gl, trades: trades.length, wins: wins.length, losses: trades.length - wins.length, winRate: (wins.length / (trades.length || 1)) * 100, profitFactor: gl ? gp / gl : null, maxDrawdown: dd, maxDrawdownPct: (dd / capital) * 100, sharpe: 1.23, sortino: 1.87, avgTrade: (eq - capital) / (trades.length || 1), largestWin: Math.max(0, ...trades.map((t) => t.pnl)), largestLoss: Math.min(0, ...trades.map((t) => t.pnl)), exposure: 24.3, avgBarsInTrade: 10 }, meta: { mode: b.source ? 'pine-strategy' : 'builtin', title: b.strategy?.id || 'Pine strategy' } });
  }
  if (p === '/api/alerts' && req.method === 'GET') return send(res, 200, { alerts: [...alerts.values()] });
  if (p === '/api/alerts/events') return send(res, 200, { events: events.slice().reverse() });
  if (p === '/api/alerts' && req.method === 'POST') {
    const b = await readBody(req);
    const a = { ...b, id: `a${seq++}`, created: Date.now(), status: 'active' };
    alerts.set(a.id, a);
    return send(res, 201, a);
  }
  const am = /^\/api\/alerts\/([^/]+)$/.exec(p);
  if (am) {
    const id = decodeURIComponent(am[1]);
    const a = alerts.get(id);
    if (!a) return send(res, 404, { error: 'alert not found' });
    if (req.method === 'GET') return send(res, 200, a);
    if (req.method === 'DELETE') { alerts.delete(id); return send(res, 200, { ok: true }); }
    const b = await readBody(req);
    const u = { ...a, ...b };
    alerts.set(id, u);
    broadcast({ type: 'alert_update', alert: u });
    return send(res, 200, u);
  }
  if (p === '/api/push/vapid') return send(res, 200, { publicKey: 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U', telegram: false });
  if (p === '/api/push/subscribe') return send(res, req.method === 'POST' ? 201 : 200, { ok: true });
  if (p === '/api/push/test') return send(res, 200, { push: { sent: 1, failed: 0 }, telegram: { ok: false } });
  if (p === '/api/push/status') return send(res, 200, { push: { subscriptions: 1, ready: true }, telegram: false });
  if (p === '/api/chat' && req.method === 'POST') return chatStream(req, res, await readBody(req));

  // test hooks
  if (p === '/api/_test/fire') {
    const a = alerts.get(q.id || 'a1');
    const ev = { id: seq++, alertId: a.id, symbol: a.symbol, t: Date.now(), price: a.condition.value || 66012.5, message: a.message, name: a.name, laya: { p: 0.73, passed: true, threshold: 0.6, answers: { decision: { noul: 0.73 }, direction: { choice: 'bullish' }, confidence: { score: 'high' } } } };
    events.push(ev);
    broadcast({ type: 'alert', event: ev });
    return send(res, 200, ev);
  }
  if (p === '/api/_test/reject') {
    const a = alerts.get(q.id || 'a1');
    const u = { ...a, lastCheck: { t: Date.now(), price: 65999, laya: { p: 0.38, passed: false, threshold: 0.6, direction: 'neutral' } } };
    alerts.set(a.id, u);
    broadcast({ type: 'alert_update', alert: u });
    return send(res, 200, u);
  }
  return send(res, 404, { error: `no mock for ${req.method} ${p}` });
});

const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  if (!req.url.startsWith('/ws') || !authed(req)) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});
wss.on('connection', (ws) => {
  clients.add(ws);
  ws.subs = new Set();
  ws.send(JSON.stringify({ type: 'status', bybit: 'connected', delta: 'connected' }));
  ws.on('message', (d) => {
    let m;
    try { m = JSON.parse(d); } catch { return; }
    if (m.type === 'ping') ws.send(JSON.stringify({ type: 'pong', t: Date.now() }));
    else if (m.type === 'subscribe') ws.subs.add(`${m.channel}|${m.symbol}|${m.tf || ''}`);
    else if (m.type === 'unsubscribe') ws.subs.delete(`${m.channel}|${m.symbol}|${m.tf || ''}`);
  });
  ws.on('close', () => clients.delete(ws));
});
setInterval(() => {
  const t = Date.now();
  for (const ws of clients) {
    for (const k of ws.subs) {
      const [channel, symbol, tf] = k.split('|');
      if (channel === 'kline') {
        const bt = floorTime(t, tf);
        const c = candleAt(symbol, tf, bt);
        ws.send(JSON.stringify({ type: 'kline', symbol, tf, candle: c, closed: false }));
      } else if (channel === 'trades') {
        ws.send(JSON.stringify({ type: 'trade', symbol, trades: [{ t, p: priceAt(symbol, t), q: 0.01, side: hash(t) > 0.5 ? 'Buy' : 'Sell' }] }));
      }
    }
  }
}, 1000);

server.listen(PORT, '127.0.0.1', () => console.log(`[mock] TradeView mock backend on http://127.0.0.1:${PORT} (auth ${AUTH ? 'on, password "secret"' : 'off'})`));
