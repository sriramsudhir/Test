// Startup gap filler (ARCHITECTURE §3): brings every tracked symbol/tf (rows in backfill_state) up to date.
import { NATIVE_TFS } from './timeframes.js';
import { runPool } from './backfill.js';

/**
 * @param {{ market: import('./market.js').MarketData, repos: any, log?: any }} ctx
 * @param {{ pairs?: {symbol:string, tf:string}[], concurrency?: number, signal?: AbortSignal }} [opts]
 * @returns {Promise<{ total: number, filled: number, failed: number, aborted: boolean }>}
 */
export async function runGapfill(ctx, { pairs, concurrency = 2, signal } = {}) {
  const log = ctx.log || console;
  const list = (pairs ?? ctx.repos.backfillState.all())
    .filter((p) => NATIVE_TFS.includes(p.tf))
    .map((p) => ({ symbol: p.symbol, tf: p.tf }));
  const res = { total: list.length, filled: 0, failed: 0, aborted: false };
  if (!list.length) return res;
  log.info?.(`gapfill: updating ${list.length} symbol/timeframe pairs`);
  const t0 = Date.now();
  let consecutiveFailures = 0;
  await runPool(list, concurrency, async ({ symbol, tf }) => {
    if (res.aborted || signal?.aborted) return;
    try {
      await ctx.market.refresh(symbol, tf);
      res.filled++;
      consecutiveFailures = 0;
    } catch (err) {
      res.failed++;
      consecutiveFailures++;
      log.warn?.(`gapfill: ${symbol} ${tf} failed: ${err.message}`);
      // Bybit unreachable: stop early instead of hammering it for every pair (offline mode).
      if (consecutiveFailures >= 3) {
        res.aborted = true;
        log.warn?.('gapfill: aborting, Bybit appears unreachable; serving cached data');
      }
    }
  });
  log.info?.(`gapfill: ${res.filled}/${res.total} updated, ${res.failed} failed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return res;
}
