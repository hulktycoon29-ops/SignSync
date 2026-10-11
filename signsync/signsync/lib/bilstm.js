'use strict';
// Sign-Recognition model: a bidirectional LSTM sequence classifier in plain JavaScript
// (forward pass, backpropagation through time, Adam). No ML framework needed, so the same
// code trains locally and runs for inference inside a serverless function.
//
//   input  : T x D feature sequence  (see lib/landmarks.js)
//   encoder: LSTM(forward) + LSTM(backward), hidden size H each
//   pooling: mean over time of concat(h_fwd, h_bwd)  -> 2H
//   head   : dense (2H -> C) + softmax over gloss classes
const { gaussian } = require('./util');

const sigmoid = (x) => 1 / (1 + Math.exp(-x));
const zeros = (n) => new Float64Array(n);

function randArr(n, scale, rng) { const a = zeros(n); for (let i = 0; i < n; i++) a[i] = gaussian(rng) * scale; return a; }

function initParams(D, H, C, rng) {
  const p = {};
  for (const d of ['f', 'b']) {
    p[d + 'Wx'] = randArr(4 * H * D, Math.sqrt(1 / D), rng);
    p[d + 'Wh'] = randArr(4 * H * H, Math.sqrt(1 / H), rng);
    const b = zeros(4 * H);
    for (let i = H; i < 2 * H; i++) b[i] = 1; // forget-gate bias
    p[d + 'b'] = b;
  }
  p.Wo = randArr(C * 2 * H, Math.sqrt(1 / (2 * H)), rng);
  p.bo = zeros(C);
  return p;
}

function zeroGrads(p) { const g = {}; for (const k of Object.keys(p)) g[k] = zeros(p[k].length); return g; }

function lstmForward(Wx, Wh, b, xs, H, reverse) {
  const T = xs.length, D = xs[0].length;
  const hs = new Array(T), steps = new Array(T);
  let h = zeros(H), c = zeros(H);
  for (let s = 0; s < T; s++) {
    const t = reverse ? T - 1 - s : s, x = xs[t];
    const i = zeros(H), f = zeros(H), g = zeros(H), o = zeros(H), cn = zeros(H), tc = zeros(H), hn = zeros(H);
    for (let u = 0; u < H; u++) {
      let a0 = b[u], a1 = b[H + u], a2 = b[2 * H + u], a3 = b[3 * H + u];
      const r0 = u * D, r1 = (H + u) * D, r2 = (2 * H + u) * D, r3 = (3 * H + u) * D;
      for (let k = 0; k < D; k++) { const xv = x[k]; a0 += Wx[r0 + k] * xv; a1 += Wx[r1 + k] * xv; a2 += Wx[r2 + k] * xv; a3 += Wx[r3 + k] * xv; }
      const q0 = u * H, q1 = (H + u) * H, q2 = (2 * H + u) * H, q3 = (3 * H + u) * H;
      for (let k = 0; k < H; k++) { const hv = h[k]; a0 += Wh[q0 + k] * hv; a1 += Wh[q1 + k] * hv; a2 += Wh[q2 + k] * hv; a3 += Wh[q3 + k] * hv; }
      i[u] = sigmoid(a0); f[u] = sigmoid(a1); g[u] = Math.tanh(a2); o[u] = sigmoid(a3);
      cn[u] = f[u] * c[u] + i[u] * g[u]; tc[u] = Math.tanh(cn[u]); hn[u] = o[u] * tc[u];
    }
    steps[s] = { x, hPrev: h, cPrev: c, i, f, g, o, tc, t };
    h = hn; c = cn; hs[t] = hn;
  }
  return { hs, steps };
}

function lstmBackward(Wh, steps, dHs, H, D, gWx, gWh, gb) {
  let dhNext = zeros(H), dcNext = zeros(H);
  for (let s = steps.length - 1; s >= 0; s--) {
    const st = steps[s];
    const da = zeros(4 * H);
    for (let u = 0; u < H; u++) {
      const dh = dHs[st.t][u] + dhNext[u];
      const dc = dcNext[u] + dh * st.o[u] * (1 - st.tc[u] * st.tc[u]);
      da[u] = dc * st.g[u] * st.i[u] * (1 - st.i[u]);
      da[H + u] = dc * st.cPrev[u] * st.f[u] * (1 - st.f[u]);
      da[2 * H + u] = dc * st.i[u] * (1 - st.g[u] * st.g[u]);
      da[3 * H + u] = dh * st.tc[u] * st.o[u] * (1 - st.o[u]);
      dcNext[u] = dc * st.f[u];
    }
    dhNext = zeros(H);
    for (let r = 0; r < 4 * H; r++) {
      const v = da[r];
      if (v === 0) continue;
      gb[r] += v;
      const rx = r * D, rh = r * H;
      for (let k = 0; k < D; k++) gWx[rx + k] += v * st.x[k];
      for (let k = 0; k < H; k++) { gWh[rh + k] += v * st.hPrev[k]; dhNext[k] += v * Wh[rh + k]; }
    }
  }
}

function softmax(z) {
  let m = -Infinity; for (const v of z) if (v > m) m = v;
  const e = new Float64Array(z.length); let s = 0;
  for (let i = 0; i < z.length; i++) { e[i] = Math.exp(z[i] - m); s += e[i]; }
  for (let i = 0; i < e.length; i++) e[i] /= s;
  return e;
}

function forward(p, xs, H, C) {
  const F = lstmForward(p.fWx, p.fWh, p.fb, xs, H, false);
  const B = lstmForward(p.bWx, p.bWh, p.bb, xs, H, true);
  const T = xs.length, pooled = zeros(2 * H);
  for (let t = 0; t < T; t++) for (let u = 0; u < H; u++) { pooled[u] += F.hs[t][u] / T; pooled[H + u] += B.hs[t][u] / T; }
  const logits = zeros(C);
  for (let c = 0; c < C; c++) { let a = p.bo[c]; for (let k = 0; k < 2 * H; k++) a += p.Wo[c * 2 * H + k] * pooled[k]; logits[c] = a; }
  return { F, B, pooled, probs: softmax(logits) };
}

// Accumulates gradients into `grads`; returns the cross-entropy loss for one sample.
function lossAndGrad(p, xs, label, H, C, grads) {
  const D = xs[0].length, T = xs.length;
  const r = forward(p, xs, H, C);
  const loss = -Math.log(Math.max(r.probs[label], 1e-12));
  const dl = Float64Array.from(r.probs); dl[label] -= 1;
  const dp = zeros(2 * H);
  for (let c = 0; c < C; c++) {
    grads.bo[c] += dl[c];
    for (let k = 0; k < 2 * H; k++) { grads.Wo[c * 2 * H + k] += dl[c] * r.pooled[k]; dp[k] += dl[c] * p.Wo[c * 2 * H + k]; }
  }
  const dHf = new Array(T), dHb = new Array(T);
  for (let t = 0; t < T; t++) { dHf[t] = zeros(H); dHb[t] = zeros(H); for (let u = 0; u < H; u++) { dHf[t][u] = dp[u] / T; dHb[t][u] = dp[H + u] / T; } }
  lstmBackward(p.fWh, r.F.steps, dHf, H, D, grads.fWx, grads.fWh, grads.fb);
  lstmBackward(p.bWh, r.B.steps, dHb, H, D, grads.bWx, grads.bWh, grads.bb);
  return loss;
}

class Adam {
  constructor(params, lr) {
    this.lr = lr; this.t = 0; this.m = zeroGrads(params); this.v = zeroGrads(params);
  }
  step(params, grads, scale, clip = 5) {
    let norm = 0;
    for (const k of Object.keys(grads)) for (let i = 0; i < grads[k].length; i++) { grads[k][i] *= scale; norm += grads[k][i] ** 2; }
    norm = Math.sqrt(norm);
    const cs = norm > clip ? clip / norm : 1;
    this.t++;
    const b1 = 0.9, b2 = 0.999, eps = 1e-8;
    const c1 = 1 - b1 ** this.t, c2 = 1 - b2 ** this.t;
    for (const k of Object.keys(params)) {
      const P = params[k], G = grads[k], M = this.m[k], V = this.v[k];
      for (let i = 0; i < P.length; i++) {
        const g = G[i] * cs;
        M[i] = b1 * M[i] + (1 - b1) * g; V[i] = b2 * V[i] + (1 - b2) * g * g;
        P[i] -= (this.lr * (M[i] / c1)) / (Math.sqrt(V[i] / c2) + eps);
      }
    }
  }
}

// ---- Runtime wrapper for serialized models ----
function toRuntime(json) {
  const params = {};
  for (const k of Object.keys(json.params)) params[k] = Float64Array.from(json.params[k]);
  return { ...json, params, mean: Float64Array.from(json.norm.mean), std: Float64Array.from(json.norm.std) };
}

function normalize(rt, sequence) {
  return sequence.map((v) => { const o = zeros(v.length); for (let k = 0; k < v.length; k++) o[k] = (v[k] - rt.mean[k]) / rt.std[k]; return o; });
}

function predict(rt, sequence) {
  const xs = normalize(rt, sequence);
  return forward(rt.params, xs, rt.config.hidden, rt.labels.length).probs;
}

module.exports = { initParams, zeroGrads, lossAndGrad, forward, Adam, toRuntime, normalize, predict };
