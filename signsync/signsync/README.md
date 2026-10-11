# SignSync

Indian Sign Language (ISL) recognition, translation and speech, built from `ARCHITECTURE.MD` and `DESIGN.md`.
It is a static web UI plus serverless-style API functions, with a trainable bidirectional LSTM sign classifier.
No runtime dependencies: Node.js 20+ is the only requirement.

> **Read this first**
> * `product_requirement_document.md` describes a different project (Campus Truth, a Java/JavaFX app) and was **not used**.
> * No sign dataset was supplied. The model trains on **synthetic hand-landmark sequences** (`lib/synthetic.js`) so the pipeline runs end to end. Accuracy numbers describe that synthetic data, not real ISL. Bring real data with `--data` (see `docs/MODEL_SCHEMA.md`).
> * Hand tracking from a camera is **not bundled**. The Live screen shows the camera preview and drives the model with a built-in sign simulator that emits landmark frames. Any tracker that outputs 21 `[x, y, z]` points per frame can call `POST /api/infer`.

## Pipeline (ARCHITECTURE.MD)

| Stage | Module | Endpoint |
|---|---|---|
| Video frame ingestion | `lib/landmarks.js` (validation, limits) | `POST /api/infer` |
| Landmark extraction | `lib/landmarks.js` (normalize, resample) | (inside infer) |
| Sign recognition | `lib/bilstm.js`, `lib/train.js` | `POST /api/infer`, `POST /api/train`, `GET /api/model` |
| Translation (English, Hindi, Marathi) | `lib/translate.js` | `POST /api/translate` |
| Text-to-speech | Server returns text + language tag; the browser's Web Speech API plays it | `POST /api/tts` |
| User data persistence | `lib/store.js` (Users, Preferences, Session Logs, CSV export) | `/api/auth/*`, `/api/preferences`, `/api/sessions`, `/api/sessions/export` |

Admin endpoints: `POST /api/admin/login`, `GET /api/admin/overview`, `GET /api/admin/export?table=users|sessions`. Other endpoints: `GET /api/health`, `POST /api/simulate` (demo landmark generator).

## Commands

```bash
npm run train                  # train on synthetic data, writes model/model.json (about 10 s)
npm run train -- --epochs 40 --hidden 24 --samples 60 --lr 0.01 --seed 1
npm run dataset                # write data/dataset.json (synthetic, in the documented import format)
npm run train:dataset          # train from data/dataset.json (replace it with your own data)
npm start                      # http://localhost:3000  (static UI + API)
npm test                       # end-to-end API checks (auth, inference, translation, CSV, training)
npm run build                  # used by hosts: trains only if model/model.json is missing
```

Local setup: `cp .env.example .env`, set `SESSION_SECRET`, `ADMIN_USERNAME` and `ADMIN_PASSWORD`, then `npm start`. A trained model (`model/model.json`) is already included, so the app works immediately.

## Using the site

1. Open `http://localhost:3000`, create an account (or continue as guest).
2. **Dashboard**: status cards, recent sessions, and a **Train model** panel that calls `POST /api/train` and plots the learning curve.
3. **Live translation**: choose or randomize a sign, watch the landmark stream, see the recognized sign, confidence, top 3 candidates and latency. Accepted signs build a sentence in your chosen language, which you can speak or save.
4. **Admin** (open `http://localhost:3000/#/admin` by typing it; **no link to it appears anywhere on the site**, so users never see it. To make the address private, change `ADMIN_ROUTE` at the top of `public/js/app.js`, e.g. to `'panel-7391'`): sign in with the admin username and password to see every user, their preferences, all saved sessions, and model details; search, and export CSV. Read-only. Credentials come from `ADMIN_USERNAME` and `ADMIN_PASSWORD` in `.env` (or the host's environment variables). With those unset, the console is disabled. Password hashes are never shown, and 5 wrong attempts lock out an IP for a minute.
5. **Settings**: language, confidence threshold, voice, theme, glasses connection profile (Bluetooth LE or Wi-Fi, stored only), CSV export.

## Project layout

```
public/            static UI (index.html, css/styles.css, js/app.js)
api/[...path].js   Vercel adapter  -> lib/router.js
functions/api/     Cloudflare Pages adapter -> lib/router.js
lib/               router, auth, store, landmarks, bilstm, train, translate, synthetic
scripts/           train.js, make-dataset.js, build.js, smoke-test.js
model/model.json   trained model (bundled)
server.js          local server with file persistence in .data/
docs/              MODEL_SCHEMA.md, DEPLOYMENT.md
```

## Known limits

* **Storage on serverless hosts is per-instance and temporary.** Accounts and session logs live in memory on Vercel/Cloudflare, so they can disappear between invocations. Local `npm start` persists them to `.data/store.json`. A durable relational database (the architecture leaves the engine open) needs a new adapter behind `lib/store.js`; none was added because the documents name no engine.
* **Training from the deployed site** (`POST /api/train`) runs inside a function and is not saved. Train locally and redeploy for a permanent model. Free Cloudflare Workers CPU limits will stop training; use `npm run train` instead.
* **No WebSocket stream.** ARCHITECTURE/DESIGN mention one; serverless hosts cannot hold it open, so inference is request/response over REST.
* **TTS** produces text plus a language tag; audio is generated by the browser, so available voices depend on the user's device.
* **Translation** is word-level (gloss to word). It does not reorder grammar.
* The Cloudflare adapter follows the documented Pages Functions format but was not run on Cloudflare. The Vercel adapter and local server were not run on Vercel either; local server, API tests and the browser UI were.
