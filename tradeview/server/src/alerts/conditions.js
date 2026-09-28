// Pure alert-condition logic (§6). No I/O; unit tested in test/intel-alerts.test.js.

export const PRICE_OPS = ['crosses', 'crosses_up', 'crosses_down', 'above', 'below', 'enters_channel', 'exits_channel'];
export const CHANNEL_OPS = ['enters_channel', 'exits_channel'];
export const TRIGGERS = ['once', 'once_per_bar', 'once_per_bar_close', 'every_time'];

const fin = Number.isFinite;

/**
 * Evaluate a price condition between the previous and the current price.
 * Levels may move over time (trendlines), so each level can be given at the previous and current time.
 *
 * @param {string} op
 * @param {number|undefined} prev        previous price (undefined on the first tick)
 * @param {number} cur                   current price
 * @param {number|{prev:number,cur:number}} value    level (or channel bound 1)
 * @param {number|{prev:number,cur:number}} [value2] channel bound 2
 * @returns {boolean}
 */
export function evaluatePriceOp(op, prev, cur, value, value2) {
  if (!fin(cur)) return false;
  const v = level(value);
  const hasPrev = fin(prev) && fin(v.prev);
  switch (op) {
    case 'above':
      return fin(v.cur) && cur > v.cur;
    case 'below':
      return fin(v.cur) && cur < v.cur;
    case 'crosses_up':
      return hasPrev && fin(v.cur) && prev < v.prev && cur >= v.cur;
    case 'crosses_down':
      return hasPrev && fin(v.cur) && prev > v.prev && cur <= v.cur;
    case 'crosses':
      return hasPrev && fin(v.cur) && ((prev < v.prev && cur >= v.cur) || (prev > v.prev && cur <= v.cur));
    case 'enters_channel':
    case 'exits_channel': {
      const w = level(value2);
      if (!fin(v.cur) || !fin(w.cur) || !fin(prev) || !fin(v.prev) || !fin(w.prev)) return false;
      const wasIn = inside(prev, v.prev, w.prev);
      const isIn = inside(cur, v.cur, w.cur);
      return op === 'enters_channel' ? !wasIn && isIn : wasIn && !isIn;
    }
    default:
      return false;
  }
}

function level(x) {
  if (x && typeof x === 'object') return { prev: Number(x.prev), cur: Number(x.cur) };
  const n = Number(x);
  return { prev: n, cur: n };
}

export function inside(p, a, b) {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return p >= lo && p <= hi;
}

/**
 * Value of a drawing at time t.
 * Supported: hline / horizontal_ray (price), trendline (segment unless extended), ray (extends right),
 * extended line, rectangle / price channel (two prices -> channel).
 * Drawings use `points: [{t, price}]` (§7). `extend: 'right'|'left'|'both'|true` is honoured.
 * @returns {{value:number|null, value2?:number|null}}
 */
export function drawingValueAt(drawing, t) {
  if (!drawing) return { value: null };
  const type = String(drawing.type || drawing.tool || '').toLowerCase();
  const pts = normPoints(drawing);
  if (['hline', 'horizontal_line', 'horizontal_ray', 'price_line'].includes(type)) {
    const price = fin(drawing.price) ? drawing.price : pts[0]?.price;
    if (type === 'horizontal_ray' && pts[0] && t < pts[0].t) return { value: null };
    return { value: fin(price) ? price : null };
  }
  if (['rectangle', 'channel', 'price_range', 'box'].includes(type)) {
    if (pts.length < 2) return { value: null };
    const [a, b] = pts;
    const t0 = Math.min(a.t, b.t);
    const t1 = Math.max(a.t, b.t);
    const ext = drawing.extend;
    const rightOk = t <= t1 || ext === true || ext === 'right' || ext === 'both';
    if (t < t0 || !rightOk) return { value: null, value2: null };
    return { value: Math.min(a.price, b.price), value2: Math.max(a.price, b.price) };
  }
  if (pts.length >= 2 && ['trendline', 'trend_line', 'line', 'ray', 'extended', 'extended_line', 'arrow', 'fib', 'parallel_channel'].includes(type)) {
    const [a, b] = pts[0].t <= pts[1].t ? [pts[0], pts[1]] : [pts[1], pts[0]];
    if (a.t === b.t) return { value: null };
    let extL = false;
    let extR = false;
    if (type === 'ray') extR = true;
    if (type === 'extended' || type === 'extended_line') extL = extR = true;
    if (drawing.extend === true || drawing.extend === 'both') extL = extR = true;
    if (drawing.extend === 'right') extR = true;
    if (drawing.extend === 'left') extL = true;
    if ((t < a.t && !extL) || (t > b.t && !extR)) return { value: null };
    const slope = (b.price - a.price) / (b.t - a.t);
    return { value: a.price + slope * (t - a.t) };
  }
  if (pts.length === 1) return { value: pts[0].price };
  return { value: null };
}

function normPoints(d) {
  const raw = Array.isArray(d.points) ? d.points : [d.p1, d.p2].filter(Boolean);
  return raw
    .map((p) => ({ t: Number(p.t ?? p.time), price: Number(p.price ?? p.value ?? p.p) }))
    .filter((p) => fin(p.price));
}

/**
 * Evaluate a drawing condition from (prevT, prev) to (t, cur).
 * For rectangles/channels only enters/exits/above/below make sense; above = above the top edge.
 */
export function evaluateDrawingOp(op, drawing, prevT, prev, t, cur) {
  const a = drawingValueAt(drawing, fin(prevT) ? prevT : t);
  const b = drawingValueAt(drawing, t);
  if (b.value === null || b.value === undefined) return false;
  if (b.value2 !== undefined && b.value2 !== null) {
    if (CHANNEL_OPS.includes(op)) return evaluatePriceOp(op, prev, cur, { prev: a.value, cur: b.value }, { prev: a.value2, cur: b.value2 });
    if (op === 'above') return cur > b.value2;
    if (op === 'below') return cur < b.value;
    // crossing a box: crossing either edge
    return (
      evaluatePriceOp(op, prev, cur, { prev: a.value, cur: b.value }) ||
      evaluatePriceOp(op, prev, cur, { prev: a.value2, cur: b.value2 })
    );
  }
  return evaluatePriceOp(op, prev, cur, { prev: a.value ?? NaN, cur: b.value });
}

/**
 * Evaluate an alert condition for a price move. Indicator conditions are evaluated elsewhere (closed bars).
 * @param {object} condition  Alert.condition
 * @param {{prev?:number, cur:number, prevT?:number, t:number, drawing?:object}} tick
 */
export function evaluateCondition(condition, { prev, cur, prevT, t, drawing }) {
  if (!condition) return false;
  if (condition.kind === 'price') return evaluatePriceOp(condition.op, prev, cur, condition.value, condition.value2);
  if (condition.kind === 'drawing') return evaluateDrawingOp(condition.op, drawing || condition.drawing, prevT, prev, t, cur);
  return false;
}

/**
 * Trigger gating (pure). Decides whether a hit may fire given the alert's trigger mode and history.
 * @param {string} trigger
 * @param {{lastFiredAt?:number, lastFiredBar?:number}} state
 * @param {number} barTime   open time of the current bar in the alert's tf
 * @param {number} now
 * @param {number} [cooldownMs=1000]  minimum gap for every_time
 */
export function canFire(trigger, state, barTime, now, cooldownMs = 1000) {
  switch (trigger) {
    case 'once':
      return !state.lastFiredAt;
    case 'once_per_bar':
    case 'once_per_bar_close':
      return state.lastFiredBar !== barTime;
    case 'every_time':
      return !state.lastFiredAt || now - state.lastFiredAt >= cooldownMs;
    default:
      return false;
  }
}

/** The level an alert watches (for display / Laya distance). */
export function alertLevel(alert, t = Date.now(), drawing) {
  const c = alert?.condition;
  if (!c) return null;
  if (c.kind === 'price') return fin(c.value) ? c.value : null;
  if (c.kind === 'drawing') return drawingValueAt(drawing || c.drawing, t).value ?? null;
  return null;
}

/** Fill {{placeholders}} in an alert message. */
export function renderMessage(template, vars) {
  const s = String(template ?? '');
  return s.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => (vars[k] === undefined || vars[k] === null ? m : String(vars[k])));
}
