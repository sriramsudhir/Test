// Fired alert history. Stores the AlertEvent JSON (ARCHITECTURE §6); `id` is the autoincrement row id.

function row2event(r) {
  const e = JSON.parse(r.json);
  e.id = r.id;
  e.alertId ??= r.alert_id;
  e.t ??= r.t;
  return e;
}

/** @param {import('better-sqlite3').Database} db */
export function createAlertEventsRepo(db) {
  const ins = db.prepare(`INSERT INTO alert_events(alert_id, t, json) VALUES (?, ?, ?)`);
  const selRecent = db.prepare(`SELECT id, alert_id, t, json FROM alert_events ORDER BY id DESC LIMIT ?`);
  const selForAlert = db.prepare(
    `SELECT id, alert_id, t, json FROM alert_events WHERE alert_id=? ORDER BY id DESC LIMIT ?`,
  );
  const selOne = db.prepare(`SELECT id, alert_id, t, json FROM alert_events WHERE id=?`);
  const delForAlert = db.prepare(`DELETE FROM alert_events WHERE alert_id=?`);
  const delAll = db.prepare(`DELETE FROM alert_events`);
  // Keep the newest `max` events (ids are monotonic). No-op while there are fewer rows.
  const trimTo = db.prepare(`DELETE FROM alert_events WHERE id <= (SELECT id FROM alert_events ORDER BY id DESC LIMIT 1 OFFSET ?)`);

  const repo = {
    /** Persist an event; returns it with its numeric `id`. */
    add(event) {
      const e = { ...event };
      delete e.id;
      e.t ??= Date.now();
      const info = ins.run(e.alertId ?? null, e.t, JSON.stringify(e));
      return { ...e, id: Number(info.lastInsertRowid) };
    },
    /** Newest first. */
    list({ limit = 100, alertId } = {}) {
      const n = Math.max(1, Math.min(Number(limit) || 100, 10000));
      return (alertId ? selForAlert.all(alertId, n) : selRecent.all(n)).map(row2event);
    },
    get(id) {
      const r = selOne.get(id);
      return r ? row2event(r) : null;
    },
    /** Delete all but the newest `max` events. Returns rows deleted. */
    trim(max) {
      const n = Math.floor(Number(max));
      if (!(n > 0)) return 0;
      return trimTo.run(n).changes;
    },
    clear(alertId) {
      return (alertId ? delForAlert.run(alertId) : delAll.run()).changes;
    },
  };
  repo.insert = repo.add;
  repo.create = repo.add;
  repo.recent = (limit) => repo.list({ limit });
  return repo;
}
