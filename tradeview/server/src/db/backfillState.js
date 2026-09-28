// backfill_state: contiguous coverage [oldest, newest] of candles (or footprint days) per (symbol, tf).
// Semantics: every bar with open time in [oldest, newest] that Bybit serves has been fetched and stored,
// and `newest` is the open time of the latest CLOSED bar stored.

/** @param {import('better-sqlite3').Database} db */
export function createBackfillStateRepo(db) {
  const sel = db.prepare(`SELECT oldest, newest FROM backfill_state WHERE symbol=? AND tf=?`);
  const put = db.prepare(
    `INSERT INTO backfill_state(symbol, tf, oldest, newest) VALUES (?, ?, ?, ?)
     ON CONFLICT(symbol, tf) DO UPDATE SET oldest=excluded.oldest, newest=excluded.newest`,
  );
  const all = db.prepare(`SELECT symbol, tf, oldest, newest FROM backfill_state ORDER BY symbol, tf`);
  const del = db.prepare(`DELETE FROM backfill_state WHERE symbol=? AND tf=?`);

  const repo = {
    /** @returns {{oldest:number, newest:number}|null} */
    get(symbol, tf) {
      return sel.get(symbol, tf) ?? null;
    },
    set(symbol, tf, { oldest, newest }) {
      put.run(symbol, tf, oldest, newest);
    },
    /** Widen coverage to include [oldest, newest] (caller guarantees contiguity). */
    extend(symbol, tf, { oldest, newest }) {
      const cur = sel.get(symbol, tf);
      if (!cur) {
        put.run(symbol, tf, oldest, newest);
        return { oldest, newest };
      }
      const next = {
        oldest: oldest != null ? Math.min(cur.oldest, oldest) : cur.oldest,
        newest: newest != null ? Math.max(cur.newest, newest) : cur.newest,
      };
      put.run(symbol, tf, next.oldest, next.newest);
      return next;
    },
    all() {
      return all.all();
    },
    delete(symbol, tf) {
      del.run(symbol, tf);
    },
  };
  return repo;
}
