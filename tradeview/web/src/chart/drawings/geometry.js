/** Geometry + canvas helpers used by drawing tools. */

export function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const x = ax + t * dx;
  const y = ay + t * dy;
  return Math.hypot(px - x, py - y);
}

/**
 * Extend segment a→b to the pane edges. Returns [p, q] endpoints.
 * left/right: extend beyond a (backwards) / beyond b (forwards).
 */
export function extendSegment(a, b, w, h, left, right) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return [a, b];
  // parametric p = a + t*(b-a); find t range that keeps p inside a generous box
  const big = Math.max(w, h) * 4;
  const ts = [];
  if (Math.abs(dx) > 1e-9) ts.push((-big - a.x) / dx, (w + big - a.x) / dx);
  if (Math.abs(dy) > 1e-9) ts.push((-big - a.y) / dy, (h + big - a.y) / dy);
  const tMin = Math.max(...ts.filter((t) => t <= 0).concat([-1e6]));
  const tMax = Math.min(...ts.filter((t) => t >= 1).concat([1e6]));
  const t0 = left ? tMin : 0;
  const t1 = right ? tMax : 1;
  return [
    { x: a.x + t0 * dx, y: a.y + t0 * dy },
    { x: a.x + t1 * dx, y: a.y + t1 * dy },
  ];
}

export function pointInRect(x, y, x1, y1, x2, y2, pad = 0) {
  return x >= Math.min(x1, x2) - pad && x <= Math.max(x1, x2) + pad && y >= Math.min(y1, y2) - pad && y <= Math.max(y1, y2) + pad;
}

export function setDash(ctx, style, width = 1) {
  if (style === 'dashed') ctx.setLineDash([6 * Math.max(1, width * 0.75), 4 * Math.max(1, width * 0.75)]);
  else if (style === 'dotted') ctx.setLineDash([Math.max(1.5, width), 3 * Math.max(1, width * 0.75)]);
  else ctx.setLineDash([]);
}

export function line(ctx, a, b) {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

export function arrowHead(ctx, from, to, size = 10) {
  const ang = Math.atan2(to.y - from.y, to.x - from.x);
  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(to.x - size * Math.cos(ang - Math.PI / 7), to.y - size * Math.sin(ang - Math.PI / 7));
  ctx.lineTo(to.x - size * Math.cos(ang + Math.PI / 7), to.y - size * Math.sin(ang + Math.PI / 7));
  ctx.closePath();
  ctx.fill();
}

export function roundRect(ctx, x, y, w, h, r = 3) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

/**
 * Draw a text label with a background box.
 * opts: { bg, color, align:'left'|'center'|'right', baseline:'top'|'middle'|'bottom', font, pad, radius, border }
 * Returns the box {x, y, w, h}.
 */
export function label(ctx, text, x, y, opts = {}) {
  const font = opts.font || '11px -apple-system, BlinkMacSystemFont, "Trebuchet MS", Roboto, Ubuntu, sans-serif';
  const pad = opts.pad ?? 4;
  ctx.font = font;
  const lines = String(text).split('\n');
  const lh = opts.lineHeight || parseInt(font, 10) * 1.3;
  const tw = Math.max(...lines.map((l) => ctx.measureText(l).width));
  const bw = tw + pad * 2;
  const bh = lh * lines.length + pad * 2 - (lh - parseInt(font, 10));
  let bx = x;
  if (opts.align === 'center') bx = x - bw / 2;
  else if (opts.align === 'right') bx = x - bw;
  let by = y;
  if (opts.baseline === 'middle') by = y - bh / 2;
  else if (opts.baseline === 'bottom') by = y - bh;
  if (opts.bg) {
    ctx.fillStyle = opts.bg;
    roundRect(ctx, bx, by, bw, bh, opts.radius ?? 3);
    ctx.fill();
  }
  if (opts.border) {
    ctx.strokeStyle = opts.border;
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    roundRect(ctx, bx + 0.5, by + 0.5, bw - 1, bh - 1, opts.radius ?? 3);
    ctx.stroke();
  }
  ctx.fillStyle = opts.color || '#d1d4dc';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  lines.forEach((l, i) => ctx.fillText(l, bx + pad, by + pad + i * lh));
  return { x: bx, y: by, w: bw, h: bh };
}

export function handle(ctx, x, y, active = false, color = '#2962ff') {
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(x, y, active ? 5.5 : 4.5, 0, Math.PI * 2);
  ctx.fillStyle = active ? color : '#131722';
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = color;
  ctx.stroke();
}
