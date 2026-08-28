-- Raw SnapTrade payload snapshots (accounts/positions/balances/webhooks) for audit and debugging
create table if not exists public.snaptrade_raw (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete cascade,
  account_id text,
  kind text not null,
  payload jsonb not null,
  fetched_at timestamptz not null default now()
);
alter table public.snaptrade_raw enable row level security;
create index if not exists snaptrade_raw_user_idx on public.snaptrade_raw (user_id, kind, fetched_at desc);
select cron.schedule('assetly-snaptrade-raw-prune','40 3 * * *', $$delete from public.snaptrade_raw where fetched_at < now() - interval '30 days'$$);
