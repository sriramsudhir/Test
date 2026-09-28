// push_subscriptions(endpoint TEXT PRIMARY KEY, json TEXT) repository (ARCHITECTURE §13.3).
// A subscription is the browser PushSubscription JSON: { endpoint, expirationTime, keys: { p256dh, auth } }.

/** @param {import('better-sqlite3').Database} db */
export function createPushRepo(db) {
  const selAll = db.prepare(`SELECT endpoint, json FROM push_subscriptions ORDER BY rowid`);
  const selOne = db.prepare(`SELECT endpoint, json FROM push_subscriptions WHERE endpoint=?`);
  const put = db.prepare(
    `INSERT INTO push_subscriptions(endpoint, json) VALUES (?, ?) ON CONFLICT(endpoint) DO UPDATE SET json=excluded.json`,
  );
  const del = db.prepare(`DELETE FROM push_subscriptions WHERE endpoint=?`);
  const count = db.prepare(`SELECT COUNT(*) AS n FROM push_subscriptions`);
  const parse = (r) => ({ ...JSON.parse(r.json), endpoint: r.endpoint });

  const repo = {
    list() {
      return selAll.all().map(parse);
    },
    get(endpoint) {
      const r = selOne.get(endpoint);
      return r ? parse(r) : null;
    },
    /** Insert or replace a subscription (keyed by `sub.endpoint`). */
    add(sub) {
      if (!sub?.endpoint || typeof sub.endpoint !== 'string') throw new Error('subscription.endpoint required');
      put.run(sub.endpoint, JSON.stringify(sub));
      return repo.get(sub.endpoint);
    },
    remove(endpoint) {
      return del.run(typeof endpoint === 'string' ? endpoint : endpoint?.endpoint).changes > 0;
    },
    count() {
      return count.get().n;
    },
  };
  repo.save = repo.add;
  repo.upsert = repo.add;
  repo.subscribe = repo.add;
  repo.delete = repo.remove;
  repo.unsubscribe = repo.remove;
  repo.all = repo.list;
  return repo;
}
