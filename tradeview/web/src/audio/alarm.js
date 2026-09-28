// Loud synthesised alarms with WebAudio (§12). No audio files.
//
//   alarm.play({ preset: 'siren'|'klaxon'|'bell'|'beep', volume: 0..1, repeat: n, loop: bool }) -> handle
//   alarm.stop()
//   alarm.unlock()        call from the first user gesture (browsers keep AudioContext suspended until then)
//   alarm.on('state', fn) fn({ playing, unlocked, blocked })
//
// Signal chain: voices -> bus (fade in/out) -> drive (pre-gain, pushes into the compressor) ->
// DynamicsCompressor configured as a brick-wall limiter -> output gain (volume) -> destination.
// The drive stage makes the perceived loudness high while the limiter keeps the output from clipping.

const PRESETS = {
  // Two detuned sawtooth/square oscillators sweeping 650 Hz -> 1500 Hz -> 650 Hz, like an emergency siren.
  siren: {
    period: 1.3,
    schedule(ctx, out, t) {
      const dur = 1.3;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.9, t + 0.03);
      g.gain.setValueAtTime(0.9, t + dur - 0.04);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      g.connect(out);
      const oscs = [];
      for (const [type, detune, level] of [['sawtooth', 0, 0.55], ['square', 7, 0.35], ['triangle', -5, 0.5]]) {
        const o = ctx.createOscillator();
        o.type = type;
        o.detune.value = detune;
        o.frequency.setValueAtTime(650, t);
        o.frequency.linearRampToValueAtTime(1500, t + dur * 0.5);
        o.frequency.linearRampToValueAtTime(650, t + dur);
        const lg = ctx.createGain();
        lg.gain.value = level;
        o.connect(lg).connect(g);
        o.start(t);
        o.stop(t + dur + 0.02);
        oscs.push(o);
      }
      return oscs;
    },
  },
  // Harsh two-tone square-wave horn pulses (car/ship klaxon), with a slight pitch drop at the end of each blast.
  klaxon: {
    period: 0.62,
    schedule(ctx, out, t) {
      const on = 0.42;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(1, t + 0.012);
      g.gain.setValueAtTime(1, t + on - 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t + on);
      // A little band emphasis around 1.2 kHz makes it cut through.
      const peak = ctx.createBiquadFilter();
      peak.type = 'peaking';
      peak.frequency.value = 1200;
      peak.Q.value = 1.2;
      peak.gain.value = 8;
      g.connect(peak).connect(out);
      const oscs = [];
      for (const f of [370, 466, 740]) {
        const o = ctx.createOscillator();
        o.type = 'square';
        o.frequency.setValueAtTime(f, t);
        o.frequency.linearRampToValueAtTime(f * 0.94, t + on);
        const lg = ctx.createGain();
        lg.gain.value = f > 700 ? 0.25 : 0.45;
        o.connect(lg).connect(g);
        o.start(t);
        o.stop(t + on + 0.02);
        oscs.push(o);
      }
      return oscs;
    },
  },
  // Struck bell: inharmonic sine partials with exponential decay, struck twice per cycle.
  bell: {
    period: 1.1,
    schedule(ctx, out, t) {
      const oscs = [];
      const strike = (st, base) => {
        const partials = [[1, 1, 1.6], [2.0, 0.6, 1.2], [2.76, 0.5, 0.9], [5.4, 0.3, 0.6], [8.93, 0.18, 0.4]];
        for (const [ratio, level, decay] of partials) {
          const o = ctx.createOscillator();
          o.type = 'sine';
          o.frequency.value = base * ratio;
          const g = ctx.createGain();
          g.gain.setValueAtTime(0.0001, st);
          g.gain.exponentialRampToValueAtTime(level, st + 0.004);
          g.gain.exponentialRampToValueAtTime(0.0001, st + decay);
          o.connect(g).connect(out);
          o.start(st);
          o.stop(st + decay + 0.05);
          oscs.push(o);
        }
      };
      strike(t, 880);
      strike(t + 0.28, 1175);
      return oscs;
    },
  },
  // Three sharp square beeps at 1.9 kHz (near peak ear sensitivity), then a pause.
  beep: {
    period: 0.95,
    schedule(ctx, out, t) {
      const oscs = [];
      for (let i = 0; i < 3; i++) {
        const st = t + i * 0.2;
        const o = ctx.createOscillator();
        o.type = 'square';
        o.frequency.value = 1900;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, st);
        g.gain.exponentialRampToValueAtTime(0.9, st + 0.005);
        g.gain.setValueAtTime(0.9, st + 0.12);
        g.gain.exponentialRampToValueAtTime(0.0001, st + 0.13);
        o.connect(g).connect(out);
        o.start(st);
        o.stop(st + 0.15);
        oscs.push(o);
      }
      return oscs;
    },
  },
};

export const ALARM_PRESETS = Object.keys(PRESETS);

class Alarm {
  constructor() {
    this.ctx = null;
    this.unlocked = false;
    this.blocked = false;
    this._current = null;
    this._handlers = new Set();
  }

  on(type, fn) {
    if (type !== 'state') return () => {};
    this._handlers.add(fn);
    return () => this._handlers.delete(fn);
  }

  _emit() {
    const s = this.state;
    for (const fn of [...this._handlers]) { try { fn(s); } catch (err) { console.error(err); } }
  }

  get state() {
    return { playing: !!this._current, unlocked: this.unlocked, blocked: this.blocked };
  }

  get playing() { return !!this._current; }

  _ensureCtx() {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    this.ctx = new AC({ latencyHint: 'interactive' });
    this.ctx.addEventListener?.('statechange', () => {
      const running = this.ctx.state === 'running';
      if (running && !this.unlocked) { this.unlocked = true; this.blocked = false; this._emit(); }
    });
    return this.ctx;
  }

  /** Must be called from a user gesture handler (click/keydown/touch). */
  unlock() {
    const ctx = this._ensureCtx();
    if (!ctx) return Promise.resolve(false);
    try {
      // A silent one-sample buffer "primes" playback on Safari/iOS.
      const buf = ctx.createBuffer(1, 1, 22050);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.start(0);
    } catch { /* ignore */ }
    const p = ctx.state === 'suspended' ? ctx.resume() : Promise.resolve();
    return p.then(() => {
      this.unlocked = ctx.state === 'running';
      if (this.unlocked) this.blocked = false;
      this._emit();
      return this.unlocked;
    }).catch(() => false);
  }

  /**
   * Play an alarm. Stops whatever is currently playing.
   * @param {{preset?:string, volume?:number, repeat?:number, loop?:boolean}} opts
   * @returns {{ stop: () => void, done: Promise<void> }}
   */
  play(opts = {}) {
    this.stop();
    const ctx = this._ensureCtx();
    const noop = { stop() {}, done: Promise.resolve() };
    if (!ctx) return noop;
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
      if (ctx.state === 'suspended' && !this.unlocked) {
        this.blocked = true;
        this._emit();
      }
    }
    const preset = PRESETS[opts.preset] || PRESETS.siren;
    const volume = Math.max(0, Math.min(1, opts.volume == null ? 1 : Number(opts.volume)));
    const loop = !!opts.loop;
    const repeat = Math.max(1, Math.round(opts.repeat == null ? 3 : Number(opts.repeat)) || 1);

    const bus = ctx.createGain();
    bus.gain.value = 1;
    const drive = ctx.createGain();
    drive.gain.value = 3.2; // push into the limiter for loudness
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.08;
    const output = ctx.createGain();
    // Perceptual curve so the slider feels linear; the limiter output is roughly -6 dBFS so 1.9 lands near 0 dBFS.
    output.gain.value = Math.pow(volume, 1.6) * 1.9;
    bus.connect(drive).connect(limiter).connect(output).connect(ctx.destination);

    let next = ctx.currentTime + 0.05;
    let count = 0;
    let resolveDone;
    const done = new Promise((r) => { resolveDone = r; });
    const oscs = new Set();
    let finished = false;

    const finish = (immediate) => {
      if (finished) return;
      finished = true;
      clearInterval(timer);
      clearTimeout(endTimer);
      const now = ctx.currentTime;
      try {
        bus.gain.cancelScheduledValues(now);
        bus.gain.setValueAtTime(bus.gain.value, now);
        bus.gain.linearRampToValueAtTime(0, now + (immediate ? 0.04 : 0.01));
      } catch { /* ignore */ }
      setTimeout(() => {
        for (const o of oscs) { try { o.stop(); } catch { /* already stopped */ } }
        try { output.disconnect(); } catch { /* ignore */ }
      }, 80);
      if (this._current === handle) { this._current = null; this._emit(); }
      resolveDone();
    };

    const tick = () => {
      while (next < ctx.currentTime + 0.6 && (loop || count < repeat)) {
        for (const o of preset.schedule(ctx, bus, next)) {
          oscs.add(o);
          o.onended = () => oscs.delete(o);
        }
        next += preset.period;
        count++;
      }
      if (!loop && count >= repeat && !endTimer) {
        endTimer = setTimeout(() => finish(false), Math.max(0, (next - ctx.currentTime) * 1000) + 100);
      }
    };
    let endTimer = null;
    const timer = setInterval(tick, 150);
    const handle = { stop: () => finish(true), done, preset: opts.preset || 'siren', loop };
    this._current = handle;
    tick();
    this._emit();
    return handle;
  }

  stop() {
    if (this._current) this._current.stop();
  }
}

export const alarm = new Alarm();
export default alarm;
