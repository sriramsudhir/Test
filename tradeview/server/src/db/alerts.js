// Alerts repository. Stores the full Alert object (ARCHITECTURE §6) as JSON; `status` mirrored in a column.

function row2alert(r) {
  if (!r) return null;
  const a = JSON.parse(r.json);
  if (a.status == null && r.status) a.status = r.status;
  if (a.created == null && r.created != null) a.created = r.created;
  return a;
}

/** @param {import('better-sqlite3').Database} db */
export function createAlertsRepo(db) {
  const selAll = db.prepare(`SELECT id, json, created, status FROM alerts ORDER BY created ASC`);
  const selByStatus = db.prepare(`SELECT id, json, created, status FROM alerts WHERE status=? ORDER BY created ASC`);
  const selOne = db.prepare(`SELECT id, json, created, status FROM alerts WHERE id=?`);
  const put = db.prepare(
    `INSERT INTO alerts(id, json, created, status) VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET json=excluded.json, status=excluded.status`,
  );
  const del = db.prepare(`DELETE FROM alerts WHERE id=?`);

  const repo = {
    /** @param {{status?: string}} [opts] */
    list({ status } = {}) {
      return (status ? selByStatus.all(status) : selAll.all()).map(row2alert);
    },
    get(id) {
      return row2alert(selOne.get(id));
    },
    /** Insert or replace an alert. Assigns `id`, `created`, default `status`. Returns the stored alert. */
    save(alert) {
      const a = { ...alert };
      a.id ??= newId();
      a.created ??= Date.now();
      a.status ??= 'active';
      put.run(a.id, JSON.stringify(a), a.created, a.status);
      return a;
    },
    /** Shallow-merge a patch into an existing alert. Returns the updated alert or null if missing. */
    update(id, patch) {
      const cur = repo.get(id);
      if (!cur) return null;
      return repo.save({ ...cur, ...patch, id });
    },
    setStatus(id, status) {
      return repo.update(id, { status });
    },
    delete(id) {
      return del.run(id).changes > 0;
    },
  };
  // Aliases for convenience.
  repo.all = repo.list;
  repo.create = repo.save;
  repo.insert = repo.save;
  repo.upsert = repo.save;
  repo.remove = repo.delete;
  return repo;
}

export function newId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}
