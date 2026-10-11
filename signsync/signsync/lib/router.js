'use strict';
// Runtime-neutral API router. Adapters (server.js, api/[...path].js, functions/api/[[path]].js)
// translate their platform's request/response objects to and from handle().
const { ApiError, mulberry32, round } = require('./util');
const auth = require('./auth');
const store = require('./store');
const { LANGS, translateGloss, translateSentence } = require('./translate');
const { extractSequence, FEATURES } = require('./landmarks');
const { toRuntime, predict } = require('./bilstm');
const { train } = require('./train');
const { generateSign, SIGNS } = require('./synthetic');

let bundled = null;
try { bundled = require('../model/model.json'); } catch (e) { /* no trained model bundled yet */ }

let current = bundled ? { json: bundled, runtime: toRuntime(bundled) } : null;
const hooks = { onModelTrained: null };
const DEV_SECRET = 'dev-only-secret-change-me';
const ADMIN_SUB = '__admin__';
const failedAdmin = new Map(); // ip -> { count, resetAt } (per instance)
const stats = { inferences: 0, lastLatencyMs: null };

function configure(h) { Object.assign(hooks, h); }
function setModel(json) { current = { json, runtime: toRuntime(json) }; }
function requireModel() { if (!current) throw new ApiError(503, 'No trained model available. Run `npm run train` or POST /api/train.'); return current; }

function modelInfo() {
  if (!current) return { loaded: false };
  const j = current.json;
  return { loaded: true, architecture: j.architecture, trainedAt: j.trainedAt, labels: j.labels, inputSpec: j.inputSpec, config: j.config, dataSource: j.dataSource, metrics: { trainAccuracy: j.metrics.trainAccuracy, valAccuracy: j.metrics.valAccuracy, finalLoss: j.metrics.finalLoss, trainSamples: j.metrics.trainSamples, valSamples: j.metrics.valSamples, durationMs: j.metrics.durationMs, history: j.metrics.history } };
}

const routes = [];
function route(method, path, handler, opts = {}) { routes.push({ method, path, handler, auth: !!opts.auth, admin: !!opts.admin }); }

function str(v, name, min, max) {
  if (typeof v !== 'string' || v.length < min || v.length > max) throw new ApiError(400, `${name} must be a string of ${min}-${max} characters`);
  return v;
}
function num(v, name, min, max, dflt) {
  if (v === undefined || v === null) return dflt;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw new ApiError(400, `${name} must be a number between ${min} and ${max}`);
  return v;
}
function lang(v, dflt = 'en') { const l = v === undefined ? dflt : v; if (!LANGS[l]) throw new ApiError(400, `lang must be one of: ${Object.keys(LANGS).join(', ')}`); return l; }

function cleanPrefs(p) {
  const out = {};
  if (p === undefined || p === null) return out;
  if (typeof p !== 'object') throw new ApiError(400, 'preferences must be an object');
  if (p.targetLang !== undefined) out.targetLang = lang(p.targetLang);
  if (p.theme !== undefined) { if (!['light', 'dark'].includes(p.theme)) throw new ApiError(400, 'theme must be light or dark'); out.theme = p.theme; }
  if (p.confidenceThreshold !== undefined) out.confidenceThreshold = num(p.confidenceThreshold, 'confidenceThreshold', 0, 1);
  if (p.voice !== undefined) out.voice = str(p.voice, 'voice', 1, 80);
  if (p.connection !== undefined) { if (!['bluetooth', 'wifi'].includes(p.connection)) throw new ApiError(400, 'connection must be bluetooth or wifi'); out.connection = p.connection; }
  if (p.autoSpeak !== undefined) out.autoSpeak = !!p.autoSpeak;
  return out;
}

// ---- System ----
route('GET', '/api/health', async (ctx) => ({ body: { status: 'ok', time: new Date().toISOString(), modelLoaded: !!current, inferences: stats.inferences, lastLatencyMs: stats.lastLatencyMs, secretConfigured: !!ctx.env.SESSION_SECRET, services: ['frame-ingestion', 'landmark-extraction', 'sign-recognition', 'translation', 'tts', 'persistence'] } }));

// ---- Auth ----
route('POST', '/api/auth/register', async (ctx) => {
  const username = str(ctx.body.username, 'username', 3, 32);
  if (!/^[A-Za-z0-9_.-]+$/.test(username)) throw new ApiError(400, 'username may only contain letters, numbers, dot, dash and underscore');
  const password = str(ctx.body.password, 'password', 8, 128);
  if (store.findUserByName(username)) throw new ApiError(409, 'That username is already taken');
  const prefs = cleanPrefs(ctx.body.preferences);
  const { salt, hash } = await auth.hashPassword(password);
  const profile = ctx.body.displayName ? { displayName: str(ctx.body.displayName, 'displayName', 1, 60) } : {};
  const user = store.createUser({ username, salt, hash, profile });
  if (Object.keys(prefs).length) store.updatePreferences(user.id, prefs);
  const token = await auth.signToken(user.id, ctx.secret);
  return { status: 201, body: { token, user: { id: user.id, username, profile }, preferences: store.getPreferences(user.id) } };
});

route('POST', '/api/auth/login', async (ctx) => {
  const username = str(ctx.body.username, 'username', 1, 64), password = str(ctx.body.password, 'password', 1, 128);
  const user = store.findUserByName(username);
  const ok = user ? await auth.verifyPassword(password, user.salt, user.passwordHash) : false;
  if (!ok) throw new ApiError(401, 'Incorrect username or password');
  const token = await auth.signToken(user.id, ctx.secret);
  return { body: { token, user: { id: user.id, username: user.username, profile: user.profile }, preferences: store.getPreferences(user.id) } };
});

route('GET', '/api/auth/me', async (ctx) => ({ body: { user: { id: ctx.user.id, username: ctx.user.username, profile: ctx.user.profile }, preferences: store.getPreferences(ctx.user.id) } }), { auth: true });

route('GET', '/api/preferences', async (ctx) => ({ body: { preferences: store.getPreferences(ctx.user.id) } }), { auth: true });
route('PUT', '/api/preferences', async (ctx) => ({ body: { preferences: store.updatePreferences(ctx.user.id, cleanPrefs(ctx.body)) } }), { auth: true });

// ---- Model ----
route('GET', '/api/model', async () => ({ body: { model: modelInfo(), signs: Object.keys(SIGNS), languages: LANGS } }));

route('POST', '/api/train', async (ctx) => {
  const b = ctx.body || {};
  const options = {
    epochs: Math.round(num(b.epochs, 'epochs', 1, 60, 25)),
    hidden: Math.round(num(b.hidden, 'hidden', 4, 32, 16)),
    samplesPerClass: Math.round(num(b.samplesPerClass, 'samplesPerClass', 10, 80, 40)),
    learningRate: num(b.learningRate, 'learningRate', 0.0001, 0.1, 0.01),
    seed: Math.round(num(b.seed, 'seed', 0, 1e9, 42)),
  };
  const model = train(options);
  setModel(model);
  if (hooks.onModelTrained) await hooks.onModelTrained(model);
  return { body: { message: 'Training complete', persisted: !!hooks.onModelTrained, model: modelInfo() } };
}, { auth: true });

// ---- Inference pipeline: ingestion -> landmarks -> recognition -> translation -> TTS payload ----
route('POST', '/api/infer', async (ctx) => {
  const t0 = performance.now();
  const m = requireModel();
  const targetLang = lang(ctx.body.lang);
  const threshold = num(ctx.body.threshold, 'threshold', 0, 1, 0.6);
  const ex = extractSequence(ctx.body.frames, m.json.inputSpec.seqLen);
  const probs = predict(m.runtime, ex.sequence);
  const ranked = Array.from(probs, (p, i) => ({ gloss: m.json.labels[i], confidence: round(p) })).sort((a, b) => b.confidence - a.confidence);
  const top = ranked[0];
  const accepted = top.confidence >= threshold;
  const latencyMs = round(performance.now() - t0, 2);
  stats.inferences++; stats.lastLatencyMs = latencyMs;
  const text = translateGloss(top.gloss, targetLang);
  return { body: { gloss: top.gloss, confidence: top.confidence, accepted, threshold, topK: ranked.slice(0, 3), lang: targetLang, text, tts: { text, lang: LANGS[targetLang].tag }, handDetectionRatio: round(ex.handDetectionRatio, 3), framesReceived: ex.framesReceived, framesUsed: ex.framesUsed, latencyMs } };
});

route('POST', '/api/translate', async (ctx) => {
  const glosses = ctx.body.glosses;
  if (!Array.isArray(glosses) || glosses.length > 50 || !glosses.every((g) => typeof g === 'string' && g.length < 40)) throw new ApiError(400, 'glosses must be an array of up to 50 short strings');
  const l = lang(ctx.body.lang);
  return { body: { lang: l, text: translateSentence(glosses, l), tts: { text: translateSentence(glosses, l), lang: LANGS[l].tag } } };
});

// TTS service: returns a synthesis request (text + BCP-47 tag). Audio is rendered by the
// client's built-in Web Speech API; no audio engine is bundled on the server.
route('POST', '/api/tts', async (ctx) => {
  const text = str(ctx.body.text, 'text', 1, 500);
  const l = lang(ctx.body.lang);
  return { body: { text, lang: LANGS[l].tag, engine: 'web-speech-synthesis', voice: ctx.body.voice || 'default' } };
});

// Demo helper: synthetic landmark frames for a sign (stands in for a camera/glasses bridge).
route('POST', '/api/simulate', async (ctx) => {
  const gloss = str(ctx.body.gloss, 'gloss', 1, 40);
  if (!SIGNS[gloss]) throw new ApiError(400, 'Unknown gloss. Available: ' + Object.keys(SIGNS).join(', '));
  const seed = Math.round(num(ctx.body.seed, 'seed', 0, 1e9, Math.floor(Math.random() * 1e9)));
  const frames = generateSign(gloss, mulberry32(seed)).map((f) => f.map((p) => p.map((v) => round(v, 4))));
  return { body: { gloss, seed, frames } };
});

// ---- Session logs ----
route('POST', '/api/sessions', async (ctx) => {
  const glosses = ctx.body.glosses;
  if (!Array.isArray(glosses) || !glosses.length || glosses.length > 100 || !glosses.every((g) => typeof g === 'string' && g.length < 40)) throw new ApiError(400, 'glosses must be a non-empty array of short strings');
  const l = lang(ctx.body.lang);
  const confidence = num(ctx.body.confidence, 'confidence', 0, 1, 0);
  const log = store.addSessionLog(ctx.user.id, { glosses, translatedText: translateSentence(glosses, l), languagePair: 'ISL>' + l, confidence });
  return { status: 201, body: { session: log } };
}, { auth: true });

route('GET', '/api/sessions', async (ctx) => ({ body: { sessions: store.listSessionLogs(ctx.user.id, 100) } }), { auth: true });

function csvCell(v) {
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // neutralize spreadsheet formula injection
  return '"' + s.replace(/"/g, '""') + '"';
}
route('GET', '/api/sessions/export', async (ctx) => {
  const rows = store.listSessionLogs(ctx.user.id, 5000).reverse();
  const lines = ['id,createdAt,inputGlosses,translatedText,languagePair,confidence'];
  for (const r of rows) lines.push([r.id, r.createdAt, r.glosses.join(' '), r.translatedText, r.languagePair, r.confidence].map(csvCell).join(','));
  return { raw: lines.join('\n') + '\n', headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="signsync-sessions.csv"' } };
}, { auth: true });

// ---- Admin console (read-only view of all stored data) ----
// Credentials come from ADMIN_USERNAME / ADMIN_PASSWORD environment variables. If they are not set,
// the console is disabled. Password hashes and salts are never returned.
route('POST', '/api/admin/login', async (ctx) => {
  if (!ctx.env.ADMIN_USERNAME || !ctx.env.ADMIN_PASSWORD) throw new ApiError(503, 'Admin console is disabled. Set ADMIN_USERNAME and ADMIN_PASSWORD in the environment.');
  const ip = ctx.ip || 'unknown', now = Date.now();
  const rec = failedAdmin.get(ip);
  if (rec && rec.resetAt > now && rec.count >= 5) throw new ApiError(429, 'Too many failed attempts. Wait a minute and try again.');
  const u = str(ctx.body.username, 'username', 1, 64), p = str(ctx.body.password, 'password', 1, 128);
  const okU = await auth.secretsMatch(u, ctx.env.ADMIN_USERNAME), okP = await auth.secretsMatch(p, ctx.env.ADMIN_PASSWORD);
  if (!(okU && okP)) {
    const cur = rec && rec.resetAt > now ? rec : { count: 0, resetAt: now + 60000 };
    cur.count++; failedAdmin.set(ip, cur);
    throw new ApiError(401, 'Incorrect admin username or password');
  }
  failedAdmin.delete(ip);
  return { body: { token: await auth.signToken(ADMIN_SUB, ctx.secret), admin: ctx.env.ADMIN_USERNAME } };
});

route('GET', '/api/admin/overview', async () => {
  const users = store.listUsersForAdmin(), sessions = store.listAllSessionLogs(1000);
  const m = modelInfo();
  return { body: { counts: { users: users.length, sessions: store._state.sessionLogs.length }, users, sessions, model: m.loaded ? { trainedAt: m.trainedAt, labels: m.labels, dataSource: m.dataSource, valAccuracy: m.metrics.valAccuracy, trainAccuracy: m.metrics.trainAccuracy, config: m.config } : null, inferences: stats.inferences, lastLatencyMs: stats.lastLatencyMs } };
}, { admin: true });

route('GET', '/api/admin/export', async (ctx) => {
  const table = ctx.query.table === 'users' ? 'users' : 'sessions';
  const lines = [], file = table === 'users' ? 'signsync-users.csv' : 'signsync-session-logs.csv';
  if (table === 'users') {
    lines.push('id,username,displayName,createdAt,targetLang,theme,confidenceThreshold,connection,sessionCount');
    for (const u of store.listUsersForAdmin()) lines.push([u.id, u.username, u.displayName, u.createdAt, u.preferences.targetLang, u.preferences.theme, u.preferences.confidenceThreshold, u.preferences.connection, u.sessionCount].map(csvCell).join(','));
  } else {
    lines.push('id,username,createdAt,inputGlosses,translatedText,languagePair,confidence');
    for (const r of store.listAllSessionLogs(5000)) lines.push([r.id, r.username, r.createdAt, r.glosses.join(' '), r.translatedText, r.languagePair, r.confidence].map(csvCell).join(','));
  }
  return { raw: lines.join('\n') + '\n', headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${file}"` } };
}, { admin: true });

// ---- Dispatcher ----
async function handle(req) {
  const env = req.env || {};
  const secret = env.SESSION_SECRET || DEV_SECRET;
  const path = (req.path || '/').replace(/\/+$/, '') || '/';
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  try {
    const matches = routes.filter((r) => r.path === path);
    if (!matches.length) throw new ApiError(404, 'Not found');
    const r = matches.find((x) => x.method === req.method);
    if (!r) throw new ApiError(405, 'Method not allowed');
    const hdrs = req.headers || {};
    const ip = String(hdrs['x-forwarded-for'] || hdrs['cf-connecting-ip'] || 'local').split(',')[0].trim();
    const ctx = { env, secret, ip, body: req.body && typeof req.body === 'object' ? req.body : {}, query: req.query || {}, user: null };
    let refreshed = null;
    if (r.auth) {
      const h = (req.headers && (req.headers.authorization || req.headers.Authorization)) || '';
      const payload = await auth.verifyToken(h.startsWith('Bearer ') ? h.slice(7) : '', secret);
      const user = payload && store.findUserById(payload.sub);
      if (!user) throw new ApiError(401, 'Session expired or invalid. Sign in again.');
      ctx.user = user;
      refreshed = await auth.signToken(user.id, secret); // sliding inactivity expiry
    }
    if (r.admin) {
      const h = hdrs.authorization || hdrs.Authorization || '';
      const payload = await auth.verifyToken(h.startsWith('Bearer ') ? h.slice(7) : '', secret);
      if (!payload || payload.sub !== ADMIN_SUB) throw new ApiError(401, 'Admin session expired or invalid. Sign in again.');
      refreshed = await auth.signToken(ADMIN_SUB, secret);
    }
    const out = await r.handler(ctx);
    if (refreshed) headers['X-Refresh-Token'] = refreshed;
    if (out.raw !== undefined) return { status: out.status || 200, headers: { ...headers, ...out.headers }, body: out.raw };
    return { status: out.status || 200, headers, body: JSON.stringify(out.body) };
  } catch (e) {
    if (e instanceof ApiError) return { status: e.status, headers, body: JSON.stringify({ error: e.message }) };
    console.error(e);
    return { status: 500, headers, body: JSON.stringify({ error: 'Internal server error' }) };
  }
}

module.exports = { handle, configure, setModel, store, modelInfo, FEATURES };
