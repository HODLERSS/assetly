-- Investor profile: 5 tap-only answers captured at sign-up (skippable; null = novice value investor defaults),
-- editable in Settings, injected into every user-scoped generation (portfolio intelligence, briefs, assessment, Ask).
alter table public.profiles add column if not exists investor jsonb;
