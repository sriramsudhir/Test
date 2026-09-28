// Worker thread entry: executes Pine jobs off the main event loop so a runaway script can be terminated.
import { parentPort } from 'node:worker_threads';
import { executePine } from './exec.js';

parentPort.on('message', async (msg) => {
  const { id, job } = msg;
  try {
    const result = await executePine(job);
    parentPort.postMessage({ id, ok: true, result });
  } catch (err) {
    parentPort.postMessage({
      id,
      ok: false,
      error: { message: err?.message || String(err), line: err?.line, column: err?.column, kind: err?.kind || 'runtime' },
    });
  }
});
