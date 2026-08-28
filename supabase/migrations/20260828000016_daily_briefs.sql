-- The Daily Brief: a per-user morning research note, one per trading day.
create table if not exists public.daily_briefs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  brief_date date not null,
  sections jsonb not null,
  memos jsonb,
  model text not null,
  generated_at timestamptz not null default now(),
  unique (user_id, brief_date)
);
alter table public.daily_briefs enable row level security;
drop policy if exists "own briefs" on public.daily_briefs;
create policy "own briefs" on public.daily_briefs for select to authenticated using (auth.uid() = user_id);
grant select on public.daily_briefs to authenticated, service_role;
grant insert, update on public.daily_briefs to service_role;
create index if not exists daily_briefs_user_date on public.daily_briefs (user_id, brief_date desc);

-- Market-context instruments for the brief (and the pulse card family).
insert into public.symbols (symbol, name, exchange, currency, kind, yahoo, active)
values ('^VIX', 'CBOE Volatility Index', 'CBOE', 'USD', 'etf', '^VIX', true),
       ('^KS11', 'KOSPI Composite', 'KRX', 'KRW', 'etf', '^KS11', true),
       ('^GSPC', 'S&P 500', 'NYSE', 'USD', 'etf', '^GSPC', true)
on conflict (symbol) do nothing;
