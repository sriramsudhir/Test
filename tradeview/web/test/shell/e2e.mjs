// Playwright smoke test of the app shell against the mock backend.
//   node web/test/shell/mock-server.mjs &
//   (cd web && TRADEVIEW_API_PROXY=http://127.0.0.1:8787 npx next dev -p 3100) &
//   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node web/test/shell/e2e.mjs
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const { chromium } = pw;

const BASE = process.env.BASE_URL || 'http://localhost:3100';
const MOCK = process.env.MOCK_URL || 'http://127.0.0.1:8787';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../screenshots');
const only = process.argv[2] || 'all';

const errors = [];
const shot = async (page, name) => { await page.screenshot({ path: path.join(OUT, `shell-${name}.png`) }); console.log('  screenshot', name); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function newPage(browser, viewport = { width: 1600, height: 940 }) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[console] ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}\n${e.stack || ''}`));
  return page;
}

async function main() {
  const browser = await chromium.launch();
  await fetch(`${MOCK}/api/_test/auth?on=0`);
  if (only === 'all' || only === 'main') {
    const page = await newPage(browser);
    await page.addInitScript(() => { try { localStorage.clear(); } catch { /* ignore */ } });
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.app .statusbar', { timeout: 60000 });
    await sleep(3500);
    await shot(page, '01-main');

    await page.mouse.click(800, 400); // unlock sound (banner)
    await sleep(300);
    await page.keyboard.press('e');
    await page.waitForSelector('.dialog-search .search-row', { timeout: 10000 });
    await page.keyboard.type('TH');
    await sleep(500);
    await shot(page, '02-symbol-search');
    await page.keyboard.press('Enter');
    await sleep(1200);

    await page.click('.side-tab[data-tab="alerts"]');
    await sleep(600);
    await shot(page, '03-alerts');

    await page.keyboard.press('Alt+A');
    await page.waitForSelector('.dialog-alert', { timeout: 5000 });
    await sleep(300);
    await shot(page, '04-alert-dialog');
    await page.keyboard.press('Escape');
    await sleep(300);

    await page.click('.side-tab[data-tab="chat"]');
    await sleep(300);
    await shot(page, '05a-chat-empty');
    await page.click('.suggestion >> nth=1');
    await page.waitForFunction(() => !document.querySelector('.chat-send.stop'), null, { timeout: 20000 });
    await sleep(600);
    await shot(page, '05-chat');
    const drawn = await page.evaluate(() => window.tradeview.layout.active?.listDrawings?.().length ?? -1);
    console.log('  drawings on chart after agent:', drawn);

    await page.click('.bottom-tab[data-tab="pine"]');
    await page.waitForSelector('.pine-editor .monaco-editor', { timeout: 60000 });
    await sleep(800);
    await shot(page, '06-pine');
    // compile error -> marker
    await page.evaluate(() => window.tradeview.pine.setSource('//@version=6\nindicator("Bad")\nx = foo + 1\nplot(x)\n', 'Bad script'));
    await page.click('.pine-toolbar .btn-primary');
    await sleep(1200);
    await shot(page, '06b-pine-error');
    const markers = await page.$$eval('.pine-editor .squiggly-error', (els) => els.length);
    console.log('  error squiggles:', markers);
    await page.evaluate(() => window.tradeview.pine.setSource('//@version=6\nindicator("My SMA", overlay=true)\nplot(ta.sma(close, 20), "SMA")\n', 'My SMA'));
    await page.click('.pine-toolbar .btn-primary');
    await sleep(1500);

    await page.click('.bottom-tab[data-tab="tester"]');
    await sleep(500);
    await page.click('.tester-form .btn-primary');
    await page.waitForSelector('.tester-summary', { timeout: 20000 });
    await sleep(1200);
    await shot(page, '07-tester');
    await page.click('.tester-head .tab >> nth=1');
    await sleep(400);
    await shot(page, '07b-tester-trades');

    await page.click('.bottom-tab[data-tab="replay"]');
    await sleep(500);
    await shot(page, '08-replay');
    await page.keyboard.press('Alt+R');
    await sleep(2500);
    await page.click('.btn-buy').catch(() => {});
    await sleep(800);
    await shot(page, '08b-replay-active');

    await page.click('.bottom-tab[data-tab="alertlog"]');
    await sleep(500);
    await shot(page, '09-alert-log');

    await page.click('.side-tab[data-tab="objects"]');
    await sleep(500);
    await shot(page, '10-object-tree');
    await page.click('.side-tab[data-tab="data"]');
    await page.mouse.move(700, 350);
    await sleep(400);
    await page.mouse.move(720, 360);
    await sleep(400);
    await shot(page, '11-data-window');

    await fetch(`${MOCK}/api/_test/reject?id=a1`);
    await sleep(800);
    await fetch(`${MOCK}/api/_test/fire?id=a1`);
    await page.waitForSelector('.dialog-fired', { timeout: 10000 });
    await sleep(600);
    const playing = await page.evaluate(() => window.tradeview.alarm.playing);
    console.log('  alarm playing:', playing);
    await shot(page, '12-alert-fired');
    await page.click('.dialog-fired .btn-danger');
    await sleep(300);
    console.log('  alarm after ack:', await page.evaluate(() => window.tradeview.alarm.playing));

    await page.setViewportSize({ width: 860, height: 900 });
    await sleep(800);
    await shot(page, '13-narrow');
    await page.setViewportSize({ width: 390, height: 844 });
    await sleep(800);
    await shot(page, '14-mobile');
    await page.context().close();
  }

  if (only === 'all' || only === 'login') {
    await fetch(`${MOCK}/api/_test/auth?on=1`);
    const page = await newPage(browser, { width: 1280, height: 800 });
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.login-screen', { timeout: 60000 });
    await sleep(400);
    await shot(page, '15-login');
    await page.fill('.login-input', 'wrong');
    await page.click('.login-submit');
    await sleep(700);
    await shot(page, '15b-login-error');
    await page.fill('.login-input', 'secret');
    await page.click('.login-submit');
    await page.waitForSelector('.app .statusbar', { timeout: 30000 });
    await sleep(2500);
    await shot(page, '16-after-login');
    await fetch(`${MOCK}/api/_test/auth?on=0`);
    await page.context().close();
  }

  await browser.close();
  // Ignore failures we provoke on purpose (401 during login, mock push key).
  const relevant = errors.filter((e) => !/401|Unauthorized|favicon/i.test(e));
  console.log(`\n${relevant.length} console/page errors`);
  for (const e of relevant) console.log(' -', e.slice(0, 600));
}

main().catch((err) => { console.error(err); process.exit(1); });
