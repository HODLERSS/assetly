-- Accounts: the same ticker in a brokerage vs a 401k is a different position.
-- Minimal surface: account defaults to 'brokerage'; users only pick when it matters.
alter table public.holdings add column if not exists account text not null default 'brokerage'
  check (account in ('brokerage','401k','ira'));
alter table public.holdings drop constraint if exists holdings_user_id_symbol_key;
alter table public.holdings add constraint holdings_user_symbol_account_key unique (user_id, symbol, account);

-- Cash is a position: symbol CASH pinned at $1 (no market feed).
alter table public.symbols drop constraint if exists symbols_kind_check;
alter table public.symbols add constraint symbols_kind_check
  check (kind in ('equity','etf','fund','crypto','cash'));
insert into public.symbols (symbol, name, exchange, currency, kind, yahoo)
  values ('$CASH','Cash (USD)','CASH','USD','cash',null)
  on conflict (symbol) do nothing;
insert into public.prices (symbol, price, prev_close, change_pct, currency, market_state, as_of, source)
  values ('$CASH', 1, 1, 0, 'USD', 'regular', now(), 'pinned')
  on conflict (symbol) do nothing;

-- portfolio view carries the account through (drop first: column order changes)
drop view if exists public.portfolio;
create view public.portfolio as
  select h.user_id, h.id as holding_id, h.symbol, h.account, s.name, s.currency, s.kind,
         sum(l.qty) as qty,
         sum(l.qty * l.cost_per_share) as cost_basis,
         case when sum(l.qty) > 0 then sum(l.qty * l.cost_per_share) / sum(l.qty) end as avg_cost,
         p.price, p.change_pct, p.as_of,
         sum(l.qty) * p.price as value,
         sum(l.qty) * p.price - sum(l.qty * l.cost_per_share) as total_gl
  from public.holdings h
  join public.symbols s using (symbol)
  left join public.lots l on l.holding_id = h.id
  left join public.prices p on p.symbol = h.symbol
  group by h.user_id, h.id, h.symbol, h.account, s.name, s.currency, s.kind, p.price, p.change_pct, p.as_of;
alter view public.portfolio set (security_invoker = true);

-- recreating the view drops its grants; restore API-role access
grant select on public.portfolio to anon, authenticated, service_role;
