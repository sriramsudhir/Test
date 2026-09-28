// Minimal JSON-Schema validator for tool inputs (type, required, enum, min/max, items, nested objects).
// With eager input streaming the API no longer validates tool inputs, so every input is checked here.

/** @returns {string[]} list of problems (empty = valid) */
export function validateInput(schema, value, path = 'input') {
  const errs = [];
  check(schema, value, path, errs);
  return errs;
}

/** Upper bound for strings without an explicit maxLength. */
export const DEFAULT_MAX_STRING = 2000;

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (Number.isInteger(v)) return 'integer';
  return typeof v;
}

function check(s, v, path, errs) {
  if (!s || v === undefined) return;
  if (s.type) {
    const t = typeOf(v);
    const ok = s.type === t || (s.type === 'number' && t === 'integer');
    if (!ok) {
      errs.push(`${path} must be ${s.type} (got ${t})`);
      return;
    }
  }
  if (s.enum && !s.enum.includes(v)) errs.push(`${path} must be one of ${s.enum.join(', ')}`);
  if (typeof v === 'string') {
    // Every string is bounded (tool inputs come from the model, which may be steered by prompt injection).
    const max = s.maxLength ?? DEFAULT_MAX_STRING;
    if (v.length > max) errs.push(`${path} is too long (max ${max} characters)`);
    else if (s.pattern && !new RegExp(s.pattern).test(v)) errs.push(`${path} has an invalid format`);
  }
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) errs.push(`${path} must be finite`);
    if (s.minimum !== undefined && v < s.minimum) errs.push(`${path} must be >= ${s.minimum}`);
    if (s.maximum !== undefined && v > s.maximum) errs.push(`${path} must be <= ${s.maximum}`);
  }
  if (Array.isArray(v)) {
    if (s.minItems !== undefined && v.length < s.minItems) errs.push(`${path} needs at least ${s.minItems} items`);
    if (s.maxItems !== undefined && v.length > s.maxItems) errs.push(`${path} allows at most ${s.maxItems} items`);
    if (s.items) v.forEach((item, i) => check(s.items, item, `${path}[${i}]`, errs));
  }
  if (s.type === 'object' && v && typeof v === 'object') {
    for (const r of s.required || []) if (v[r] === undefined || v[r] === null) errs.push(`${path}.${r} is required`);
    for (const [k, sub] of Object.entries(s.properties || {})) check(sub, v[k], `${path}.${k}`, errs);
  }
}
