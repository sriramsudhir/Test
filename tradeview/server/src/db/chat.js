// Chat history for the Claude agent. `content` is any JSON value (string or Anthropic content blocks).

/** @param {import('better-sqlite3').Database} db */
export function createChatRepo(db) {
  const ins = db.prepare(`INSERT INTO chat_messages(session, role, json, t) VALUES (?, ?, ?, ?)`);
  const selSession = db.prepare(
    `SELECT id, session, role, json, t FROM (
       SELECT id, session, role, json, t FROM chat_messages WHERE session=? ORDER BY id DESC LIMIT ?
     ) ORDER BY id ASC`,
  );
  const selSessions = db.prepare(
    `SELECT session, COUNT(*) AS count, MIN(t) AS started, MAX(t) AS updated FROM chat_messages
     GROUP BY session ORDER BY updated DESC`,
  );
  const delSession = db.prepare(`DELETE FROM chat_messages WHERE session=?`);

  const repo = {
    /** Append a message; returns its id. */
    append(session, role, content, t = Date.now()) {
      return Number(ins.run(session, role, JSON.stringify(content), t).lastInsertRowid);
    },
    /** Messages of a session, oldest first (the latest `limit`). */
    list(session, limit = 200) {
      return selSession.all(session, limit).map((r) => ({
        id: r.id,
        session: r.session,
        role: r.role,
        content: JSON.parse(r.json),
        t: r.t,
      }));
    },
    sessions() {
      return selSessions.all();
    },
    clear(session) {
      return delSession.run(session).changes;
    },
  };
  repo.add = repo.append;
  repo.history = repo.list;
  return repo;
}
