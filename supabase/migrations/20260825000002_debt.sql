-- Debt balances: consolidated net worth = assets - debt. DEBT is $1-pinned like CASH;
-- the client subtracts kind='debt' positions from totals.
alter table public.symbols drop constraint if exists symbols_kind_check;
alter table public.symbols add constraint symbols_kind_check
  check (kind in ('equity','etf','fund','crypto','cash','debt'));
insert into public.symbols (symbol, name, exchange, currency, kind, yahoo)
  values ('$DEBT','Debt (USD)','DEBT','USD','debt',null)
  on conflict (symbol) do nothing;
insert into public.prices (symbol, price, prev_close, change_pct, currency, market_state, as_of, source)
  values ('$DEBT', 1, 1, 0, 'USD', 'regular', now(), 'pinned')
  on conflict (symbol) do nothing;
