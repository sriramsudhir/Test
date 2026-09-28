// Password hashing / verification with scrypt (node:crypto). Hash format: scrypt$<N>$<r>$<p>$<saltB64url>$<hashB64url>
import crypto from 'node:crypto';

const KEYLEN = 64;
const DEFAULTS = { N: 16384, r: 8, p: 1 };

function scrypt(password, salt, { N, r, p }) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(String(password).normalize('NFKC'), salt, KEYLEN, { N, r, p, maxmem: 256 * N * r }, (err, key) =>
      err ? reject(err) : resolve(key));
  });
}

/** Create a hash string for AUTH_PASSWORD_HASH. */
export async function hashPassword(password, params = DEFAULTS) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, params);
  return ['scrypt', params.N, params.r, params.p, salt.toString('base64url'), key.toString('base64url')].join('$');
}

/** Parse a hash string; returns null if malformed. */
export function parseHash(hash) {
  const parts = String(hash || '').trim().split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null;
  const [, N, r, p, salt, key] = parts;
  const params = { N: Number(N), r: Number(r), p: Number(p) };
  if (![params.N, params.r, params.p].every((x) => Number.isInteger(x) && x > 0)) return null;
  if (params.N & (params.N - 1)) return null; // N must be a power of two
  return { params, salt: Buffer.from(salt, 'base64url'), key: Buffer.from(key, 'base64url') };
}

/** Constant-time verification of `password` against a hash string. */
export async function verifyPassword(password, hash) {
  const h = typeof hash === 'string' ? parseHash(hash) : hash;
  if (!h) return false;
  const key = await scrypt(password, h.salt, h.params);
  return key.length === h.key.length && crypto.timingSafeEqual(key, h.key);
}
