'use strict';
// Shared helpers. Platform-neutral: no Node-only modules (runs on Node and edge runtimes).

class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function mulberry32(seed) {
  let a = seed | 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rng) {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const enc = new TextEncoder();

function toB64Url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64Url(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const s = atob(str);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function randomId(prefix) {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  return prefix + '_' + toB64Url(b);
}

function round(n, d = 4) { const f = 10 ** d; return Math.round(n * f) / f; }

module.exports = { ApiError, mulberry32, gaussian, enc, toB64Url, fromB64Url, randomId, round };
