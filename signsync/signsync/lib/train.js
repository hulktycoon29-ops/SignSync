'use strict';
// Training pipeline: dataset -> features -> BiLSTM training -> serialized model JSON.
const { mulberry32 } = require('./util');
const { extractFrame, extractSequence, FEATURES } = require('./landmarks');
const { initParams, zeroGrads, lossAndGrad, Adam, toRuntime, normalize, forward } = require('./bilstm');
const { makeDataset, LABELS: SYNTH_LABELS } = require('./synthetic');

const DEFAULTS = { epochs: 25, hidden: 16, samplesPerClass: 40, learningRate: 0.01, batchSize: 16, seqLen: 12, seed: 42, valSplit: 0.2 };

function shuffle(arr, rng) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; }

function prepare(dataset, labels, seqLen) {
  const out = [];
  for (const item of dataset) {
    const y = labels.indexOf(item.label);
    if (y < 0) continue;
    try { out.push({ x: extractSequence(item.frames, seqLen).sequence, y }); } catch (e) { /* skip unusable sample */ }
  }
  return out;
}

function accuracy(rt, samples) {
  if (!samples.length) return null;
  let ok = 0;
  for (const s of samples) {
    const p = forward(rt.params, s.x, rt.config.hidden, rt.labels.length).probs;
    let best = 0; for (let i = 1; i < p.length; i++) if (p[i] > p[best]) best = i;
    if (best === s.y) ok++;
  }
  return ok / samples.length;
}

function train(options = {}, dataset = null, onEpoch = null) {
  const cfg = { ...DEFAULTS, ...options };
  const started = Date.now();
  if (!dataset) dataset = makeDataset(cfg.samplesPerClass, cfg.seed);
  const labels = [...new Set(dataset.map((d) => d.label))].sort((a, b) => (SYNTH_LABELS.indexOf(a) - SYNTH_LABELS.indexOf(b)) || a.localeCompare(b));
  const samples = prepare(dataset, labels, cfg.seqLen);
  if (samples.length < labels.length * 2) throw new Error('Not enough valid samples to train');
  const rng = mulberry32(cfg.seed + 1);
  shuffle(samples, rng);
  const nVal = Math.max(labels.length, Math.floor(samples.length * cfg.valSplit));
  const val = samples.slice(0, nVal), tr = samples.slice(nVal);

  // Per-feature normalization stats from training frames only.
  const mean = new Float64Array(FEATURES), std = new Float64Array(FEATURES);
  let n = 0;
  for (const s of tr) for (const v of s.x) { n++; for (let k = 0; k < FEATURES; k++) mean[k] += v[k]; }
  for (let k = 0; k < FEATURES; k++) mean[k] /= n;
  for (const s of tr) for (const v of s.x) for (let k = 0; k < FEATURES; k++) std[k] += (v[k] - mean[k]) ** 2;
  for (let k = 0; k < FEATURES; k++) std[k] = Math.max(Math.sqrt(std[k] / n), 1e-3);

  const H = cfg.hidden, C = labels.length;
  const params = initParams(FEATURES, H, C, rng);
  const rt = { params, labels, config: { hidden: H }, mean, std };
  const trN = tr.map((s) => ({ x: normalize(rt, s.x), y: s.y }));
  const valN = val.map((s) => ({ x: normalize(rt, s.x), y: s.y }));
  const opt = new Adam(params, cfg.learningRate);
  const history = [];

  for (let epoch = 1; epoch <= cfg.epochs; epoch++) {
    shuffle(trN, rng);
    let total = 0;
    for (let i = 0; i < trN.length; i += cfg.batchSize) {
      const batch = trN.slice(i, i + cfg.batchSize);
      const grads = zeroGrads(params);
      for (const s of batch) total += lossAndGrad(params, s.x, s.y, H, C, grads);
      opt.step(params, grads, 1 / batch.length);
    }
    const rtN = { ...rt };
    const entry = { epoch, loss: total / trN.length, trainAcc: accuracy(rtN, trN), valAcc: accuracy(rtN, valN) };
    history.push(entry);
    if (onEpoch) onEpoch(entry);
  }

  const r5 = (a) => Array.from(a, (v) => Math.round(v * 1e5) / 1e5);
  const serialized = {};
  for (const k of Object.keys(params)) serialized[k] = r5(params[k]);
  const model = {
    schemaVersion: 1,
    architecture: 'bilstm-mean-pool-softmax',
    trainedAt: new Date().toISOString(),
    labels,
    inputSpec: { seqLen: cfg.seqLen, features: FEATURES, landmarksPerFrame: 21 },
    config: { hidden: H, epochs: cfg.epochs, learningRate: cfg.learningRate, batchSize: cfg.batchSize, seed: cfg.seed, samples: samples.length },
    norm: { mean: r5(mean), std: r5(std) },
    params: serialized,
    metrics: { trainAccuracy: history[history.length - 1].trainAcc, valAccuracy: history[history.length - 1].valAcc, finalLoss: history[history.length - 1].loss, trainSamples: tr.length, valSamples: val.length, durationMs: Date.now() - started, history },
    dataSource: options.dataSource || 'synthetic',
  };
  return model;
}

module.exports = { train, DEFAULTS, toRuntime };
