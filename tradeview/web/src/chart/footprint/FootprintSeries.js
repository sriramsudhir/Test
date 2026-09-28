import { customSeriesDefaultOptions } from 'lightweight-charts';
import { THEME, withAlpha } from '../theme.js';
import { formatCell } from '../format.js';
import { toSec } from '../util.js';

/**
 * Footprint / cluster chart as a lightweight-charts v5 custom series.
 *
 * Data item: { time, open, high, low, close, volume, levels:[{p,bid,ask}] (ascending p), poc, delta, tick }
 * Modes: 'bidask' (bid × ask numbers), 'delta' (ask − bid per level), 'profile' (per-bar volume profile).
 * Diagonal imbalance: ask[i] >= ratio × bid[i-1] (buyers lifting) and bid[i] >= ratio × ask[i+1] (sellers hitting).
 * When cells get too small for text, each level is drawn as a heat-coloured cell instead.
 */

export const FOOTPRINT_DEFAULTS = {
  ...customSeriesDefaultOptions,
  color: THEME.up,
  mode: 'bidask',
  imbalanceRatio: 3,
  showImbalance: true,
  showPoc: true,
  showSummary: true,
  upColor: THEME.up,
  downColor: THEME.down,
  textColor: '#d1d4dc',
  imbalanceUpColor: '#00e676',
  imbalanceDownColor: '#ff5252',
  pocColor: THEME.poc,
};

/** Build the custom-series data item for one bar from a candle and an optional footprint bar. */
export function toFootprintItem(candle, fp) {
  const item = {
    time: toSec(candle.t),
    open: candle.o,
    high: candle.h,
    low: candle.l,
    close: candle.c,
    volume: candle.v || 0,
    levels: null,
    poc: null,
    delta: null,
    tick: null,
  };
  if (fp && Array.isArray(fp.levels) && fp.levels.length) {
    const levels = fp.levels
      .map((l) => ({ p: +l.p, bid: +l.bid || 0, ask: +l.ask || 0 }))
      .sort((a, b) => a.p - b.p);
    let tick = +fp.tick;
    if (!(tick > 0)) {
      tick = Infinity;
      for (let i = 1; i < levels.length; i++) tick = Math.min(tick, levels[i].p - levels[i - 1].p);
      if (!Number.isFinite(tick) || tick <= 0) tick = Math.max((candle.h - candle.l) / 10, 1e-8);
    }
    let poc = fp.poc;
    let delta = fp.delta;
    let vol = 0;
    let best = -1;
    let d = 0;
    for (const l of levels) {
      const t = l.bid + l.ask;
      vol += t;
      d += l.ask - l.bid;
      if (t > best) {
        best = t;
        if (poc == null) poc = l.p;
      }
    }
    if (fp.poc == null) {
      let bp = levels[0].p;
      let bv = -1;
      for (const l of levels) if (l.bid + l.ask > bv) (bv = l.bid + l.ask), (bp = l.p);
      poc = bp;
    }
    item.levels = levels;
    item.tick = tick;
    item.poc = poc;
    item.delta = delta != null ? +delta : d;
    item.volume = candle.v || vol;
    // Make sure the bar's range covers all levels (footprint may be bucketed wider than OHLC)
    item.high = Math.max(item.high, levels[levels.length - 1].p + tick);
    item.low = Math.min(item.low, levels[0].p);
  }
  return item;
}

class FootprintRenderer {
  constructor() {
    this._data = null;
    this._options = null;
  }

  update(data, options) {
    this._data = data;
    this._options = options;
  }

  draw(target, priceToCoordinate) {
    const data = this._data;
    const opt = this._options;
    if (!data || !data.visibleRange || !data.bars.length || !opt) return;
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      ctx.save();
      const w = data.barSpacing;
      const { from, to } = data.visibleRange;
      for (let i = from; i < to; i++) {
        const bar = data.bars[i];
        if (!bar) continue;
        this._drawBar(ctx, bar.x, w, bar.originalData, priceToCoordinate, opt, mediaSize);
      }
      ctx.restore();
    });
  }

  _drawBar(ctx, x, w, d, p2c, opt, mediaSize) {
    if (d.close == null) return;
    const up = d.close >= d.open;
    const color = up ? opt.upColor : opt.downColor;
    const yH = p2c(d.high);
    const yL = p2c(d.low);
    const yO = p2c(d.open);
    const yC = p2c(d.close);
    if (yH == null || yL == null || yO == null || yC == null) return;

    const xL = x - w / 2;
    if (w < 3 || !d.levels) {
      // plain candle
      ctx.fillStyle = color;
      const bw = Math.max(1, Math.floor(Math.min(w * 0.7, 14)));
      ctx.fillRect(Math.round(x) - 0.5, yH, 1, Math.max(1, yL - yH));
      if (w >= 3) ctx.fillRect(Math.round(x - bw / 2), Math.min(yO, yC), bw, Math.max(1, Math.abs(yC - yO)));
      return;
    }

    const levels = d.levels;
    const tick = d.tick;
    const cellH = Math.abs(p2c(levels[0].p) - p2c(levels[0].p + tick));

    // Candle strip on the left of the cluster.
    const stripW = Math.max(2, Math.min(8, Math.round(w * 0.09)));
    const stripX = xL + 1;
    ctx.fillStyle = color;
    ctx.fillRect(stripX + stripW / 2 - 0.5, yH, 1, Math.max(1, yL - yH));
    ctx.fillRect(stripX, Math.min(yO, yC), stripW, Math.max(1, Math.abs(yC - yO)));

    const cx = stripX + stripW + 2;
    const cw = Math.max(1, xL + w - 2 - cx);
    const mode = opt.mode || 'bidask';
    const textMode = cellH >= 11.5 && cw >= (mode === 'bidask' ? 46 : 26);

    let maxVol = 0;
    let maxSide = 0;
    let maxAbsDelta = 0;
    for (const l of levels) {
      maxVol = Math.max(maxVol, l.bid + l.ask);
      maxSide = Math.max(maxSide, l.bid, l.ask);
      maxAbsDelta = Math.max(maxAbsDelta, Math.abs(l.ask - l.bid));
    }
    maxVol ||= 1;
    maxSide ||= 1;
    maxAbsDelta ||= 1;

    const ratio = opt.imbalanceRatio > 0 ? opt.imbalanceRatio : 3;
    const fontSize = Math.max(9, Math.min(12, Math.floor(cellH * 0.72)));
    if (textMode) {
      ctx.font = `${fontSize}px ${THEME.font}`;
      ctx.textBaseline = 'middle';
    }

    for (let i = 0; i < levels.length; i++) {
      const l = levels[i];
      const yTop = p2c(l.p + tick);
      const yBot = p2c(l.p);
      if (yTop == null || yBot == null) continue;
      if (yBot < -cellH || yTop > mediaSize.height + cellH) continue;
      const top = Math.round(Math.min(yTop, yBot));
      const h = Math.max(1, Math.round(Math.abs(yBot - yTop)) - (cellH > 4 ? 1 : 0));
      const total = l.bid + l.ask;
      const delta = l.ask - l.bid;

      if (!textMode) {
        // Heat cell
        const intensity = total / maxVol;
        ctx.fillStyle = withAlpha(delta >= 0 ? opt.upColor : opt.downColor, 0.12 + 0.78 * intensity);
        if (mode === 'profile') ctx.fillRect(cx, top, Math.max(1, cw * intensity), h);
        else ctx.fillRect(cx, top, cw, h);
        continue;
      }

      const midY = top + h / 2;
      if (mode === 'bidask') {
        const half = cw / 2;
        ctx.fillStyle = withAlpha(opt.downColor, 0.06 + 0.42 * (l.bid / maxSide));
        ctx.fillRect(cx, top, half - 0.5, h);
        ctx.fillStyle = withAlpha(opt.upColor, 0.06 + 0.42 * (l.ask / maxSide));
        ctx.fillRect(cx + half + 0.5, top, half - 0.5, h);

        const below = levels[i - 1];
        const above = levels[i + 1];
        const near = (a, b) => Math.abs(a - b) < tick * 0.01;
        const askImb = opt.showImbalance && below && near(below.p, l.p - tick) && below.bid > 0 && l.ask >= ratio * below.bid;
        const bidImb = opt.showImbalance && above && near(above.p, l.p + tick) && above.ask > 0 && l.bid >= ratio * above.ask;

        if (askImb) {
          ctx.fillStyle = withAlpha(opt.imbalanceUpColor, 0.28);
          ctx.fillRect(cx + half + 0.5, top, half - 0.5, h);
        }
        if (bidImb) {
          ctx.fillStyle = withAlpha(opt.imbalanceDownColor, 0.28);
          ctx.fillRect(cx, top, half - 0.5, h);
        }
        ctx.font = `${bidImb ? 'bold ' : ''}${fontSize}px ${THEME.font}`;
        ctx.textAlign = 'right';
        ctx.fillStyle = bidImb ? opt.imbalanceDownColor : opt.textColor;
        ctx.fillText(formatCell(l.bid), cx + half - 4, midY);
        ctx.font = `${askImb ? 'bold ' : ''}${fontSize}px ${THEME.font}`;
        ctx.textAlign = 'left';
        ctx.fillStyle = askImb ? opt.imbalanceUpColor : opt.textColor;
        ctx.fillText(formatCell(l.ask), cx + half + 4, midY);
        ctx.fillStyle = 'rgba(120,123,134,0.55)';
        ctx.fillRect(cx + half - 0.5, top + 2, 1, Math.max(1, h - 4));
      } else if (mode === 'delta') {
        ctx.fillStyle = withAlpha(delta >= 0 ? opt.upColor : opt.downColor, 0.08 + 0.55 * (Math.abs(delta) / maxAbsDelta));
        ctx.fillRect(cx, top, cw, h);
        ctx.textAlign = 'center';
        ctx.font = `${fontSize}px ${THEME.font}`;
        ctx.fillStyle = delta >= 0 ? '#b2dfdb' : '#ffcdd2';
        ctx.fillText((delta > 0 ? '+' : '') + formatCell(delta), cx + cw / 2, midY);
      } else {
        // per-bar volume profile
        const len = Math.max(1, (total / maxVol) * cw);
        const askLen = total ? len * (l.ask / total) : 0;
        ctx.fillStyle = withAlpha(opt.upColor, 0.55);
        ctx.fillRect(cx, top, askLen, h);
        ctx.fillStyle = withAlpha(opt.downColor, 0.55);
        ctx.fillRect(cx + askLen, top, len - askLen, h);
        ctx.textAlign = 'left';
        ctx.font = `${fontSize}px ${THEME.font}`;
        ctx.fillStyle = opt.textColor;
        ctx.fillText(formatCell(total), cx + 3, midY);
      }
    }

    // POC
    if (opt.showPoc && d.poc != null) {
      const yTop = p2c(d.poc + tick);
      const yBot = p2c(d.poc);
      if (yTop != null && yBot != null) {
        ctx.strokeStyle = opt.pocColor;
        ctx.lineWidth = textMode ? 1.5 : 1;
        const top = Math.round(Math.min(yTop, yBot)) + 0.5;
        const h = Math.max(1, Math.round(Math.abs(yBot - yTop)) - 1);
        if (textMode || cellH >= 2) ctx.strokeRect(cx + 0.5, top, cw - 1, h);
        else {
          ctx.fillStyle = opt.pocColor;
          ctx.fillRect(cx, top, cw, 1);
        }
      }
    }

    // Summary: delta and volume under the bar
    if (opt.showSummary && w >= 34) {
      const bottom = Math.max(yL, p2c(levels[0].p) ?? yL);
      const fs = Math.max(9, Math.min(11, Math.floor(w / 7)));
      ctx.font = `${fs}px ${THEME.font}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const dv = d.delta ?? 0;
      ctx.fillStyle = dv >= 0 ? opt.upColor : opt.downColor;
      ctx.fillText(`Δ ${(dv > 0 ? '+' : '') + formatCell(dv)}`, xL + w / 2, bottom + 5);
      ctx.fillStyle = THEME.muted;
      ctx.fillText(`V ${formatCell(d.volume)}`, xL + w / 2, bottom + 7 + fs);
    }
  }
}

export class FootprintSeries {
  constructor() {
    this._renderer = new FootprintRenderer();
  }

  priceValueBuilder(item) {
    return [item.low, item.high, item.close];
  }

  isWhitespace(item) {
    return item.close === undefined || item.close === null;
  }

  renderer() {
    return this._renderer;
  }

  update(data, options) {
    this._renderer.update(data, options);
  }

  defaultOptions() {
    return { ...FOOTPRINT_DEFAULTS };
  }

  destroy() {
    this._renderer = new FootprintRenderer();
  }
}
