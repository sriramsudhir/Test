// Normalises the Laya decision attached to an AlertEvent (§6) for display.
import { h } from './dom.js';

function pick(v, keys) {
  if (v == null) return undefined;
  if (typeof v !== 'object') return v;
  for (const k of keys) if (v[k] != null) return v[k];
  return undefined;
}

/**
 * @param {object|undefined} laya  AlertEvent.laya ({ p, passed, answers } | { skipped: true })
 * @returns {{ present:boolean, skipped:boolean, p:number|null, passed:boolean|null, direction:string|null, confidence:string|null, threshold:number|null, reason:string|null }}
 */
export function layaSummary(laya) {
  if (!laya || typeof laya !== 'object') {
    return { present: false, skipped: false, p: null, passed: null, direction: null, confidence: null, threshold: null, reason: null };
  }
  const a = laya.answers || {};
  let p = laya.p;
  if (p == null) {
    const d = a.decision;
    p = typeof d === 'number' ? d : pick(d, ['noul', 'p', 'probability', 'value', 'score']);
  }
  p = p == null || !isFinite(p) ? null : Number(p);
  const dir = a.direction;
  const direction = typeof dir === 'string' ? dir : pick(dir, ['choice', 'value', 'label', 'answer']) ?? null;
  const conf = a.confidence;
  const confidence = typeof conf === 'string' ? conf : typeof conf === 'number' ? conf.toFixed(2) : pick(conf, ['score', 'value', 'label', 'choice']) ?? null;
  return {
    present: true,
    skipped: !!laya.skipped,
    p,
    passed: laya.passed == null ? (laya.skipped ? null : null) : !!laya.passed,
    direction: direction == null ? null : String(direction),
    confidence: confidence == null ? null : String(confidence),
    threshold: laya.threshold ?? null,
    reason: laya.reason || laya.error || null,
  };
}

/** Compact badge element: "Laya 72% ✓ bullish" */
export function layaBadge(laya, { big = false } = {}) {
  const s = layaSummary(laya);
  if (!s.present) return null;
  if (s.skipped) return h(`span.laya-badge.skipped${big ? '.big' : ''}`, { title: s.reason || 'Laya unavailable; alert fired without the decision gate' }, 'Laya skipped');
  const pct = s.p == null ? '—' : `${Math.round(s.p * 100)}%`;
  const cls = s.passed === false ? 'blocked' : 'passed';
  return h(`span.laya-badge.${cls}${big ? '.big' : ''}`, { title: 'Laya decision P(true)' },
    h('span.laya-p', `P ${pct}`),
    s.direction ? h(`span.laya-dir.${s.direction.toLowerCase()}`, s.direction) : null,
    s.confidence ? h('span.laya-conf', s.confidence) : null);
}

/** Horizontal probability bar. */
export function layaBar(p, threshold) {
  const pct = p == null ? 0 : Math.max(0, Math.min(1, p)) * 100;
  const bar = h('div.prob-bar', h('div.prob-fill', { style: { width: `${pct}%` } }));
  if (threshold != null) bar.appendChild(h('div.prob-threshold', { style: { left: `${threshold * 100}%` }, title: `threshold ${threshold}` }));
  return bar;
}
