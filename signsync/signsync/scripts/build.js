'use strict';
// Build step for static hosts: ensure a trained model exists (trains one if missing).
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const model = path.join(__dirname, '..', 'model', 'model.json');
if (fs.existsSync(model)) console.log('model/model.json found - skipping training.');
else { console.log('No model found - training one now.'); const r = spawnSync(process.execPath, [path.join(__dirname, 'train.js')], { stdio: 'inherit' }); process.exit(r.status || 0); }
console.log('Static assets are served directly from public/. Build complete.');
