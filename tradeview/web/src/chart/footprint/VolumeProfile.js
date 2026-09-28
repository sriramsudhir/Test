import { THEME, withAlpha } from '../theme.js';
import { formatCompact } from '../format.js';

/**
 * Visible-range Volume Profile (VPVR) as a series primitive, drawn on the right side of the main pane.
 * Uses footprint levels (exact bid/ask per price) when available, otherwise distributes each candle's
 * volume uniformly across its high–low range (up/down split by candle direction).
 * Draws POC (point of control) and the value area (VAH/VAL, default 70%).
 */

export function computeProfile(candles, footprint, { rows = 60, valueArea = 0.7 } = {}) {
  if (!candles.length) return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (const c of candles) {
    if (c.l < lo) lo = c.l;
    if (c.h > hi) hi = c.h;
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
  if (hi - lo <= 0) hi = lo + Math.max(Math.abs(lo) * 1e-4, 1e-8);
  const step = (hi - lo) / rows;
  const up = new Float64Array(rows);
  const dn = new Float64Array(rows);
  const rowOf = (p) => Math.max(0, Math.min(rows - 1, Math.floor((p - lo) / step)));

  for (const c of candles) {
    const fp = footprint && footprint.get(c.t);
    if (fp && fp.levels && fp.levels.length) {
      for (const l of fp.levels) {
        const r = rowOf(+l.p);
        up[r] += +l.ask || 0;
        dn[r] += +l.bid || 0;
      }
      continue;
    }
    const v = c.v || 0;
    if (!v) continue;
    const target = c.c >= c.o ? up : dn;
    const r0 = rowOf(c.l);
    const r1 = rowOf(c.h);
    const span = c.h - c.l;
    if (r0 === r1 || span <= 0) {
      target[r0] += v;
      continue;
    }
    for (let r = r0; r <= r1; r++) {
      const a = Math.max(c.l, lo + r * step);
      const b = Math.min(c.h, lo + (r + 1) * step);
      if (b > a) target[r] += (v * (b - a)) / span;
    }
  }

  let poc = 0;
  let max = 0;
  let total = 0;
  for (let r = 0; r < rows; r++) {
    const t = up[r] + dn[r];
    total += t;
    if (t > max) {
      max = t;
      poc = r;
    }
  }
  // Value area: expand from POC towards the larger neighbour until valueArea% of volume is covered.
  let a = poc;
  let b = poc;
  let acc = max;
  while (acc < total * valueArea && (a > 0 || b < rows - 1)) {
    const va = a > 0 ? up[a - 1] + dn[a - 1] : -1;
    const vb = b < rows - 1 ? up[b + 1] + dn[b + 1] : -1;
    if (vb >= va) acc += up[++b] + dn[b];
    else acc += up[--a] + dn[a];
  }
  return {
    lo, hi, step, rows, up, dn, max, total,
    poc, pocPrice: lo + (poc + 0.5) * step,
    vaLow: a, vaHigh: b,
    val: lo + a * step, vah: lo + (b + 1) * step,
  };
}

class ProfileRenderer {
  constructor(src) {
    this._src = src;
  }

  draw(target) {
    const s = this._src;
    const prof = s._profile;
    if (!s._enabled || !prof || !s._series || !prof.max) return;
    const series = s._series;
    const opt = s._options;
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      const W = Math.min(mediaSize.width * opt.widthPct, opt.maxWidth);
      const xr = mediaSize.width - 2;
      ctx.save();
      for (let r = 0; r < prof.rows; r++) {
        const y1 = series.priceToCoordinate(prof.lo + (r + 1) * prof.step);
        const y2 = series.priceToCoordinate(prof.lo + r * prof.step);
        if (y1 == null || y2 == null) continue;
        const top = Math.min(y1, y2);
        const h = Math.max(1, Math.abs(y2 - y1) - (Math.abs(y2 - y1) > 3 ? 1 : 0));
        const inVa = r >= prof.vaLow && r <= prof.vaHigh;
        const upLen = (prof.up[r] / prof.max) * W;
        const dnLen = (prof.dn[r] / prof.max) * W;
        const alpha = inVa ? opt.vaAlpha : opt.alpha;
        ctx.fillStyle = withAlpha(opt.upColor, alpha);
        ctx.fillRect(xr - upLen - dnLen, top, upLen, h);
        ctx.fillStyle = withAlpha(opt.downColor, alpha);
        ctx.fillRect(xr - dnLen, top, dnLen, h);
      }
      const label = (price, text, color, dashed, full) => {
        const y = series.priceToCoordinate(price);
        if (y == null) return;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.setLineDash(dashed ? [4, 3] : []);
        ctx.beginPath();
        ctx.moveTo(full ? 0 : xr - W, Math.round(y) + 0.5);
        ctx.lineTo(xr, Math.round(y) + 0.5);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = `10px ${THEME.font}`;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        ctx.fillStyle = color;
        ctx.fillText(text, xr - W - 4, y - 1);
      };
      label(prof.pocPrice, 'POC', opt.pocColor, false, opt.pocFullWidth);
      label(prof.vah, 'VAH', withAlpha(opt.vaColor, 0.9), true, false);
      label(prof.val, 'VAL', withAlpha(opt.vaColor, 0.9), true, false);
      ctx.font = `10px ${THEME.font}`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'top';
      ctx.fillStyle = THEME.muted;
      ctx.fillText(`VPVR Σ ${formatCompact(prof.total)}`, xr - 2, 4);
      ctx.restore();
    });
  }
}

class ProfileView {
  constructor(src) {
    this._renderer = new ProfileRenderer(src);
  }
  zOrder() {
    return 'bottom';
  }
  renderer() {
    return this._renderer;
  }
}

export class VolumeProfilePrimitive {
  /**
   * @param {() => { candles: any[], footprint?: Map<number, any>, key: string }} provider visible-range data
   */
  constructor(provider, options = {}) {
    this._provider = provider;
    this._options = {
      rows: 60,
      valueArea: 0.7,
      widthPct: 0.28,
      maxWidth: 320,
      alpha: 0.22,
      vaAlpha: 0.42,
      upColor: '#26a69a',
      downColor: '#ef5350',
      pocColor: THEME.poc,
      vaColor: '#b2b5be',
      pocFullWidth: true,
      ...options,
    };
    this._enabled = true;
    this._views = [new ProfileView(this)];
    this._profile = null;
    this._key = '';
    this._series = null;
    this._requestUpdate = null;
  }

  attached({ series, requestUpdate }) {
    this._series = series;
    this._requestUpdate = requestUpdate;
  }

  detached() {
    this._series = null;
    this._requestUpdate = null;
  }

  applyOptions(o) {
    Object.assign(this._options, o);
    this._key = '';
    this._requestUpdate?.();
  }

  setEnabled(on) {
    this._enabled = !!on;
    this._requestUpdate?.();
  }

  get enabled() {
    return this._enabled;
  }

  invalidate() {
    this._key = '';
    this._requestUpdate?.();
  }

  updateAllViews() {
    if (!this._enabled) return;
    const d = this._provider();
    if (!d) return;
    const key = `${d.key}|${this._options.rows}|${this._options.valueArea}`;
    if (key === this._key) return;
    this._key = key;
    this._profile = computeProfile(d.candles, d.footprint, this._options);
  }

  paneViews() {
    return this._views;
  }
}
