-- Insights v2 (design review): append-only HISTORY, not latest-only. Every hourly
-- generation is kept, so users can scroll how the AI's view evolved. Content is
-- per-symbol (shared across holders — identical inputs, identical take); each user's
-- feed comes from joining THEIR holdings, and generation priority is weighted by
-- total invested value, so the names people have real money in refresh first.
drop table if exists public.insights;
create table public.insights (
  id uuid primary key default gen_random_uuid(),
  symbol text not null references public.symbols(symbol) on delete cascade,
  bullets jsonb not null,
  windows jsonb,
  model text not null,
  generated_at timestamptz not null default now()
);
create index insights_symbol_time on public.insights (symbol, generated_at desc);
alter table public.insights enable row level security;
create policy "insights readable" on public.insights for select to authenticated using (true);
grant select on public.insights to authenticated, service_role;
