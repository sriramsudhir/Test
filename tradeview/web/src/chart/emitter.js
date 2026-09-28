/** Tiny event emitter used by all chart-core classes. */
export class Emitter {
  constructor() {
    /** @type {Map<string, Set<Function>>} */
    this._handlers = new Map();
  }

  /** Subscribe; returns an unsubscribe function. */
  on(name, fn) {
    let set = this._handlers.get(name);
    if (!set) this._handlers.set(name, (set = new Set()));
    set.add(fn);
    return () => this.off(name, fn);
  }

  once(name, fn) {
    const off = this.on(name, (...args) => {
      off();
      fn(...args);
    });
    return off;
  }

  off(name, fn) {
    const set = this._handlers.get(name);
    if (!set) return;
    if (fn) set.delete(fn);
    else set.clear();
  }

  emit(name, ...args) {
    const set = this._handlers.get(name);
    if (!set || !set.size) return;
    for (const fn of [...set]) {
      try {
        fn(...args);
      } catch (err) {
        console.error(`[chart] handler for "${name}" failed`, err);
      }
    }
  }

  removeAllListeners() {
    this._handlers.clear();
  }
}
