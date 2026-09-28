// Raw recorded trades (ARCHITECTURE §13.1). Trade JSON: { t, p, q, side: 'Buy'|'Sell' }.

/** @param {import('better-sqlite3').Database} db */
export function createTradesRepo(db) {
  const ins = db.prepare(`INSERT INTO trades(symbol, t, p, q, side) VALUES (?, ?, ?, ?, ?)`);
  const selRange = db.prepare(`SELECT t, p, q, side FROM trades WHERE symbol=? AND t>=? AND t<=? ORDER BY t ASC, rowid ASC LIMIT ?`);
  const delBefore = db.prepare(`DELETE FROM trades WHERE t < ?`);
  const selCount = db.prepare(`SELECT COUNT(*) AS n FROM trades WHERE symbol=?`);
  const selStats = db.prepare(`SELECT symbol, COUNT(*) AS n, MIN(t) AS oldest, MAX(t) AS newest FROM trades GROUP BY symbol`);

  const insertTx = db.transaction((symbol, trades) => {
    for (const tr of trades) ins.run(symbol, tr.t, tr.p, tr.q, tr.side === 'Sell' ? -1 : 1);
    return trades.length;
  });

  return {
    /** Bulk insert in one transaction. */
    insertMany(symbol, trades) {
      if (!trades?.length) return 0;
      return insertTx(symbol, trades);
    },
    /** Ascending trades in [from, to]. */
    range(symbol, { from = 0, to = Number.MAX_SAFE_INTEGER, limit = 1000000 } = {}) {
      return selRange.all(symbol, from, to, limit).map((r) => ({ t: r.t, p: r.p, q: r.q, side: r.side < 0 ? 'Sell' : 'Buy' }));
    },
    /** Delete trades older than `before` (ms). Returns rows deleted. */
    prune(before) {
      return delBefore.run(before).changes;
    },
    count(symbol) {
      return selCount.get(symbol).n;
    },
    stats() {
      return selStats.all();
    },
  };
}
