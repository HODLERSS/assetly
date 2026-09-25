-- When a symbol's daily history was last backfilled from Yahoo (two years of closes). Every function that
-- reads return windows now self-heals a held symbol whose history does not reach back 400 days
-- (_shared/history.ts ensureHistory); the stamp keeps a young listing, which is short by nature, from being
-- refetched on every 15-minute insights lap (it is retried weekly). Written only by the service role.
-- The code runs without this column (it falls back to an in-worker memo), so apply it before or after deploy.
alter table public.symbols add column if not exists history_backfilled_at timestamptz;
