'use strict';
// End-to-end check of the API pipeline without a network: auth, preferences, inference over
// every sign, translation, TTS payload, session logging and CSV export.
const { handle } = require('../lib/router');
const { LABELS } = require('../lib/synthetic');

let failures = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) failures++; };
const ENV = { SESSION_SECRET: 'test-secret', ADMIN_USERNAME: 'boss', ADMIN_PASSWORD: 'Admin-Pass-99' };
let token = null;
async function call(method, path, body, extraHeaders) {
  const headers = { ...(token ? { authorization: 'Bearer ' + token } : {}), ...extraHeaders };
  const [pathname, qs] = path.split('?');
  const r = await handle({ method, path: pathname, query: Object.fromEntries(new URLSearchParams(qs || '')), body: body || {}, headers, env: ENV });
  if (r.headers['X-Refresh-Token']) token = r.headers['X-Refresh-Token'];
  let data = r.body; try { data = JSON.parse(r.body); } catch (e) { /* csv */ }
  return { status: r.status, data, headers: r.headers };
}

(async () => {
  let r = await call('GET', '/api/health');
  ok(r.status === 200 && r.data.status === 'ok', 'health endpoint responds');
  r = await call('GET', '/api/model');
  ok(r.data.model.loaded && r.data.model.labels.length === LABELS.length, 'bundled model is loaded');

  r = await call('POST', '/api/auth/register', { username: 'tester', password: 'short' });
  ok(r.status === 400, 'weak password rejected');
  r = await call('POST', '/api/auth/register', { username: 'tester', password: 'correct-horse-1', preferences: { targetLang: 'hi' } });
  ok(r.status === 201 && r.data.token && r.data.preferences.targetLang === 'hi', 'register returns token and preferences');
  token = r.data.token;
  r = await call('POST', '/api/auth/register', { username: 'Tester', password: 'correct-horse-1' });
  ok(r.status === 409, 'duplicate username rejected');
  r = await call('POST', '/api/auth/login', { username: 'tester', password: 'wrong-password' });
  ok(r.status === 401, 'wrong password rejected');
  r = await call('POST', '/api/auth/login', { username: 'tester', password: 'correct-horse-1' });
  ok(r.status === 200, 'login works'); token = r.data.token;
  r = await call('GET', '/api/auth/me');
  ok(r.status === 200 && r.headers['X-Refresh-Token'], 'token accepted and refreshed (sliding expiry)');
  const saved = token; token = 'garbage';
  r = await call('GET', '/api/auth/me'); ok(r.status === 401, 'tampered token rejected'); token = saved;
  r = await call('PUT', '/api/preferences', { confidenceThreshold: 5 }); ok(r.status === 400, 'invalid preference rejected');
  r = await call('PUT', '/api/preferences', { theme: 'light', confidenceThreshold: 0.5 }); ok(r.data.preferences.theme === 'light', 'preferences updated');

  let correct = 0, total = 0, latMax = 0;
  for (const g of LABELS) for (let i = 0; i < 6; i++) {
    const sim = await call('POST', '/api/simulate', { gloss: g, seed: 90000 + i * 17 + g.length });
    const inf = await call('POST', '/api/infer', { frames: sim.data.frames, lang: 'en', threshold: 0.5 });
    total++; if (inf.data.gloss === g) correct++; latMax = Math.max(latMax, inf.data.latencyMs);
  }
  ok(correct / total >= 0.85, `inference accuracy on fresh simulated signs: ${correct}/${total} (max latency ${latMax} ms)`);

  const sim = await call('POST', '/api/simulate', { gloss: 'HELLO', seed: 5 });
  r = await call('POST', '/api/infer', { frames: sim.data.frames, lang: 'mr' });
  ok(r.data.lang === 'mr' && r.data.tts.lang === 'mr-IN', 'inference returns Marathi text and TTS tag');
  r = await call('POST', '/api/infer', { frames: [[1, 2], [3, 4]] }); ok(r.status === 422, 'invalid landmarks rejected with 422');
  r = await call('POST', '/api/infer', { frames: 'nope' }); ok(r.status === 400, 'malformed frames rejected');
  r = await call('POST', '/api/translate', { glosses: ['HELLO', 'WATER', 'PLEASE'], lang: 'hi' });
  ok(r.data.text === 'नमस्ते पानी कृपया', 'gloss sentence translated to Hindi');
  r = await call('POST', '/api/tts', { text: 'Hello', lang: 'en' }); ok(r.data.lang === 'en-IN', 'TTS payload generated');

  r = await call('POST', '/api/sessions', { glosses: ['HELLO', 'HELP'], lang: 'en', confidence: 0.9 }); ok(r.status === 201, 'session log saved');
  r = await call('GET', '/api/sessions'); ok(r.data.sessions.length === 1, 'session history listed');
  r = await call('GET', '/api/sessions/export'); ok(r.status === 200 && /^id,createdAt/.test(r.data) && r.headers['Content-Type'].startsWith('text/csv'), 'CSV export works');

  const saveTok = token; token = null;
  r = await call('POST', '/api/train', {}); ok(r.status === 401, 'training requires authentication'); token = saveTok;
  r = await call('POST', '/api/train', { epochs: 10, samplesPerClass: 20 });
  ok(r.status === 200 && r.data.model.metrics.valAccuracy > 0.6, `API training works (val acc ${r.data.model && (r.data.model.metrics.valAccuracy * 100).toFixed(1)}%)`);
  r = await call('POST', '/api/train', { epochs: 9999 }); ok(r.status === 400, 'training limits enforced');
  r = await call('GET', '/api/nope'); ok(r.status === 404, 'unknown route 404');

  // ---- Admin console ----
  const userTok = token; token = null;
  let dis = await handle({ method: 'POST', path: '/api/admin/login', body: { username: 'a', password: 'b' }, headers: {}, env: { SESSION_SECRET: 'x' } });
  ok(dis.status === 503, 'admin console disabled when credentials are not configured');
  r = await call('GET', '/api/admin/overview'); ok(r.status === 401, 'admin overview requires login');
  token = userTok; r = await call('GET', '/api/admin/overview'); ok(r.status === 401, 'normal user token cannot open admin'); token = null;
  r = await call('POST', '/api/admin/login', { username: 'boss', password: 'nope' }); ok(r.status === 401, 'wrong admin password rejected');
  r = await call('POST', '/api/admin/login', { username: 'boss', password: 'Admin-Pass-99' }); ok(r.status === 200 && r.data.token, 'admin login works');
  token = r.data.token;
  r = await call('GET', '/api/admin/overview');
  ok(r.status === 200 && r.data.counts.users >= 1 && r.data.sessions.length >= 1, 'admin overview lists users and sessions');
  ok(!/passwordHash|salt/.test(JSON.stringify(r.data)), 'admin overview never exposes password hashes');
  r = await call('GET', '/api/admin/export?table=users'); ok(r.status === 200 && /^id,username/.test(r.data), 'admin users CSV export');
  r = await call('GET', '/api/auth/me'); ok(r.status === 401, 'admin token cannot act as a user');
  token = null;
  for (let i = 0; i < 6; i++) r = await call('POST', '/api/admin/login', { username: 'boss', password: 'bad' + i });
  ok(r.status === 429, 'repeated bad admin logins are rate limited');

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})();
