/**
 * Pure candle transforms for derived chart types (Heikin Ashi, Renko, Range bars).
 * Input/output candles are { t, o, h, l, c, v } with t in ms, ascending.
 */

export function heikinAshi(candles) {
  const out = new Array(candles.length);
  let prev = null;
  for (let i = 0; i < candles.length; i++) {
    const k = candles[i];
    out[i] = prev = heikinAshiNext(prev, k);
  }
  return out;
}

export function heikinAshiNext(prevHa, k) {
  const c = (k.o + k.h + k.l + k.c) / 4;
  const o = prevHa ? (prevHa.o + prevHa.c) / 2 : (k.o + k.c) / 2;
  return { t: k.t, o, h: Math.max(k.h, o, c), l: Math.min(k.l, o, c), c, v: k.v };
}

/** Wilder ATR of the last `length` bars. */
export function atr(candles, length = 14) {
  if (candles.length < 2) return candles.length ? candles[0].h - candles[0].l : 0;
  let value = null;
  for (let i = 1; i < candles.length; i++) {
    const k = candles[i];
    const pc = candles[i - 1].c;
    const tr = Math.max(k.h - k.l, Math.abs(k.h - pc), Math.abs(k.l - pc));
    if (value == null) value = tr;
    else if (i <= length) value = (value * (i - 1) + tr) / i;
    else value = (value * (length - 1) + tr) / length;
  }
  return value;
}

/** Round a box size to a "nice" value given the tick size. */
export function niceBox(v, tick = 0) {
  if (!(v > 0)) return tick || 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const m = v / p;
  const nice = m < 1.5 ? 1 : m < 2.25 ? 2 : m < 3.5 ? 2.5 : m < 7.5 ? 5 : 10;
  const r = nice * p;
  return tick ? Math.max(tick, Math.round(r / tick) * tick) : r;
}

/**
 * Traditional close-based Renko with 2-box reversal.
 * opts: { mode: 'atr'|'fixed', boxSize, atrLength }
 * Brick times are the source bar time, bumped by >= minStep ms to stay strictly increasing.
 */
export function renko(candles, opts = {}) {
  if (!candles.length) return { bars: [], box: 0 };
  const box = opts.mode === 'fixed' && opts.boxSize > 0 ? opts.boxSize : niceBox(atr(candles, opts.atrLength || 14), opts.tick);
  const minStep = opts.minStep || 1000;
  const bars = [];
  let base = Math.floor(candles[0].c / box) * box;
  let dir = 0; // 1 up, -1 down
  let lastT = -Infinity;
  let vAcc = 0;
  const push = (t, o, c) => {
    const tt = Math.max(t, lastT + minStep);
    lastT = tt;
    bars.push({ t: tt, o, h: Math.max(o, c), l: Math.min(o, c), c, v: vAcc });
    vAcc = 0;
  };
  for (const k of candles) {
    vAcc += k.v || 0;
    const price = k.c;
    let loops = 0;
    while (loops++ < 500) {
      if (dir >= 0 && price >= base + box) {
        push(k.t, base, base + box);
        base += box;
        dir = 1;
      } else if (dir <= 0 && price <= base - box) {
        push(k.t, base, base - box);
        base -= box;
        dir = -1;
      } else if (dir === 1 && price <= base - 2 * box) {
        push(k.t, base - box, base - 2 * box);
        base -= 2 * box;
        dir = -1;
      } else if (dir === -1 && price >= base + 2 * box) {
        push(k.t, base + box, base + 2 * box);
        base += 2 * box;
        dir = 1;
      } else break;
    }
  }
  return { bars, box };
}

/**
 * Range bars: each bar spans exactly `range` from low to high. The intrabar path of each source candle is
 * approximated as open → nearer extreme → farther extreme → close.
 */
export function rangeBars(candles, opts = {}) {
  if (!candles.length) return { bars: [], range: 0 };
  const range = opts.range > 0 ? opts.range : niceBox(atr(candles, 14) * 0.5, opts.tick);
  const minStep = opts.minStep || 1000;
  const bars = [];
  let cur = null;
  let lastT = -Infinity;
  const open = (t, p) => {
    const tt = Math.max(t, lastT + minStep);
    lastT = tt;
    cur = { t: tt, o: p, h: p, l: p, c: p, v: 0 };
  };
  const walk = (t, target) => {
    let guard = 0;
    while (guard++ < 1000) {
      if (target > cur.c) {
        const cap = cur.l + range;
        if (target >= cap) {
          cur.h = cap;
          cur.c = cap;
          bars.push(cur);
          open(t, cap);
          continue;
        }
        cur.c = target;
        cur.h = Math.max(cur.h, target);
      } else if (target < cur.c) {
        const cap = cur.h - range;
        if (target <= cap) {
          cur.l = cap;
          cur.c = cap;
          bars.push(cur);
          open(t, cap);
          continue;
        }
        cur.c = target;
        cur.l = Math.min(cur.l, target);
      }
      break;
    }
  };
  for (const k of candles) {
    if (!cur) open(k.t, k.o);
    const up = k.c >= k.o;
    const path = up ? [k.o, k.l, k.h, k.c] : [k.o, k.h, k.l, k.c];
    for (const p of path) walk(k.t, p);
    cur.v += k.v || 0;
  }
  if (cur) bars.push(cur);
  return { bars, range };
}
