'use strict';
// Training CLI.  node scripts/train.js [--data file] [--epochs N] [--hidden N] [--samples N] [--lr X] [--seed N] [--out file]
const fs = require('fs');
const path = require('path');
const { train } = require('../lib/train');
const args = process.argv.slice(2);
const get = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };

let dataset = null, dataSource = 'synthetic';
if (get('data')) {
  const raw = JSON.parse(fs.readFileSync(get('data'), 'utf8'));
  dataset = Array.isArray(raw) ? raw : raw.samples;
  dataSource = path.basename(get('data'));
  if (!Array.isArray(dataset)) { console.error('Dataset must be an array or { samples: [...] }'); process.exit(1); }
}
const opts = { epochs: parseInt(get('epochs', '25'), 10), hidden: parseInt(get('hidden', '16'), 10), samplesPerClass: parseInt(get('samples', '40'), 10), learningRate: parseFloat(get('lr', '0.01')), seed: parseInt(get('seed', '42'), 10), dataSource };
console.log('Training BiLSTM sign classifier', opts, dataset ? `on ${dataset.length} samples from ${dataSource}` : '(synthetic data)');
const model = train(opts, dataset, (e) => console.log(`epoch ${String(e.epoch).padStart(2)}  loss ${e.loss.toFixed(4)}  train ${(e.trainAcc * 100).toFixed(1)}%  val ${(e.valAcc * 100).toFixed(1)}%`));
const out = path.resolve(__dirname, '..', get('out', 'model/model.json'));
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(model));
console.log(`\nSaved ${out}  (val accuracy ${(model.metrics.valAccuracy * 100).toFixed(1)}%, ${model.metrics.durationMs} ms)`);
