'use strict';
// Authentication: PBKDF2 password hashing + HMAC-SHA256 signed session tokens with
// sliding expiry (inactivity timeout). Uses the standard Web Crypto API only.
const { enc, toB64Url, fromB64Url } = require('./util');

const ITERATIONS = 100000; // maximum accepted by edge runtimes
const SESSION_TTL_MS = 30 * 60 * 1000; // expires after 30 min of inactivity

async function pbkdf2(password, salt) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' }, key, 256);
  return new Uint8Array(bits);
}

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt);
  return { salt: toB64Url(salt), hash: toB64Url(hash) };
}

async function verifyPassword(password, saltB64, hashB64) {
  const got = await pbkdf2(password, fromB64Url(saltB64));
  const want = fromB64Url(hashB64);
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got[i] ^ want[i];
  return diff === 0;
}

function hmacKey(secret) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function signToken(userId, secret, now = Date.now()) {
  const payload = toB64Url(enc.encode(JSON.stringify({ sub: userId, exp: now + SESSION_TTL_MS })));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(payload));
  return payload + '.' + toB64Url(new Uint8Array(sig));
}

async function verifyToken(token, secret, now = Date.now()) {
  if (typeof token !== 'string' || token.length > 2048) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  try {
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), fromB64Url(parts[1]), enc.encode(parts[0]));
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(fromB64Url(parts[0])));
    if (!payload.sub || payload.exp < now) return null;
    return payload;
  } catch (e) { return null; }
}

// Compares two secrets without leaking length/position through timing (hashes both first).
async function secretsMatch(a, b) {
  const [ha, hb] = await Promise.all([a, b].map(async (v) => new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(String(v))))));
  let diff = 0;
  for (let i = 0; i < ha.length; i++) diff |= ha[i] ^ hb[i];
  return diff === 0;
}

module.exports = { secretsMatch, hashPassword, verifyPassword, signToken, verifyToken, SESSION_TTL_MS };
