#!/usr/bin/env node
// Backfill CLI (ARCHITECTURE §3).
//   npm run backfill -- --symbols default --days 365 --tf all [--footprint] [--concurrency 2]
// --symbols: comma list of keys (linear:BTCUSDT, spot:ETHUSDT, BTCUSDT = linear), group names
//            (crypto, forex, commodities), top:N, or "default" (DEFAULT_SYMBOLS from .env).
import { parseArgs } from 'node:util';
import config from '../src/config.js';
import { initDb } from '../src/db/index.js';
import { BybitRest } from '../src/bybit/rest.js';
import { Instruments } from '../src/bybit/instruments.js';
import { MarketData } from '../src/data/market.js';
import { Backfiller, resolveSymbols, parseTfList } from '../src/data/backfill.js';

const HELP = `TradeView backfill

Usage: npm run backfill -- [options]

  --symbols <list>     Comma list: keys (linear:BTCUSDT, spot:ETHUSDT), groups (crypto, forex, commodities),
                       top:N, or "default" (DEFAULT_SYMBOLS). Default: default
  --days <n>           History depth in days. Default: ${config.backfillDays}
  --tf <all|list>      "all" (13 native Bybit timeframes) or a comma list, e.g. 1m,5m,1h,1D. Default: all
  --footprint          Also build footprint history (1m..1h) from public.bybit.com daily trade dumps
  --concurrency <n>    Symbols processed in parallel (requests share one rate limiter). Default: 2
  --rate <n>           REST requests per second. Default: RATE_LIMIT (${config.rateLimit})
  --quiet              Only print per-timeframe results and the summary
  -h, --help           Show this help
`;

const fmtDate = (t) => (Number.isFinite(t) ? new Date(t).toISOString().slice(0, 16).replace('T', ' ') : '-');
const fmtNum = (n) => n.toLocaleString('en-US');
const fmtDur = (ms) => (ms < 60000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(ms / 60000)}m${Math.round((ms % 60000) / 1000)}s`);

async function main() {
  let args;
  try {
    ({ values: args } = parseArgs({
      options: {
        symbols: { type: 'string', default: 'default' },
        days: { type: 'string', default: String(config.backfillDays) },
        tf: { type: 'string', default: 'all' },
        footprint: { type: 'boolean', default: false },
        concurrency: { type: 'string', default: '2' },
        rate: { type: 'string' },
        quiet: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
      allowPositionals: false,
    }));
  } catch (err) {
    console.error(`${err.message}\n\n${HELP}`);
    process.exit(2);
  }
  if (args.help) {
    console.log(HELP);
    return;
  }
  const days = Number(args.days);
  const concurrency = Math.max(1, Number(args.concurrency) || 2);
  if (!(days > 0)) throw new Error('--days must be a positive number');
  const tfs = parseTfList(args.tf);
  const rate = args.rate ? Number(args.rate) : config.rateLimit;

  const log = {
    info: (m) => console.log(m),
    warn: (m) => console.warn(`warn: ${m}`),
    debug: () => {},
    error: (m) => console.error(`error: ${m}`),
  };
  const { db, repos } = initDb(config.dbPath);
  const rest = new BybitRest({ baseUrl: config.bybitRest, rateLimit: rate, log });
  const instruments = new Instruments({ rest, repos, log });
  const market = new MarketData({ repos, rest, instruments, log, config });
  const backfiller = new Backfiller({ repos, rest, instruments, market, config, log });

  const specs = args.symbols.split(',').map((s) => s.trim()).filter(Boolean);
  const symbols = await resolveSymbols(specs, { instruments, config, log });
  if (!symbols.length) throw new Error(`no symbols resolved from "${args.symbols}"`);

  console.log(`TradeView backfill -> ${config.dbPath}`);
  console.log(`  symbols (${symbols.length}): ${symbols.slice(0, 30).join(', ')}${symbols.length > 30 ? ', ...' : ''}`);
  console.log(`  timeframes: ${tfs.join(' ')}   days: ${days}   concurrency: ${concurrency}   rate: ${rate} req/s${args.footprint ? '   +footprint' : ''}`);

  const t0 = Date.now();
  const lastPrint = new Map();
  let doneSymbols = 0;
  let interrupted = false;
  process.once('SIGINT', () => {
    interrupted = true;
    console.log('\nInterrupted: progress is saved, re-run the same command to resume.');
    try {
      db.close();
    } catch {
      /* ignore */
    }
    process.exit(130);
  });

  const summary = await backfiller.run({
    symbols, days, tfs, footprint: args.footprint, concurrency,
    onEvent: (e) => {
      const tag = `[${e.key}${e.tf ? ` ${e.tf}` : ''}]`;
      switch (e.type) {
        case 'progress': {
          if (args.quiet) return;
          const k = `${e.key}|${e.tf}`;
          const now = Date.now();
          if (now - (lastPrint.get(k) || 0) < 2000) return;
          lastPrint.set(k, now);
          console.log(`  ${tag} ${e.pct.toFixed(0).padStart(3)}%  ${fmtNum(e.stored)} bars  ${fmtDate(e.oldest)} -> ${fmtDate(e.newest)}`);
          break;
        }
        case 'tf_done':
          console.log(`  ${tag} done: +${fmtNum(e.stored)} bars, coverage ${fmtDate(e.oldest)} -> ${fmtDate(e.newest)}${e.complete ? '' : ' (partial)'} in ${fmtDur(e.ms)}`);
          break;
        case 'fp_progress':
          if (args.quiet) return;
          console.log(`  [${e.key} footprint] ${e.day} ${e.phase === 'missing' ? 'no dump' : 'ok'}  (${e.daysDone} days, ${fmtNum(e.trades)} trades)`);
          break;
        case 'fp_done':
          console.log(`  [${e.key} footprint] done: ${e.daysDone} days, ${fmtNum(e.trades)} trades, bucket ${e.tick}`);
          break;
        case 'error':
          console.error(`  ${tag} FAILED: ${e.error}`);
          break;
        case 'symbol_done':
          doneSymbols++;
          console.log(`[${doneSymbols}/${symbols.length}] ${e.key} complete (${fmtDur(Date.now() - t0)} elapsed)`);
          break;
        default:
      }
    },
  });

  if (interrupted) return;
  console.log('');
  console.log(`Finished in ${fmtDur(Date.now() - t0)}: ${summary.jobs} symbol/timeframe jobs, ${fmtNum(summary.stored)} bars stored, ${summary.failed.length} failures.`);
  for (const f of summary.failed.slice(0, 20)) console.log(`  failed ${f.key} ${f.tf}: ${f.error}`);
  db.close();
  process.exitCode = summary.failed.length ? 1 : 0;
}

main().catch((err) => {
  console.error(`backfill failed: ${err.message}`);
  process.exit(1);
});
