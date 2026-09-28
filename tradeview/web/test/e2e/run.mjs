#!/usr/bin/env node
// End-to-end test of the REAL TradeView server (Fastify + SQLite + Next.js in-process) against a local fake Delta
// Exchange and a fake laya-serve, driven by Playwright/Chromium.
//
//   node web/test/e2e/run.mjs              boots fakes + backfill + `npm run dev` on a temp DB, runs every step
//   node web/test/e2e/run.mjs --prod       same, but `npm start` (needs `npm run build` first)
//   node web/test/e2e/run.mjs --only backfill,login,chart-live   run a subset of steps (names as printed)
//   E2E_KEEP=1 ...                         leave the server + fakes running at the end (prints the URLs)
//
// Screenshots go to web/test/screenshots/e2e-*.png. Exit code 1 if any step fails or the page logged any
// console error / page error.
import { spawn, execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { startFakeDelta } from './fake-delta.mjs';
import { startFakeLaya } from './fake-laya.mjs';

const require = createRequire(import.meta.url);
/** Playwright is not a project dependency: use a local install, else the global one (`npm i -g playwright`). */
function loadPlaywright() {
  try { return require('playwright'); } catch { /* not installed locally */ }
  try {
    const globalRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
    return require(path.join(globalRoot, 'playwright'));
  } catch {
    throw new Error('Playwright not found. Install it (npm i -g playwright && npx playwright install chromium) and retry.');
  }
}
const { chromium } = loadPlaywright();

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const OUT = path.resolve(HERE, '../screenshots');
const PROD = process.argv.includes('--prod');
const onlyArg = process.argv.indexOf('--only');
const ONLY = onlyArg > 0 ? new Set(process.argv[onlyArg + 1].split(',')) : null;
const PASSWORD = 'test123';
const SYMBOL = 'delta:BTCUSD';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);
const quiet = { info() {}, warn: (...a) => console.warn(...a), error: (...a) => console.error(...a) };

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

function run(cmd, args, { env, logFile, cwd = ROOT } = {}) {
  const out = logFile ? fs.openSync(logFile, 'a') : 'inherit';
  const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', out, out], detached: true });
  return child;
}

function waitExit(child) {
  return new Promise((resolve) => child.once('exit', (code) => resolve(code)));
}

async function waitHttp(url, timeoutMs = 180000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(url);
      if (r.ok) return true;
    } catch { /* not up yet */ }
    await sleep(500);
  }
  throw new Error(`timeout waiting for ${url}`);
}

// ------------------------------------------------------------------ results
const results = [];
const errors = [];
const shots = [];
let fatal = null;
async function step(name, fn, { critical = false } = {}) {
  if (ONLY && !ONLY.has(name)) return;
  if (fatal) {
    results.push({ name, ok: false, detail: `skipped (${fatal} failed)`, ms: 0 });
    log(`- ${name} ... skipped (${fatal} failed)`);
    return;
  }
  const t0 = Date.now();
  process.stdout.write(`- ${name} ... `);
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail, ms: Date.now() - t0 });
    log(`ok (${((Date.now() - t0) / 1000).toFixed(1)}s)${detail ? ` ${detail}` : ''}`);
  } catch (err) {
    results.push({ name, ok: false, detail: err.message, ms: Date.now() - t0 });
    log(`FAILED: ${err.message}`);
    if (critical) fatal = name;
    if (process.env.E2E_DEBUG) console.error(err);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tradeview-e2e-'));
  const dbPath = path.join(tmp, 'e2e.db');
  const serverLog = path.join(tmp, 'server.log');

  // ---------------------------------------------------------------- fakes
  const delta = await startFakeDelta({ port: Number(process.env.FAKE_DELTA_PORT || 0), log: quiet });
  const laya = await startFakeLaya({ port: Number(process.env.FAKE_LAYA_PORT || 0), p: 0.8, log: quiet });
  const port = Number(process.env.E2E_PORT) || (await freePort());
  const BASE = `http://localhost:${port}`;
  const env = {
    PORT: String(port),
    DB_PATH: dbPath,
    AUTH_PASSWORD: PASSWORD,
    SESSION_SECRET: 'e2e-session-secret-e2e-session-secret',
    AGENT_DRIVER: process.env.AGENT_DRIVER || 'off',
    LAYA_MODE: 'http',
    LAYA_URL: laya.url,
    DELTA_REST: delta.url,
    DELTA_WS: delta.wsUrl,
    DEFAULT_SYMBOLS: 'delta:BTCUSD,delta:ETHUSD,delta:SOLUSD',
    LOG_LEVEL: 'warn',
    NEXT_TELEMETRY_DISABLED: '1',
  };
  log(`fake delta ${delta.url} · fake laya ${laya.url} · db ${dbPath} · server log ${serverLog}`);

  // ---------------------------------------------------------------- backfill (real CLI against the fake)
  await step('backfill', async () => {
    const child = run('npm', ['run', 'backfill', '--', '--symbols', 'delta:BTCUSD', '--days', '30', '--tf', 'all', '--quiet'], { env, logFile: serverLog });
    const code = await waitExit(child);
    assert(code === 0, `backfill exited with ${code} (see ${serverLog})`);
    const text = fs.readFileSync(serverLog, 'utf8');
    const m = /(\d[\d,]*) bars stored, (\d+) failures/.exec(text);
    assert(m && m[2] === '0', `unexpected backfill summary: ${text.split('\n').slice(-4).join(' | ')}`);
    return `${m[1]} bars, 13 timeframes`;
  });

  // ---------------------------------------------------------------- server
  const server = run('npm', [PROD ? 'start' : 'run', ...(PROD ? [] : ['dev'])], { env, logFile: serverLog });
  let serverExited = false;
  server.once('exit', () => { serverExited = true; });
  const stopServer = async () => {
    if (serverExited) return;
    try { process.kill(-server.pid, 'SIGTERM'); } catch { /* gone */ }
    await Promise.race([waitExit(server), sleep(8000)]);
    try { process.kill(-server.pid, 'SIGKILL'); } catch { /* gone */ }
  };
  const cleanup = async () => {
    if (process.env.E2E_KEEP) return;
    await stopServer();
    await delta.close();
    await laya.close();
  };
  process.once('SIGINT', () => cleanup().then(() => process.exit(130)));

  let browser;
  try {
    await waitHttp(`${BASE}/api/health`);
    log(`server (${PROD ? 'production' : 'dev'}) up on ${BASE}`);
    // Warm the Next route so the first navigation does not time out in dev (compilation).
    await fetch(BASE).catch(() => {});

    browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1600, height: 940 }, deviceScaleFactor: 1 });
    await context.addInitScript(() => {
      // Keep the notifications API quiet; auto-deny so no prompt appears.
      try { Object.defineProperty(Notification, 'permission', { get: () => 'denied' }); } catch { /* ignore */ }
    });
    const page = await context.newPage();
    const traffic = { pineRuns: 0, klines: 0 };
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`[console] ${m.text()}`); });
    page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}\n${(e.stack || '').split('\n').slice(0, 4).join('\n')}`));
    page.on('request', (r) => { if (r.url().endsWith('/api/pine/run')) traffic.pineRuns++; });
    page.on('websocket', (ws) => {
      if (!ws.url().endsWith('/ws')) return;
      ws.on('framereceived', (f) => { if (typeof f.payload === 'string' && f.payload.startsWith('{"type":"kline"')) traffic.klines++; });
    });
    const shot = async (name) => {
      const file = path.join(OUT, `e2e-${name}.png`);
      await page.screenshot({ path: file });
      shots.push(`e2e-${name}.png`);
    };
    const chart = (expr) => page.evaluate(`(() => { const c = window.tradeview.layout.active; return ${expr}; })()`);
    const waitChart = (expr, timeout = 30000) => page.waitForFunction(`(() => { const c = window.tradeview && window.tradeview.layout.active; return c && (${expr}); })()`, null, { timeout, polling: 250 });
    const setTf = async (tf, label) => {
      await page.click('.tv-tb-more');
      await page.locator('.tv-menu .tv-menu-item', { hasText: new RegExp(`^${label}$`) }).first().click();
      await waitChart(`c.tf === '${tf}' && c.candles.length > 0 && !c._loadingOlder`, 45000);
    };

    // ---------------------------------------------------------------- login
    await step('login', async () => {
      await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 180000 });
      await page.waitForSelector('.login-screen .login-input', { timeout: 180000 });
      await shot('01-login');
      await page.fill('.login-input', PASSWORD);
      await page.click('.login-submit');
      await page.waitForSelector('.app .statusbar', { timeout: 60000 });
      await page.mouse.click(5, 900); // user gesture: unlock the alarm audio (dismisses the sound banner)
      const me = await page.evaluate(() => fetch('/api/auth/me').then((r) => r.json()));
      assert(me.authenticated === true, `auth/me after login: ${JSON.stringify(me)}`);
    }, { critical: true });

    // ---------------------------------------------------------------- chart + live
    await step('chart-live', async () => {
      await waitChart(`c.symbol === '${SYMBOL}' && c.candles.length > 100`, 60000);
      const serverRes = await page.evaluate((s) => fetch(`/api/candles?symbol=${s}&tf=1h&limit=3`).then((r) => r.json()), SYMBOL);
      const before = await chart('({ tf: c.tf, n: c.candles.length, last: c.candles[c.candles.length - 1] })');
      assert(Array.isArray(serverRes.candles) && serverRes.candles.length === 3, 'server /api/candles returned no candles');
      // Make the chart move: print a trade 0.3% above the current price and wait for the live candle to follow.
      const px = delta.price(SYMBOL);
      const target = Math.round(px * 1.003 * 2) / 2;
      await fetch(`${delta.url}/control/price`, { method: 'POST', body: JSON.stringify({ symbol: SYMBOL, price: target }) });
      await waitChart(`Math.abs(c.lastPrice - ${target}) < 5 || c.candles[c.candles.length - 1].h >= ${target}`, 20000);
      const k0 = traffic.klines;
      await sleep(3000);
      const after = await chart('({ n: c.candles.length, last: c.candles[c.candles.length - 1], status: c._statusKind || null })');
      assert(traffic.klines > k0, 'no kline messages over /ws in 3 s');
      await shot('02-chart-live');
      return `${before.n} bars (${before.tf}), last close ${before.last.c} -> ${after.last.c}, ${traffic.klines - k0} kline msgs/3s`;
    });

    // ---------------------------------------------------------------- timeframes
    await step('timeframes', async () => {
      const done = [];
      for (const [tf, label, min] of [['1m', '1 minute', 100], ['5m', '5 minutes', 100], ['1h', '1 hour', 100], ['12h', '12 hours', 30], ['1D', '1 day', 30], ['1W', '1 week', 3], ['1M', '1 month', 1], ['5s', '5 seconds', 1]]) {
        await setTf(tf, label);
        if (tf === '5s') await waitChart('c.candles.length >= 2', 20000);
        const st = await chart(`({ n: c.candles.length, first: c.candles[0].t, last: c.candles[c.candles.length - 1].t, ms: c.tfMs, gaps: c.candles.slice(1).filter((x, i) => x.t <= c.candles[i].t).length, bad: (() => { const i = c.candles.findIndex((x, j) => j > 0 && x.t <= c.candles[j - 1].t); return i > 0 ? [i, c.candles.length, c.candles[i - 1], c.candles[i]] : null; })() })`);
        assert(st.n >= min, `${tf}: only ${st.n} candles`);
        assert(st.gaps === 0, `${tf}: candles not strictly ascending (${st.gaps}): ${JSON.stringify(st.bad)}`);
        if (['1m', '5m', '1h', '12h', '1D'].includes(tf)) {
          const aligned = await chart(`c.candles.every((x) => x.t % c.tfMs === 0)`);
          assert(aligned, `${tf}: candle times not aligned to the timeframe`);
        }
        if (tf === '1W') assert(await chart(`c.candles.every((x) => new Date(x.t).getUTCDay() === 1)`), '1W bars do not open on Monday');
        if (tf === '1M') assert(await chart(`c.candles.every((x) => new Date(x.t).getUTCDate() === 1)`), '1M bars do not open on the 1st');
        await shot(`03-tf-${tf}`);
        done.push(`${tf}:${st.n}`);
      }
      // 12h derived from 6h must agree with the server's 1h data over the same window.
      const cmp = await page.evaluate(async (s) => {
        const h12 = (await fetch(`/api/candles?symbol=${s}&tf=12h&limit=3`).then((r) => r.json())).candles;
        const bar = h12[h12.length - 2];
        const h1 = (await fetch(`/api/candles?symbol=${s}&tf=1h&from=${bar.t}&to=${bar.t + 11 * 3600e3}`).then((r) => r.json())).candles;
        return { bar, n: h1.length, o: h1[0]?.o, c: h1[h1.length - 1]?.c, h: Math.max(...h1.map((x) => x.h)), l: Math.min(...h1.map((x) => x.l)) };
      }, SYMBOL);
      assert(cmp.n === 12 && cmp.o === cmp.bar.o && cmp.c === cmp.bar.c && cmp.h === cmp.bar.h && cmp.l === cmp.bar.l, `12h bar inconsistent with 1h bars: ${JSON.stringify(cmp)}`);
      await setTf('1m', '1 minute');
      return done.join(' ');
    });

    // ---------------------------------------------------------------- older history on scroll
    await step('history-scroll', async () => {
      await setTf('1h', '1 hour');
      const n0 = await chart('c.candles.length');
      // Scroll to the left edge like a user dragging the chart: older bars are fetched and prepended.
      const before = await page.evaluate(async () => {
        const ts = window.tradeview.layout.active.chart.timeScale();
        ts.setVisibleLogicalRange({ from: 2, to: 150 });
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); // applied on the next frame
        const r = ts.getVisibleRange();
        return { from: r.from, to: r.to };
      });
      await waitChart(`c.candles.length > ${n0}`, 20000);
      await sleep(500);
      const after = await chart(`(() => { const r = c.chart.timeScale().getVisibleRange(); return { n: c.candles.length, from: r.from, to: r.to, asc: c.candles.every((x, i) => i === 0 || x.t > c.candles[i - 1].t) }; })()`);
      assert(after.asc, 'candles not ascending after loading older history');
      assert(Math.abs(after.from - before.from) <= 3600 * 3 && Math.abs(after.to - before.to) <= 3600 * 3, `view jumped when older history loaded: ${JSON.stringify({ before, after })}`);
      await page.evaluate(() => window.tradeview.layout.active._jumpToLatest());
      await setTf('1m', '1 minute');
      return `${n0} -> ${after.n} bars, view stayed on ${new Date(before.from * 1000).toISOString().slice(0, 13)}`;
    });

    // ---------------------------------------------------------------- footprint
    await step('footprint', async () => {
      await page.evaluate(() => window.tradeview.layout.active.setChartType('footprint'));
      await waitChart(`c.chartType === 'footprint' && c._fp && c._fp.size > 0`, 30000);
      await sleep(2500);
      const fp = await chart('({ bars: c._fp.size, last: [...c._fp.values()].pop() })');
      assert(fp.last && Array.isArray(fp.last.levels) && fp.last.levels.length > 0, 'footprint bar without levels');
      await shot('04-footprint');
      await page.evaluate(() => window.tradeview.layout.active.setChartType('candles'));
      return `${fp.bars} recorded bars, last has ${fp.last.levels.length} levels, delta ${fp.last.delta}`;
    });

    // ---------------------------------------------------------------- symbol search
    await step('symbol-search', async () => {
      await page.click('#chart-root', { position: { x: 400, y: 300 } }).catch(() => {});
      await page.keyboard.press('/');
      await page.waitForSelector('.dialog-search .search-row', { timeout: 10000 });
      await page.waitForTimeout(500);
      const names = await page.$$eval('.dialog-search .search-row .sym-name', (els) => els.map((e) => e.textContent));
      for (const s of ['BTCUSD', 'ETHUSD', 'SOLUSD']) assert(names.includes(s), `symbol search misses ${s} (got ${names.join(',')})`);
      await page.keyboard.type('ETH');
      await page.waitForTimeout(600);
      await shot('05-symbol-search');
      await page.keyboard.press('Enter');
      await waitChart(`c.symbol === 'delta:ETHUSD' && c.candles.length > 50`, 30000);
      await page.evaluate(() => window.tradeview.layout.active.setSymbol('delta:BTCUSD'));
      await waitChart(`c.symbol === '${SYMBOL}' && c.candles.length > 50`, 30000);
      return names.join(', ');
    });

    // ---------------------------------------------------------------- RSI via Pine route
    await step('rsi-indicator', async () => {
      const runs0 = traffic.pineRuns;
      await page.click('.tv-tb-ind');
      await page.waitForSelector('.dialog-search .search-input');
      await page.click('.dialog-search .tab >> text=Pine library');
      await page.waitForSelector('.dialog-search .ind-row');
      await page.fill('.dialog-search .search-input', 'Relative Strength');
      await page.waitForTimeout(300);
      await page.click('.dialog-search .ind-row >> nth=0');
      await page.keyboard.press('Escape');
      await waitChart(`c.listIndicators().some((i) => /rsi/i.test(i.builtin || i.title) && i.status === 'pine')`, 30000);
      assert(traffic.pineRuns > runs0, 'no POST /api/pine/run request was made');
      const ind = await chart(`c.listIndicators().map((i) => i.title + ':' + i.status + (i.error ? ' ' + i.error : '')).join(', ')`);
      await sleep(500);
      await shot('06-rsi');
      return ind;
    });

    // ---------------------------------------------------------------- Pine editor
    await step('pine-editor', async () => {
      await page.click('.bottom-tab[data-tab="pine"]');
      await page.waitForSelector('.pine-editor .monaco-editor', { timeout: 90000 });
      await page.evaluate(() => window.tradeview.pine.setSource('//@version=6\nindicator("E2E Mid", overlay=true)\nplot(ta.sma(hl2, 30), "Mid", color=color.orange)\n', 'E2E Mid'));
      const runs0 = traffic.pineRuns;
      await page.click('.pine-toolbar .btn-primary');
      await waitChart(`c.listIndicators().some((i) => i.title === 'E2E Mid' && i.status === 'pine')`, 30000);
      assert(traffic.pineRuns > runs0, 'Pine editor did not call /api/pine/run');
      await sleep(600);
      await shot('07-pine-editor');
      return await chart(`c.listIndicators().map((i) => i.title).join(', ')`);
    });

    // ---------------------------------------------------------------- strategy tester
    await step('strategy-tester', async () => {
      await page.click('.bottom-tab[data-tab="tester"]');
      await page.waitForSelector('.tester-form select');
      await page.waitForFunction(() => [...document.querySelectorAll('.tester-form select option')].some((o) => o.value === 'lib:strategy_ema_cross'), null, { timeout: 15000 });
      await page.selectOption('.tester-form select >> nth=0', 'lib:strategy_ema_cross');
      await page.click('.tester-form .btn-primary');
      await page.waitForSelector('.tester-summary, .tester-error', { timeout: 60000 });
      const err = await page.$eval('.tester-error', (e) => e.textContent).catch(() => null);
      assert(!err, `backtest failed: ${err}`);
      const summary = await page.$eval('.tester-summary', (e) => e.innerText.replace(/\s+/g, ' '));
      const trades = await page.evaluate(() => window.tradeview.tester.result.trades.length);
      assert(trades > 0, 'backtest produced no trades');
      await sleep(800);
      await shot('08-strategy-tester');
      return `${trades} trades · ${summary.slice(0, 120)}`;
    });

    // ---------------------------------------------------------------- alerts (Laya gate)
    const createAlertViaUi = async (name, offsetPct) => {
      if (await page.locator('.pane-alerts').isHidden()) await page.click('.side-tab[data-tab="alerts"]');
      const px = delta.price(SYMBOL);
      const level = Math.round(px * (1 + offsetPct) * 2) / 2;
      await page.click('.pane-alerts .btn-primary >> text=Create');
      await page.waitForSelector('.dialog-alert');
      const dlg = page.locator('.dialog-alert');
      await dlg.locator('.cond-box select').selectOption('crosses_up');
      await dlg.locator('.cond-box input.num').first().fill(String(level));
      await dlg.locator('input[placeholder="Alert name (optional)"]').fill(name);
      if (!(await dlg.locator('label.switch input[type=checkbox]').isChecked())) await dlg.locator('label.switch').click();
      assert(await dlg.locator('label.switch input[type=checkbox]').isChecked(), 'Laya gate switch did not turn on');
      await dlg.locator('.laya-body').scrollIntoViewIfNeeded();
      await page.waitForTimeout(300); // switch transition
      await shot(`09-alert-dialog-${name.replace(/\W+/g, '-').toLowerCase()}`);
      await dlg.locator('.btn-primary', { hasText: 'Create' }).click();
      await page.waitForSelector('.dialog-alert', { state: 'detached', timeout: 10000 });
      const alerts = await page.evaluate(() => fetch('/api/alerts').then((r) => r.json()));
      const a = alerts.alerts.find((x) => x.name === name);
      assert(a && a.status === 'active', `alert "${name}" not stored as active: ${JSON.stringify(alerts).slice(0, 300)}`);
      assert(a.laya && a.laya.enabled === true, `alert "${name}" was created without the Laya gate`);
      return { a, level };
    };
    const cross = async (level) => {
      await fetch(`${delta.url}/control/price`, { method: 'POST', body: JSON.stringify({ symbol: SYMBOL, price: level - 20, pause: true }) });
      await sleep(700);
      await fetch(`${delta.url}/control/price`, { method: 'POST', body: JSON.stringify({ symbol: SYMBOL, price: level + 20 }) });
    };

    await step('alert-laya-reject', async () => {
      laya.setP(0.3);
      const calls0 = laya.state.calls.length;
      const { a, level } = await createAlertViaUi('E2E reject', 0.002);
      await cross(level);
      await page.waitForSelector('.toast >> text=/Laya rejected/', { timeout: 20000 });
      assert(laya.state.calls.length > calls0, 'fake laya-serve was never called');
      await sleep(300);
      await shot('10-alert-laya-rejected');
      const fired = await page.$('.dialog-fired');
      assert(!fired, 'alarm modal opened although Laya rejected');
      const after = (await page.evaluate(() => fetch('/api/alerts').then((r) => r.json()))).alerts.find((x) => x.id === a.id);
      assert(after.status === 'active' && after.lastCheck?.laya?.passed === false, `rejected alert state: ${JSON.stringify(after).slice(0, 300)}`);
      const q = laya.state.calls.at(-1);
      assert(q.questions.decision?.type === 'noul' && q.state.symbol === SYMBOL, 'laya request has the wrong shape');
      await fetch(`${delta.url}/control/pause`, { method: 'POST', body: JSON.stringify({ paused: false }) });
      await page.evaluate((id) => fetch(`/api/alerts/${id}`, { method: 'DELETE' }), a.id);
      return `P=${after.lastCheck.laya.p} < 0.6 at ${after.lastCheck.price}, rejection toast shown`;
    });

    await step('alert-laya-fire', async () => {
      laya.setP(0.8);
      await sleep(1000);
      const { a, level } = await createAlertViaUi('E2E fire', 0.002);
      await cross(level);
      await page.waitForSelector('.dialog-fired .fired-laya', { timeout: 25000 });
      const txt = await page.$eval('.dialog-fired', (e) => e.innerText.replace(/\s+/g, ' '));
      assert(/P\(true\) 80\.0%/.test(txt), `modal lacks the Laya P: ${txt}`);
      assert(/bullish/i.test(txt), `modal lacks the Laya direction: ${txt}`);
      const playing = await page.evaluate(() => window.tradeview.alarm.playing);
      await sleep(400);
      await shot('11-alert-fired');
      const ev = (await page.evaluate(() => fetch('/api/alerts/events').then((r) => r.json()))).events.find((e) => e.alertId === a.id);
      assert(ev && ev.laya && ev.laya.passed === true, `event not persisted with laya: ${JSON.stringify(ev)}`);
      await page.click('.dialog-fired .btn-danger');
      await fetch(`${delta.url}/control/pause`, { method: 'POST', body: JSON.stringify({ paused: false }) });
      const st = (await page.evaluate(() => fetch('/api/alerts').then((r) => r.json()))).alerts.find((x) => x.id === a.id);
      assert(st.status === 'triggered', `alert status after fire: ${st.status}`);
      await page.click('.bottom-tab[data-tab="alertlog"]');
      await sleep(600);
      await shot('12-alert-log');
      return `fired at ${ev.price} (level ${level}), P=${ev.laya.p}, alarm playing=${playing}`;
    });

    // ---------------------------------------------------------------- drawings persist
    await step('drawings-persist', async () => {
      await page.evaluate(() => window.tradeview.layout.active.clearDrawings());
      await page.evaluate(() => window.tradeview.layout.active.setDrawingTool('trendline'));
      const box = await page.locator('.tv-chart-canvas, .tv-chart canvas').first().boundingBox();
      const x0 = box.x + box.width * 0.35;
      const x1 = box.x + box.width * 0.7;
      await page.mouse.move(x0 - 20, box.y + box.height * 0.5);
      await page.mouse.click(x0, box.y + box.height * 0.55);
      await page.mouse.move((x0 + x1) / 2, box.y + box.height * 0.4, { steps: 5 });
      await page.mouse.click(x1, box.y + box.height * 0.3);
      await page.waitForTimeout(800);
      await page.evaluate(() => window.tradeview.layout.active.draw({ type: 'horizontal_line', points: [{ t: Date.now(), price: window.tradeview.layout.active.lastPrice }], text: 'E2E level' }));
      await page.waitForTimeout(1200);
      const n = await chart('c.listDrawings().length');
      assert(n === 2, `expected 2 drawings, got ${n}: ${await chart('JSON.stringify(c.listDrawings().map((d) => d.tool || d.type))')}`);
      const stored = await page.evaluate((s) => fetch(`/api/drawings?symbol=${s}`).then((r) => r.json()), SYMBOL);
      assert(stored.drawings.length === 2, `server has ${stored.drawings.length} drawings`);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.app .statusbar', { timeout: 120000 });
      await waitChart(`c.candles.length > 50 && c.listDrawings().length === 2`, 30000);
      const types = await chart('c.listDrawings().map((d) => d.tool || d.type).sort().join(",")');
      await sleep(800);
      await shot('13-drawings-after-reload');
      return types;
    });

    // ---------------------------------------------------------------- layout 4
    await step('layout-4', async () => {
      await page.click('.tv-tb-layout');
      await page.click('.tv-layout-opt[title="4 charts"]');
      await page.waitForFunction(() => window.tradeview.layout.charts.length === 4 && window.tradeview.layout.charts.every((c) => c.candles.length > 20), null, { timeout: 60000 });
      await sleep(1500);
      await shot('14-layout-4');
      const syms = await page.evaluate(() => window.tradeview.layout.charts.map((c) => `${c.symbol}/${c.tf}:${c.candles.length}`).join(' '));
      await page.click('.tv-tb-layout');
      await page.click('.tv-layout-opt[title="1 chart"]');
      await page.waitForFunction(() => window.tradeview.layout.charts.length === 1, null, { timeout: 10000 });
      return syms;
    });

    // ---------------------------------------------------------------- replay
    await step('replay', async () => {
      await setTf('1h', '1 hour');
      await page.click('.bottom-tab[data-tab="replay"]');
      await page.waitForSelector('.replay-controls .btn-primary');
      if (process.env.E2E_DEBUG) {
        await page.evaluate(() => {
          const c = window.tradeview.layout.active;
          window.__dbg = [];
          const orig = c._loadOlder.bind(c);
          c._loadOlder = async () => { window.__dbg.push(`loadOlder n=${c.candles.length} replay=${c.replay.active} lr=${JSON.stringify(c.chart.timeScale().getVisibleLogicalRange())}`); const r = await orig(); window.__dbg.push(`  -> n=${c.candles.length} lr=${JSON.stringify(c.chart.timeScale().getVisibleLogicalRange())}`); return r; };
          c.on('replay', () => window.__dbg.push(`replay idx=${c.replay.index} n=${c.candles.length} disp=${c._display.length} lr=${JSON.stringify(c.chart.timeScale().getVisibleLogicalRange())}`));
        });
      }
      await page.click('.replay-controls .btn-ghost >> text=Visible range');
      await waitChart('c.replay.active', 15000);
      const s0 = await chart('c.replay.snapshot()');
      await page.click('.tv-replay-bar .tv-rb-btn[title^="Step forward"]');
      await page.click('.tv-replay-bar .tv-rb-btn[title^="Step forward"]');
      const s1 = await chart('c.replay.snapshot()');
      assert(s1.index === s0.index + 2, `step forward: ${s0.index} -> ${s1.index}`);
      await page.fill('.replay-trade input.num', '2');
      await page.click('.tv-replay-bar .tv-rb-buy');
      await page.click('.tv-replay-bar .tv-rb-btn[title^="Step forward"]');
      await page.click('.tv-replay-bar .tv-rb-btn[title^="Step forward"]');
      const pos = await chart('c.replay.positions.map((p) => p.side + " " + p.qty).join(",")');
      assert(pos === 'long 2', `position after quick Buy: ${pos}`);
      await page.selectOption('.tv-replay-bar .tv-rb-speed', '10');
      await page.click('.tv-replay-bar .tv-rb-play');
      await sleep(2500);
      await page.click('.tv-replay-bar .tv-rb-play');
      const s2 = await chart('c.replay.snapshot()');
      assert(s2.index > s1.index + 2, `play did not advance (${s1.index} -> ${s2.index})`);
      // The chart must show the replay head (last displayed bar = replay bar, and it is inside the visible range).
      const view = await chart(`(() => { const r = c.chart.timeScale().getVisibleRange(); const d = c._display[c._display.length - 1]; return { head: c.replay.candle.t, last: d.t, from: r && r.from * 1000, to: r && r.to * 1000 }; })()`);
      if (process.env.E2E_DEBUG) console.log(await page.evaluate(() => window.__dbg.join('\n')));
      assert(view.last === view.head && view.to >= view.head && view.from <= view.head, `replay view does not show the replay bar: ${JSON.stringify(view)}`);
      await sleep(400);
      await shot('15-replay');
      await page.click('.replay-trade .btn-block');
      const trades = await chart('c.replay.pnl.trades');
      assert(trades === 1, `closed trades: ${trades}`);
      await page.click('.tv-replay-bar .tv-rb-exit');
      await waitChart('!c.replay.active', 5000);
      return `index ${s0.index} -> ${s2.index}, 1 paper trade closed`;
    });

    // ---------------------------------------------------------------- hardening: XSS guards
    await step('xss-guards', async () => {
      const payload = 'delta:<img src=x onerror="window.__xss=1">';
      // Agent chart commands (set_symbol) only accept symbol keys.
      const cmd = await page.evaluate((p) => window.tradeview.layout.executeCommand({ action: 'set_symbol', symbol: p }).then(() => 'accepted', (e) => e.message), payload);
      assert(/Invalid symbol/.test(cmd), `malicious set_symbol was not rejected: ${cmd}`);
      assert((await chart('c.symbol')) === SYMBOL, 'symbol changed by a rejected command');
      // Even if a bad symbol got in (old saved layout), the legend and toolbar render it as text.
      const res = await page.evaluate(async (p) => {
        const c = window.tradeview.layout.active;
        const prev = c.symbol;
        c.symbol = p;
        c._refreshLegend();
        window.tradeview.layout.toolbar?._renderState();
        await new Promise((r) => setTimeout(r, 300));
        const imgs = document.querySelectorAll('.tv-legend img, .tv-toolbar img, .tv-tb-symname img').length;
        const text = document.querySelector('.tv-lg-sym')?.textContent || '';
        c.symbol = prev;
        c._refreshLegend();
        window.tradeview.layout.toolbar?._renderState();
        return { imgs, text, xss: window.__xss ?? null };
      }, payload);
      assert(res.imgs === 0 && res.xss === null, `symbol markup was rendered as HTML: ${JSON.stringify(res)}`);
      assert(res.text.includes('<img'), `legend did not show the escaped text: ${res.text}`);
      return 'set_symbol rejected, legend/toolbar escape symbol names';
    });

    // ---------------------------------------------------------------- hardening: deep scroll-back on 1m
    await step('history-20k', async () => {
      await setTf('1m', '1 minute');
      await page.evaluate(() => window.tradeview.layout.active._jumpToLatest());
      const reqs = [];
      const onReq = (r) => { if (r.url().includes('/api/candles')) reqs.push(new URL(r.url()).searchParams); };
      page.on('request', onReq);
      const pine0 = traffic.pineRuns;
      const pageMs = [];
      try {
        for (let i = 0; i < 20; i++) {
          const n0 = await chart('c.candles.length');
          if (n0 >= 20000) break;
          const t0 = Date.now();
          await page.evaluate(() => window.tradeview.layout.active.chart.timeScale().setVisibleLogicalRange({ from: 2, to: 300 }));
          await waitChart(`c.candles.length > ${n0} && !c._loadingOlder`, 20000);
          pageMs.push(Date.now() - t0);
        }
      } finally {
        page.off('request', onReq);
      }
      const n = await chart('c.candles.length');
      assert(n >= 20000, `only ${n} bars after paging`);
      assert(reqs.length === pageMs.length, `${reqs.length} /api/candles requests for ${pageMs.length} pages (refetching?)`);
      assert(reqs.every((q) => q.get('to') && Number(q.get('limit')) <= 2000 && !q.get('from')), `a page request was not an incremental "to=" page: ${reqs.map((q) => q.toString()).join(' | ')}`);
      // Smoothness: pan across the loaded history and time the frames.
      const frames = await page.evaluate(async () => {
        const ts = window.tradeview.layout.active.chart.timeScale();
        const deltas = [];
        let last = performance.now();
        for (let k = 0; k < 90; k++) {
          ts.scrollToPosition(-k * 200, false);
          await new Promise((r) => requestAnimationFrame(r));
          const now = performance.now();
          deltas.push(now - last);
          last = now;
        }
        deltas.sort((a, b) => a - b);
        return { p50: deltas[Math.floor(deltas.length / 2)], p95: deltas[Math.floor(deltas.length * 0.95)], max: deltas[deltas.length - 1] };
      });
      assert(frames.p95 < 120, `panning 20k bars is janky: ${JSON.stringify(frames)}`);
      // Pine indicators are evaluated server-side on the newest 5000 bars: paging must not re-run them per page.
      await sleep(900); // debounce window
      const inds = await chart('c.listIndicators().filter((i) => i.status === "pine").length');
      assert(traffic.pineRuns - pine0 <= 2 * Math.max(1, inds), `${traffic.pineRuns - pine0} Pine runs while paging ${pageMs.length} pages with ${inds} Pine indicators`);
      const asc = await chart('c.candles.every((x, i) => i === 0 || x.t > c.candles[i - 1].t)');
      assert(asc, 'candles not ascending after deep paging');
      await page.evaluate(() => window.tradeview.layout.active._jumpToLatest());
      pageMs.sort((a, b) => a - b);
      return `${n} bars in ${pageMs.length} pages (page p50 ${pageMs[Math.floor(pageMs.length / 2)]} ms, max ${pageMs.at(-1)} ms), ${traffic.pineRuns - pine0} pine runs, pan frames p50 ${frames.p50.toFixed(1)} / p95 ${frames.p95.toFixed(1)} / max ${frames.max.toFixed(1)} ms`;
    });

    // ---------------------------------------------------------------- hardening: zoomed-out footprint
    await step('footprint-zoomed-out', async () => {
      await page.evaluate(() => window.tradeview.layout.active.setChartType('footprint'));
      await waitChart(`c.chartType === 'footprint'`, 10000);
      // Synthetic footprint for the last 3000 bars (Delta footprint only exists since recording started).
      await page.evaluate(() => {
        const c = window.tradeview.layout.active;
        const bars = c.candles.slice(-3000);
        for (const b of bars) {
          if (c._fp.has(b.t)) continue;
          // Worst case: a fine bucket (~800 levels per bar), as with FOOTPRINT_TICK_MULT=1 on higher timeframes.
          const tick = Math.max((b.h - b.l) / 800, 1e-6);
          const levels = [];
          for (let i = 0; i < 800; i++) {
            const p = b.l + i * tick;
            levels.push({ p, bid: (i * 7) % 13, ask: (i * 11) % 17 });
          }
          const vol = levels.reduce((a, l) => a + l.bid + l.ask, 0);
          c._fp.set(b.t, { t: b.t, levels, poc: levels[0]?.p, delta: 0, volume: vol, tick });
        }
        c._rebuild();
        const proto = CanvasRenderingContext2D.prototype;
        if (!proto.__fillTextCount) {
          const orig = proto.fillText;
          const origRect = proto.fillRect;
          proto.__fillTextCount = true;
          window.__fillText = 0;
          window.__fillRect = 0;
          proto.fillText = function (...a) { window.__fillText++; return orig.apply(this, a); };
          proto.fillRect = function (...a) { window.__fillRect++; return origRect.apply(this, a); };
        }
      });
      const measure = (bars) => page.evaluate(async (count) => {
        const c = window.tradeview.layout.active;
        const ts = c.chart.timeScale();
        const n = c._display.length;
        ts.setVisibleLogicalRange({ from: n - count, to: n + 2 });
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const avgLevels = c._display.slice(-count).reduce((a, b) => a + (c._fp.get(b.t)?.levels.length || 0), 0) / count;
        window.__fillText = 0;
        window.__fillRect = 0;
        const deltas = [];
        let last = performance.now();
        for (let k = 0; k < 30; k++) {
          ts.scrollToPosition(-(k % 3), false);
          await new Promise((r) => requestAnimationFrame(r));
          const now = performance.now();
          deltas.push(now - last);
          last = now;
        }
        deltas.sort((a, b) => a - b);
        return { count, spacing: ts.options().barSpacing, avgLevels, fillTextPerFrame: window.__fillText / 30, fillRectPerFrame: window.__fillRect / 30, p95: deltas[Math.floor(deltas.length * 0.95)] };
      }, bars);
      const heat = await measure(250);
      await shot('17-footprint-zoomed-out');
      const far = await measure(3000);
      await page.evaluate(() => window.tradeview.layout.active.setChartType('candles'));
      // Text per level would be ~2 x levels x bars (tens of thousands); axis labels are a few dozen.
      for (const r of [heat, far]) {
        assert(r.fillTextPerFrame < 300, `footprint drew text per level when zoomed out: ${JSON.stringify(r)}`);
        assert(r.p95 < 120, `footprint frames too slow zoomed out: ${JSON.stringify(r)}`);
      }
      assert(heat.avgLevels >= 5, `synthetic footprint too thin: ${JSON.stringify(heat)}`);
      assert(heat.spacing >= 3 && heat.fillRectPerFrame > heat.count * 5, `250 bars did not render heat cells: ${JSON.stringify(heat)}`);
      // Heat rows are aggregated to pixel rows: bounded by bars x chart height, not bars x levels (200k).
      assert(heat.fillRectPerFrame < heat.count * 300, `heat cells not aggregated: ${JSON.stringify(heat)}`);
      const f = (r) => `${r.count} bars (${r.avgLevels.toFixed(0)} levels/bar, spacing ${r.spacing.toFixed(1)}px): ${r.fillTextPerFrame.toFixed(0)} fillText + ${r.fillRectPerFrame.toFixed(0)} fillRect/frame, p95 ${r.p95.toFixed(1)} ms`;
      return `${f(heat)}; ${f(far)}`;
    });

    // ---------------------------------------------------------------- status bar / agent off
    await step('status-and-agent', async () => {
      const text = await page.$eval('.statusbar', (e) => e.innerText.replace(/\s+/g, ' '));
      await page.click('.side-tab[data-tab="chat"]');
      await sleep(800);
      const chatText = await page.$eval('.pane-chat', (e) => e.innerText.replace(/\s+/g, ' '));
      await shot('16-agent-off');
      assert(/Delta/i.test(text), `status bar lacks Delta badge: ${text}`);
      assert(/disabled|off|not available|unavailable/i.test(chatText), `chat panel does not explain the agent is off: ${chatText.slice(0, 200)}`);
      return text.slice(0, 160);
    });

    await context.close();
  } finally {
    await browser?.close().catch(() => {});
    if (process.env.E2E_KEEP) log(`\nE2E_KEEP: server ${BASE} (pid ${server.pid}), fake delta ${delta.url}, fake laya ${laya.url}`);
    await cleanup();
  }

  // ---------------------------------------------------------------- report
  const failed = results.filter((r) => !r.ok);
  log(`\n${results.length - failed.length}/${results.length} steps passed${PROD ? ' (production build)' : ' (dev server)'}`);
  log(`screenshots: ${shots.join(', ')}`);
  log(`${errors.length} console/page errors`);
  for (const e of errors) log(' -', e.slice(0, 800));
  if (failed.length || errors.length) {
    log(`server log: ${serverLog}`);
    process.exitCode = 1;
  } else if (!process.env.E2E_KEEP) {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
