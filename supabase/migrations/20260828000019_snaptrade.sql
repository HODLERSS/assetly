-- SnapTrade OAuth integration: per-user tokens + PKCE state + import provenance
create table if not exists public.snaptrade_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  refresh_token text not null,
  access_token text,
  access_expires_at timestamptz,
  st_user_id text,
  scope text,
  institutions text[] default '{}',
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_sync_at timestamptz
);
alter table public.snaptrade_tokens enable row level security;
-- no policies: service-role only. Connection status surfaces through the edge function.

create table if not exists public.snaptrade_oauth_states (
  state text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  verifier text not null,
  created_at timestamptz not null default now()
);
alter table public.snaptrade_oauth_states enable row level security;

alter table public.holdings add column if not exists source text not null default 'manual';
alter table public.holdings add column if not exists external_id text;
create unique index if not exists holdings_external_id_key on public.holdings (user_id, external_id) where external_id is not null;

-- periodic re-import for connected users (positions drift as people trade)
select cron.schedule('assetly-snaptrade-sync', '15 */6 * * *', $$select public.invoke_edge('snaptrade-sync')$$);

-- commercial (Connection Portal) mode: per-user SnapTrade secret; oauth tokens optional
alter table public.snaptrade_tokens alter column refresh_token drop not null;
alter table public.snaptrade_tokens add column if not exists mode text not null default 'oauth';
alter table public.snaptrade_tokens add column if not exists st_secret text;
