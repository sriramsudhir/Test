// Candle repository. Candle JSON is { t, o, h, l, c, v } (qv stored but not exposed).

/** @param {import('better-sqlite3').Database} db */
export function createCandlesRepo(db) {
  const upsert = db.prepare(
    `INSERT INTO candles(symbol, tf, t, o, h, l, c, v, qv) VALUES (@symbol, @tf, @t, @o, @h, @l, @c, @v, @qv)
     ON CONFLICT(symbol, tf, t) DO UPDATE SET o=excluded.o, h=excluded.h, l=excluded.l, c=excluded.c,
       v=excluded.v, qv=excluded.qv`,
  );
  const selRangeAsc = db.prepare(
    `SELECT t, o, h, l, c, v FROM candles WHERE symbol=? AND tf=? AND t>=? AND t<=? ORDER BY t ASC LIMIT ?`,
  );
  const selRangeDesc = db.prepare(
    `SELECT t, o, h, l, c, v FROM candles WHERE symbol=? AND tf=? AND t>=? AND t<=? ORDER BY t DESC LIMIT ?`,
  );
  const selLast = db.prepare(`SELECT t, o, h, l, c, v FROM candles WHERE symbol=? AND tf=? ORDER BY t DESC LIMIT 1`);
  const selFirst = db.prepare(`SELECT t, o, h, l, c, v FROM candles WHERE symbol=? AND tf=? ORDER BY t ASC LIMIT 1`);
  const selCount = db.prepare(`SELECT COUNT(*) AS n FROM candles WHERE symbol=? AND tf=? AND t>=? AND t<=?`);
  const selTimes = db.prepare(`SELECT t FROM candles WHERE symbol=? AND tf=? AND t>=? AND t<=? ORDER BY t ASC`);
  const selSymbols = db.prepare(`SELECT DISTINCT symbol FROM candles`);
  const selPairs = db.prepare(`SELECT symbol, tf, COUNT(*) AS n, MIN(t) AS oldest, MAX(t) AS newest FROM candles GROUP BY symbol, tf`);
  const delRange = db.prepare(`DELETE FROM candles WHERE symbol=? AND tf=? AND t>=? AND t<=?`);

  const upsertTx = db.transaction((symbol, tf, candles) => {
    let n = 0;
    for (const k of candles) {
      if (!Number.isFinite(k.t)) continue;
      upsert.run({ symbol, tf, t: k.t, o: k.o, h: k.h, l: k.l, c: k.c, v: k.v ?? 0, qv: k.qv ?? null });
      n++;
    }
    return n;
  });

  return {
    /**
     * Bulk upsert in one transaction.
     * @param {string} symbol key, e.g. linear:BTCUSDT
     * @param {string} tf
     * @param {Array<{t:number,o:number,h:number,l:number,c:number,v:number,qv?:number}>} candles
     * @returns {number} rows written
     */
    upsertMany(symbol, tf, candles) {
      if (!candles?.length) return 0;
      return upsertTx(symbol, tf, candles);
    },
    upsert(symbol, tf, candle) {
      return upsertTx(symbol, tf, [candle]);
    },
    /**
     * Ascending candles in [from, to]. With `limit`, returns the LAST `limit` bars of the range
     * (chart-style "latest N up to `to`"), unless `anchor: 'start'` asks for the first `limit` bars.
     */
    range(symbol, tf, { from = 0, to = Number.MAX_SAFE_INTEGER, limit = 5000, anchor = 'end' } = {}) {
      if (anchor === 'start') return selRangeAsc.all(symbol, tf, from, to, limit);
      return selRangeDesc.all(symbol, tf, from, to, limit).reverse();
    },
    last(symbol, tf) {
      return selLast.get(symbol, tf) ?? null;
    },
    first(symbol, tf) {
      return selFirst.get(symbol, tf) ?? null;
    },
    count(symbol, tf, from = 0, to = Number.MAX_SAFE_INTEGER) {
      return selCount.get(symbol, tf, from, to).n;
    },
    times(symbol, tf, from, to) {
      return selTimes.all(symbol, tf, from, to).map((r) => r.t);
    },
    symbols() {
      return selSymbols.all().map((r) => r.symbol);
    },
    /** Coverage summary per (symbol, tf). */
    pairs() {
      return selPairs.all();
    },
    deleteRange(symbol, tf, from, to) {
      return delRange.run(symbol, tf, from, to).changes;
    },
  };
}
