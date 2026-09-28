/**
 * Thin wrappers over the shared API client (§12). The contract guarantees api.get/api.post; PUT/PATCH/DELETE
 * go through api.put/patch/delete|del when the client provides them, else through fetch() directly.
 */
export async function apiRequest(api, method, path, body) {
  const m = method.toLowerCase();
  let fn = api && api[m];
  if (!fn && m === 'delete') fn = api && (api.del || api.remove);
  if (typeof fn === 'function') return fn.call(api, path, body);
  if (api && typeof api.request === 'function') return api.request(method, path, body);
  let url = path;
  const init = { method: method.toUpperCase(), headers: {} };
  if (body != null) {
    if (m === 'get') {
      const qs = new URLSearchParams(Object.entries(body).filter(([, v]) => v != null && v !== '')).toString();
      if (qs) url += (url.includes('?') ? '&' : '?') + qs;
    } else {
      init.headers['content-type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
  }
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${init.method} ${path} → HTTP ${res.status}`);
  if (res.status === 204) return null;
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export const apiGet = (api, path, params) => apiRequest(api, 'get', path, params);
export const apiPost = (api, path, body) => apiRequest(api, 'post', path, body);
