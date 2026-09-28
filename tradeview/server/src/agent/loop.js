// Streaming manual tool-use loop for the TradeView agent (§7).
//
// History handling (preserved thinking): the system prompt and tool list are constants, the chart
// context rides in each user turn, and history is append-only — assistant turns are stored with
// their full content blocks (including thinking) and replayed verbatim. Old turns are dropped in
// deterministic chunks; once any turn has been dropped, thinking blocks are stripped from the
// replayed history (the one-time recovery the API documents) so the request stays valid.
import Anthropic from '@anthropic-ai/sdk';
import { TOOLS } from './tools.js';
import { SYSTEM_PROMPT, formatContext } from './prompt.js';
import { createExecutor } from './executor.js';

export const MAX_ITERATIONS = 12;
export const MAX_TURNS = 20;
const MAX_TOKENS = 32000;
const HISTORY_ROWS = 2000;

/** Models that support adaptive thinking + effort (Claude 4.6+ generation). */
function supportsAdaptive(model) {
  return !/haiku|claude-3|-4-5|-4-1|-4-0|sonnet-4-(?!6)|opus-4-(?![678])/.test(model);
}

function isToolResultMsg(m) {
  return m.role === 'user' && Array.isArray(m.content) && m.content.length > 0 && m.content.every((b) => b.type === 'tool_result');
}

/** Rows from ctx.repos.chat -> API messages, windowed to at most MAX_TURNS user turns. */
export function buildHistory(rows, maxTurns = MAX_TURNS) {
  let msgs = rows
    .filter((r) => r.role === 'user' || r.role === 'assistant')
    .map((r) => ({ role: r.role, content: r.content }));
  // Drop a dangling assistant tool_use tail (interrupted turn without tool results).
  while (msgs.length) {
    const last = msgs[msgs.length - 1];
    const dangling = last.role === 'assistant' && Array.isArray(last.content) && last.content.some((b) => b.type === 'tool_use');
    if (dangling) msgs.pop();
    else break;
  }
  // Turn starts = user messages that are not tool results.
  const starts = [];
  msgs.forEach((m, i) => {
    if (m.role === 'user' && !isToolResultMsg(m)) starts.push(i);
  });
  if (!starts.length) return { messages: [], trimmed: false };
  msgs = msgs.slice(starts[0]);
  const shift = starts[0];
  const turnStarts = starts.map((i) => i - shift);
  const total = turnStarts.length;
  let trimmed = false;
  if (total > maxTurns) {
    const half = Math.max(1, Math.floor(maxTurns / 2));
    const firstTurn = Math.floor((total - half) / half) * half; // stable for `half` consecutive turns
    msgs = msgs.slice(turnStarts[firstTurn]);
    trimmed = true;
  }
  if (trimmed) msgs = msgs.map(stripThinking).filter((m) => !(Array.isArray(m.content) && m.content.length === 0));
  return { messages: msgs, trimmed };
}

function stripThinking(m) {
  if (m.role !== 'assistant' || !Array.isArray(m.content)) return m;
  return { ...m, content: m.content.filter((b) => b.type !== 'thinking' && b.type !== 'redacted_thinking') };
}

/** Friendly message for SDK / network errors. */
export function describeError(err) {
  if (err instanceof Anthropic.AuthenticationError) return 'Anthropic authentication failed: check ANTHROPIC_API_KEY.';
  if (err instanceof Anthropic.PermissionDeniedError) return 'This API key has no access to the configured model (CLAUDE_MODEL).';
  if (err instanceof Anthropic.NotFoundError) return `Model not found: ${err.message}`;
  if (err instanceof Anthropic.RateLimitError) return 'Rate limited by the Anthropic API; try again in a moment.';
  if (err instanceof Anthropic.BadRequestError) return `Request rejected by the Anthropic API: ${err.message}`;
  if (err instanceof Anthropic.APIConnectionError) return 'Could not reach the Anthropic API (network).';
  if (err instanceof Anthropic.APIError) return `Anthropic API error ${err.status ?? ''}: ${err.message}`;
  return err?.message || String(err);
}

function resolveAuth(ctx) {
  const cfg = ctx.config || {};
  const apiKey = cfg.anthropicApiKey || cfg.ANTHROPIC_API_KEY || cfg.claude?.apiKey || process.env.ANTHROPIC_API_KEY || '';
  const authToken = process.env.ANTHROPIC_AUTH_TOKEN || '';
  return { apiKey, authToken };
}

/** True when the agent can talk to Claude (or a client was injected). */
export function agentConfigured(ctx) {
  const { apiKey, authToken } = resolveAuth(ctx);
  return !!(apiKey || authToken);
}

let sharedClient = null;
function getClient(ctx) {
  if (sharedClient) return sharedClient;
  const { apiKey } = resolveAuth(ctx);
  sharedClient = apiKey ? new Anthropic({ apiKey }) : new Anthropic();
  return sharedClient;
}

/**
 * Run one chat turn: persist the user message, loop model <-> tools, stream events via `emit`.
 * Never throws; errors are emitted as {type:'error', message}.
 *
 * @param {object} p
 * @param {object} p.ctx
 * @param {string} p.session
 * @param {string} p.message
 * @param {object} [p.context]          browser chart context
 * @param {(ev:object)=>void} p.emit    SSE event sink
 * @param {AbortSignal} [p.signal]      client disconnect
 * @param {object} [p.client]           Anthropic client (injectable for tests)
 * @param {object} [p.executor]         tool executor (injectable for tests)
 * @param {number} [p.maxIterations]
 */
export async function runChat({ ctx, session, message, context, emit, signal, client, executor, maxIterations = MAX_ITERATIONS, now = Date.now() }) {
  const chat = ctx.repos?.chat;
  const persist = (role, content) => {
    try {
      chat?.append?.(session, role, content);
    } catch (err) {
      ctx.log?.warn?.({ err: err.message }, 'chat: could not persist message');
    }
  };

  if (!client && !agentConfigured(ctx)) {
    emit({ type: 'error', message: 'The AI agent is not configured: set ANTHROPIC_API_KEY in tradeview/.env and restart the server.' });
    emit({ type: 'done' });
    return;
  }

  const cfg = ctx.config || {};
  const model = cfg.claudeModel || cfg.CLAUDE_MODEL || cfg.claude?.model || process.env.CLAUDE_MODEL || 'claude-opus-5-5';
  const effort = process.env.CLAUDE_EFFORT || 'medium';
  const api = client || getClient(ctx);
  const exec = executor || createExecutor(ctx, { emit, context });

  let rows = [];
  try {
    rows = chat?.list?.(session, HISTORY_ROWS) || [];
  } catch (err) {
    ctx.log?.warn?.({ err: err.message }, 'chat: could not load history');
  }
  const { messages } = buildHistory(rows);

  const userMsg = {
    role: 'user',
    content: [
      { type: 'text', text: formatContext(context, now) },
      { type: 'text', text: String(message) },
    ],
  };
  messages.push(userMsg);
  persist('user', userMsg.content);

  const params = {
    model,
    max_tokens: MAX_TOKENS,
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    tools: TOOLS,
    messages,
    ...(supportsAdaptive(model) ? { thinking: { type: 'adaptive' }, output_config: { effort } } : {}),
  };

  let jsonRetries = 0;
  try {
    for (let iter = 0; iter < maxIterations; iter++) {
      if (signal?.aborted) return;
      const stream = api.messages.stream({ ...params, messages }, signal ? { signal } : undefined);
      stream.on?.('text', (delta) => emit({ type: 'text', delta }));
      let msg;
      try {
        msg = await stream.finalMessage();
        jsonRetries = 0;
      } catch (err) {
        if (signal?.aborted) return;
        // Eager input streaming: a tool input that is not parseable JSON rejects finalMessage(). Retry that turn.
        if (!(err instanceof Anthropic.APIError) && err?.name !== 'AbortError' && jsonRetries++ < 2) {
          ctx.log?.warn?.({ err: err?.message }, 'chat: unparseable tool input, re-issuing turn');
          continue;
        }
        throw err;
      }

      const toolUses = msg.content.filter((b) => b.type === 'tool_use');
      if (msg.stop_reason === 'refusal') {
        emit({ type: 'error', message: 'Claude declined to answer this request.' });
        break;
      }
      if (msg.stop_reason === 'max_tokens' && toolUses.length) {
        emit({ type: 'error', message: 'The response was cut off (max tokens) while preparing a tool call. Please ask for a smaller step.' });
        break;
      }
      messages.push({ role: 'assistant', content: msg.content });
      persist('assistant', msg.content);

      if (msg.stop_reason === 'pause_turn') continue;
      if (!toolUses.length) break; // end_turn / stop_sequence / max_tokens on plain text

      const results = [];
      for (const tu of toolUses) {
        emit({ type: 'tool', name: tu.name, input: tu.input, id: tu.id });
        let out;
        if (signal?.aborted) out = { content: 'Interrupted: the user disconnected before this tool ran.', isError: true };
        else {
          try {
            out = await exec.execute(tu.name, tu.input);
          } catch (err) {
            out = { content: `Error: ${err?.message || err}`, isError: true };
          }
        }
        emit({ type: 'tool_result', name: tu.name, id: tu.id, isError: !!out.isError });
        results.push({ type: 'tool_result', tool_use_id: tu.id, content: out.content, ...(out.isError ? { is_error: true } : {}) });
      }
      const toolMsg = { role: 'user', content: results };
      messages.push(toolMsg);
      persist('user', toolMsg.content);
      if (signal?.aborted) return;
      if (iter === maxIterations - 1) {
        emit({ type: 'error', message: `Stopped after ${maxIterations} tool rounds.` });
      }
    }
  } catch (err) {
    if (signal?.aborted || err?.name === 'AbortError' || err instanceof Anthropic.APIUserAbortError) return;
    ctx.log?.error?.({ err: err?.message }, 'chat: agent loop failed');
    emit({ type: 'error', message: describeError(err) });
  }
  if (!signal?.aborted) emit({ type: 'done' });
}
