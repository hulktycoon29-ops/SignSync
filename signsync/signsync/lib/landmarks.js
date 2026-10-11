'use strict';
// Landmark Extraction Service: validates and normalizes raw hand landmarks.
// Input frame: 21 points [x, y, z] (MediaPipe-style hand layout, camera-normalized coordinates).
// Output feature vector (66 numbers): 63 wrist-relative, hand-size-normalized shape values
// + 3 raw wrist coordinates (preserves where the hand moves, which many signs depend on).
const { ApiError } = require('./util');

const NUM_LANDMARKS = 21;
const FEATURES = NUM_LANDMARKS * 3 + 3;
const MAX_FRAMES = 120;

function extractFrame(frame) {
  const lm = Array.isArray(frame) ? frame : frame && frame.landmarks;
  if (!Array.isArray(lm) || lm.length !== NUM_LANDMARKS) return null;
  for (const p of lm) {
    if (!Array.isArray(p) || p.length < 3) return null;
    for (let k = 0; k < 3; k++) if (!Number.isFinite(p[k])) return null;
  }
  const w = lm[0], m = lm[9];
  const scale = Math.hypot(m[0] - w[0], m[1] - w[1], m[2] - w[2]);
  if (scale < 1e-6) return null;
  const out = new Float64Array(FEATURES);
  for (let i = 0; i < NUM_LANDMARKS; i++) for (let k = 0; k < 3; k++) out[i * 3 + k] = (lm[i][k] - w[k]) / scale;
  out[63] = w[0]; out[64] = w[1]; out[65] = w[2];
  return out;
}

function resample(seq, T) {
  const n = seq.length;
  const out = [];
  for (let i = 0; i < T; i++) {
    const pos = T === 1 ? 0 : (i * (n - 1)) / (T - 1);
    const lo = Math.floor(pos), hi = Math.min(n - 1, lo + 1), a = pos - lo;
    const v = new Float64Array(FEATURES);
    for (let k = 0; k < FEATURES; k++) v[k] = seq[lo][k] * (1 - a) + seq[hi][k] * a;
    out.push(v);
  }
  return out;
}

function extractSequence(frames, T) {
  if (!Array.isArray(frames)) throw new ApiError(400, 'frames must be an array');
  if (frames.length < 2) throw new ApiError(400, 'At least 2 frames are required');
  if (frames.length > MAX_FRAMES) throw new ApiError(400, `At most ${MAX_FRAMES} frames per request`);
  const feats = frames.map(extractFrame);
  const valid = feats.filter(Boolean);
  const handDetectionRatio = valid.length / frames.length;
  if (valid.length < 2) throw new ApiError(422, 'No hand detected: fewer than 2 frames contained 21 valid landmarks');
  return { sequence: resample(valid, T), handDetectionRatio, framesReceived: frames.length, framesUsed: valid.length };
}

module.exports = { NUM_LANDMARKS, FEATURES, MAX_FRAMES, extractFrame, extractSequence, resample };
