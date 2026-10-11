'use strict';
// Vercel Serverless Function adapter (Node.js runtime). Serves every /api/* route.
const { handle } = require('../lib/router');

module.exports = async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const out = await handle({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), headers: req.headers, body, env: process.env });
  res.statusCode = out.status;
  for (const [k, v] of Object.entries(out.headers)) res.setHeader(k, v);
  res.end(out.body);
};
