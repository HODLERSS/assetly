-- import provenance in the portfolio view + exclusion tombstones + sync-delta events
create table if not exists public.snaptrade_exclusions (
  user_id uuid not null references auth.users(id) on delete cascade,
  symbol text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, symbol)
);
alter table public.snaptrade_exclusions enable row level security;
drop policy if exists "own exclusions" on public.snaptrade_exclusions;
create policy "own exclusions" on public.snaptrade_exclusions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists public.snaptrade_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  detail jsonb not null default '{}'::jsonb,
  seen boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.snaptrade_events enable row level security;
drop policy if exists "own events select" on public.snaptrade_events;
create policy "own events select" on public.snaptrade_events for select to authenticated using (user_id = auth.uid());
drop policy if exists "own events seen" on public.snaptrade_events;
create policy "own events seen" on public.snaptrade_events for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop view if exists public.portfolio;
create view public.portfolio with (security_invoker = true) as
 SELECT h.user_id, h.id AS holding_id, h.symbol, h.account, h.nickname, h.source,
    s.name, s.name_kr, s.currency, s.kind,
    sum(l.qty) AS qty,
    sum(l.qty * l.cost_per_share) AS cost_basis,
    CASE WHEN sum(l.qty) > 0::numeric THEN sum(l.qty * l.cost_per_share) / sum(l.qty) ELSE NULL::numeric END AS avg_cost,
    p.price, p.change_pct, p.as_of,
    sum(l.qty) * p.price AS value,
    sum(l.qty) * p.price - sum(l.qty * l.cost_per_share) AS total_gl
   FROM holdings h
     JOIN symbols s USING (symbol)
     LEFT JOIN lots l ON l.holding_id = h.id
     LEFT JOIN prices p ON p.symbol = h.symbol
  GROUP BY h.user_id, h.id, h.symbol, h.account, h.nickname, h.source, s.name, s.name_kr, s.currency, s.kind, p.price, p.change_pct, p.as_of;
grant select on public.portfolio to authenticated, anon;
