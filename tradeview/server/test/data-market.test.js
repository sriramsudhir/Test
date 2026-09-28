import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { Readable } from 'node:stream';
import { initDb } from '../src/db/index.js';
import { BybitRest, RateLimiter } from '../src/bybit/rest.js';
import { MarketData } from '../src/data/market.js';
import { runGapfill } from '../src/data/gapfill.js';
import {
  Backfiller, parseTradeDump, detectColumns, parseDumpLine, normalizeTimestamp, dumpUrls, parseTfList, resolveSymbols, runPool,
} from '../src/data/backfill.js';
import { floorTime, addBars } from '../src/data/timeframes.js';

const quiet = { info() {}, warn() {}, debug() {}, error() {} };
/** Deterministic synthetic price for bar open time t. */
function synthBar(t) {
  const base = 60000 + Math.sin(t / 3.6e6) * 500;
  const o = Math.round(base * 10) / 10;
  const c = Math.round((base + Math.cos(t / 1.8e6) * 20) * 10) / 10;
  return { t, o, h: Math.max(o, c) + 5, l: Math.min(o, c) - 5, c, v: 10 + (t / 60000) % 7, qv: 600000 };
}

/**
 * Fake Bybit REST backend (as a fetch implementation) serving realistic v5 JSON: kline pages are
 * DESCENDING arrays of strings, like the real API.
 * @param {{ now: () => number, listedAt?: number, failFirst?: number, rateLimitFirst?: number }} opts
 */
function fakeBybitFetch({ now, listedAt = 0, failFirst = 0, rateLimitFirst = 0 } = {}) {
  const calls = [];
  let failures = failFirst;
  let limited = rateLimitFirst;
  const tfOf = { 1: '1m', 3: '3m', 5: '5m', 15: '15m', 30: '30m', 60: '1h', 120: '2h', 240: '4h', 360: '6h', 720: '12h', D: '1D', W: '1W', M: '1M' };
  const json = (obj, status = 200) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: new Map(),
    text: async () => JSON.stringify(obj),
  });
  const fn = async (url) => {
    const u = new URL(url);
    const q = Object.fromEntries(u.searchParams);
    calls.push({ path: u.pathname, q });
    if (failures > 0) {
      failures--;
      throw new TypeError('fetch failed');
    }
    if (limited > 0) {
      limited--;
      return json({ retCode: 10006, retMsg: 'Too many visits!', result: {}, time: now() });
    }
    if (u.pathname === '/v5/market/kline') {
      const tf = tfOf[q.interval];
      const limit = Number(q.limit || 200);
      const end = Math.min(Number(q.end ?? now()), now());
      const start = Math.max(Number(q.start ?? 0), listedAt);
      const rows = [];
      for (let t = floorTime(end, tf); t >= start && rows.length < limit; t = addBars(t, tf, -1)) {
        if (t < floorTime(start, tf) && t < start) break;
        if (t < start) break;
        const b = synthBar(t);
        rows.push([String(t), String(b.o), String(b.h), String(b.l), String(b.c), String(b.v), String(b.qv)]);
      }
      return json({ retCode: 0, retMsg: 'OK', result: { symbol: q.symbol, category: q.category, list: rows }, retExtInfo: {}, time: now() });
    }
    return json({ retCode: 10001, retMsg: 'unknown endpoint', result: {} });
  };
  fn.calls = calls;
  return fn;
}

const NOW = Date.UTC(2025, 5, 10, 12, 34, 56);
const MIN = 60000;

function setup({ now = () => NOW, listedAt = 0, fetchOpts = {} } = {}) {
  const { repos } = initDb(':memory:');
  const fetch = fakeBybitFetch({ now, listedAt, ...fetchOpts });
  const rest = new BybitRest({ fetch, limiter: new RateLimiter(1e6, { burst: 1e6 }), sleep: async () => {}, log: quiet });
  const market = new MarketData({ repos, rest, log: quiet, config: {}, now });
  return { repos, rest, fetch, market };
}

const klineCalls = (fetch) => fetch.calls.filter((c) => c.path === '/v5/market/kline');

test('getCandles: empty DB -> fetched from Bybit, stored, then served from DB', async () => {
  const { repos, fetch, market } = setup();
  const c = await market.getCandles({ symbol: 'linear:BTCUSDT', tf: '1m', limit: 300 });
  assert.equal(c.length, 300);
  assert.equal(c.at(-1).t, floorTime(NOW, '1m'));
  for (let i = 1; i < c.length; i++) assert.equal(c[i].t - c[i - 1].t, MIN);
  assert.deepEqual(Object.keys(c[0]), ['t', 'o', 'h', 'l', 'c', 'v']);
  assert.deepEqual(c[10], (({ t, o, h, l, c: cl, v }) => ({ t, o, h, l, c: cl, v }))(synthBar(c[10].t)));
  assert.equal(repos.candles.count('linear:BTCUSDT', '1m'), 300);
  const st = repos.backfillState.get('linear:BTCUSDT', '1m');
  assert.equal(st.oldest, c[0].t);
  assert.equal(st.newest, floorTime(NOW, '1m') - MIN); // last CLOSED bar
  const n = klineCalls(fetch).length;

  // Same request again within the top-up throttle: no Bybit call.
  const again = await market.getCandles({ symbol: 'linear:BTCUSDT', tf: '1m', limit: 300 });
  assert.equal(again.length, 300);
  assert.equal(klineCalls(fetch).length, n);

  // A sub-range entirely inside coverage: no Bybit call.
  const inside = await market.getCandles({ symbol: 'linear:BTCUSDT', tf: '1m', from: c[50].t, to: c[60].t });
  assert.equal(inside.length, 11);
  assert.equal(klineCalls(fetch).length, n);
});

test('getCandles fills only the missing older range and the newer range', async () => {
  let now = NOW;
  const { repos, fetch, market } = setup({ now: () => now });
  await market.getCandles({ symbol: 'linear:BTCUSDT', tf: '5m', limit: 100 });
  const st1 = repos.backfillState.get('linear:BTCUSDT', '5m');
  fetch.calls.length = 0;

  // Older: request 50 bars before coverage.
  const from = addBars(st1.oldest, '5m', -50);
  const older = await market.getCandles({ symbol: 'linear:BTCUSDT', tf: '5m', from, to: addBars(st1.oldest, '5m', 10) });
  assert.equal(older.length, 61);
  const calls = klineCalls(fetch);
  assert.equal(calls.length, 1);
  assert.equal(Number(calls[0].q.start), from);
  assert.equal(Number(calls[0].q.end), st1.oldest);
  assert.equal(repos.backfillState.get('linear:BTCUSDT', '5m').oldest, from);

  // Newer: time passes by 1 hour -> only [newest, now] is fetched.
  now = NOW + 3600000;
  fetch.calls.length = 0;
  const latest = await market.getCandles({ symbol: 'linear:BTCUSDT', tf: '5m', limit: 20 });
  assert.equal(latest.at(-1).t, floorTime(now, '5m'));
  const c2 = klineCalls(fetch);
  assert.equal(c2.length, 1);
  assert.equal(Number(c2[0].q.start), st1.newest);
  const st2 = repos.backfillState.get('linear:BTCUSDT', '5m');
  assert.equal(st2.newest, floorTime(now, '5m') - 5 * MIN);
  // Contiguous: no holes between oldest and newest.
  const all = repos.candles.range('linear:BTCUSDT', '5m', { limit: 5000 });
  for (let i = 1; i < all.length; i++) assert.equal(all[i].t - all[i - 1].t, 5 * MIN);
});

test('getCandles respects the listing start (no refetch loop before listing)', async () => {
  const listedAt = floorTime(NOW, '1h') - 10 * 3600000;
  const { fetch, market } = setup({ listedAt });
  const all = await market.getCandles({ symbol: 'linear:NEWUSDT', tf: '1h', limit: 5 });
  assert.equal(all.length, 5);
  const n = klineCalls(fetch).length;
  const c = await market.getCandles({ symbol: 'linear:NEWUSDT', tf: '1h', from: listedAt - 100 * 3600000, to: listedAt + 3600000 });
  assert.deepEqual(c.map((x) => x.t), [listedAt, listedAt + 3600000]);
  const n2 = klineCalls(fetch).length;
  assert.equal(n2, n + 1); // one call to learn there is nothing older
  await market.getCandles({ symbol: 'linear:NEWUSDT', tf: '1h', from: listedAt - 100 * 3600000, to: listedAt + 3600000 });
  assert.equal(klineCalls(fetch).length, n2); // state remembers
});

test('getCandles degrades gracefully offline (serves DB data)', async () => {
  const { repos, market, rest } = setup({ fetchOpts: { failFirst: 1e9 } });
  rest.maxRetries = 1;
  repos.candles.upsertMany('linear:BTCUSDT', '1h', [{ t: floorTime(NOW, '1h') - 3600000, o: 1, h: 2, l: 0.5, c: 1.5, v: 10 }]);
  const c = await market.getCandles({ symbol: 'linear:BTCUSDT', tf: '1h', limit: 10 });
  assert.equal(c.length, 1);
  assert.equal(rest.health, 'degraded');
  await assert.rejects(market.getCandles({ symbol: 'linear:BTCUSDT', tf: '7h' }), /Unknown timeframe/);
});

test('getCandles clamps limit to 5000 and handles 1W/1M calendar bars', async () => {
  const { market } = setup();
  const c = await market.getCandles({ symbol: 'linear:BTCUSDT', tf: '1m', limit: 99999 });
  assert.equal(c.length, 5000);
  const w = await market.getCandles({ symbol: 'linear:BTCUSDT', tf: '1W', limit: 10 });
  assert.equal(w.length, 10);
  for (const b of w) assert.equal(new Date(b.t).getUTCDay(), 1);
  const m = await market.getCandles({ symbol: 'linear:BTCUSDT', tf: '1M', limit: 6 });
  assert.equal(m.length, 6);
  for (const b of m) assert.equal(new Date(b.t).getUTCDate(), 1);
});

test('getCandles for seconds timeframes uses LiveHub bars', async () => {
  const { market } = setup();
  const T = floorTime(NOW, '5s');
  market.live = { secondBars: () => [{ t: T - 5000, o: 1, h: 2, l: 1, c: 2, v: 3, qv: 6 }, { t: T, o: 2, h: 2, l: 2, c: 2, v: 1, qv: 2 }] };
  const c = await market.getCandles({ symbol: 'linear:BTCUSDT', tf: '5s', limit: 1 });
  assert.deepEqual(c, [{ t: T, o: 2, h: 2, l: 2, c: 2, v: 1 }]);
});

test('getFootprint reads stored bars with the symbol bucket size', async () => {
  const { repos, market } = setup();
  const T = floorTime(NOW, '1m') - 10 * MIN;
  repos.footprint.upsertBars('linear:BTCUSDT', '1m', [{ t: T, levels: [{ p: 60000, bid: 1, ask: 3 }, { p: 60010, bid: 5, ask: 0 }] }]);
  market.instruments = { tickSize: () => 0.1 };
  repos.candles.upsertMany('linear:BTCUSDT', '1m', [{ t: T, o: 60000, h: 60010, l: 59990, c: 60005, v: 1 }]);
  const bars = await market.getFootprint({ symbol: 'linear:BTCUSDT', tf: '1m', from: T - MIN, to: T + MIN });
  assert.equal(bars.length, 1);
  assert.equal(bars[0].tick, 10);
  assert.equal(bars[0].poc, 60010);
  assert.equal(bars[0].delta, -3);
});

test('gapfill brings tracked pairs up to date and aborts when offline', async () => {
  let now = NOW;
  const { repos, fetch, market } = setup({ now: () => now });
  await market.getCandles({ symbol: 'linear:BTCUSDT', tf: '15m', limit: 50 });
  await market.getCandles({ symbol: 'spot:ETHUSDT', tf: '1h', limit: 50 });
  now += 6 * 3600000;
  const r = await runGapfill({ market, repos, log: quiet });
  assert.deepEqual(r, { total: 2, filled: 2, failed: 0, aborted: false });
  assert.equal(repos.backfillState.get('linear:BTCUSDT', '15m').newest, floorTime(now, '15m') - 15 * MIN);
  assert.equal(repos.backfillState.get('spot:ETHUSDT', '1h').newest, floorTime(now, '1h') - 3600000);
  assert.ok(fetch.calls.some((c) => c.q.category === 'spot'));

  const off = { refresh: async () => { throw new Error('offline'); } };
  for (let i = 0; i < 5; i++) repos.backfillState.set(`linear:X${i}USDT`, '1m', { oldest: 0, newest: 0 });
  const r2 = await runGapfill({ market: off, repos, log: quiet }, { concurrency: 1 });
  assert.equal(r2.aborted, true);
  assert.equal(r2.failed, 3);
});

// ---------------------------------------------------------------- backfill

test('backfillCandles pages back to the target and is resumable', async () => {
  let now = NOW;
  const { repos, fetch, rest } = setup({ now: () => now });
  const bf = new Backfiller({ repos, rest, log: quiet, now: () => now });
  const progress = [];
  const r = await bf.backfillCandles({ key: 'linear:BTCUSDT', tf: '1h', days: 90, onProgress: (p) => progress.push(p) });
  const target = floorTime(NOW - 90 * 86400000, '1h');
  assert.equal(r.complete, true);
  assert.equal(r.oldest, target);
  assert.equal(repos.candles.first('linear:BTCUSDT', '1h').t, target);
  assert.equal(repos.candles.count('linear:BTCUSDT', '1h'), (floorTime(NOW, '1h') - target) / 3600000 + 1);
  assert.equal(klineCalls(fetch).length, 3); // 2161 bars / 1000 per page
  assert.ok(progress.length >= 3);
  assert.equal(progress.at(-1).pct, 100);

  // Re-run: nothing to do.
  fetch.calls.length = 0;
  const again = await bf.backfillCandles({ key: 'linear:BTCUSDT', tf: '1h', days: 90 });
  assert.equal(again.stored, 0);
  assert.equal(klineCalls(fetch).length, 0);

  // Extend history + time passes: forward page then backwards from the old oldest.
  now += 5 * 3600000;
  const more = await bf.backfillCandles({ key: 'linear:BTCUSDT', tf: '1h', days: 120 });
  assert.equal(more.oldest, floorTime(now - 120 * 86400000, '1h'));
  assert.equal(more.newest, floorTime(now, '1h') - 3600000);
  const all = repos.candles.range('linear:BTCUSDT', '1h', { limit: 5000 });
  for (let i = 1; i < all.length; i++) assert.equal(all[i].t - all[i - 1].t, 3600000);
});

test('backfillCandles resumes after an interruption mid-way', async () => {
  const { repos, rest } = setup();
  const bf = new Backfiller({ repos, rest, log: quiet, now: () => NOW });
  let pages = 0;
  const orig = rest.getKlines.bind(rest);
  rest.getKlines = async (p) => {
    if (++pages === 3) throw new Error('boom');
    return orig(p);
  };
  await assert.rejects(bf.backfillCandles({ key: 'linear:BTCUSDT', tf: '15m', days: 30 }), /boom/);
  const mid = repos.backfillState.get('linear:BTCUSDT', '15m');
  assert.ok(mid.oldest > floorTime(NOW - 30 * 86400000, '15m'));
  rest.getKlines = orig;
  const r = await bf.backfillCandles({ key: 'linear:BTCUSDT', tf: '15m', days: 30 });
  assert.equal(r.complete, true);
  const all = repos.candles.range('linear:BTCUSDT', '15m', { limit: 5000 });
  const target = floorTime(NOW - 30 * 86400000, '15m');
  assert.equal(all.length, (floorTime(NOW, '15m') - target) / (15 * MIN) + 1);
  for (let i = 1; i < all.length; i++) assert.equal(all[i].t - all[i - 1].t, 15 * MIN);
});

test('Backfiller.run processes symbols x timeframes with a concurrency pool', async () => {
  const { repos, rest } = setup();
  const bf = new Backfiller({ repos, rest, log: quiet, now: () => NOW });
  const events = [];
  const s = await bf.run({ symbols: ['linear:BTCUSDT', 'spot:ETHUSDT', 'linear:SOLUSDT'], days: 2, tfs: ['1h', '4h', '1D'], concurrency: 2, onEvent: (e) => events.push(e.type) });
  assert.equal(s.jobs, 9);
  assert.equal(s.failed.length, 0);
  assert.equal(events.filter((e) => e === 'symbol_done').length, 3);
  assert.equal(repos.backfillState.all().length, 9);
});

test('parseTfList / runPool / resolveSymbols', async () => {
  assert.equal(parseTfList('all').length, 13);
  assert.deepEqual(parseTfList('1m,60,D'), ['1m', '1h', '1D']);
  assert.throws(() => parseTfList('5s'));
  let active = 0;
  let peak = 0;
  const out = await runPool([1, 2, 3, 4, 5], 2, async (x) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 5));
    active--;
    return x * 2;
  });
  assert.deepEqual(out, [2, 4, 6, 8, 10]);
  assert.equal(peak, 2);

  const instruments = {
    load: async () => {},
    topLinear: async (n) => ['linear:BTCUSDT', 'linear:ETHUSDT', 'linear:SOLUSDT'].slice(0, n),
    groupKeys: (g) => ({ commodities: ['linear:XAUTUSDT', 'spot:PAXGUSDT'], forex: ['spot:EURUSDT'], crypto: ['linear:BTCUSDT', 'linear:BTCPERP'] })[g],
  };
  const config = { defaultSymbols: ['top:2', 'group:commodities', 'group:forex'] };
  assert.deepEqual(await resolveSymbols(['default'], { instruments, config }), ['linear:BTCUSDT', 'linear:ETHUSDT', 'linear:XAUTUSDT', 'spot:PAXGUSDT', 'spot:EURUSDT']);
  assert.deepEqual(await resolveSymbols(['linear:BTCUSDT', 'ethusdt', 'forex'], { instruments, config }), ['linear:BTCUSDT', 'linear:ETHUSDT', 'spot:EURUSDT']);
  assert.deepEqual(await resolveSymbols(['crypto'], { instruments, config }), ['linear:BTCUSDT']);
});

// ---------------------------------------------------------------- trade dumps

// First lines of a real linear dump (BTCUSDT2024-01-01.csv.gz): header + timestamp in float seconds.
const LINEAR_DUMP = `timestamp,symbol,side,size,price,tickDirection,trdMatchID,grossValue,homeNotional,foreignNotional
1704067200.1234,BTCUSDT,Buy,0.012,42283.60,ZeroPlusTick,6a9b5c1e-3a52-5d2c-8a1e-0b8f3d7c1a01,5.0740320e+10,0.012,507.40320
1704067200.5,BTCUSDT,Sell,0.500,42283.50,MinusTick,7b0c6d2f-4b63-6e3d-9b2f-1c9f4e8d2b12,2.1141750e+12,0.5,21141.75
1704067259.999,BTCUSDT,Sell,0.100,42270.10,MinusTick,8c1d7e3a-5c74-7f4e-ac3a-2da05f9e3c23,4.2270100e+11,0.1,4227.01
1704067260.001,BTCUSDT,Buy,1.000,42290.00,PlusTick,9d2e8f4b-6d85-8a5f-bd4b-3eb16a0f4d34,4.2290000e+12,1,42290
`;
// Spot dump layout: id,timestamp(ms),price,volume,side
const SPOT_DUMP = `id,timestamp,price,volume,side
1,1704067200123,2281.5,0.5,buy
2,1704067201456,2281.4,1.25,sell
`;

const gz = (s) => Readable.from([zlib.gzipSync(Buffer.from(s))]);

test('dump timestamp normalisation and header detection', () => {
  assert.equal(normalizeTimestamp('1704067200.1234'), 1704067200123);
  assert.equal(normalizeTimestamp('1704067200123'), 1704067200123);
  assert.equal(normalizeTimestamp('1704067200123456'), 1704067200123);
  assert.deepEqual(detectColumns('timestamp,symbol,side,size,price,tickDirection'), { t: 0, side: 2, q: 3, p: 4 });
  assert.deepEqual(detectColumns('id,timestamp,price,volume,side'), { t: 1, side: 4, q: 3, p: 2 });
  assert.equal(detectColumns('1704067200.1,BTCUSDT,Buy,0.01,42000'), null);
  assert.deepEqual(parseDumpLine('1704067200.5,BTCUSDT,Sell,0.500,42283.50'), { t: 1704067200500, p: 42283.5, q: 0.5, side: 'Sell' });
  assert.equal(parseDumpLine('garbage'), null);
});

test('parseTradeDump stream-parses gzipped linear and spot dumps (with or without header)', async () => {
  const lin = [];
  const s1 = await parseTradeDump(gz(LINEAR_DUMP), (t) => lin.push(t));
  assert.deepEqual(s1, { lines: 5, trades: 4, skipped: 0 });
  assert.deepEqual(lin[0], { t: 1704067200123, p: 42283.6, q: 0.012, side: 'Buy' });
  const noHeader = [];
  await parseTradeDump(gz(LINEAR_DUMP.split('\n').slice(1).join('\n')), (t) => noHeader.push(t));
  assert.deepEqual(noHeader, lin);
  const spot = [];
  await parseTradeDump(gz(SPOT_DUMP), (t) => spot.push(t));
  assert.deepEqual(spot, [
    { t: 1704067200123, p: 2281.5, q: 0.5, side: 'Buy' },
    { t: 1704067201456, p: 2281.4, q: 1.25, side: 'Sell' },
  ]);
});

test('dumpUrls for linear and spot', () => {
  const d = Date.UTC(2024, 0, 1);
  assert.deepEqual(dumpUrls('https://public.bybit.com', 'linear', 'BTCUSDT', d), ['https://public.bybit.com/trading/BTCUSDT/BTCUSDT2024-01-01.csv.gz']);
  assert.equal(dumpUrls('https://public.bybit.com', 'spot', 'ETHUSDT', d)[0], 'https://public.bybit.com/spot/ETHUSDT/ETHUSDT_2024-01-01.csv.gz');
});

test('backfillFootprint downloads daily dumps into footprint bars and resumes by day', async () => {
  const { repos } = setup();
  const now = Date.UTC(2024, 0, 3, 8);
  const requested = [];
  const fetchDump = async (url) => {
    requested.push(url);
    if (url.endsWith('BTCUSDT2024-01-01.csv.gz')) {
      const body = zlib.gzipSync(Buffer.from(LINEAR_DUMP));
      return { ok: true, status: 200, body: Readable.toWeb(Readable.from([body])) };
    }
    if (url.endsWith('BTCUSDT2024-01-02.csv.gz')) {
      const body = zlib.gzipSync(Buffer.from(LINEAR_DUMP.replaceAll('17040672', '17041536')));
      return { ok: true, status: 200, body: Readable.toWeb(Readable.from([body])) };
    }
    return { ok: false, status: 404, body: null };
  };
  const bf = new Backfiller({ repos, rest: null, log: quiet, fetch: fetchDump, now: () => now, config: { bybitDumps: 'https://public.bybit.com', footprintTickMult: 'auto' }, instruments: { tickSize: () => 0.1 } });
  const r = await bf.backfillFootprint({ key: 'linear:BTCUSDT', days: 5 });
  assert.equal(r.daysDone, 2);
  assert.equal(r.trades, 8);
  assert.equal(r.tick, 10); // ~2 bps of 42k with tick 0.1 -> 10
  const rows = repos.footprint.rows('linear:BTCUSDT', '1m', {});
  const t0 = Date.UTC(2024, 0, 1);
  const first = rows.filter((x) => x.t === t0);
  assert.deepEqual(first, [
    { t: t0, price: 42270, bid_v: 0.1, ask_v: 0 },
    { t: t0, price: 42280, bid_v: 0.5, ask_v: 0.012 },
  ]);
  assert.deepEqual(rows.filter((x) => x.t === t0 + 60000), [{ t: t0 + 60000, price: 42290, bid_v: 0, ask_v: 1 }]);
  assert.equal(repos.footprint.rows('linear:BTCUSDT', '1h', {}).length, 6); // 2 days x 3 levels
  assert.deepEqual(repos.backfillState.get('linear:BTCUSDT', 'fp'), { oldest: t0, newest: t0 + 86400000 });

  // Resume: nothing new is downloaded for covered days.
  requested.length = 0;
  const r2 = await bf.backfillFootprint({ key: 'linear:BTCUSDT', days: 5 });
  assert.equal(r2.daysDone, 0);
  assert.ok(!requested.some((u) => u.includes('2024-01-01') || u.includes('2024-01-02')));
});
