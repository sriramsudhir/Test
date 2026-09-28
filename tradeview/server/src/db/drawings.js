// Persisted chart drawings. The drawing object is stored as JSON; `symbol` is indexed.

/** @param {import('better-sqlite3').Database} db */
export function createDrawingsRepo(db) {
  const selBySymbol = db.prepare(`SELECT id, symbol, json FROM drawings WHERE symbol=? ORDER BY rowid ASC`);
  const selAll = db.prepare(`SELECT id, symbol, json FROM drawings ORDER BY rowid ASC`);
  const selOne = db.prepare(`SELECT id, symbol, json FROM drawings WHERE id=?`);
  const put = db.prepare(
    `INSERT INTO drawings(id, symbol, json) VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET symbol=excluded.symbol, json=excluded.json`,
  );
  const del = db.prepare(`DELETE FROM drawings WHERE id=?`);
  const delSymbol = db.prepare(`DELETE FROM drawings WHERE symbol=?`);

  const parse = (r) => ({ ...JSON.parse(r.json), id: r.id, symbol: r.symbol });

  const repo = {
    list(symbol) {
      return (symbol ? selBySymbol.all(symbol) : selAll.all()).map(parse);
    },
    get(id) {
      const r = selOne.get(id);
      return r ? parse(r) : null;
    },
    /** Insert or replace. `drawing.id` and `drawing.symbol` are required. */
    put(drawing) {
      if (!drawing?.id) throw new Error('drawing.id required');
      put.run(String(drawing.id), drawing.symbol ?? null, JSON.stringify(drawing));
      return repo.get(String(drawing.id));
    },
    delete(id) {
      return del.run(id).changes > 0;
    },
    clear(symbol) {
      return delSymbol.run(symbol).changes;
    },
  };
  repo.save = repo.put;
  repo.upsert = repo.put;
  repo.remove = repo.delete;
  return repo;
}
