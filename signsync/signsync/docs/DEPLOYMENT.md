# Deployment guide (Cloudflare Pages or Vercel)

Nothing is deployed for you. Both options serve `public/` as static files and `/api/*` from the shared router in `lib/router.js`.

Before either option:
1. Unzip, run `npm test` locally (confirms the model and API work).
2. Generate a secret: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
3. Put the project in a Git repository (both hosts deploy from Git), or use the host's CLI/upload route.

Set the environment variable **`SESSION_SECRET`** on the host. To enable the admin console, also set **`ADMIN_USERNAME`** and **`ADMIN_PASSWORD`** (as secrets). The console shows only what the server holds in memory, which on these hosts is temporary (see below). Without it a built-in development secret is used (tokens are forgeable) and the health endpoint reports `secretConfigured: false`.

## Option A: Vercel
1. Push the project to a Git repo and choose **Add New > Project** in Vercel, importing it.
2. Leave framework as **Other**. `vercel.json` already sets: build command `npm run build`, output directory `public`, API function `api/[...path].js` with a 60 s limit, and bundles `lib/` and `model/`.
3. Add `SESSION_SECRET` under **Settings > Environment Variables** (Production and Preview).
4. Deploy. Check `https://<your-app>.vercel.app/api/health` returns `"status":"ok"` and `"modelLoaded":true`.

CLI alternative: `npx vercel` then `npx vercel --prod` (this uses Vercel's own tool, not part of the project).

## Option B: Cloudflare Pages
1. In the Cloudflare dashboard choose **Workers & Pages > Create > Pages > Connect to Git**.
2. Build settings: **Framework preset** None, **Build command** `npm run build`, **Build output directory** `public`. Pages automatically picks up the `functions/` folder at the project root (`functions/api/[[path]].js`).
3. Under **Settings > Variables and Secrets**, add `SESSION_SECRET` as a secret.
4. Deploy and open `https://<project>.pages.dev/api/health`.

Notes: functions are bundled together with `lib/` and `model/model.json`. The free plan's CPU time limit is too low for in-site training; train locally.

## After deploying: what to expect
* **Accounts and session logs are stored in memory on the function instance.** They can vanish on cold starts or differ between instances. Guest mode, recognition, translation and speech do not depend on storage.
* **Retraining**: run `npm run train` (optionally with `--data`), commit the new `model/model.json`, redeploy.
* **Changing the model changes the file size**: a larger `--hidden` grows `model.json`; keep it under the host's function bundle limits (a few MB is fine).
* Troubleshooting: 503 from `/api/infer` means `model/model.json` was not bundled; 401 on training/sessions means the session expired or `SESSION_SECRET` changed between deploys.
