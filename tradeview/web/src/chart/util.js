/** Misc helpers: time normalisation, ids, socket listener disposal, DOM. */

/** Accept ms, seconds, ISO strings or Date and return ms UTC. */
export function toMs(t) {
  if (t == null || t === '') return null;
  if (t instanceof Date) return t.getTime();
  if (typeof t === 'string') {
    if (/^\d+(\.\d+)?$/.test(t)) return toMs(Number(t));
    const p = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(t) || !/T|\d\d:\d\d/.test(t) ? t : t + 'Z');
    return Number.isNaN(p) ? null : p;
  }
  if (typeof t === 'number') return t < 1e11 ? Math.round(t * 1000) : Math.round(t);
  if (typeof t === 'object' && 'year' in t) return Date.UTC(t.year, t.month - 1, t.day);
  return null;
}

/** lightweight-charts time (UTCTimestamp seconds) from ms. */
export const toSec = (ms) => Math.floor(ms / 1000);
export const fromSec = (s) => (typeof s === 'number' ? s * 1000 : toMs(s));

let _seq = 0;
export function uid(prefix = 'id') {
  _seq = (_seq + 1) % 1e6;
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}${_seq.toString(36)}`;
}

/** Subscribe to a socket message type and return a disposer, whatever the client's on() returns. */
export function listen(socket, type, fn) {
  if (!socket || typeof socket.on !== 'function') return () => {};
  const ret = socket.on(type, fn);
  if (typeof ret === 'function') return ret;
  return () => {
    if (typeof socket.off === 'function') socket.off(type, fn);
    else if (typeof socket.removeListener === 'function') socket.removeListener(type, fn);
  };
}

/** Binary search: index of the last element with key <= t, or -1. */
export function lowerIndex(arr, t, key = (x) => x.t) {
  let lo = 0;
  let hi = arr.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (key(arr[mid]) <= t) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

export function el(tag, attrs = {}, children = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of [].concat(children)) {
    if (c == null || c === false) continue;
    e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return e;
}

export function debounce(fn, ms) {
  let h = null;
  const d = (...args) => {
    clearTimeout(h);
    h = setTimeout(() => fn(...args), ms);
  };
  d.cancel = () => clearTimeout(h);
  d.flush = (...args) => {
    clearTimeout(h);
    fn(...args);
  };
  return d;
}

export function throttle(fn, ms) {
  let last = 0;
  let h = null;
  let pendingArgs = null;
  const t = (...args) => {
    const now = Date.now();
    pendingArgs = args;
    if (now - last >= ms) {
      last = now;
      fn(...args);
    } else if (!h) {
      h = setTimeout(() => {
        h = null;
        last = Date.now();
        fn(...pendingArgs);
      }, ms - (now - last));
    }
  };
  t.cancel = () => {
    clearTimeout(h);
    h = null;
  };
  return t;
}

export function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

/** Parse an API list response that may be an array or wrapped under a key. */
export function unwrapList(res, key) {
  if (Array.isArray(res)) return res;
  if (res && Array.isArray(res[key])) return res[key];
  if (res && Array.isArray(res.data)) return res.data;
  if (res && Array.isArray(res.items)) return res.items;
  return [];
}

export function downloadDataUrl(url, filename) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
