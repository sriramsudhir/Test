// Small key/value JSON cache (additive helper table `meta`).

/** @param {import('better-sqlite3').Database} db */
export function createMetaRepo(db) {
  const sel = db.prepare(`SELECT json, t FROM meta WHERE key=?`);
  const put = db.prepare(
    `INSERT INTO meta(key, json, t) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET json=excluded.json, t=excluded.t`,
  );
  return {
    /** @returns {{ value: any, t: number }|null} */
    get(key) {
      const r = sel.get(key);
      return r ? { value: JSON.parse(r.json), t: r.t } : null;
    },
    set(key, value, t = Date.now()) {
      put.run(key, JSON.stringify(value), t);
    },
  };
}
