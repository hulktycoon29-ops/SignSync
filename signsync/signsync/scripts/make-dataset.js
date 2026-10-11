'use strict';
// Writes a synthetic landmark dataset to data/dataset.json (see docs/MODEL_SCHEMA.md for the format).
const fs = require('fs');
const path = require('path');
const { makeDataset } = require('../lib/synthetic');
const args = process.argv.slice(2);
const get = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const data = makeDataset(parseInt(get('samples', '60'), 10), parseInt(get('seed', '7'), 10));
const out = path.resolve(__dirname, '..', get('out', 'data/dataset.json'));
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ format: 'signsync-landmarks-v1', samples: data.map((s) => ({ label: s.label, frames: s.frames.map((f) => f.map((p) => p.map((v) => Math.round(v * 1e4) / 1e4))) })) }));
console.log(`Wrote ${data.length} samples to ${out}`);
