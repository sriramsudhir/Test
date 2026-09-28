// Agent driver selection (§13.2). AGENT_DRIVER = claude-code (default) | anthropic-api | off.
//   claude-code   -> drivers/claudeCode.js (Claude Agent SDK, Claude Pro/Max subscription login)
//   anthropic-api -> drivers/anthropicApi.js (Messages API streaming tool loop, needs ANTHROPIC_API_KEY)
// Alerts and Laya never depend on the agent.
import * as claudeCode from './drivers/claudeCode.js';
import * as anthropicApi from './drivers/anthropicApi.js';

export const DRIVERS = ['claude-code', 'anthropic-api', 'off'];

export function driverName(ctx) {
  const raw = String(ctx?.config?.agentDriver ?? ctx?.config?.AGENT_DRIVER ?? process.env.AGENT_DRIVER ?? 'claude-code').trim().toLowerCase();
  return DRIVERS.includes(raw) ? raw : 'claude-code';
}

/** GET /api/agent/status -> { driver, ready, detail } */
export async function agentStatus(ctx) {
  const d = driverName(ctx);
  if (d === 'off') return { driver: 'off', ready: false, detail: 'The agent is disabled (AGENT_DRIVER=off).' };
  try {
    return d === 'anthropic-api' ? anthropicApi.status(ctx) : await claudeCode.status(ctx);
  } catch (err) {
    return { driver: d, ready: false, detail: err?.message || String(err) };
  }
}

/**
 * Run one chat turn with the configured driver. Never throws; streams events through `emit`.
 * @param {{ctx, session, message, context, emit, signal}} params
 */
export async function runChat(params) {
  const d = driverName(params.ctx);
  if (d === 'off') {
    params.emit({ type: 'error', message: 'The agent is disabled (AGENT_DRIVER=off).' });
    params.emit({ type: 'done' });
    return;
  }
  try {
    if (d === 'anthropic-api') await anthropicApi.run(params);
    else await claudeCode.run(params);
  } catch (err) {
    params.emit({ type: 'error', message: err?.message || String(err) });
    params.emit({ type: 'done' });
  }
}
