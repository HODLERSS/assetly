# Assetly — run it, ship it

## Production (LIVE)
- App: **https://hodlerss.github.io/assetly/** (GitHub Pages, repo HODLERSS/assetly, branch gh-pages)
- Supabase: project `assetly` in org Thunder Route, ref `hhdpthrfmsdmxdrfckxq` — schema, RLS, grants,
  edge functions `price-sync` + `news-sync` + `symbol-search` (universal US+KR ticker search
  and on-demand register: live price + ~3mo daily history at add time), pg_cron (1-min prices / 15-min news via vault
  `project_url` + `edge_bearer` = publishable key), auth URL config. Deploy new code:
  `cd web && VITE_BASE=/assetly/ npm run build` → copy `dist/` to the gh-pages branch (see git log).
- Morning items: `MORNING.md`. Verify anytime: `bash scripts/verify-oauth.sh`.
- Cloud tests: `ASSETLY_CLOUD=1 npx vitest run src/test/cloud.test.ts` · iPhone e2e:
  `node e2e/iphone.mjs` (`PW_ENGINE=webkit` for the Safari engine) · 10-stock scenario e2e:
  `node e2e/scenario.mjs` (add/edit/remove/charts) → screenshots in `e2e-shots/`.


## Run everything locally (works today, no accounts needed)
```bash
cd stockAnalysis/app
npx supabase start                                   # local Postgres + Auth + API (Docker)
(export $(grep -v '^#' supabase/.env.local | xargs) && npx supabase functions serve --no-verify-jwt) &
cd web && npm install && npm run dev                 # app at http://127.0.0.1:5173
npx vitest run                                       # full battery: 23 tests vs the real stack
```
Manual pipeline laps: `curl -X POST http://127.0.0.1:54321/functions/v1/price-sync` (and `news-sync`).

## Production (the ~30 minutes only you can do — account actions I can't perform for you)
1. **Supabase project** — `npx supabase login`, then `npx supabase projects create assetly`,
   `npx supabase link --project-ref <ref>`, `npx supabase db push`,
   `npx supabase functions deploy price-sync news-sync`.
2. **Enable the cron** — in SQL editor:
   `select vault.create_secret('https://<ref>.supabase.co','project_url');`
   `select vault.create_secret('<service_role_key>','service_key');`
   The migrated jobs (`assetly-price-sync` every minute, `assetly-news-sync` every 15) go live the
   moment those two secrets exist. Verify: `select * from cron.job;` then watch `prices.updated_at`.
3. **GitHub OAuth app** — github.com → Settings → Developer settings → OAuth Apps → New.
   Callback URL: `https://<ref>.supabase.co/auth/v1/callback`. Put ID/secret in
   Supabase Dashboard → Auth → Providers → GitHub.
4. **Google OAuth client** — console.cloud.google.com → Credentials → OAuth client (Web).
   Authorized redirect URI: `https://<ref>.supabase.co/auth/v1/callback`. Same dashboard, Google provider.
   Add your app's domain to Authorized JavaScript origins.
5. **Host the web app** — `cd web && VITE_SUPABASE_URL=https://<ref>.supabase.co \
   VITE_SUPABASE_ANON_KEY=<anon> npm run build`, deploy `web/dist` (Vercel works like the
   valuation workbench). Add the deployed URL to Supabase Auth → URL Configuration →
   Site URL + redirect list.
6. **iPhone** — immediately: open the deployed URL in Safari → Share → Add to Home Screen
   (standalone PWA, safe-areas handled). App Store path: `npm i @capacitor/core @capacitor/ios`,
   `npx cap init assetly com.assetly.app --web-dir=dist`, `npx cap add ios`, open in Xcode, ship.
   OAuth redirect for the wrapped app uses `assetly://auth-callback` (already whitelisted in config).

## Where things live
- `supabase/migrations/` — schema, RLS, grants, cron (idempotent; `db reset` replays clean)
- `supabase/functions/price-sync|news-sync|symbol-search` — the cloud pipelines (fixture modes for tests);
  price-sync tracks held + recently-added symbols, news-sync tracks held only, symbol-search
  proxies Yahoo search (any US listing incl. OTC, KRX .KS/.KQ, major crypto; Hangul aliases)
- `web/src/lib/api.ts` — the entire data layer; screens never touch the client directly
- `web/src/test/` — integration battery (real stack) + UI battery (stubbed)
- `design/` — the synced canvas + the gap screens pushed back to Claude Design
- `QUALITY.md` — the 30-metric gate and iteration log
