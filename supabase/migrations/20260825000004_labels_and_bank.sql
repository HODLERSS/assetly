-- Named balances ("Cash (Yeonhwa)") + bank account type.
-- nickname joins the uniqueness so several labeled cash/debt rows coexist per account;
-- market positions keep merging (nickname defaults to '').
update public.holdings set nickname = '' where nickname is null;
alter table public.holdings alter column nickname set default '';
alter table public.holdings alter column nickname set not null;
alter table public.holdings drop constraint if exists holdings_user_symbol_account_key;
alter table public.holdings drop constraint if exists holdings_user_symbol_account_nick_key;
alter table public.holdings add constraint holdings_user_symbol_account_nick_key
  unique (user_id, symbol, account, nickname);
alter table public.holdings drop constraint if exists holdings_account_check;
alter table public.holdings add constraint holdings_account_check
  check (account in ('brokerage','bank','401k','ira'));
drop view if exists public.portfolio;
create view public.portfolio as
  select h.user_id, h.id as holding_id, h.symbol, h.account, h.nickname, s.name, s.currency, s.kind,
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
  group by h.user_id, h.id, h.symbol, h.account, h.nickname, s.name, s.currency, s.kind, p.price, p.change_pct, p.as_of;
alter view public.portfolio set (security_invoker = true);
grant select on public.portfolio to anon, authenticated, service_role;
