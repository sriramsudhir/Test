// Laya decision service (§6, §11).
//   LAYA_MODE=local  -> lazy `await import('@receptron/laya')`, `Laya.load()`, `laya.systemOne(state, questions)`
//   LAYA_MODE=http   -> POST `${LAYA_URL}/v1/systemone` with {state, questions} (Python laya-serve)
//   LAYA_MODE=off    -> always unavailable
// `decide()` never throws: it resolves to `{answers, usage?}` or `null` when Laya is unavailable.

const LOCAL_RETRY_MS = 5 * 60 * 1000;
const HTTP_RETRY_MS = 15 * 1000;
const DEFAULT_TIMEOUT_MS = 20000;

/**
 * @param {object} ctx  server ctx (uses ctx.config.layaMode / layaUrl, ctx.log)
 * @param {object} [deps]  test seams: { importer: () => Promise<module>, fetch, timeoutMs }
 */
export function createLayaService(ctx = {}, deps = {}) {
  const cfg = ctx.config || {};
  const mode = String(cfg.layaMode ?? cfg.laya?.mode ?? process.env.LAYA_MODE ?? 'local').toLowerCase();
  const url = String(cfg.layaUrl ?? cfg.laya?.url ?? process.env.LAYA_URL ?? 'http://127.0.0.1:8000').replace(/\/+$/, '');
  const log = ctx.log || console;
  const importer = deps.importer || (() => import('@receptron/laya'));
  const doFetch = deps.fetch || globalThis.fetch;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const st = {
    mode: ['local', 'http', 'off'].includes(mode) ? mode : 'off',
    state: mode === 'off' ? 'off' : 'idle', // idle | loading | ready | error | off
    model: null,
    error: null,
    failedAt: 0,
    lastLatencyMs: null,
    calls: 0,
  };
  let laya = null; // local instance
  let mod = null;
  let loading = null;

  async function loadLocal() {
    if (laya) return laya;
    if (st.state === 'error' && Date.now() - st.failedAt < LOCAL_RETRY_MS) return null;
    if (!loading) {
      st.state = 'loading';
      loading = (async () => {
        try {
          mod = await importer();
          const Laya = mod.Laya ?? mod.default?.Laya ?? mod.default ?? mod;
          if (typeof Laya?.load !== 'function') throw new Error('@receptron/laya does not export Laya.load()');
          const inst = await Laya.load();
          if (typeof inst?.systemOne !== 'function') throw new Error('Laya instance has no systemOne()');
          laya = inst;
          st.state = 'ready';
          st.error = null;
          st.model = inst.model?.name ?? inst.modelName ?? inst.model ?? mod.MODEL ?? '@receptron/laya';
          if (typeof st.model !== 'string') st.model = '@receptron/laya';
          log.info?.({ model: st.model }, 'laya loaded (local)');
          return laya;
        } catch (err) {
          st.state = 'error';
          st.error = `local Laya unavailable: ${err?.message || err}`;
          st.failedAt = Date.now();
          log.warn?.({ err: err?.message }, 'laya local load failed');
          return null;
        } finally {
          loading = null;
        }
      })();
    }
    return loading;
  }

  async function decideLocal(state, questions) {
    const inst = await loadLocal();
    if (!inst) return null;
    return withTimeout(Promise.resolve(inst.systemOne(state, questions)), timeoutMs);
  }

  async function decideHttp(state, questions) {
    if (st.state === 'error' && Date.now() - st.failedAt < HTTP_RETRY_MS) return null;
    if (typeof doFetch !== 'function') throw new Error('fetch is not available');
    if (st.state !== 'ready') st.state = 'loading';
    const res = await doFetch(`${url}/v1/systemone`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state, questions }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`laya-serve HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`);
    }
    const body = await res.json();
    st.state = 'ready';
    st.error = null;
    if (body?.model) st.model = body.model;
    else if (!st.model) st.model = 'laya-serve';
    return body;
  }

  return {
    /** @returns {{ready:boolean, mode:string, model:string|null, state:string, error?:string, url?:string}} */
    status() {
      return {
        ready: st.state === 'ready',
        mode: st.mode,
        model: st.model,
        state: st.state,
        ...(st.error ? { error: st.error } : {}),
        ...(st.mode === 'http' ? { url } : {}),
        calls: st.calls,
        lastLatencyMs: st.lastLatencyMs,
      };
    },

    /** Kick off lazy loading without waiting (optional warm-up). */
    warmup() {
      if (st.mode === 'local') loadLocal().catch(() => {});
    },

    /**
     * @param {object} state      market state (see laya/questions.js buildMarketState)
     * @param {object} questions  question set (see buildQuestions)
     * @returns {Promise<{answers:object, usage?:object}|null>}
     */
    async decide(state, questions) {
      if (st.mode === 'off') return null;
      const t0 = Date.now();
      try {
        const out = st.mode === 'local' ? await decideLocal(state, questions) : await decideHttp(state, questions);
        if (!out) return null;
        st.calls++;
        st.state = 'ready';
        st.error = null;
        st.lastLatencyMs = Date.now() - t0;
        if (!out.answers || typeof out.answers !== 'object') throw new Error('Laya returned no answers');
        return { answers: out.answers, ...(out.usage ? { usage: out.usage } : {}) };
      } catch (err) {
        st.state = 'error';
        st.error = err?.message || String(err);
        st.failedAt = Date.now();
        log.warn?.({ err: st.error }, 'laya decide failed');
        return null;
      }
    },
  };
}

function withTimeout(p, ms) {
  let timer;
  return Promise.race([
    p,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Laya timed out after ${ms} ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

export default createLayaService;
