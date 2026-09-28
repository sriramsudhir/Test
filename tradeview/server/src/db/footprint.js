// Footprint repository: one row per (symbol, tf, bar open time, price level).

/** @param {import('better-sqlite3').Database} db */
export function createFootprintRepo(db) {
  const upsert = db.prepare(
    `INSERT INTO footprint(symbol, tf, t, price, bid_v, ask_v) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(symbol, tf, t, price) DO UPDATE SET bid_v=excluded.bid_v, ask_v=excluded.ask_v`,
  );
  const delBar = db.prepare(`DELETE FROM footprint WHERE symbol=? AND tf=? AND t=?`);
  const selRange = db.prepare(
    `SELECT t, price, bid_v, ask_v FROM footprint WHERE symbol=? AND tf=? AND t>=? AND t<=? ORDER BY t ASC, price ASC`,
  );
  const selBarTimes = db.prepare(
    `SELECT DISTINCT t FROM footprint WHERE symbol=? AND tf=? AND t>=? AND t<=? ORDER BY t DESC LIMIT ?`,
  );
  const selLast = db.prepare(`SELECT MAX(t) AS t FROM footprint WHERE symbol=? AND tf=?`);
  const selFirst = db.prepare(`SELECT MIN(t) AS t FROM footprint WHERE symbol=? AND tf=?`);

  const writeBars = db.transaction((symbol, tf, bars) => {
    let n = 0;
    for (const bar of bars) {
      // Replace the whole bar so levels that disappeared (re-bucketing) do not linger.
      delBar.run(symbol, tf, bar.t);
      for (const lv of bar.levels) {
        upsert.run(symbol, tf, bar.t, lv.p, lv.bid, lv.ask);
        n++;
      }
    }
    return n;
  });

  return {
    /**
     * Replace footprint bars (`{ t, levels: [{p, bid, ask}] }`) in one transaction.
     * @returns {number} rows written
     */
    upsertBars(symbol, tf, bars) {
      if (!bars?.length) return 0;
      return writeBars(symbol, tf, bars);
    },
    /** Raw rows `{ t, price, bid_v, ask_v }` ascending. With `maxBars`, only the latest N bars of the range. */
    rows(symbol, tf, { from = 0, to = Number.MAX_SAFE_INTEGER, maxBars } = {}) {
      if (maxBars) {
        const ts = selBarTimes.all(symbol, tf, from, to, maxBars);
        if (!ts.length) return [];
        from = ts[ts.length - 1].t;
      }
      return selRange.all(symbol, tf, from, to);
    },
    lastTime(symbol, tf) {
      return selLast.get(symbol, tf).t ?? null;
    },
    firstTime(symbol, tf) {
      return selFirst.get(symbol, tf).t ?? null;
    },
  };
}
