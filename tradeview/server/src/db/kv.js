// kv(key TEXT PRIMARY KEY, value TEXT) repository (ARCHITECTURE §13.3) plus a JSON "meta" view on top of it.

/** @param {import('better-sqlite3').Database} db */
export function createKvRepo(db) {
  const sel = db.prepare(`SELECT value FROM kv WHERE key=?`);
  const put = db.prepare(`INSERT INTO kv(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`);
  const del = db.prepare(`DELETE FROM kv WHERE key=?`);
  const selPrefix = db.prepare(`SELECT key, value FROM kv WHERE key >= ? AND key < ? ORDER BY key`);

  const repo = {
    /** @returns {string|null} */
    get(key) {
      return sel.get(key)?.value ?? null;
    },
    /** Store a string (non-strings are JSON encoded). */
    set(key, value) {
      put.run(key, typeof value === 'string' ? value : JSON.stringify(value));
    },
    delete(key) {
      return del.run(key).changes > 0;
    },
    /** Parsed JSON value or `def`. */
    getJSON(key, def = null) {
      const v = repo.get(key);
      if (v == null) return def;
      try {
        return JSON.parse(v);
      } catch {
        return def;
      }
    },
    setJSON(key, value) {
      put.run(key, JSON.stringify(value));
    },
    /** All entries whose key starts with `prefix`. */
    list(prefix = '') {
      return selPrefix.all(prefix, `${prefix}￿`);
    },
  };
  repo.remove = repo.delete;
  return repo;
}

/**
 * JSON cache view over kv (`meta:` key prefix): get() -> { value, t } | null, set(key, value).
 * @param {import('better-sqlite3').Database} db
 */
export function createMetaRepo(db) {
  const kv = createKvRepo(db);
  return {
    get(key) {
      const r = kv.getJSON(`meta:${key}`);
      return r && typeof r === 'object' && 'value' in r ? r : null;
    },
    set(key, value, t = Date.now()) {
      kv.setJSON(`meta:${key}`, { value, t });
    },
  };
}
