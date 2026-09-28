// JSON Schema (the subset used in agent/tools.js) -> Zod raw shape, for the Claude Agent SDK's tool().
// Inputs are validated again by agent/validate.js before execution, so this only needs to describe them.

/** @param {typeof import('zod').z} z @param {object} schema object schema @returns {Record<string, any>} raw shape */
export function toZodShape(z, schema) {
  const shape = {};
  const required = new Set(schema?.required || []);
  for (const [key, sub] of Object.entries(schema?.properties || {})) {
    let t = toZod(z, sub);
    if (!required.has(key)) t = t.optional();
    shape[key] = t;
  }
  return shape;
}

function toZod(z, s = {}) {
  let t;
  if (Array.isArray(s.enum) && s.enum.every((v) => typeof v === 'string')) t = z.enum(s.enum);
  else {
    switch (s.type) {
      case 'string':
        t = z.string();
        break;
      case 'integer':
        t = z.number().int();
        if (s.minimum !== undefined) t = t.min(s.minimum);
        if (s.maximum !== undefined) t = t.max(s.maximum);
        break;
      case 'number':
        t = z.number();
        if (s.minimum !== undefined) t = t.min(s.minimum);
        if (s.maximum !== undefined) t = t.max(s.maximum);
        break;
      case 'boolean':
        t = z.boolean();
        break;
      case 'array':
        t = z.array(s.items ? toZod(z, s.items) : z.any());
        if (s.minItems !== undefined) t = t.min(s.minItems);
        if (s.maxItems !== undefined) t = t.max(s.maxItems);
        break;
      case 'object':
        t = s.properties ? z.object(toZodShape(z, s)).passthrough() : z.record(z.string(), z.any());
        break;
      default:
        t = z.any();
    }
  }
  if (s.description) t = t.describe(s.description);
  return t;
}
