'use strict';
// Local development server: static files from public/ + the shared API router.
// Adds file persistence for users/sessions (.data/store.json) and for retrained models.
const http = require('http');
const fs = require('fs');
const path = require('path');
const router = require('./lib/router');

// Minimal .env loader (no dependency): KEY=VALUE lines, never overrides real env vars.
try {
  for (const line of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch (e) { /* .env is optional */ }

const PORT = parseInt(process.env.PORT || '3000', 10);
const PUBLIC = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, '.data');
const STORE_FILE = path.join(DATA_DIR, 'store.json');
const MODEL_FILE = path.join(__dirname, 'model', 'model.json');

try { router.store.load(JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'))); } catch (e) { /* first run */ }
let saveTimer = null;
router.store.setOnChange((state) => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(STORE_FILE, JSON.stringify(state)); }, 200);
});
router.configure({ onModelTrained: (model) => fs.writeFileSync(MODEL_FILE, JSON.stringify(model)) });

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon' };

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 2e6) { reject(new Error('Body too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { resolve({}); } });
    req.on('error', reject);
  });
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    const body = req.method === 'GET' ? {} : await readBody(req).catch(() => ({}));
    const out = await router.handle({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), headers: req.headers, body, env: process.env });
    res.writeHead(out.status, out.headers); res.end(out.body); return;
  }
  let file = path.normalize(path.join(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' }); res.end(buf);
  });
}).listen(PORT, () => console.log(`SignSync running at http://localhost:${PORT}`));
