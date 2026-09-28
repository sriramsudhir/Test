// Driver 'claude-code' (§13.2, DEFAULT): runs the agent through the Claude Agent SDK so it uses the
// user's Claude Pro/Max subscription login instead of an API key.
//
// Auth: the `claude` CLI logged in on the server (`claude` -> /login, credentials in ~/.claude) or
// CLAUDE_CODE_OAUTH_TOKEN (from `claude setup-token`). NOTE: if ANTHROPIC_API_KEY is set in the
// server environment the SDK uses it instead (and bills the API account).
//
// Only the §7 tools are exposed, through an in-process SDK MCP server; every built-in Claude Code
// tool (Bash, Read, Edit, Write, WebFetch, ...) is disabled.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TOOLS } from '../tools.js';
import { SYSTEM_PROMPT, formatContext } from '../prompt.js';
import { createExecutor } from '../executor.js';
import { toZodShape } from './zodSchema.js';

export const MCP_SERVER = 'tradeview';
export const MAX_TURNS = 12;
export const TOOL_NAMES = TOOLS.map((t) => t.name);
export const ALLOWED_TOOLS = TOOL_NAMES.map((n) => `mcp__${MCP_SERVER}__${n}`);
const BUILTIN_TOOLS = [
  'Bash', 'BashOutput', 'KillShell', 'Read', 'Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'Glob', 'Grep',
  'WebFetch', 'WebSearch', 'Task', 'Agent', 'TodoWrite', 'ExitPlanMode', 'Skill', 'SlashCommand', 'AskUserQuestion',
];

const FALLBACK_USAGE_PREFIXES = ["You've hit your", "You've reached your", "You're out of usage credits", "You're out of extra usage"];

// ---- driver-wide state (for /api/agent/status) --------------------------------------------------
const state = {
  sdk: null, // loaded module
  sdkError: null,
  lastError: null,
  lastErrorAt: 0,
  limitedUntil: 0,
  lastOkAt: 0,
  apiKeySource: null,
};

/** In-memory cache of chat session -> SDK session id (also persisted in ctx.repos.chat as role 'meta'). */
const sdkSessions = new Map();
const MAX_CACHED_SESSIONS = 200;

async function loadSdk(loader) {
  if (state.sdk && !loader) return state.sdk;
  try {
    const mod = await (loader ? loader() : import('@anthropic-ai/claude-agent-sdk'));
    if (typeof mod?.query !== 'function' || typeof mod?.createSdkMcpServer !== 'function' || typeof mod?.tool !== 'function') {
      throw new Error('unexpected @anthropic-ai/claude-agent-sdk exports');
    }
    if (!loader) state.sdk = mod;
    state.sdkError = null;
    return mod;
  } catch (err) {
    state.sdkError = err?.message || String(err);
    return null;
  }
}

function credentialSource(cfg = {}, env = process.env) {
  if (env.ANTHROPIC_API_KEY || cfg.anthropicApiKey) return 'ANTHROPIC_API_KEY (takes precedence over the subscription login)';
  if (env.CLAUDE_CODE_OAUTH_TOKEN || cfg.claudeCodeOauthToken) return 'CLAUDE_CODE_OAUTH_TOKEN';
  if (env.ANTHROPIC_AUTH_TOKEN) return 'ANTHROPIC_AUTH_TOKEN';
  if (env.CLAUDE_CODE_USE_BEDROCK === '1' || env.CLAUDE_CODE_USE_VERTEX === '1') return env.CLAUDE_CODE_USE_BEDROCK === '1' ? 'Amazon Bedrock' : 'Google Vertex AI';
  const dir = env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  try {
    if (fs.existsSync(path.join(dir, '.credentials.json'))) return `claude CLI login (${dir})`;
  } catch {
    /* ignore */
  }
  return null;
}

function fmtTime(sec) {
  if (!sec) return null;
  const ms = sec > 1e12 ? sec : sec * 1000;
  return new Date(ms).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
}

/**
 * Translate SDK / CLI failures into a clear chat error.
 * @param {{text?:string, code?:string, resetsAt?:number}} p
 */
export function friendlyError({ text = '', code, resetsAt, usagePrefixes = FALLBACK_USAGE_PREFIXES } = {}) {
  const t = String(text || '');
  const resets = fmtTime(resetsAt);
  const isUsage = code === 'rate_limit' || usagePrefixes.some((p) => t.startsWith(p)) || /usage limit|rate.?limit/i.test(t);
  if (isUsage) return `Claude usage limit reached${resets ? `, resets at ${resets}` : ''}. Alerts and Laya keep running meanwhile.${t && !/^rate/i.test(t) ? ` (${t})` : ''}`;
  if (code === 'authentication_failed' || code === 'oauth_org_not_allowed' || /not logged in|log ?in|authenticat|invalid api key|401|oauth/i.test(t)) {
    return 'Claude is not logged in on the server. Run `claude` and use /login with your Claude Pro/Max account, or set CLAUDE_CODE_OAUTH_TOKEN (from `claude setup-token`), then retry.';
  }
  if (code === 'billing_error' || code === 'account_on_hold') return `Claude account problem (${code}). ${t}`.trim();
  if (code === 'overloaded') return 'Claude is overloaded right now; try again in a minute.';
  if (code === 'model_not_found') return `The configured CLAUDE_MODEL is not available for this account. ${t}`.trim();
  return t || 'Claude agent failed.';
}

function recordError(msg, resetsAt) {
  state.lastError = msg;
  state.lastErrorAt = Date.now();
  if (resetsAt) state.limitedUntil = resetsAt > 1e12 ? resetsAt : resetsAt * 1000;
}

/** GET /api/agent/status for this driver. */
export async function status(ctx, { loader } = {}) {
  const sdk = await loadSdk(loader);
  const cred = credentialSource(ctx?.config || {});
  if (!sdk) return { driver: 'claude-code', ready: false, detail: `Claude Agent SDK unavailable: ${state.sdkError}` };
  if (state.limitedUntil > Date.now()) {
    return { driver: 'claude-code', ready: false, detail: `Claude usage limit reached, resets at ${fmtTime(state.limitedUntil)}`, limitedUntil: state.limitedUntil };
  }
  // Credentials can also be provided in ways we cannot see (e.g. a host-managed ANTHROPIC_BASE_URL proxy): a query
  // that already succeeded proves the driver works.
  if (!cred && !(state.lastOkAt && (!state.lastErrorAt || state.lastOkAt > state.lastErrorAt))) {
    return {
      driver: 'claude-code', ready: false,
      detail: 'No Claude login found. Run `claude` then /login on the server, or set CLAUDE_CODE_OAUTH_TOKEN (from `claude setup-token`).',
    };
  }
  return {
    driver: 'claude-code', ready: true,
    detail: cred ? `Claude subscription via ${cred}` : 'Claude credentials provided by the environment (last query succeeded)',
    model: ctx?.config?.claudeModel || process.env.CLAUDE_MODEL || null,
    ...(state.lastError ? { lastError: state.lastError, lastErrorAt: state.lastErrorAt } : {}),
    ...(state.lastOkAt ? { lastOkAt: state.lastOkAt } : {}),
  };
}

function findSdkSession(ctx, session) {
  if (sdkSessions.has(session)) return sdkSessions.get(session);
  try {
    const rows = ctx.repos?.chat?.list?.(session, 2000) || [];
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i].role === 'meta' && rows[i].content?.sdkSessionId) return rows[i].content.sdkSessionId;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function saveSdkSession(ctx, session, id) {
  if (!id || sdkSessions.get(session) === id) return;
  sdkSessions.delete(session);
  sdkSessions.set(session, id);
  // A cache over the stored 'meta' rows: bounded so client-chosen session ids cannot grow it forever.
  while (sdkSessions.size > MAX_CACHED_SESSIONS) sdkSessions.delete(sdkSessions.keys().next().value);
  try {
    ctx.repos?.chat?.append?.(session, 'meta', { sdkSessionId: id, driver: 'claude-code' });
  } catch {
    /* ignore */
  }
}

/** Build the in-process MCP server exposing the §7 tools, bound to this chat turn's executor. */
export function buildMcpServer(sdk, z, exec, emit) {
  const tools = TOOLS.map((def) =>
    sdk.tool(def.name, def.description, toZodShape(z, def.input_schema), async (args) => {
      emit({ type: 'tool', name: def.name, input: args });
      let out;
      try {
        out = await exec.execute(def.name, args);
      } catch (err) {
        out = { content: `Error: ${err?.message || err}`, isError: true };
      }
      emit({ type: 'tool_result', name: def.name, isError: !!out.isError });
      return { content: [{ type: 'text', text: out.content }], ...(out.isError ? { isError: true } : {}) };
    }),
  );
  return sdk.createSdkMcpServer({ name: MCP_SERVER, version: '1.0.0', tools, alwaysLoad: true });
}

/** Options passed to query() (exported for tests). */
export function buildOptions({ ctx, mcpServer, resume, abortController, maxTurns = MAX_TURNS }) {
  const model = ctx?.config?.claudeModel || process.env.CLAUDE_MODEL || undefined;
  return {
    systemPrompt: SYSTEM_PROMPT,
    mcpServers: { [MCP_SERVER]: mcpServer },
    strictMcpConfig: true,
    tools: [], // no built-in Claude Code tools at all
    allowedTools: ALLOWED_TOOLS,
    disallowedTools: BUILTIN_TOOLS,
    permissionMode: 'dontAsk', // never prompt: pre-approved MCP tools run, anything else is denied
    canUseTool: async (name, input) =>
      ALLOWED_TOOLS.includes(name) ? { behavior: 'allow', updatedInput: input } : { behavior: 'deny', message: 'Only TradeView tools are available.' },
    settingSources: [], // ignore ~/.claude settings, CLAUDE.md, plugins
    includePartialMessages: true,
    maxTurns,
    persistSession: true,
    cwd: os.tmpdir(),
    ...(model ? { model } : {}),
    ...(resume ? { resume } : {}),
    abortController,
  };
}

function textOf(content) {
  return (Array.isArray(content) ? content : []).filter((b) => b.type === 'text').map((b) => b.text).join('');
}

/**
 * Run one chat turn through the Claude Agent SDK. Never throws; errors are emitted.
 * @param {object} p  same as the anthropic-api driver: {ctx, session, message, context, emit, signal}
 * @param {object} [p.sdk]       injected SDK module (tests)
 * @param {object} [p.z]         injected zod (tests)
 * @param {object} [p.executor]  injected executor (tests)
 */
export async function run({ ctx, session, message, context, emit, signal, sdk: injected, z: injectedZ, executor, maxTurns = MAX_TURNS, now = Date.now() }) {
  const sdk = injected || (await loadSdk());
  if (!sdk) {
    emit({ type: 'error', message: `The Claude Agent SDK could not be loaded (${state.sdkError}).` });
    emit({ type: 'done' });
    return;
  }
  let z = injectedZ;
  if (!z) {
    try {
      z = (await import('zod')).z;
    } catch (err) {
      emit({ type: 'error', message: `zod is missing: ${err.message}` });
      emit({ type: 'done' });
      return;
    }
  }
  const usagePrefixes = Array.isArray(sdk.USAGE_LIMIT_ERROR_PREFIXES) ? sdk.USAGE_LIMIT_ERROR_PREFIXES : FALLBACK_USAGE_PREFIXES;
  const persist = (role, content) => {
    try {
      ctx.repos?.chat?.append?.(session, role, content);
    } catch (err) {
      ctx.log?.warn?.({ err: err.message }, 'chat: could not persist message');
    }
  };

  const exec = executor || createExecutor(ctx, { emit, context });
  const mcpServer = buildMcpServer(sdk, z, exec, emit);
  const prompt = `${formatContext(context, now)}\n\n${String(message)}`;
  persist('user', [{ type: 'text', text: formatContext(context, now) }, { type: 'text', text: String(message) }]);

  const attempt = async (resume) => {
    const abortController = new AbortController();
    const onAbort = () => abortController.abort();
    signal?.addEventListener?.('abort', onAbort, { once: true });
    const out = { text: '', tools: [], streamed: false, error: null, resetsAt: null, gotOutput: false, sessionId: null };
    const streamedIds = new Set();
    try {
      const q = sdk.query({ prompt, options: buildOptions({ ctx, mcpServer, resume, abortController, maxTurns }) });
      for await (const m of q) {
        if (signal?.aborted) break;
        if (m.session_id) out.sessionId = m.session_id;
        switch (m.type) {
          case 'system':
            if (m.subtype === 'init') {
              state.apiKeySource = m.apiKeySource ?? null;
              saveSdkSession(ctx, session, m.session_id);
            }
            break;
          case 'stream_event': {
            const ev = m.event;
            if (m.parent_tool_use_id) break;
            if (ev?.type === 'message_start' && ev.message?.id) out.currentId = ev.message.id;
            if (ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text) {
              out.gotOutput = true;
              if (out.currentId) streamedIds.add(out.currentId);
              emit({ type: 'text', delta: ev.delta.text });
            }
            break;
          }
          case 'assistant': {
            if (m.parent_tool_use_id) break;
            if (m.error) {
              out.error = { code: m.error, text: textOf(m.message?.content) };
              break;
            }
            const text = textOf(m.message?.content);
            if (text) {
              out.gotOutput = true;
              // Without partial messages (older CLI), emit whole blocks instead of deltas.
              if (!streamedIds.has(m.message?.id)) emit({ type: 'text', delta: text });
              out.text += text;
            }
            for (const b of m.message?.content || []) if (b.type === 'tool_use') out.tools.push({ name: b.name.replace(`mcp__${MCP_SERVER}__`, ''), input: b.input });
            break;
          }
          case 'rate_limit_event': {
            const info = m.rate_limit_info || {};
            if (info.status === 'rejected') out.resetsAt = info.resetsAt || info.overageResetsAt || out.resetsAt;
            break;
          }
          case 'auth_status':
            if (m.error) out.error = { code: 'authentication_failed', text: m.error };
            break;
          case 'result':
            if (m.is_error || m.subtype !== 'success') {
              const text = m.subtype === 'error_max_turns'
                ? `Stopped after ${maxTurns} turns.`
                : m.result || (m.errors || []).join('; ') || m.subtype;
              if (!out.error || m.subtype === 'error_max_turns') out.error = { code: out.error?.code, text };
            }
            break;
          default:
            break;
        }
      }
    } catch (err) {
      if (!signal?.aborted && err?.name !== 'AbortError') out.error = { code: out.error?.code, text: err?.message || String(err), thrown: true };
    } finally {
      signal?.removeEventListener?.('abort', onAbort);
    }
    return out;
  };

  let resume = findSdkSession(ctx, session);
  let out = await attempt(resume);
  // A stale session id (e.g. the CLI's session files were wiped) fails before any output: start fresh.
  if (out.error && resume && !out.gotOutput && !signal?.aborted && /session|resume|conversation|not found|no such/i.test(out.error.text || '')) {
    sdkSessions.delete(session);
    resume = null;
    out = await attempt(null);
  }
  if (out.sessionId) saveSdkSession(ctx, session, out.sessionId);

  if (out.text || out.tools.length) {
    // Stored as plain text (+ a tool log) so the history also stays valid for the anthropic-api driver.
    if (out.tools.length) persist('tool_calls', out.tools);
    if (out.text) persist('assistant', [{ type: 'text', text: out.text }]);
  }
  if (signal?.aborted) return;
  if (out.error) {
    const msg = friendlyError({ text: out.error.text, code: out.error.code, resetsAt: out.resetsAt, usagePrefixes });
    recordError(msg, out.resetsAt);
    ctx.log?.warn?.({ err: out.error.text, code: out.error.code }, 'claude-code driver error');
    emit({ type: 'error', message: msg });
  } else {
    state.lastOkAt = Date.now();
    state.lastError = null;
    state.limitedUntil = 0;
  }
  emit({ type: 'done' });
}

/** Forget the SDK session for a chat session (DELETE /api/chat/:session). */
export function forgetSession(session) {
  sdkSessions.delete(session);
}

/** Reset module state (tests). */
export function _reset() {
  sdkSessions.clear();
  Object.assign(state, { sdk: null, sdkError: null, lastError: null, lastErrorAt: 0, limitedUntil: 0, lastOkAt: 0, apiKeySource: null });
}
