import { withAlpha, THEME } from '../theme.js';
import { formatDuration, formatCompact } from '../format.js';
import { distToSegment, extendSegment, pointInRect, setDash, line, arrowHead, label, roundRect } from './geometry.js';

/**
 * Drawing tool registry. Every tool is data + pure functions over a render context `r`:
 *   r = { ctx?, w, h, pts:[{x,y}], model, style, selected, hovered, creating, p2y, y2p, t2x, x2t,
 *         fmtPrice, tick, tfMs, barsBetween(t0,t1), volumeBetween(t0,t1), lastPrice }
 * Tool fields:
 *   clicks   number of points placed with the mouse (0 = freehand)
 *   render(r)            draw body
 *   hit(r, x, y)         true when (x,y) touches the drawing
 *   handles(r)           [{x, y, key}] draggable handles (default: one per point)
 *   drag(model, key, pt) apply a handle drag (default: replace point `key`)
 *   init(model, pt, r)   one-click tools set up their extra points here
 *   axis                 which axis labels to show when selected ('price' | 'time' | 'both')
 */

const TOL = 6;
const measureCtx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;

const baseStyle = (color = '#2962ff', extra = {}) => ({ color, width: 2, lineStyle: 'solid', ...extra });

const stroke = (r, width, style, color) => {
  const { ctx } = r;
  const w = (width ?? r.style.width ?? 1) + (r.hovered && !r.selected ? 0.5 : 0);
  ctx.lineWidth = w;
  ctx.strokeStyle = color || r.style.color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  setDash(ctx, style ?? r.style.lineStyle, w);
};

const fontOf = (size = 12, weight = '') => `${weight ? weight + ' ' : ''}${size}px ${THEME.font}`;

const pct = (a, b) => (b ? ((a - b) / b) * 100 : 0);
const fmtPct = (v) => (v >= 0 ? '+' : '') + v.toFixed(2) + '%';

function segmentTool(id, labelText, { left = false, right = false } = {}) {
  return {
    id,
    label: labelText,
    group: 'lines',
    clicks: 2,
    defaults: baseStyle('#2962ff', { extendLeft: left, extendRight: right }),
    axis: 'both',
    render(r) {
      if (r.pts.length < 2) return;
      const [a, b] = extendSegment(r.pts[0], r.pts[1], r.w, r.h, r.style.extendLeft, r.style.extendRight);
      stroke(r);
      line(r.ctx, a, b);
      if ((r.selected || r.creating) && r.style.showStats !== false) {
        const [p0, p1] = r.model.points;
        const d = p1.price - p0.price;
        const bars = r.barsBetween(p0.t, p1.t);
        label(r.ctx, `${d >= 0 ? '+' : ''}${r.fmtPrice(d)} (${fmtPct(pct(p1.price, p0.price))})  ${bars} bars`, r.pts[1].x + 8, r.pts[1].y, {
          bg: 'rgba(30,34,45,0.92)', color: THEME.text, baseline: 'middle', border: THEME.border,
        });
      }
    },
    hit(r, x, y) {
      if (r.pts.length < 2) return false;
      const [a, b] = extendSegment(r.pts[0], r.pts[1], r.w, r.h, r.style.extendLeft, r.style.extendRight);
      return distToSegment(x, y, a.x, a.y, b.x, b.y) <= TOL;
    },
  };
}

const FIB_RETR_LEVELS = [
  { r: 0, color: '#787b86' },
  { r: 0.236, color: '#f23645' },
  { r: 0.382, color: '#ff9800' },
  { r: 0.5, color: '#4caf50' },
  { r: 0.618, color: '#089981' },
  { r: 0.786, color: '#00bcd4' },
  { r: 1, color: '#787b86' },
  { r: 1.618, color: '#2962ff' },
  { r: 2.618, color: '#f23645' },
];
const FIB_EXT_LEVELS = [
  { r: 0, color: '#787b86' },
  { r: 0.382, color: '#f23645' },
  { r: 0.618, color: '#ff9800' },
  { r: 1, color: '#4caf50' },
  { r: 1.272, color: '#089981' },
  { r: 1.618, color: '#00bcd4' },
  { r: 2, color: '#2962ff' },
  { r: 2.618, color: '#9c27b0' },
];

function drawFibLevels(r, levels, priceAt, x1, x2) {
  const { ctx } = r;
  const rows = levels.map((lv) => ({ ...lv, price: priceAt(lv.r) })).map((lv) => ({ ...lv, y: r.p2y(lv.price) }));
  for (let i = 0; i < rows.length - 1; i++) {
    const a = rows[i];
    const b = rows[i + 1];
    if (a.y == null || b.y == null) continue;
    ctx.fillStyle = withAlpha(b.color, 0.1);
    ctx.fillRect(x1, Math.min(a.y, b.y), x2 - x1, Math.abs(b.y - a.y));
  }
  ctx.setLineDash([]);
  for (const lv of rows) {
    if (lv.y == null) continue;
    ctx.strokeStyle = lv.color;
    ctx.lineWidth = 1;
    line(ctx, { x: x1, y: Math.round(lv.y) + 0.5 }, { x: x2, y: Math.round(lv.y) + 0.5 });
    ctx.font = fontOf(11);
    ctx.fillStyle = lv.color;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${lv.r} (${r.fmtPrice(lv.price)})`, x1 - 6, lv.y);
  }
  return rows;
}

const TOOLS = {};
const def = (t) => {
  TOOLS[t.id] = t;
  return t;
};

def(segmentTool('trendline', 'Trend Line'));
def(segmentTool('ray', 'Ray', { right: true }));
def(segmentTool('extended_line', 'Extended Line', { left: true, right: true }));

def({
  id: 'arrow',
  label: 'Arrow',
  group: 'shapes',
  clicks: 2,
  defaults: baseStyle('#2962ff'),
  axis: 'both',
  render(r) {
    if (r.pts.length < 2) return;
    stroke(r);
    const [a, b] = r.pts;
    const size = 8 + (r.style.width || 2) * 2;
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    line(r.ctx, a, { x: b.x - Math.cos(ang) * size * 0.6, y: b.y - Math.sin(ang) * size * 0.6 });
    r.ctx.fillStyle = r.style.color;
    arrowHead(r.ctx, a, b, size);
  },
  hit(r, x, y) {
    return r.pts.length >= 2 && distToSegment(x, y, r.pts[0].x, r.pts[0].y, r.pts[1].x, r.pts[1].y) <= TOL;
  },
});

def({
  id: 'horizontal_line',
  label: 'Horizontal Line',
  group: 'lines',
  clicks: 1,
  defaults: baseStyle('#2962ff', { width: 1 }),
  axis: 'price',
  axisAlways: true,
  render(r) {
    const y = Math.round(r.pts[0].y) + 0.5;
    stroke(r);
    line(r.ctx, { x: 0, y }, { x: r.w, y });
    if (r.style.text) label(r.ctx, r.style.text, r.w - 8, y - 3, { color: r.style.color, align: 'right', baseline: 'bottom', pad: 2 });
  },
  hit: (r, x, y) => Math.abs(y - r.pts[0].y) <= TOL,
  handles: (r) => [{ x: Math.min(r.w - 40, Math.max(40, r.pts[0].x)), y: r.pts[0].y, key: 0 }],
});

def({
  id: 'horizontal_ray',
  label: 'Horizontal Ray',
  group: 'lines',
  clicks: 1,
  defaults: baseStyle('#2962ff', { width: 1 }),
  axis: 'price',
  axisAlways: true,
  render(r) {
    const p = r.pts[0];
    const y = Math.round(p.y) + 0.5;
    stroke(r);
    line(r.ctx, { x: p.x, y }, { x: r.w, y });
  },
  hit: (r, x, y) => x >= r.pts[0].x - TOL && Math.abs(y - r.pts[0].y) <= TOL,
});

def({
  id: 'vertical_line',
  label: 'Vertical Line',
  group: 'lines',
  clicks: 1,
  defaults: baseStyle('#2962ff', { width: 1 }),
  axis: 'time',
  axisAlways: true,
  render(r) {
    const x = Math.round(r.pts[0].x) + 0.5;
    stroke(r);
    line(r.ctx, { x, y: 0 }, { x, y: r.h });
  },
  hit: (r, x) => Math.abs(x - r.pts[0].x) <= TOL,
  handles: (r) => [{ x: r.pts[0].x, y: Math.min(r.h - 30, Math.max(30, r.pts[0].y)), key: 0 }],
});

function channelGeometry(r) {
  const [a, b, c] = r.pts;
  const slope = Math.abs(b.x - a.x) > 1e-9 ? (b.y - a.y) / (b.x - a.x) : 0;
  const off = c ? c.y - (a.y + slope * (c.x - a.x)) : 0;
  return { a, b, a2: { x: a.x, y: a.y + off }, b2: { x: b.x, y: b.y + off }, off };
}

def({
  id: 'parallel_channel',
  label: 'Parallel Channel',
  group: 'lines',
  clicks: 3,
  defaults: baseStyle('#2962ff', { fill: true, extendLeft: false, extendRight: false }),
  axis: 'both',
  render(r) {
    if (r.pts.length < 2) return;
    const { ctx } = r;
    const g = channelGeometry(r);
    const [a, b] = extendSegment(g.a, g.b, r.w, r.h, r.style.extendLeft, r.style.extendRight);
    if (r.pts.length >= 3) {
      const [a2, b2] = extendSegment(g.a2, g.b2, r.w, r.h, r.style.extendLeft, r.style.extendRight);
      if (r.style.fill !== false) {
        ctx.fillStyle = withAlpha(r.style.color, 0.12);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.lineTo(b2.x, b2.y);
        ctx.lineTo(a2.x, a2.y);
        ctx.closePath();
        ctx.fill();
      }
      stroke(r);
      line(ctx, a2, b2);
      stroke(r, 1, 'dashed', withAlpha(r.style.color, 0.7));
      line(ctx, { x: (a.x + a2.x) / 2, y: (a.y + a2.y) / 2 }, { x: (b.x + b2.x) / 2, y: (b.y + b2.y) / 2 });
    }
    stroke(r);
    line(ctx, a, b);
  },
  hit(r, x, y) {
    if (r.pts.length < 2) return false;
    const g = channelGeometry(r);
    if (distToSegment(x, y, g.a.x, g.a.y, g.b.x, g.b.y) <= TOL) return true;
    if (r.pts.length < 3) return false;
    if (distToSegment(x, y, g.a2.x, g.a2.y, g.b2.x, g.b2.y) <= TOL) return true;
    // inside the parallelogram
    const minX = Math.min(g.a.x, g.b.x);
    const maxX = Math.max(g.a.x, g.b.x);
    if (x < minX || x > maxX) return false;
    const slope = Math.abs(g.b.x - g.a.x) > 1e-9 ? (g.b.y - g.a.y) / (g.b.x - g.a.x) : 0;
    const y1 = g.a.y + slope * (x - g.a.x);
    const y2 = y1 + g.off;
    return y >= Math.min(y1, y2) && y <= Math.max(y1, y2);
  },
  handles(r) {
    const hs = r.pts.slice(0, 2).map((p, i) => ({ x: p.x, y: p.y, key: i }));
    if (r.pts.length >= 3) {
      const g = channelGeometry(r);
      hs.push({ x: (g.a2.x + g.b2.x) / 2, y: (g.a2.y + g.b2.y) / 2, key: 2 });
    }
    return hs;
  },
  drag(model, key, pt, r) {
    if (key === 2 && r) {
      // keep the offset handle free: store the price offset relative to the main line at the handle time
      model.points[2] = { t: pt.t, price: pt.price };
      return;
    }
    model.points[key] = { t: pt.t, price: pt.price };
  },
});

def({
  id: 'rectangle',
  label: 'Rectangle',
  group: 'shapes',
  clicks: 2,
  defaults: baseStyle('#9c27b0', { width: 1, fill: true }),
  axis: 'both',
  render(r) {
    if (r.pts.length < 2) return;
    const [a, b] = r.pts;
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    const w = Math.abs(b.x - a.x);
    const h = Math.abs(b.y - a.y);
    if (r.style.fill !== false) {
      r.ctx.fillStyle = withAlpha(r.style.color, 0.18);
      r.ctx.fillRect(x, y, w, h);
    }
    stroke(r);
    r.ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w), Math.round(h));
    if (r.style.text) {
      label(r.ctx, r.style.text, x + w / 2, y + h / 2, { color: r.style.color, align: 'center', baseline: 'middle', font: fontOf(12) });
    }
  },
  hit(r, x, y) {
    if (r.pts.length < 2) return false;
    const [a, b] = r.pts;
    return pointInRect(x, y, a.x, a.y, b.x, b.y, TOL);
  },
  handles(r) {
    if (r.pts.length < 2) return r.pts.map((p, i) => ({ ...p, key: i }));
    const [a, b] = r.pts;
    return [
      { x: a.x, y: a.y, key: 0 },
      { x: b.x, y: b.y, key: 1 },
      { x: a.x, y: b.y, key: 'c2' },
      { x: b.x, y: a.y, key: 'c3' },
    ];
  },
  drag(model, key, pt) {
    const [p0, p1] = model.points;
    if (key === 'c2') {
      p0.t = pt.t;
      p1.price = pt.price;
    } else if (key === 'c3') {
      p1.t = pt.t;
      p0.price = pt.price;
    } else model.points[key] = { t: pt.t, price: pt.price };
  },
});

def({
  id: 'fib_retracement',
  label: 'Fib Retracement',
  group: 'fib',
  clicks: 2,
  defaults: baseStyle('#787b86', { width: 1, extendRight: false }),
  axis: 'both',
  render(r) {
    if (r.pts.length < 2) return;
    const [p0, p1] = r.model.points;
    const x1 = Math.min(r.pts[0].x, r.pts[1].x);
    const x2 = r.style.extendRight ? r.w : Math.max(r.pts[0].x, r.pts[1].x);
    const levels = r.style.levels || FIB_RETR_LEVELS.filter((l) => l.r <= 1 || r.style.showExtensions);
    drawFibLevels(r, levels, (k) => p1.price + (p0.price - p1.price) * k, x1, x2);
    stroke(r, 1, 'dashed', withAlpha('#787b86', 0.8));
    line(r.ctx, r.pts[0], r.pts[1]);
  },
  hit(r, x, y) {
    if (r.pts.length < 2) return false;
    const [a, b] = r.pts;
    const x2 = r.style.extendRight ? r.w : Math.max(a.x, b.x);
    return pointInRect(x, y, Math.min(a.x, b.x), a.y, x2, b.y, 3) || distToSegment(x, y, a.x, a.y, b.x, b.y) <= TOL;
  },
});

def({
  id: 'fib_extension',
  label: 'Trend-Based Fib Extension',
  group: 'fib',
  clicks: 3,
  defaults: baseStyle('#787b86', { width: 1 }),
  axis: 'both',
  render(r) {
    const { ctx } = r;
    stroke(r, 1, 'dashed', withAlpha('#787b86', 0.8));
    for (let i = 0; i < r.pts.length - 1; i++) line(ctx, r.pts[i], r.pts[i + 1]);
    if (r.pts.length < 3) return;
    const [p0, p1, p2] = r.model.points;
    const span = Math.max(60, Math.abs(r.pts[1].x - r.pts[0].x));
    const x1 = r.pts[2].x;
    drawFibLevels(r, FIB_EXT_LEVELS, (k) => p2.price + (p1.price - p0.price) * k, x1, x1 + span);
  },
  hit(r, x, y) {
    for (let i = 0; i < r.pts.length - 1; i++) {
      if (distToSegment(x, y, r.pts[i].x, r.pts[i].y, r.pts[i + 1].x, r.pts[i + 1].y) <= TOL) return true;
    }
    if (r.pts.length < 3) return false;
    const [p0, p1, p2] = r.model.points;
    const span = Math.max(60, Math.abs(r.pts[1].x - r.pts[0].x));
    const yA = r.p2y(p2.price);
    const yB = r.p2y(p2.price + (p1.price - p0.price) * 2.618);
    return pointInRect(x, y, r.pts[2].x, yA, r.pts[2].x + span, yB, 2);
  },
});

function positionTool(id, side) {
  const long = side === 'long';
  return {
    id,
    label: long ? 'Long Position' : 'Short Position',
    group: 'measure',
    clicks: 1,
    defaults: { color: long ? '#089981' : '#f23645', width: 1, lineStyle: 'solid', qty: 1 },
    axis: 'price',
    init(model, pt, r) {
      const span = Math.max(Math.abs(r.y2p(0) - r.y2p(r.h)) * 0.08, pt.price * 0.002);
      const right = r.x2t(r.t2x(pt.t) + Math.max(120, r.w * 0.12));
      model.points = [
        { t: pt.t, price: pt.price },
        { t: right, price: long ? pt.price + span * 2 : pt.price - span * 2 },
        { t: right, price: long ? pt.price - span : pt.price + span },
      ];
    },
    render(r) {
      if (r.pts.length < 3) return;
      const { ctx } = r;
      const [pe, ptp, psl] = r.model.points;
      const xE = r.pts[0].x;
      const xR = Math.max(r.pts[1].x, xE + 10);
      const yE = r.pts[0].y;
      const yT = r.pts[1].y;
      const yS = r.pts[2].y;
      const W = xR - xE;
      ctx.fillStyle = 'rgba(8,153,129,0.22)';
      ctx.fillRect(xE, Math.min(yE, yT), W, Math.abs(yT - yE));
      ctx.fillStyle = 'rgba(242,54,69,0.22)';
      ctx.fillRect(xE, Math.min(yE, yS), W, Math.abs(yS - yE));

      // live/replay progress inside the box
      if (r.path && r.path.length) {
        const up = long ? r.lastPrice >= pe.price : r.lastPrice <= pe.price;
        const yL = r.p2y(r.lastPrice);
        const xL = Math.min(xR, r.path[r.path.length - 1].x);
        if (yL != null && xL > xE) {
          ctx.fillStyle = up ? 'rgba(8,153,129,0.25)' : 'rgba(242,54,69,0.25)';
          ctx.fillRect(xE, Math.min(yE, yL), xL - xE, Math.abs(yL - yE));
        }
      }

      ctx.setLineDash([]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#9598a1';
      line(ctx, { x: xE, y: Math.round(yE) + 0.5 }, { x: xR, y: Math.round(yE) + 0.5 });

      if (r.selected || r.hovered || r.creating || r.style.alwaysShowStats !== false) {
        const qty = r.style.qty || 1;
        const tpD = ptp.price - pe.price;
        const slD = psl.price - pe.price;
        const risk = Math.abs(slD);
        const reward = Math.abs(tpD);
        const rr = risk ? reward / risk : 0;
        const font = fontOf(11);
        const cx = xE + W / 2;
        label(ctx, `Target: ${r.fmtPrice(ptp.price)} (${fmtPct(pct(ptp.price, pe.price))}) ${r.fmtPrice(tpD)}, Amount: ${formatCompact(reward * qty)}`, cx, long ? Math.min(yT, yE) - 4 : Math.max(yT, yE) + 4, {
          bg: '#089981', color: '#fff', align: 'center', baseline: long ? 'bottom' : 'top', font,
        });
        label(ctx, `Stop: ${r.fmtPrice(psl.price)} (${fmtPct(pct(psl.price, pe.price))}) ${r.fmtPrice(slD)}, Amount: ${formatCompact(risk * qty)}`, cx, long ? Math.max(yS, yE) + 4 : Math.min(yS, yE) - 4, {
          bg: '#f23645', color: '#fff', align: 'center', baseline: long ? 'top' : 'bottom', font,
        });
        let center = `${long ? 'Long' : 'Short'} ${qty}  ·  Risk/Reward Ratio: ${rr.toFixed(2)}`;
        if (r.lastPrice != null && r.path && r.path.length) {
          const pnl = (long ? r.lastPrice - pe.price : pe.price - r.lastPrice) * qty;
          center += `\nOpen P&L: ${pnl >= 0 ? '+' : ''}${r.fmtPrice(pnl)}`;
        }
        label(ctx, center, cx, yE, { bg: long ? 'rgba(8,153,129,0.95)' : 'rgba(242,54,69,0.95)', color: '#fff', align: 'center', baseline: 'middle', font });
      }
    },
    hit(r, x, y) {
      if (r.pts.length < 3) return false;
      const xE = r.pts[0].x;
      const xR = Math.max(r.pts[1].x, xE + 10);
      return pointInRect(x, y, xE, r.pts[1].y, xR, r.pts[2].y, 3);
    },
    handles(r) {
      if (r.pts.length < 3) return [];
      const xE = r.pts[0].x;
      const xR = Math.max(r.pts[1].x, xE + 10);
      return [
        { x: xE, y: r.pts[0].y, key: 'entry' },
        { x: xE, y: r.pts[1].y, key: 'tp' },
        { x: xE, y: r.pts[2].y, key: 'sl' },
        { x: xR, y: r.pts[0].y, key: 'right' },
      ];
    },
    drag(model, key, pt) {
      const [e, tp, sl] = model.points;
      if (key === 'entry') {
        e.t = pt.t;
        e.price = pt.price;
      } else if (key === 'tp') tp.price = long ? Math.max(pt.price, e.price) : Math.min(pt.price, e.price);
      else if (key === 'sl') sl.price = long ? Math.min(pt.price, e.price) : Math.max(pt.price, e.price);
      else if (key === 'right') {
        if (pt.t > e.t) tp.t = sl.t = pt.t;
      }
    },
  };
}
def(positionTool('long_position', 'long'));
def(positionTool('short_position', 'short'));

def({
  id: 'price_range',
  label: 'Price Range',
  group: 'measure',
  clicks: 2,
  defaults: baseStyle('#2962ff', { width: 1 }),
  axis: 'both',
  render(r) {
    if (r.pts.length < 2) return;
    const { ctx } = r;
    const [a, b] = r.pts;
    const [p0, p1] = r.model.points;
    const up = p1.price >= p0.price;
    const color = up ? '#2962ff' : '#f23645';
    const x = Math.min(a.x, b.x);
    const w = Math.abs(b.x - a.x);
    ctx.fillStyle = withAlpha(color, 0.18);
    ctx.fillRect(x, Math.min(a.y, b.y), w, Math.abs(b.y - a.y));
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    line(ctx, { x, y: Math.round(a.y) + 0.5 }, { x: x + w, y: Math.round(a.y) + 0.5 });
    line(ctx, { x, y: Math.round(b.y) + 0.5 }, { x: x + w, y: Math.round(b.y) + 0.5 });
    const cx = Math.round(x + w / 2) + 0.5;
    line(ctx, { x: cx, y: a.y }, { x: cx, y: b.y });
    ctx.fillStyle = color;
    arrowHead(ctx, { x: cx, y: a.y }, { x: cx, y: b.y }, 7);
    const d = p1.price - p0.price;
    const ticks = r.tick ? Math.round(d / r.tick) : null;
    const txt = `${d >= 0 ? '+' : ''}${r.fmtPrice(d)} (${fmtPct(pct(p1.price, p0.price))})${ticks != null ? `, ${ticks.toLocaleString('en-US')} ticks` : ''}`;
    label(ctx, txt, cx, up ? Math.min(a.y, b.y) - 6 : Math.max(a.y, b.y) + 6, { bg: color, color: '#fff', align: 'center', baseline: up ? 'bottom' : 'top' });
  },
  hit(r, x, y) {
    return r.pts.length >= 2 && pointInRect(x, y, r.pts[0].x, r.pts[0].y, r.pts[1].x, r.pts[1].y, 3);
  },
});

def({
  id: 'date_range',
  label: 'Date Range',
  group: 'measure',
  clicks: 2,
  defaults: baseStyle('#2962ff', { width: 1 }),
  axis: 'both',
  render(r) {
    if (r.pts.length < 2) return;
    const { ctx } = r;
    const [a, b] = r.pts;
    const [p0, p1] = r.model.points;
    const fwd = p1.t >= p0.t;
    const color = fwd ? '#2962ff' : '#f23645';
    const y = Math.min(a.y, b.y);
    const h = Math.abs(b.y - a.y);
    ctx.fillStyle = withAlpha(color, 0.18);
    ctx.fillRect(Math.min(a.x, b.x), y, Math.abs(b.x - a.x), h);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    line(ctx, { x: Math.round(a.x) + 0.5, y }, { x: Math.round(a.x) + 0.5, y: y + h });
    line(ctx, { x: Math.round(b.x) + 0.5, y }, { x: Math.round(b.x) + 0.5, y: y + h });
    const cy = Math.round(y + h / 2) + 0.5;
    line(ctx, { x: a.x, y: cy }, { x: b.x, y: cy });
    ctx.fillStyle = color;
    arrowHead(ctx, { x: a.x, y: cy }, { x: b.x, y: cy }, 7);
    const bars = r.barsBetween(p0.t, p1.t);
    const vol = r.volumeBetween(p0.t, p1.t);
    const txt = `${bars} bars, ${formatDuration(p1.t - p0.t)}${vol ? `\nVol ${formatCompact(vol)}` : ''}`;
    label(ctx, txt, (a.x + b.x) / 2, y + h + 6, { bg: color, color: '#fff', align: 'center', baseline: 'top' });
  },
  hit(r, x, y) {
    return r.pts.length >= 2 && pointInRect(x, y, r.pts[0].x, r.pts[0].y, r.pts[1].x, r.pts[1].y, 3);
  },
});

function textBox(r) {
  const size = r.style.fontSize || 14;
  const lines = String(r.style.text || 'Text').split('\n');
  let w = 40;
  if (measureCtx) {
    measureCtx.font = fontOf(size);
    w = Math.max(...lines.map((l) => measureCtx.measureText(l).width));
  }
  const pad = r.style.bg ? 6 : 2;
  return { x: r.pts[0].x - pad, y: r.pts[0].y - pad, w: w + pad * 2, h: lines.length * size * 1.3 + pad * 2 - size * 0.3, pad, size, lines };
}

def({
  id: 'text',
  label: 'Text',
  group: 'annotation',
  clicks: 1,
  defaults: { color: '#d1d4dc', width: 1, lineStyle: 'solid', text: 'Text', fontSize: 14, bg: null },
  axis: 'both',
  editable: true,
  render(r) {
    const { ctx } = r;
    const b = textBox(r);
    if (r.style.bg) {
      ctx.fillStyle = r.style.bg;
      roundRect(ctx, b.x, b.y, b.w, b.h, 4);
      ctx.fill();
    }
    if (r.selected) {
      ctx.strokeStyle = '#2962ff';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.strokeRect(b.x - 2.5, b.y - 2.5, b.w + 5, b.h + 5);
      ctx.setLineDash([]);
    }
    ctx.font = fontOf(b.size);
    ctx.fillStyle = r.style.color;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    b.lines.forEach((l, i) => ctx.fillText(l, r.pts[0].x, r.pts[0].y + i * b.size * 1.3));
  },
  hit(r, x, y) {
    const b = textBox(r);
    return pointInRect(x, y, b.x, b.y, b.x + b.w, b.y + b.h, 3);
  },
  handles: () => [],
});

def({
  id: 'brush',
  label: 'Brush',
  group: 'shapes',
  clicks: 0,
  defaults: baseStyle('#ff9800', { width: 2 }),
  axis: 'none',
  render(r) {
    if (r.pts.length < 2) return;
    const { ctx } = r;
    stroke(r, null, 'solid');
    ctx.beginPath();
    ctx.moveTo(r.pts[0].x, r.pts[0].y);
    for (let i = 1; i < r.pts.length - 1; i++) {
      const mx = (r.pts[i].x + r.pts[i + 1].x) / 2;
      const my = (r.pts[i].y + r.pts[i + 1].y) / 2;
      ctx.quadraticCurveTo(r.pts[i].x, r.pts[i].y, mx, my);
    }
    const last = r.pts[r.pts.length - 1];
    ctx.lineTo(last.x, last.y);
    ctx.stroke();
  },
  hit(r, x, y) {
    for (let i = 0; i < r.pts.length - 1; i++) {
      if (distToSegment(x, y, r.pts[i].x, r.pts[i].y, r.pts[i + 1].x, r.pts[i + 1].y) <= TOL) return true;
    }
    return false;
  },
  handles: () => [],
});

export const DRAWING_TOOLS = TOOLS;

/** Toolbar grouping (left drawing toolbar). */
export const TOOL_GROUPS = [
  { id: 'lines', label: 'Trend line tools', tools: ['trendline', 'ray', 'extended_line', 'horizontal_line', 'horizontal_ray', 'vertical_line', 'parallel_channel'] },
  { id: 'fib', label: 'Fibonacci tools', tools: ['fib_retracement', 'fib_extension'] },
  { id: 'shapes', label: 'Geometric shapes', tools: ['rectangle', 'brush', 'arrow'] },
  { id: 'annotation', label: 'Annotation tools', tools: ['text'] },
  { id: 'measure', label: 'Prediction and measurement tools', tools: ['long_position', 'short_position', 'price_range', 'date_range'] },
];

const TOOL_ALIASES = {
  hline: 'horizontal_line', horizontal: 'horizontal_line', horizontalline: 'horizontal_line', h_line: 'horizontal_line',
  hray: 'horizontal_ray', vline: 'vertical_line', vertical: 'vertical_line', trend: 'trendline', trend_line: 'trendline',
  line: 'trendline', extended: 'extended_line', channel: 'parallel_channel', rect: 'rectangle', box: 'rectangle',
  fib: 'fib_retracement', fibonacci: 'fib_retracement', fib_retr: 'fib_retracement', fibext: 'fib_extension',
  long: 'long_position', short: 'short_position', longposition: 'long_position', shortposition: 'short_position',
  pricerange: 'price_range', daterange: 'date_range', note: 'text', label: 'text', pen: 'brush',
};

export function normalizeTool(id) {
  if (!id) return null;
  const s = String(id).trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (TOOLS[s]) return s;
  const a = TOOL_ALIASES[s] || TOOL_ALIASES[s.replace(/_/g, '')];
  return a && TOOLS[a] ? a : null;
}

export function getTool(id) {
  return TOOLS[normalizeTool(id)] || null;
}

/** Default handle list: one per point. */
export function toolHandles(tool, r) {
  if (tool.handles) return tool.handles(r);
  return r.pts.map((p, i) => ({ x: p.x, y: p.y, key: i }));
}

export function toolDrag(tool, model, key, pt, r) {
  if (tool.drag) tool.drag(model, key, pt, r);
  else model.points[key] = { t: pt.t, price: pt.price };
}
