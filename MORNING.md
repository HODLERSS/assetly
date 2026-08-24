# Assetly — your 5-minute morning checklist

Everything below is live and tested. OAuth is now fully live (see below). Nothing is pending.

## Try it now (works before anything else)
- Open **https://hodlerss.github.io/assetly/** on your iPhone → Share → *Add to Home Screen*.
- Sign in with **Email me a sign-in link** (passwordless). Or use the fixture account from the
  tests: `e2e-cloud@assetly.test` is auto-confirmed (password grant only, for tests).

## GitHub + Google sign-in — DONE (Aug 24, live-tested)
Registered through your browser with your approval; you pasted the two secrets.
- **GitHub OAuth app "Assetly"** — Client ID `Ov23lihYevAhLzohDRkt`
  (github.com/settings/applications/3813563), callback `https://hhdpthrfmsdmxdrfckxq.supabase.co/auth/v1/callback`
- **Google OAuth client "Assetly (production)"** — Client ID
  `1021648459917-km5htfnqdv1b7ckahv9jhdshe4m7kl6t.apps.googleusercontent.com`
  (project gen-lang-client-0159002701, same as Thunder Route/Stadion clients);
  JS origin `https://hodlerss.github.io`, redirect URI = Supabase callback.
- Supabase providers GitHub + Google: enabled, saved, `/auth/v1/settings` reports all three ENABLED.
- **Live round-trips verified on the deployed app**: GitHub → session `provider: github`;
  Google → same user auto-linked, `providers: ["github","google"]` (email `minjae.m.lee@gmail.com`).
- Consent screen shows the Google project's brand name until you customize Branding (cosmetic).
- Re-verify anytime: `bash app/scripts/verify-oauth.sh`.

## What's running in your Supabase (project `assetly`, org Thunder Route, ref hhdpthrfmsdmxdrfckxq)
- Schema, RLS, grants, seed catalog (17 symbols) — verified via SQL
- Edge functions `price-sync`, `news-sync` — deployed, live-tested
- pg_cron: prices every minute, news every 15 — proven in `cron.job_run_details`
- Auth: email (passwordless links) + GitHub + Google OAuth, all enabled and round-trip tested
- Note: AI Bites project was paused (you approved) to free the free-plan slot — resume it anytime from its settings.
