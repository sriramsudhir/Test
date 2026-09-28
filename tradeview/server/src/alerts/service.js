// Alert CRUD shared by REST routes and the agent. Persists via ctx.repos.alerts, informs the engine,
// broadcasts {type:'alert_update'}.
import { validateAlert, ValidationError } from './validate.js';
import { getEngine } from './engine.js';

export { ValidationError };

function repo(ctx) {
  const r = ctx?.repos?.alerts;
  if (!r) throw Object.assign(new Error('alerts repository unavailable'), { statusCode: 503 });
  return r;
}

function threshold(ctx) {
  const t = Number(ctx?.config?.layaThreshold ?? ctx?.config?.laya?.threshold);
  return Number.isFinite(t) ? t : 0.6;
}

function notify(ctx, alert, engine = getEngine()) {
  engine?.upsert?.(alert);
  try {
    ctx.broadcast?.({ type: 'alert_update', alert });
  } catch {
    /* ignore */
  }
}

export function listAlerts(ctx, { status, symbol } = {}) {
  let list = repo(ctx).list(status ? { status } : {}) || [];
  if (symbol) list = list.filter((a) => a.symbol === symbol);
  return list;
}

export function getAlert(ctx, id) {
  return repo(ctx).get(id);
}

/** @param {'user'|'agent'} createdBy */
export function createAlert(ctx, input, { createdBy = 'user', engine } = {}) {
  const { id: _ignored, ...body } = input || {};
  const alert = validateAlert(body, { createdBy, defaultThreshold: threshold(ctx) });
  if (createdBy === 'agent') alert.createdBy = 'agent';
  alert.created = Date.now();
  const saved = repo(ctx).save(alert);
  notify(ctx, saved, engine);
  return saved;
}

export function updateAlert(ctx, id, patch, { engine } = {}) {
  const existing = repo(ctx).get(id);
  if (!existing) return null;
  const { id: _i, createdBy: _c, created: _cr, ...body } = patch || {};
  const next = validateAlert(body, { existing, defaultThreshold: threshold(ctx) });
  // Re-activating an expired alert requires a future expiry.
  if (next.status === 'active' && next.expires && next.expires <= Date.now()) {
    throw new ValidationError('cannot re-activate an alert whose expiry is in the past');
  }
  const saved = repo(ctx).save(next);
  notify(ctx, saved, engine);
  return saved;
}

export function deleteAlert(ctx, id, { engine = getEngine() } = {}) {
  const ok = repo(ctx).delete(id);
  engine?.remove?.(id);
  if (ok) {
    try {
      ctx.broadcast?.({ type: 'alert_update', alert: { id, deleted: true } });
    } catch {
      /* ignore */
    }
  }
  return ok;
}

export function listEvents(ctx, { limit = 100, alertId } = {}) {
  const r = ctx?.repos?.alertEvents;
  if (!r) return [];
  return r.list({ limit, ...(alertId ? { alertId } : {}) });
}
