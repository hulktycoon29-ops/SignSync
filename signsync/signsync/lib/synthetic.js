'use strict';
// Synthetic ISL-style landmark generator.
// NO real ISL dataset was supplied with the project documents, so this module produces
// parametric hand-landmark sequences (21 points/frame) so the whole pipeline can be
// trained and tested end to end. Replace with real data via `npm run train -- --data <file>`.
const { mulberry32, gaussian } = require('./util');

const SIGNS = {
  //            finger curls: thumb, index, middle, ring, pinky   | wrist motion
  HELLO:     { curls: [0.0, 0.0, 0.0, 0.0, 0.0], motion: 'wave' },
  THANK_YOU: { curls: [0.0, 0.0, 0.0, 0.0, 0.0], motion: 'down' },
  YES:       { curls: [1.0, 1.3, 1.3, 1.3, 1.3], motion: 'nod' },
  NO:        { curls: [1.0, 0.0, 0.0, 1.3, 1.3], motion: 'snap' },
  HELP:      { curls: [0.0, 1.3, 1.3, 1.3, 1.3], motion: 'up' },
  WATER:     { curls: [1.0, 0.0, 0.0, 0.0, 1.3], motion: 'tap' },
  FOOD:      { curls: [0.8, 0.9, 0.9, 0.9, 0.9], motion: 'circle' },
  PLEASE:    { curls: [0.0, 0.0, 0.0, 0.0, 0.0], motion: 'circle' },
};
const LABELS = Object.keys(SIGNS);

const BASES = [[-0.45, 0.25], [-0.3, 1.0], [0, 1.05], [0.3, 1.0], [0.55, 0.9]];

function handPose(curls, rollRad) {
  const pts = [[0, 0, 0]];
  for (let f = 0; f < 5; f++) {
    let [bx, by] = BASES[f];
    let x = bx, y = by, z = 0, ang = 0;
    const seg = f === 0 ? 0.3 : 0.33;
    const dirx = f === 0 ? -0.5 : 0;
    const diry = 1;
    pts.push([x, y, z]);
    for (let j = 0; j < 3; j++) {
      ang += (curls[f] * 0.8) / (j + 1);
      const dy = Math.cos(ang) * diry, dz = -Math.sin(ang);
      x += dirx * seg * 0.4; y += dy * seg; z += dz * seg;
      pts.push([x, y, z]);
    }
  }
  const c = Math.cos(rollRad), s = Math.sin(rollRad);
  return pts.map(([x, y, z]) => [x * c - y * s, x * s + y * c, z]);
}

function motionOffset(kind, u) {
  const tau = 2 * Math.PI;
  switch (kind) {
    case 'wave': return [Math.sin(tau * 2 * u) * 0.16, 0];
    case 'down': return [0, -0.12 + 0.3 * u];
    case 'nod': return [0, Math.sin(tau * 2 * u) * 0.1];
    case 'snap': return [Math.sin(tau * 3 * u) * 0.06, 0];
    case 'up': return [0, 0.15 - 0.3 * u];
    case 'tap': return [0, Math.abs(Math.sin(tau * 1.5 * u)) * 0.12];
    case 'circle': return [Math.cos(tau * u) * 0.1, Math.sin(tau * u) * 0.1];
    default: return [0, 0];
  }
}

function generateSign(label, rng, opts = {}) {
  const spec = SIGNS[label];
  if (!spec) throw new Error('Unknown sign: ' + label);
  const n = opts.frames || 18 + Math.floor(rng() * 12);
  const noise = opts.noise === undefined ? 0.02 : opts.noise;
  const curls = spec.curls.map((c) => Math.max(0, c + gaussian(rng) * 0.12));
  const scale = 0.18 * (1 + gaussian(rng) * 0.1);
  const roll = gaussian(rng) * 0.12;
  const phase = rng() * 0.15;
  const cx = 0.5 + gaussian(rng) * 0.04, cy = 0.5 + gaussian(rng) * 0.04;
  const frames = [];
  for (let t = 0; t < n; t++) {
    const u = Math.min(1, t / (n - 1) + phase * 0);
    const [dx, dy] = motionOffset(spec.motion, Math.min(1, u + phase * 0.3));
    const pose = handPose(curls, roll);
    frames.push(pose.map(([x, y, z]) => [
      cx + dx + x * scale + gaussian(rng) * noise * scale,
      cy + dy - y * scale + gaussian(rng) * noise * scale,
      z * scale + gaussian(rng) * noise * scale,
    ]));
  }
  return frames;
}

function makeDataset(samplesPerClass, seed) {
  const rng = mulberry32(seed);
  const data = [];
  for (const label of LABELS) for (let i = 0; i < samplesPerClass; i++) data.push({ label, frames: generateSign(label, rng) });
  return data;
}

module.exports = { SIGNS, LABELS, generateSign, makeDataset };
