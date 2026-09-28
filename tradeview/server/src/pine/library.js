// Built-in Pine library: server/src/pine/library/*.pine. Metadata comes from the header comments
// (`// @category`, `// @description`) and the indicator()/strategy() declaration.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const LIBRARY_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'library');

let cache = null;

function parseEntry(file) {
  const id = path.basename(file, '.pine');
  const source = fs.readFileSync(path.join(LIBRARY_DIR, file), 'utf8');
  const category = source.match(/^\/\/\s*@category\s+(.+)$/m)?.[1].trim() || 'Other';
  const description = source.match(/^\/\/\s*@description\s+(.+)$/m)?.[1].trim() || '';
  const decl = source.match(/^\s*(indicator|strategy)\s*\(\s*["']([^"']+)["']([^\n]*)\)/m);
  const type = decl?.[1] || 'indicator';
  const name = decl?.[2] || id;
  const shorttitle = decl?.[3]?.match(/shorttitle\s*=\s*["']([^"']+)["']/)?.[1] || name;
  const overlay = /overlay\s*=\s*true/.test(decl?.[3] || '');
  return { id, name, shorttitle, type, category, description, overlay, source };
}

/** @returns {Array<{id,name,shorttitle,type,category,description,overlay,source}>} */
export function loadLibrary({ reload = false } = {}) {
  if (cache && !reload) return cache;
  cache = fs
    .readdirSync(LIBRARY_DIR)
    .filter((f) => f.endsWith('.pine'))
    .sort()
    .map(parseEntry);
  return cache;
}

export function listLibrary() {
  return loadLibrary().map(({ source, ...meta }) => meta);
}

/** Short ids used by the web indicator catalog and the agent, mapped to library file ids. */
export const LIBRARY_ALIASES = Object.freeze({
  bb: 'bollinger', bbands: 'bollinger', stoch: 'stochastic', psar: 'parabolic_sar', sar: 'parabolic_sar',
  adx: 'adx_dmi', dmi: 'adx_dmi', willr: 'williams_r',
});

export function getLibraryEntry(id) {
  const key = String(id ?? '').trim().toLowerCase().replace(/\.pine$/, '');
  const lib = loadLibrary();
  return lib.find((e) => e.id === key) || lib.find((e) => e.id === LIBRARY_ALIASES[key]) || null;
}
