# Assetly — your 5-minute morning checklist

Everything below is live and tested. Two items need *you* because they are account actions on
GitHub and Google that my browser session was not allowed to open (the Claude-in-Chrome
extension blocks github.com and console.cloud.google.com by default), and because I never type
secrets into fields.

## Try it now (works before anything else)
- Open **https://hodlerss.github.io/assetly/** on your iPhone → Share → *Add to Home Screen*.
- Sign in with **Email me a sign-in link** (passwordless). Or use the fixture account from the
  tests: `e2e-cloud@assetly.test` is auto-confirmed (password grant only, for tests).

## Turn on GitHub + Google sign-in (≈4 minutes)
Both providers are already wired in the app and in Supabase (`auth/v1/callback` URL, redirects).
1. **GitHub → new OAuth app** (github.com → Settings → Developer settings → OAuth Apps → New):
   - Application name: `Assetly` · Homepage: `https://hodlerss.github.io/assetly/`
   - Authorization callback URL: `https://hhdpthrfmsdmxdrfckxq.supabase.co/auth/v1/callback`
   - Then Supabase → Authentication → Sign In / Providers → GitHub → paste Client ID + Secret → Enable → Save.
2. **Google → new OAuth client** (console.cloud.google.com → APIs & Services → Credentials →
   Create credentials → OAuth client ID → Web application):
   - Authorized JavaScript origins: `https://hodlerss.github.io`
   - Authorized redirect URIs: `https://hhdpthrfmsdmxdrfckxq.supabase.co/auth/v1/callback`
   - Supabase → Providers → Google → paste Client ID + Secret → Enable → Save.
3. Verify: `bash app/scripts/verify-oauth.sh` — prints which providers Supabase reports enabled,
   then re-runs the cloud battery. Tap *Continue with GitHub* on the phone to see the round trip.

(If you'd rather I do steps 1–2 through the browser: allow `github.com` and
`console.cloud.google.com` in the Claude-in-Chrome extension's site permissions and say so —
the only thing I'll still hand you is the two secret pastes.)

## What's running in your Supabase (project `assetly`, org Thunder Route, ref hhdpthrfmsdmxdrfckxq)
- Schema, RLS, grants, seed catalog (17 symbols) — verified via SQL
- Edge functions `price-sync`, `news-sync` — deployed, live-tested
- pg_cron: prices every minute, news every 15 — proven in `cron.job_run_details`
- Auth: email (passwordless links), site URL + redirect allow-list set; GitHub/Google await your keys
- Note: AI Bites project was paused (you approved) to free the free-plan slot — resume it anytime from its settings.
