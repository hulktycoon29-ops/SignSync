/* SignSync front end: hash-routed single page app, no framework. */
(function () {
  'use strict';
  const LANGS = { en: 'English', hi: 'Hindi', mr: 'Marathi' };
  const LANG_TAGS = { en: 'en-IN', hi: 'hi-IN', mr: 'mr-IN' };
  // Admin page address (type it in the browser: http://localhost:3000/#/<ADMIN_ROUTE>). No link to it appears anywhere
  // in the site. Change this to something private; the real protection is the admin password checked by the server.
  const ADMIN_ROUTE = 'admin';
  const INACTIVITY_MS = 30 * 60 * 1000;
  const BONES = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[9,10],[10,11],[11,12],[13,14],[14,15],[15,16],[0,17],[17,18],[18,19],[19,20],[5,9],[9,13],[13,17]];
  const DEFAULT_PREFS = { targetLang: 'en', theme: 'dark', confidenceThreshold: 0.6, voice: 'default', connection: 'bluetooth', autoSpeak: false };

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) { /* storage unavailable */ } },
  };

  const state = {
    token: store.get('ss_token'), user: null, prefs: { ...DEFAULT_PREFS, ...safeJson(store.get('ss_prefs')) },
    adminToken: sessionStore('ss_admin'), health: null, model: null, buffer: [], lastResult: null, lastActivity: Date.now(), cameraStream: null,
  };
  function sessionStore(k, v) { try { if (v === undefined) return sessionStorage.getItem(k); v === null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch (e) { return null; } }
  function safeJson(s) { try { return JSON.parse(s) || {}; } catch (e) { return {}; } }

  // ---------- API ----------
  async function api(path, { method = 'GET', body, admin = false } = {}) {
    const headers = {};
    if (body) headers['Content-Type'] = 'application/json';
    const tok = admin ? state.adminToken : state.token;
    if (tok) headers.Authorization = 'Bearer ' + tok;
    let res;
    try { res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined }); }
    catch (e) { setOnline(false); throw new Error('Cannot reach the SignSync API. Check your connection.'); }
    setOnline(true);
    const refreshed = res.headers.get('X-Refresh-Token');
    if (refreshed) { if (admin) { state.adminToken = refreshed; sessionStore('ss_admin', refreshed); } else { state.token = refreshed; store.set('ss_token', refreshed); } }
    if (res.status === 401 && tok && !path.endsWith('/login')) { if (admin) { state.adminToken = null; sessionStore('ss_admin', null); if (currentRoute() === ADMIN_ROUTE) render(); } else signOut(true); }
    const ct = res.headers.get('Content-Type') || '';
    const data = ct.includes('json') ? await res.json() : await res.text();
    if (!res.ok) throw new Error((data && data.error) || 'Request failed (' + res.status + ')');
    return data;
  }

  function setOnline(ok) {
    const d = $('#api-dot'), t = $('#api-text');
    if (d) { d.className = 'dot ' + (ok ? 'ok' : 'bad'); t.textContent = ok ? 'API online' : 'API offline'; }
  }

  // ---------- Session ----------
  async function restoreSession() {
    if (!state.token) return;
    try { const r = await api('/api/auth/me'); state.user = r.user; applyPrefs({ ...DEFAULT_PREFS, ...r.preferences }, false); }
    catch (e) { state.token = null; store.set('ss_token', null); }
  }
  function startSession(r) {
    state.token = r.token; state.user = r.user; store.set('ss_token', r.token);
    applyPrefs({ ...DEFAULT_PREFS, ...r.preferences }, false);
  }
  function signOut(expired) {
    state.token = null; state.user = null; store.set('ss_token', null);
    renderNav();
    if (expired) toast('Your session expired. Sign in again.', true);
    location.hash = '#/login';
  }
  setInterval(() => { if (state.token && Date.now() - state.lastActivity > INACTIVITY_MS) signOut(true); }, 30000);
  ['pointerdown', 'keydown'].forEach((ev) => addEventListener(ev, () => { state.lastActivity = Date.now(); }));

  function applyPrefs(p, persist) {
    state.prefs = p;
    document.documentElement.setAttribute('data-theme', p.theme);
    store.set('ss_theme', p.theme); store.set('ss_prefs', JSON.stringify(p));
    if (persist && state.token) api('/api/preferences', { method: 'PUT', body: p }).catch((e) => toast(e.message, true));
  }

  // ---------- UI helpers ----------
  let toastTimer;
  function toast(msg, isErr) {
    const t = $('#toast'); t.textContent = msg; t.className = 'show' + (isErr ? ' err' : '');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.className = ''; }, 3800);
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('.btn'); if (!b || b.disabled) return;
    const r = b.getBoundingClientRect(), size = Math.max(r.width, r.height) * 1.2, s = document.createElement('span');
    s.className = 'ripple'; s.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - r.left - size / 2}px;top:${e.clientY - r.top - size / 2}px`;
    b.appendChild(s); setTimeout(() => s.remove(), 650);
  });
  (function glow() {
    const g = $('#glow'); if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let x = 0, y = 0, raf = 0;
    addEventListener('pointermove', (e) => { x = e.clientX; y = e.clientY; g.classList.add('on'); if (!raf) raf = requestAnimationFrame(() => { g.style.transform = `translate(${x}px,${y}px)`; raf = 0; }); });
    document.addEventListener('pointerleave', () => g.classList.remove('on'));
  })();

  const LOGO = '<svg viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="14" fill="#0b2a5b"/><g stroke="#22d3ee" stroke-width="4" stroke-linecap="round" fill="none"><path d="M32 50V30M22 34V20M42 34V18M32 30V14M50 38l-8 6"/></g><circle cx="32" cy="52" r="5" fill="#22d3ee"/></svg>';

  function renderNav() {
    const route = currentRoute();
    const link = (r, label) => `<a href="#/${r}" ${route === r ? 'aria-current="page"' : ''}>${label}</a>`;
    $('#nav').innerHTML = `
      <a class="brand" href="#/dashboard">${LOGO}<span>SignSync</span></a>
      <nav class="nav-links" aria-label="Primary">${link('dashboard', 'Dashboard')}${link('live', 'Live translation')}${link('settings', 'Settings')}${link('help', 'Help')}</nav>
      <div class="nav-right">
        <span class="status-pill"><span id="api-dot" class="dot"></span><span id="api-text">Checking API</span></span>
        <button class="btn secondary icon-btn" id="theme-btn" aria-label="Switch to ${state.prefs.theme === 'dark' ? 'light' : 'dark'} theme">${state.prefs.theme === 'dark' ? 'Light theme' : 'Dark theme'}</button>
        ${state.user ? `<span class="muted">${esc(state.user.username)}</span><button class="btn secondary" id="signout">Sign out</button>` : '<a class="btn" href="#/login">Sign in</a>'}
      </div>`;
    $('#theme-btn').onclick = () => { applyPrefs({ ...state.prefs, theme: state.prefs.theme === 'dark' ? 'light' : 'dark' }, true); renderNav(); drawers.forEach((f) => f()); };
    const so = $('#signout'); if (so) so.onclick = () => signOut(false);
    api('/api/health').then((h) => { state.health = h; }).catch(() => {});
  }

  // ---------- Routing ----------
  const drawers = [];
  let renderSeq = 0;
  const routes = { login: renderLogin, register: renderRegister, dashboard: renderDashboard, live: renderLive, settings: renderSettings, help: renderHelp, [ADMIN_ROUTE]: renderAdmin };
  function currentRoute() { return (location.hash.replace(/^#\//, '') || 'dashboard').split('?')[0]; }
  async function render() {
    stopCamera(); drawers.length = 0;
    const r = currentRoute(); const fn = routes[r] || renderDashboard;
    renderNav();
    const view = $('#view'); view.innerHTML = ''; ++renderSeq;
    await fn(view);
    document.title = 'SignSync - ' + ({ login: 'Sign in', register: 'Create account', dashboard: 'Dashboard', live: 'Live translation', settings: 'Settings', help: 'Help', [ADMIN_ROUTE]: 'Admin console' }[r] || 'Dashboard');
  }
  addEventListener('hashchange', render);

  // ---------- Auth pages ----------
  function renderLogin(v) {
    v.innerHTML = `<section class="card form-card"><h1>Sign in</h1><p class="muted">Your sessions, preferences and history follow you across devices.</p>
      <div class="field"><label for="u">Username</label><input id="u" autocomplete="username"></div>
      <div class="field"><label for="p">Password</label><input id="p" type="password" autocomplete="current-password"></div>
      <p class="error" id="err" role="alert"></p>
      <div class="row"><button class="btn" id="go">Sign in</button><a class="btn secondary" href="#/register">Create account</a><a class="btn ghost" href="#/dashboard">Continue as guest</a></div></section>`;
    const submit = async () => {
      $('#err').textContent = ''; $('#go').disabled = true;
      try { startSession(await api('/api/auth/login', { method: 'POST', body: { username: $('#u').value.trim(), password: $('#p').value } })); location.hash = '#/dashboard'; }
      catch (e) { $('#err').textContent = e.message; } finally { $('#go').disabled = false; }
    };
    $('#go').onclick = submit; $('#p').onkeydown = (e) => { if (e.key === 'Enter') submit(); };
  }

  function renderRegister(v) {
    v.innerHTML = `<section class="card form-card"><h1>Create account</h1><p class="muted">Set your credentials and default accessibility preferences.</p>
      <div class="field"><label for="dn">Display name (optional)</label><input id="dn" autocomplete="name"></div>
      <div class="field"><label for="u">Username</label><input id="u" autocomplete="username"></div>
      <div class="field"><label for="p">Password (at least 8 characters)</label><input id="p" type="password" autocomplete="new-password"></div>
      <div class="field"><label for="l">Spoken output language</label><select id="l">${Object.entries(LANGS).map(([k, n]) => `<option value="${k}">${n}</option>`).join('')}</select></div>
      <div class="field"><label for="t">Theme</label><select id="t"><option value="dark">Dark</option><option value="light">Light</option></select></div>
      <p class="error" id="err" role="alert"></p>
      <div class="row"><button class="btn" id="go">Create account</button><a class="btn secondary" href="#/login">I have an account</a></div></section>`;
    $('#t').value = state.prefs.theme;
    $('#go').onclick = async () => {
      $('#err').textContent = ''; $('#go').disabled = true;
      try {
        const body = { username: $('#u').value.trim(), password: $('#p').value, preferences: { targetLang: $('#l').value, theme: $('#t').value } };
        if ($('#dn').value.trim()) body.displayName = $('#dn').value.trim();
        startSession(await api('/api/auth/register', { method: 'POST', body })); location.hash = '#/dashboard';
      } catch (e) { $('#err').textContent = e.message; } finally { $('#go').disabled = false; }
    };
  }

  // ---------- Dashboard ----------
  async function renderDashboard(v) {
    const rid = renderSeq;
    v.innerHTML = `<div class="page-head"><div><h1>Dashboard</h1><p class="muted">System status, recent translations and model training.</p></div><a class="btn" href="#/live">Open live translation</a></div>
      <div class="grid cols-4" id="stats"></div>
      <div class="grid cols-2" style="margin-top:1.1rem">
        <section class="card lift"><h2>Recent translations</h2><div id="recent" class="table-wrap"></div></section>
        <section class="card"><h2>Train the model</h2>
          <p class="muted">Trains the BiLSTM on generated sample landmarks. To use your own dataset, see the README.</p>
          <div class="row"><div class="grow"><label for="ep">Epochs</label><input id="ep" type="number" min="1" max="60" value="25"></div><div class="grow"><label for="hd">Hidden units</label><input id="hd" type="number" min="4" max="32" value="16"></div><div class="grow"><label for="sp">Samples per sign</label><input id="sp" type="number" min="10" max="80" value="40"></div></div>
          <div class="row" style="margin-top:.8rem"><button class="btn" id="train">Train model</button><span id="train-msg" class="muted" role="status"></span></div>
          <canvas class="chart" id="chart" style="margin-top:1rem"></canvas></section></div>`;
    const [h, m] = await Promise.all([api('/api/health').catch(() => null), api('/api/model').catch(() => null)]);
    if (rid !== renderSeq) return; // user navigated away while data was loading
    state.health = h; state.model = m && m.model;
    const mm = state.model;
    const lat = (state.lastResult && state.lastResult.latencyMs) ?? (h && h.lastLatencyMs);
    const conn = state.prefs.connection === 'wifi' ? 'Wi-Fi' : 'Bluetooth LE';
    $('#stats').innerHTML = [
      ['Model', mm && mm.loaded ? 'Ready' : 'Not trained', mm && mm.loaded ? `${mm.labels.length} signs, ${mm.architecture.split('-')[0].toUpperCase()}` : 'Train below to begin'],
      ['Validation accuracy', mm && mm.loaded ? (mm.metrics.valAccuracy * 100).toFixed(1) + '%' : '-', mm && mm.loaded ? 'Trained on ' + mm.dataSource + ' data' : ''],
      ['Processing latency', lat != null ? lat + ' ms' : '-', 'Last recognition request'],
      ['Glasses link', 'Not paired', conn + ' profile selected. Simulated input is active.'],
    ].map(([l, val, s]) => `<div class="card stat lift"><div class="label">${l}</div><div class="value">${esc(val)}</div><div class="sub">${esc(s)}</div></div>`).join('');
    drawLoss();
    drawers.push(drawLoss);
    $('#train').onclick = runTrain;
    loadRecent();
  }

  async function loadRecent() {
    const el = $('#recent'); if (!el) return;
    if (!state.user) { el.innerHTML = '<p class="empty">Sign in to keep a history of your translations.</p>'; return; }
    try {
      const { sessions } = await api('/api/sessions');
      el.innerHTML = sessions.length ? `<table><thead><tr><th>When</th><th>Signs</th><th>Translation</th></tr></thead><tbody>${sessions.slice(0, 6).map((s) => `<tr><td>${new Date(s.createdAt).toLocaleString()}</td><td>${esc(s.glosses.join(' '))}</td><td>${esc(s.translatedText)}</td></tr>`).join('')}</tbody></table>` : '<p class="empty">No sessions saved yet. Translate something on the live screen and save it.</p>';
    } catch (e) { el.innerHTML = `<p class="empty">${esc(e.message)}</p>`; }
  }

  async function runTrain() {
    const msg = $('#train-msg'), btn = $('#train');
    if (!state.user) { msg.textContent = 'Sign in to train a model.'; return; }
    btn.disabled = true; msg.textContent = 'Training. This usually takes 5 to 30 seconds.';
    try {
      const r = await api('/api/train', { method: 'POST', body: { epochs: +$('#ep').value, hidden: +$('#hd').value, samplesPerClass: +$('#sp').value } });
      state.model = r.model; msg.textContent = `Done: ${(r.model.metrics.valAccuracy * 100).toFixed(1)}% validation accuracy${r.persisted ? '' : ' (kept in server memory only)'}.`;
      toast('Model trained'); renderDashboard($('#view'));
    } catch (e) { msg.textContent = e.message; } finally { btn.disabled = false; }
  }

  function drawLoss() {
    const c = $('#chart'); if (!c) return;
    const dpr = devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight; c.width = w * dpr; c.height = h * dpr;
    const x = c.getContext('2d'); x.scale(dpr, dpr);
    const cs = getComputedStyle(document.documentElement), col = (n) => cs.getPropertyValue(n).trim();
    const hist = state.model && state.model.loaded && state.model.metrics.history;
    x.fillStyle = col('--muted'); x.font = '13px sans-serif';
    if (!hist || !hist.length) { x.fillText('Train a model to see its learning curve.', 14, h / 2); return; }
    const pad = 28, maxL = Math.max(...hist.map((e) => e.loss), 0.01), n = hist.length;
    const px = (i) => pad + (i / Math.max(1, n - 1)) * (w - pad * 1.5), line = (key, scale, color) => { x.beginPath(); hist.forEach((e, i) => { const y = h - pad - (e[key] / scale) * (h - pad * 1.5); i ? x.lineTo(px(i), y) : x.moveTo(px(i), y); }); x.strokeStyle = color; x.lineWidth = 2.5; x.stroke(); };
    line('loss', maxL, col('--bad')); line('valAcc', 1, col('--accent'));
    x.fillStyle = col('--bad'); x.fillText('Loss', pad, 16); x.fillStyle = col('--accent'); x.fillText('Validation accuracy', pad + 50, 16);
    x.fillStyle = col('--muted'); x.fillText('Epochs 1 to ' + n, pad, h - 8);
  }

  // ---------- Live translation ----------
  function drawHand(canvas, frame) {
    const dpr = devicePixelRatio || 1, w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== w * dpr) { canvas.width = w * dpr; canvas.height = h * dpr; }
    const x = canvas.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, w, h);
    const line = getComputedStyle(document.documentElement).getPropertyValue('--canvas-line').trim() || '#22d3ee';
    x.strokeStyle = 'rgba(147,171,208,.12)'; x.lineWidth = 1;
    for (let i = 1; i < 8; i++) { x.beginPath(); x.moveTo((w / 8) * i, 0); x.lineTo((w / 8) * i, h); x.stroke(); x.beginPath(); x.moveTo(0, (h / 8) * i); x.lineTo(w, (h / 8) * i); x.stroke(); }
    if (!frame) { x.fillStyle = '#93abd0'; x.font = '15px sans-serif'; x.textAlign = 'center'; x.fillText('Waiting for a sign', w / 2, h / 2); return; }
    const P = frame.map((p) => [p[0] * w, p[1] * h]);
    x.shadowColor = line; x.shadowBlur = 14; x.strokeStyle = line; x.lineWidth = 3; x.lineCap = 'round';
    BONES.forEach(([a, b]) => { x.beginPath(); x.moveTo(...P[a]); x.lineTo(...P[b]); x.stroke(); });
    x.fillStyle = '#e8f1ff'; P.forEach((p) => { x.beginPath(); x.arc(p[0], p[1], 3.5, 0, 7); x.fill(); });
  }

  async function renderLive(v) {
    const rid = renderSeq;
    let signs = ['HELLO', 'THANK_YOU', 'YES', 'NO', 'HELP', 'WATER', 'FOOD', 'PLEASE'];
    try { const m = await api('/api/model'); state.model = m.model; if (m.signs) signs = m.signs; } catch (e) { /* offline banner handles it */ }
    if (rid !== renderSeq) return; // user navigated away while data was loading
    const nice = (g) => g.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());
    v.innerHTML = `<div class="page-head"><div><h1>Live translation</h1><p class="muted">Perform a sign. The model reads the hand landmarks and speaks the result.</p></div></div>
      <div class="split">
        <section class="card"><h2>Input</h2>
          <div class="stage camera-box" id="cam"><span id="cam-note">Camera preview is off. Hand tracking is not bundled, so use the sign simulator below to drive the model.</span><span class="overlay" id="hand-status" style="display:none"></span></div>
          <div class="stage" style="margin-top:.8rem"><canvas id="hand" style="height:260px"></canvas><span class="overlay">Landmark stream</span></div>
          <div class="row" style="margin-top:.9rem"><button class="btn secondary" id="cam-btn">Start camera</button></div>
          <div class="row" style="margin-top:.9rem"><div class="grow"><label for="sign">Sign to perform</label><select id="sign">${signs.map((s) => `<option value="${s}">${nice(s)}</option>`).join('')}</select></div><button class="btn" id="perform">Perform sign</button><button class="btn secondary" id="random">Random sign</button></div>
          <p class="error" id="live-err" role="alert"></p></section>
        <section class="card"><h2>Recognition</h2>
          <div class="gloss-big" id="gloss" aria-live="polite">-</div>
          <div class="row" style="justify-content:space-between"><span class="muted">Confidence</span><strong id="conf">-</strong></div><div class="meter"><span id="meter"></span></div>
          <div class="topk" id="topk"></div>
          <div class="row" style="margin-top:.8rem"><span class="badge" id="hand-badge">Hand: waiting</span><span class="badge" id="lat-badge">Latency: -</span></div>
          <h3 style="margin-top:1.2rem">Sentence</h3><div class="buffer" id="buffer"></div>
          <div class="sentence" id="sentence" aria-live="polite"></div>
          <div class="row" style="margin-top:.8rem"><div class="grow"><label for="lang">Speak in</label><select id="lang">${Object.entries(LANGS).map(([k, n]) => `<option value="${k}">${n}</option>`).join('')}</select></div></div>
          <div class="row" style="margin-top:.8rem"><button class="btn" id="speak">Speak sentence</button><button class="btn secondary" id="save">Save session</button><button class="btn ghost" id="clear">Clear</button></div></section>
      </div>`;
    const canvas = $('#hand'); drawHand(canvas, null); drawers.push(() => drawHand(canvas, null));
    $('#lang').value = state.prefs.targetLang;
    $('#lang').onchange = () => { applyPrefs({ ...state.prefs, targetLang: $('#lang').value }, true); refreshSentence(); };
    $('#cam-btn').onclick = toggleCamera;
    $('#perform').onclick = () => perform($('#sign').value);
    $('#random').onclick = () => { const s = signs[Math.floor(Math.random() * signs.length)]; $('#sign').value = s; perform(s); };
    $('#clear').onclick = () => { state.buffer = []; refreshBuffer(); };
    $('#speak').onclick = speak;
    $('#save').onclick = saveSession;
    refreshBuffer();
    if (!state.model || !state.model.loaded) $('#live-err').textContent = 'No trained model is available yet. Train one from the dashboard.';
  }

  let busy = false;
  async function perform(gloss) {
    if (busy) return; busy = true; $('#live-err').textContent = ''; $('#perform').disabled = true; $('#random').disabled = true;
    const canvas = $('#hand');
    try {
      const sim = await api('/api/simulate', { method: 'POST', body: { gloss } });
      for (const f of sim.frames) { if (!$('#hand')) return; drawHand(canvas, f); await new Promise((r) => setTimeout(r, 33)); }
      const r = await api('/api/infer', { method: 'POST', body: { frames: sim.frames, lang: state.prefs.targetLang, threshold: state.prefs.confidenceThreshold } });
      state.lastResult = r; showResult(r);
      if (r.accepted) { state.buffer.push({ gloss: r.gloss, confidence: r.confidence }); refreshBuffer(); if (state.prefs.autoSpeak) speakText(r.text, r.tts.lang); }
    } catch (e) { const el = $('#live-err'); if (el) el.textContent = e.message; }
    finally { busy = false; const p = $('#perform'); if (p) { p.disabled = false; $('#random').disabled = false; } }
  }

  function showResult(r) {
    $('#gloss').textContent = r.accepted ? r.text : 'Not sure';
    $('#conf').textContent = (r.confidence * 100).toFixed(1) + '%'; $('#meter').style.width = r.confidence * 100 + '%';
    $('#topk').innerHTML = r.topK.map((t) => `<div><span>${esc(t.gloss.replace(/_/g, ' ').toLowerCase())}</span><span class="meter"><span style="width:${t.confidence * 100}%"></span></span><span>${(t.confidence * 100).toFixed(0)}%</span></div>`).join('');
    $('#hand-badge').textContent = 'Hand detected in ' + Math.round(r.handDetectionRatio * 100) + '% of frames';
    $('#lat-badge').textContent = 'Latency: ' + r.latencyMs + ' ms';
    if (!r.accepted) $('#live-err').textContent = `Confidence is below your ${Math.round(r.threshold * 100)}% threshold, so the sign was not added. Try again or lower the threshold in Settings.`;
  }

  function refreshBuffer() {
    const b = $('#buffer'); if (!b) return;
    b.innerHTML = state.buffer.length ? state.buffer.map((s) => `<span class="chip">${esc(s.gloss.replace(/_/g, ' ').toLowerCase())}</span>`).join('') : '<span class="muted">Recognized signs appear here.</span>';
    refreshSentence();
  }
  let sentenceReq = 0;
  async function refreshSentence() {
    const el = $('#sentence'); if (!el) return;
    if (!state.buffer.length) { el.textContent = ''; return; }
    const req = ++sentenceReq;
    try { const r = await api('/api/translate', { method: 'POST', body: { glosses: state.buffer.map((s) => s.gloss), lang: state.prefs.targetLang } }); if (req === sentenceReq && $('#sentence')) { el.textContent = r.text; el.dataset.lang = r.tts.lang; } } catch (e) { el.textContent = e.message; }
  }

  function speakText(text, tag) {
    if (!('speechSynthesis' in window)) { toast('This browser cannot play speech.', true); return; }
    const u = new SpeechSynthesisUtterance(text); u.lang = tag;
    const voices = speechSynthesis.getVoices();
    const pick = voices.find((x) => x.name === state.prefs.voice) || voices.find((x) => x.lang === tag) || voices.find((x) => x.lang.startsWith(tag.slice(0, 2)));
    if (pick) u.voice = pick;
    speechSynthesis.cancel(); speechSynthesis.speak(u);
  }
  async function speak() {
    const el = $('#sentence'); if (!el.textContent) { toast('Perform a sign first.', true); return; }
    try { const t = await api('/api/tts', { method: 'POST', body: { text: el.textContent, lang: state.prefs.targetLang } }); speakText(t.text, t.lang); } catch (e) { toast(e.message, true); }
  }
  async function saveSession() {
    if (!state.user) { toast('Sign in to save sessions.', true); return; }
    if (!state.buffer.length) { toast('Nothing to save yet.', true); return; }
    try {
      const avg = state.buffer.reduce((a, s) => a + s.confidence, 0) / state.buffer.length;
      await api('/api/sessions', { method: 'POST', body: { glosses: state.buffer.map((s) => s.gloss), lang: state.prefs.targetLang, confidence: avg } });
      toast('Session saved');
    } catch (e) { toast(e.message, true); }
  }

  async function toggleCamera() {
    if (state.cameraStream) { stopCamera(); return; }
    try {
      state.cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
      const video = document.createElement('video'); video.autoplay = true; video.muted = true; video.playsInline = true; video.srcObject = state.cameraStream;
      $('#cam').prepend(video); $('#cam-note').style.display = 'none'; $('#cam-btn').textContent = 'Stop camera';
    } catch (e) { toast('Camera unavailable: ' + (e.message || 'permission denied'), true); }
  }
  function stopCamera() {
    if (state.cameraStream) { state.cameraStream.getTracks().forEach((t) => t.stop()); state.cameraStream = null; }
    const cam = $('#cam'); if (cam) { const v = $('video', cam); if (v) v.remove(); const n = $('#cam-note'); if (n) n.style.display = ''; const b = $('#cam-btn'); if (b) b.textContent = 'Start camera'; }
  }

  // ---------- Settings ----------
  function renderSettings(v) {
    const p = state.prefs;
    v.innerHTML = `<div class="page-head"><div><h1>Settings</h1><p class="muted">${state.user ? 'Saved to your account.' : 'You are a guest. Settings are saved on this device only.'}</p></div></div>
      <div class="grid cols-2">
        <section class="card"><h2>Translation</h2>
          <div class="field"><label for="s-lang">Spoken output language</label><select id="s-lang">${Object.entries(LANGS).map(([k, n]) => `<option value="${k}">${n}</option>`).join('')}</select></div>
          <div class="field"><label for="s-thr">Confidence threshold: <span id="thr-val"></span></label><input id="s-thr" type="range" min="0" max="1" step="0.05"></div>
          <div class="field"><label for="s-voice">Voice</label><select id="s-voice"><option value="default">Browser default for the language</option></select></div>
          <div class="field"><label><input id="s-auto" type="checkbox"> Speak each recognized sign automatically</label></div></section>
        <section class="card"><h2>Appearance and device</h2>
          <div class="field"><label for="s-theme">Theme</label><select id="s-theme"><option value="dark">Dark</option><option value="light">Light</option></select></div>
          <div class="field"><label for="s-conn">Smart glasses connection profile</label><select id="s-conn"><option value="bluetooth">Bluetooth LE</option><option value="wifi">Wi-Fi</option></select></div>
          <p class="muted">The profile is stored for the glasses bridge. No hardware pairing happens in this web build.</p></section></div>
      <div class="row" style="margin-top:1.2rem"><button class="btn" id="s-save">Save settings</button><button class="btn secondary" id="s-export">Export session history (CSV)</button></div>`;
    $('#s-lang').value = p.targetLang; $('#s-thr').value = p.confidenceThreshold; $('#s-theme').value = p.theme; $('#s-conn').value = p.connection; $('#s-auto').checked = !!p.autoSpeak;
    const thr = () => { $('#thr-val').textContent = Math.round($('#s-thr').value * 100) + '%'; }; thr(); $('#s-thr').oninput = thr;
    const fillVoices = () => { if (!('speechSynthesis' in window)) return; const cur = p.voice; $('#s-voice').innerHTML = '<option value="default">Browser default for the language</option>' + speechSynthesis.getVoices().map((x) => `<option value="${esc(x.name)}">${esc(x.name)} (${esc(x.lang)})</option>`).join(''); $('#s-voice').value = cur; };
    fillVoices(); if ('speechSynthesis' in window) speechSynthesis.onvoiceschanged = fillVoices;
    $('#s-save').onclick = () => { applyPrefs({ targetLang: $('#s-lang').value, confidenceThreshold: +$('#s-thr').value, voice: $('#s-voice').value, connection: $('#s-conn').value, theme: $('#s-theme').value, autoSpeak: $('#s-auto').checked }, true); renderNav(); toast('Settings saved'); };
    $('#s-export').onclick = async () => {
      if (!state.user) { toast('Sign in to export your history.', true); return; }
      try { const csv = await api('/api/sessions/export'); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'signsync-sessions.csv'; a.click(); URL.revokeObjectURL(a.href); }
      catch (e) { toast(e.message, true); }
    };
  }

  // ---------- Help ----------
  function renderHelp(v) {
    v.innerHTML = `<div class="page-head"><div><h1>Help</h1><p class="muted">Guidelines, troubleshooting and privacy.</p></div></div>
      <section class="card"><h2>Using SignSync</h2>
        <details open><summary>How translation works</summary><p>Hand landmarks from each video frame are normalized, a bidirectional LSTM reads the sequence and names the sign, the gloss is translated into your chosen language, and the browser speaks it aloud.</p></details>
        <details><summary>Getting a clear reading</summary><p>Keep your hand fully in view with good, even light. Start and finish each sign with the hand still. If confidence stays low, lower the threshold in Settings or retrain the model from the dashboard.</p></details>
        <details><summary>Troubleshooting</summary><p><strong>API offline:</strong> check your connection and reload. <strong>Not trained:</strong> open the dashboard and choose Train model. <strong>No sound:</strong> check device volume and that your browser has a voice for the selected language. <strong>Signed out unexpectedly:</strong> sessions end after 30 minutes without activity.</p></details>
        <details><summary>Camera and privacy</summary><p>The camera preview stays in your browser and is never uploaded. Only landmark coordinates are sent to the recognition service, and only when you perform a sign. Saved sessions store recognized signs and translated text, not video. You can export your history as CSV from Settings.</p></details>
        <details><summary>Accessibility</summary><p>Every control works with a keyboard, focus is always visible, text uses a high-legibility typeface, and animation respects your system's reduced-motion setting.</p></details></section>`;
  }

  // ---------- Admin console ----------
  async function renderAdmin(v) {
    const rid = renderSeq;
    if (!state.adminToken) {
      v.innerHTML = `<section class="card form-card"><h1>Admin sign in</h1><p class="muted">View every account, preference and saved session. Use the admin username and password from your server's .env file.</p>
        <div class="field"><label for="au">Admin username</label><input id="au" autocomplete="username"></div>
        <div class="field"><label for="ap">Admin password</label><input id="ap" type="password" autocomplete="current-password"></div>
        <p class="error" id="err" role="alert"></p><div class="row"><button class="btn" id="go">Sign in to admin</button></div></section>`;
      const submit = async () => {
        $('#err').textContent = ''; $('#go').disabled = true;
        try { const r = await api('/api/admin/login', { method: 'POST', body: { username: $('#au').value.trim(), password: $('#ap').value } }); state.adminToken = r.token; sessionStore('ss_admin', r.token); renderAdmin(v); }
        catch (e) { $('#err').textContent = e.message; $('#go').disabled = false; }
      };
      $('#go').onclick = submit; $('#ap').onkeydown = (e) => { if (e.key === 'Enter') submit(); };
      return;
    }
    let d;
    try { d = await api('/api/admin/overview', { admin: true }); if (rid !== renderSeq) return; }
    catch (e) { v.innerHTML = `<section class="card form-card"><h1>Admin</h1><p class="error">${esc(e.message)}</p><a class="btn" href="#/${ADMIN_ROUTE}">Sign in again</a></section>`; return; }
    let tab = 'users', q = '';
    const when = (t) => (t ? new Date(t).toLocaleString() : '-');
    const body = () => {
      const f = q.toLowerCase(); const has = (...a) => !f || a.some((x) => String(x).toLowerCase().includes(f));
      if (tab === 'users') {
        const rows = d.users.filter((u) => has(u.username, u.displayName, u.id));
        return rows.length ? `<table><thead><tr><th>Username</th><th>Display name</th><th>Joined</th><th>Language</th><th>Theme</th><th>Threshold</th><th>Link</th><th>Sessions</th><th>Last session</th></tr></thead><tbody>${rows.map((u) => `<tr><td><strong>${esc(u.username)}</strong></td><td>${esc(u.displayName || '-')}</td><td>${when(u.createdAt)}</td><td>${esc(u.preferences.targetLang)}</td><td>${esc(u.preferences.theme)}</td><td>${Math.round(u.preferences.confidenceThreshold * 100)}%</td><td>${esc(u.preferences.connection)}</td><td>${u.sessionCount}</td><td>${when(u.lastSessionAt)}</td></tr>`).join('')}</tbody></table>` : '<p class="empty">No users match.</p>';
      }
      if (tab === 'sessions') {
        const rows = d.sessions.filter((r) => has(r.username, r.glosses.join(' '), r.translatedText, r.languagePair));
        if (!rows.length && f && d.sessions.length) return '<p class="empty">No sessions match.</p>';
        return rows.length ? `<table><thead><tr><th>When</th><th>User</th><th>Signs</th><th>Translation</th><th>Languages</th><th>Confidence</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${when(r.createdAt)}</td><td>${esc(r.username)}</td><td>${esc(r.glosses.join(' '))}</td><td>${esc(r.translatedText)}</td><td>${esc(r.languagePair)}</td><td>${Math.round(r.confidence * 100)}%</td></tr>`).join('')}</tbody></table>` : '<p class="empty">No saved sessions yet. Users save them from the Live translation screen.</p>';
      }
      const m = d.model;
      return m ? `<table><tbody><tr><th>Trained</th><td>${when(m.trainedAt)}</td></tr><tr><th>Data source</th><td>${esc(m.dataSource)}</td></tr><tr><th>Signs</th><td>${esc(m.labels.join(', '))}</td></tr><tr><th>Train / validation accuracy</th><td>${(m.trainAccuracy * 100).toFixed(1)}% / ${(m.valAccuracy * 100).toFixed(1)}%</td></tr><tr><th>Settings</th><td>${esc(JSON.stringify(m.config))}</td></tr><tr><th>Inferences since server start</th><td>${d.inferences}</td></tr><tr><th>Last latency</th><td>${d.lastLatencyMs == null ? '-' : d.lastLatencyMs + ' ms'}</td></tr></tbody></table>` : '<p class="empty">No trained model.</p>';
    };
    v.innerHTML = `<div class="page-head"><div><h1>Admin console</h1><p class="muted">Read-only view of all stored data. Passwords are hashed and never shown.</p></div><div class="row"><button class="btn secondary" id="ad-refresh">Refresh</button><button class="btn secondary" id="ad-out">Sign out of admin</button></div></div>
      <div class="grid cols-4"><div class="card stat"><div class="label">Users</div><div class="value">${d.counts.users}</div></div><div class="card stat"><div class="label">Saved sessions</div><div class="value">${d.counts.sessions}</div></div><div class="card stat"><div class="label">Recognitions this run</div><div class="value">${d.inferences}</div></div><div class="card stat"><div class="label">Model accuracy</div><div class="value">${d.model ? (d.model.valAccuracy * 100).toFixed(1) + '%' : '-'}</div></div></div>
      <section class="card" style="margin-top:1.1rem"><div class="row" style="margin-bottom:.9rem"><button class="btn" data-tab="users">Users</button><button class="btn secondary" data-tab="sessions">Session logs</button><button class="btn secondary" data-tab="model">Model</button><div class="grow"><label class="sr" for="ad-q" style="position:absolute;left:-999px">Search</label><input id="ad-q" placeholder="Search"></div><button class="btn secondary" id="ad-csv">Export CSV</button></div><div class="table-wrap" id="ad-body"></div></section>`;
    const paint = () => { $('#ad-body').innerHTML = body(); $$('[data-tab]').forEach((b) => { b.className = 'btn' + (b.dataset.tab === tab ? '' : ' secondary'); }); $('#ad-csv').style.display = tab === 'model' ? 'none' : ''; };
    $$('[data-tab]').forEach((b) => { b.onclick = () => { tab = b.dataset.tab; paint(); }; });
    $('#ad-q').oninput = (e) => { q = e.target.value; paint(); };
    $('#ad-refresh').onclick = () => renderAdmin(v);
    $('#ad-out').onclick = () => { state.adminToken = null; sessionStore('ss_admin', null); renderAdmin(v); };
    $('#ad-csv').onclick = async () => { try { const csv = await api('/api/admin/export?table=' + tab, { admin: true }); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = tab === 'users' ? 'signsync-users.csv' : 'signsync-session-logs.csv'; a.click(); URL.revokeObjectURL(a.href); } catch (e) { toast(e.message, true); } };
    paint();
  }

  // ---------- Boot ----------
  (async function boot() {
    applyPrefs(state.prefs, false);
    await restoreSession();
    if (!location.hash) location.hash = '#/dashboard'; else render();
  })();
})();
