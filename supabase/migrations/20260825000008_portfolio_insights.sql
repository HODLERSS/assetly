-- Portfolio-level AI insights: per USER (their actual mix), append-only, hourly.
create table if not exists public.portfolio_insights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  bullets jsonb not null,
  model text not null,
  generated_at timestamptz not null default now()
);
create index portfolio_insights_user_time on public.portfolio_insights (user_id, generated_at desc);
alter table public.portfolio_insights enable row level security;
create policy "own portfolio insights" on public.portfolio_insights
  for select using (auth.uid() = user_id);
grant select on public.portfolio_insights to authenticated, service_role;
