// Cloudflare Pages Function adapter. Serves every /api/* route.
import { handle } from '../../lib/router.js';

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  let body = {};
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    try { body = await request.json(); } catch (e) { body = {}; }
  }
  const out = await handle({ method: request.method, path: url.pathname, query: Object.fromEntries(url.searchParams), headers: Object.fromEntries(request.headers), body, env });
  return new Response(out.body, { status: out.status, headers: out.headers });
}
