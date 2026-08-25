-- KRW cash and debt balances: pinned at 1 won per unit (qty = won amount).
insert into public.symbols (symbol, name, exchange, currency, kind, yahoo) values
  ('$CASH.KRW','Cash (KRW)','CASH','KRW','cash',null),
  ('$DEBT.KRW','Debt (KRW)','DEBT','KRW','debt',null)
  on conflict (symbol) do nothing;
insert into public.prices (symbol, price, prev_close, change_pct, currency, market_state, as_of, source) values
  ('$CASH.KRW', 1, 1, 0, 'KRW', 'regular', now(), 'pinned'),
  ('$DEBT.KRW', 1, 1, 0, 'KRW', 'regular', now(), 'pinned')
  on conflict (symbol) do nothing;
