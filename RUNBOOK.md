# Assetly — run it, ship it

## Production (LIVE)
- App: **https://hodlerss.github.io/assetly/** (GitHub Pages, repo HODLERSS/assetly, branch gh-pages)
- Supabase: project `assetly` in org Thunder Route, ref `hhdpthrfmsdmxdrfckxq` — schema, RLS, grants,
  edge functions `price-sync` + `news-sync` + `symbol-search` + `insights-sync` (hourly AI
  bullets via MARA Cloud M2.7, key in Vault) + `transcripts-sync` (daily earnings calls) (universal US+KR ticker search
  and on-demand register: live price + ~3mo daily history at add time), pg_cron (1-min prices / 15-min news via vault
  `project_url` + `edge_bearer` = publishable key), auth URL config. Deploy new code:
  `cd web && VITE_BASE=/assetly/ npm run build` → rsync **with `-c` (checksum)** `dist/` to the
  gh-pages worktree (hash-only index.html diffs are size-identical and rsync's quick check
  skips them), commit, push; force a build with `gh api -X POST repos/HODLERSS/assetly/pages/builds`.
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

## App Store (iOS) — set up 2026-09-13, first submission of 1.0

Identifiers: bundle `com.hodlerss.assetly` (ASC bundle-ID record MN5856Z4D7, capabilities Push + Sign in with Apple),
App Store Connect app **6811739789** "Assetly: Portfolio Brief" (SKU `assetly-ios`, en-US, Team `5RCPL9J3UX`),
API key `26G34JQ5XQ` (Admin) at `~/.private_keys/AuthKey_26G34JQ5XQ.p8`, issuer `03b49a0e-29cc-4d9d-94bc-a12aa1f92ec4`.
Demo account for App Review: credentials in `~/.private_keys/assetly-reviewer.txt` (never in git); the account has a
seeded US + Korea + crypto book, briefs, insights and narration scripts. Since build 202609150112 the email form is
**visible** on the sign-in screen — "Use a password instead" — and the old five-tap wordmark gesture is gone.
A throwaway account for the demo recording lives in `~/.private_keys/assetly-demo-throwaway.txt`; `node e2e/throwaway.mjs`
recreates and seeds it (if GoTrue leaves it unconfirmed the script prints the one SQL line to run in the dashboard).

Xcode: `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer` (xcode-select stays on the CLT; no sudo needed).

```bash
cd web
npm run build:ios                       # VITE_BASE=./ build + base guard + cap sync ios (never deploy.sh's dist)
node scripts/asc.mjs get "/v1/apps?filter[bundleId]=com.hodlerss.assetly"      # any ASC read/write: get|post|patch
# simulator smoke (SE 3rd gen 32A94BEE-…, iPhone 17 Pro 1813B4E4-…)
cd ios/App && xcodebuild -project App.xcodeproj -scheme App -configuration Debug -sdk iphonesimulator \
  -destination "id=32A94BEE-7A1B-4436-A279-0D081A955F38" -derivedDataPath /tmp/dd CODE_SIGNING_ALLOWED=NO build
xcrun simctl install 32A94BEE-7A1B-4436-A279-0D081A955F38 /tmp/dd/Build/Products/Debug-iphonesimulator/App.app
# release: archive -> export/upload (automatic signing through the API key), then poll
BUILD=$(date -u +%Y%m%d%H%M)
xcodebuild -project App.xcodeproj -scheme App -configuration Release -sdk iphoneos -destination "generic/platform=iOS" \
  -archivePath /tmp/Assetly.xcarchive archive -allowProvisioningUpdates \
  -authenticationKeyPath ~/.private_keys/AuthKey_26G34JQ5XQ.p8 -authenticationKeyID 26G34JQ5XQ \
  -authenticationKeyIssuerID 03b49a0e-29cc-4d9d-94bc-a12aa1f92ec4 DEVELOPMENT_TEAM=5RCPL9J3UX CURRENT_PROJECT_VERSION=$BUILD
xcodebuild -exportArchive -archivePath /tmp/Assetly.xcarchive -exportOptionsPlist ExportOptions.plist -exportPath /tmp/export \
  -allowProvisioningUpdates -authenticationKeyPath ~/.private_keys/AuthKey_26G34JQ5XQ.p8 -authenticationKeyID 26G34JQ5XQ \
  -authenticationKeyIssuerID 03b49a0e-29cc-4d9d-94bc-a12aa1f92ec4      # method app-store-connect, destination upload
node scripts/asc.mjs wait-build 6811739789 $BUILD                      # VALID in ~10 min
# attach: PATCH /v1/appStoreVersions/<versionId>/relationships/build {"data":{"type":"builds","id":"<buildId>"}}
node e2e/store-shots.mjs && node scripts/asc.mjs upload-screenshot <setId> e2e/store/01-home.png   # 1320x2868, set APP_IPHONE_67
node e2e/reviewer.mjs                    # 5-tap reviewer path on the live PWA; e2e/reviewer-brief.mjs <edition> forces a brief
```

Web-UI-only steps (no API): creating the app record, the DSA trader status (Business > Agreements; declared
non-trader), and App Privacy (5 data types: Name, Email, User ID, Other Financial Info, Other User Content; all App
Functionality, linked, no tracking; published). Supabase side: Apple provider enabled with client ID
`com.hodlerss.assetly` (native identity-token flow; no OAuth secret needed), `assetly://auth-callback` in the redirect
allow list, edge function `delete-account` (verify-JWT gate OFF; it checks the session itself).
Push: `push-send` defaults to the new bundle; an APNs key still has to be created and stored before pushes deliver.

**Rejected 2026-09-14, Guideline 2.1 "Information Needed — New App Submission"** — the boilerplate letter for accounts
with no review history, not a defect. Apple wants six answers plus a screen recording made on a physical device, in both
the Resolution Center reply and the App Review Notes. Answers and the whole response: `answers/20260914_220000_assetly_app_review_response.md`.

```bash
# the demo recording: XCUITest drives the app on the phone and Xcode records the screen itself
cd web/ios/App
REHEARSAL=1 OUT=/tmp/rehearsal.mp4 ./record-demo.sh 32A94BEE-7A1B-4436-A279-0D081A955F38   # SE simulator dry run
./await-device-and-record.sh        # armed watcher: waits for the iPhone, reseeds, records, retries
./record-demo.sh 00008030-00126D913C51402E                                                  # the real take
```
The app icon and launch image come from `web/scripts/make_icons.py`, which draws the two-bar mark from
`web/public/icon.svg`'s geometry (navy #2A3F92 ground, paper #F4F5F7 bars, the second at half opacity).
It asserts the mark is centred: the bars start at an x offset inside the 32-unit viewBox, so centring the
wrong box pushes the mark left — that shipped once in build 202609161356 and was fixed in 202609161437.
Re-run it, then `npm run build:ios` and archive; the icon must stay full bleed (iOS masks the corners)
and RGB with no alpha.

Traps: a test plan silently overrides `TEST_RUNNER_*` env, so credentials go in the plan (`make-demo-plan.sh`, gitignored);
`XCUIApplication(bundleIdentifier:)` cannot receive typed text — use `XCUIApplication()`; Return submits the web form, so
press it only on a form's last field; Supabase's built-in SMTP is capped at 2 emails/hour (not raisable on the free tier),
which is why the test asserts "Link sent" and fails the run instead of recording an error box, and why rehearsals skip that
beat; the app is reinstalled BEFORE the test starts, because an install inside the run puts a placeholder icon and
"Installing..." into the Home screen shot.

**Rejected again 2026-09-21, Guideline 2.1(a)** — "stuck at the set up assetly page", reviewed on an
iPad Air 11-inch (M3). Real bug, not boilerplate: `api.ts` opened every write with `sb.auth.getUser()`
(a network call that hangs on an expired token after a long brokerage OAuth), and `Onboarding.tsx`'s
connect handler never cleared `busy`. Fixed in build 202609210143 — `currentUserId()` with bounded
lookups, `finally` on the handler, a 12s guard on every setup await, and a "Skip for now" so setup can
never block access. Full write-up: `answers/20260921_020000_assetly_2_1a_onboarding_fix.md`.

```bash
# first run on a brand-new account — the path the demo account never exercises
node e2e/reset-firstrun.mjs                 # fixture back to never-onboarded; no signup emails
PW_CHANNEL=chrome node e2e/first-run.mjs    # against the deployed PWA
cd ios/App && ./run-firstrun-sim.sh 32A94BEE-7A1B-4436-A279-0D081A955F38 iphone-se
              ./run-firstrun-sim.sh 67FD9F22-A498-433B-9DD8-67AB1BF6545B ipad-air-11   # the review device
```
Lesson worth keeping: every earlier device run and e2e signed in as the seeded demo account, which has
`onboarded_at` set and never renders setup, so first run had zero coverage. An iPhone-only app still
runs on iPad in compatibility mode and App Review does test there.

1.1 follow-up: `transcripts.content` still holds verbatim earnings-call text as model input (the client grant is revoked
as of `20260914000033`). Replace it with a model-written summary, then re-test briefs, insights and Ask.

**1.0.1 prepared 2026-09-26** (branch `release-1.0.1` b1d38e4 + legal e01476f): ASC version `1f611f5d-c4ec-4a2b-b757-baf04293a5d9`
(release type MANUAL), build `202609261817` archived + uploaded with the RUNBOOK commands above (MARKETING_VERSION=1.0.1 passed
on the command line), en-US localization `5ec97a55-…` inherited the 1.0 description and the APP_IPHONE_67 screenshot set,
What's New set from `/tmp/whatsnew101.txt` (copy in `answers/20260926_182000_assetly_1_0_1_submission_checklist.md`), review
detail `585f7ed8-…` PATCHed with the 1.0.1 notes and the reviewer demo account, age rating override `ageRatingOverrideV2 =
EIGHTEEN_PLUS` on the PREPARE_FOR_SUBMISSION appInfo `5b9a4ea9-…` (Terms say 18+; owner decision 9/26). Web 1.0.1 was
published to gh-pages in the same run (`VITE_BASE=/assetly/ npm run build`, rsync -rc into the pages worktree). Deferred to
1.0.2: Sign in with Apple token revocation on delete-account (5.1.1(v)); streaming Ask answers; an ex-date history column.
