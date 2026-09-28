// Alert validation + defaults (§6).
import { PRICE_OPS, CHANNEL_OPS, TRIGGERS } from './conditions.js';
import { isTf } from '../pine/util.js';

export const SOUND_PRESETS = ['siren', 'bell', 'klaxon', 'beep'];
export const STATUSES = ['active', 'triggered', 'paused', 'expired'];
export const DEFAULT_LAYA_QUESTION = 'Is this move likely to continue in the direction of the alert rather than fail?';

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.statusCode = 400;
  }
}

const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const toNum = (v) => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v);

function describe(cond) {
  if (cond.kind === 'price') {
    const op = cond.op.replace(/_/g, ' ');
    return CHANNEL_OPS.includes(cond.op) ? `${op} ${cond.value}–${cond.value2}` : `${op} ${cond.value}`;
  }
  if (cond.kind === 'drawing') return `${cond.op.replace(/_/g, ' ')} drawing`;
  return 'indicator signal';
}

/**
 * Validate and normalise an alert (create when `existing` is undefined, patch otherwise).
 * @param {object} input
 * @param {object} [opts]
 * @param {object} [opts.existing]        current alert when patching
 * @param {'user'|'agent'} [opts.createdBy]
 * @param {number} [opts.defaultThreshold]
 * @param {number} [opts.now]
 * @returns {object} alert without `id` for creates (repo assigns it)
 */
export function validateAlert(input, { existing, createdBy, defaultThreshold = 0.6, now = Date.now() } = {}) {
  if (!input || typeof input !== 'object') throw new ValidationError('alert body must be an object');
  const a = existing ? { ...existing, ...input } : { ...input };
  if (existing) {
    a.id = existing.id;
    a.createdBy = existing.createdBy;
    if (input.condition) a.condition = { ...input.condition };
    if (input.laya) a.laya = { ...(existing.laya || {}), ...input.laya };
    if (input.sound) a.sound = { ...(existing.sound || {}), ...input.sound };
  }

  if (typeof a.symbol !== 'string' || !/^(delta|spot|linear|inverse):[A-Z0-9][A-Z0-9_.-]{1,39}$/i.test(a.symbol)) {
    throw new ValidationError('symbol must be a key like "delta:BTCUSD" or "linear:BTCUSDT"');
  }
  a.tf = a.tf ?? '1m';
  if (!isTf(a.tf)) throw new ValidationError(`tf '${a.tf}' is not a valid timeframe`);

  const c = a.condition;
  if (!c || typeof c !== 'object') throw new ValidationError('condition is required');
  if (c.kind === 'price') {
    if (!PRICE_OPS.includes(c.op)) throw new ValidationError(`condition.op must be one of ${PRICE_OPS.join(', ')}`);
    c.value = toNum(c.value);
    if (!fin(c.value)) throw new ValidationError('condition.value must be a number');
    if (CHANNEL_OPS.includes(c.op)) {
      c.value2 = toNum(c.value2);
      if (!fin(c.value2)) throw new ValidationError('condition.value2 is required for channel conditions');
      if (c.value2 < c.value) [c.value, c.value2] = [c.value2, c.value];
    } else {
      delete c.value2;
    }
    a.condition = { kind: 'price', op: c.op, value: c.value, ...(c.value2 !== undefined ? { value2: c.value2 } : {}) };
  } else if (c.kind === 'indicator') {
    if (typeof c.source !== 'string' || !c.source.trim()) throw new ValidationError('condition.source (Pine script) is required');
    if (c.source.length > 100000) throw new ValidationError('condition.source is too large');
    if (c.inputs && JSON.stringify(c.inputs).length > 20000) throw new ValidationError('condition.inputs is too large');
    a.condition = { kind: 'indicator', source: c.source, ...(c.inputs && typeof c.inputs === 'object' ? { inputs: c.inputs } : {}) };
  } else if (c.kind === 'drawing') {
    if (!c.drawingId && !c.drawing) throw new ValidationError('condition.drawingId is required');
    if (!PRICE_OPS.includes(c.op)) throw new ValidationError(`condition.op must be one of ${PRICE_OPS.join(', ')}`);
    if (c.drawing && JSON.stringify(c.drawing).length > 20000) throw new ValidationError('condition.drawing is too large');
    if (c.drawingId && String(c.drawingId).length > 200) throw new ValidationError('condition.drawingId is too long');
    a.condition = {
      kind: 'drawing', op: c.op,
      ...(c.drawingId ? { drawingId: String(c.drawingId) } : {}),
      ...(c.drawing && typeof c.drawing === 'object' ? { drawing: c.drawing } : {}),
    };
  } else {
    throw new ValidationError("condition.kind must be 'price', 'indicator' or 'drawing'");
  }

  a.trigger = a.trigger ?? (a.condition.kind === 'indicator' ? 'once_per_bar_close' : 'once');
  if (!TRIGGERS.includes(a.trigger)) throw new ValidationError(`trigger must be one of ${TRIGGERS.join(', ')}`);
  if (a.condition.kind === 'indicator' && a.trigger === 'once_per_bar') a.trigger = 'once_per_bar_close';

  if (a.expires !== undefined && a.expires !== null) {
    a.expires = toNum(a.expires);
    if (!fin(a.expires)) throw new ValidationError('expires must be a unix ms timestamp');
    if (!existing && a.expires <= now) throw new ValidationError('expires is in the past');
  } else {
    delete a.expires;
  }

  const who = a.createdBy ?? createdBy ?? 'user';
  a.createdBy = who === 'agent' ? 'agent' : 'user';

  const l = a.laya && typeof a.laya === 'object' ? a.laya : {};
  const threshold = toNum(l.threshold);
  a.laya = {
    enabled: l.enabled ?? a.createdBy === 'agent',
    question: typeof l.question === 'string' && l.question.trim() ? l.question.trim().slice(0, 500) : DEFAULT_LAYA_QUESTION,
    threshold: fin(threshold) ? Math.min(1, Math.max(0, threshold)) : defaultThreshold,
  };
  a.laya.enabled = !!a.laya.enabled;

  const s = a.sound && typeof a.sound === 'object' ? a.sound : {};
  const vol = toNum(s.volume);
  const rep = toNum(s.repeat);
  a.sound = {
    preset: SOUND_PRESETS.includes(s.preset) ? s.preset : a.createdBy === 'agent' ? 'klaxon' : 'siren',
    volume: fin(vol) ? Math.min(1, Math.max(0, vol)) : 1,
    repeat: fin(rep) ? Math.max(1, Math.min(100, Math.round(rep))) : 3,
    loop: s.loop ?? a.createdBy === 'agent',
  };
  a.sound.loop = !!a.sound.loop;

  a.name = typeof a.name === 'string' && a.name.trim() ? a.name.trim().slice(0, 200) : `${a.symbol.split(':')[1]} ${describe(a.condition)}`;
  a.message = typeof a.message === 'string' && a.message.trim() ? a.message.slice(0, 2000) : `${a.name} ({{price}})`;
  a.status = a.status ?? 'active';
  if (!STATUSES.includes(a.status)) throw new ValidationError(`status must be one of ${STATUSES.join(', ')}`);
  return a;
}
