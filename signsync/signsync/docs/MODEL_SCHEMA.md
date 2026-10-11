# Model input/output schema

## Model
Bidirectional LSTM (forward + backward, hidden size `H`), mean pooling over time, dense softmax head.
Stored as `model/model.json` (`schemaVersion: 1`, `architecture: "bilstm-mean-pool-softmax"`) with `labels`, `inputSpec`, `norm` (per-feature mean/std), `params`, `config`, and `metrics`.

## Input: one sign = a sequence of frames
Each frame is 21 hand landmarks in MediaPipe-style order (0 wrist; 1-4 thumb; 5-8 index; 9-12 middle; 13-16 ring; 17-20 pinky), each `[x, y, z]`, with x/y in camera-normalized 0..1 coordinates.
Alternatively `{ "landmarks": [...21 points...] }`.

Preprocessing (`lib/landmarks.js`), per frame -> 66 features:
* 63 values: each landmark minus the wrist, divided by the wrist-to-middle-knuckle distance (position and scale invariant).
* 3 values: raw wrist `x, y, z` (keeps where the hand moves).

Frames with a missing/invalid hand are dropped; at least 2 valid frames are required. The valid frames are linearly resampled to `inputSpec.seqLen` (default 12), then standardized with `norm`. Limit: 120 frames per request.

## `POST /api/infer`
Request:
```json
{ "frames": [ [[0.5,0.5,0.0], "... 21 points ..."], "... 2-120 frames ..." ],
  "lang": "en | hi | mr", "threshold": 0.6 }
```
Response:
```json
{ "gloss": "WATER", "confidence": 0.9989, "accepted": true, "threshold": 0.6,
  "topK": [ { "gloss": "WATER", "confidence": 0.9989 } ],
  "lang": "hi", "text": "पानी", "tts": { "text": "पानी", "lang": "hi-IN" },
  "handDetectionRatio": 1, "framesReceived": 26, "framesUsed": 26, "latencyMs": 11.7 }
```
`accepted` is `confidence >= threshold`. Errors: 400 malformed input, 422 no usable hand, 503 no model.

## Output classes (glosses)
`HELLO, THANK_YOU, YES, NO, HELP, WATER, FOOD, PLEASE` (from `GET /api/model` -> `model.labels`). Translations live in `lib/translate.js`.

## Training dataset format (`--data file.json`)
```json
{ "format": "signsync-landmarks-v1",
  "samples": [ { "label": "HELLO", "frames": [ [[x,y,z] x 21], "..." ] } ] }
```
A bare array of samples also works. New labels are picked up automatically; add their translations to `lib/translate.js` (unknown glosses fall back to the lowercased gloss text).

## `POST /api/train` (authenticated)
Body (all optional): `epochs` 1-60, `hidden` 4-32, `samplesPerClass` 10-80, `learningRate` 0.0001-0.1, `seed`. Trains on synthetic data and returns model metadata and metrics.

## Storage schema (generic relational, per DESIGN.md)
* **users**: id, username, passwordHash (PBKDF2-SHA256, 100k iterations), salt, createdAt, profile
* **preferences**: userId, targetLang, theme, confidenceThreshold, voice, connection, autoSpeak
* **session_logs**: id, userId, createdAt, glosses (input), translatedText, languagePair, confidence

Exports (`GET /api/sessions/export`): `id,createdAt,inputGlosses,translatedText,languagePair,confidence`.
