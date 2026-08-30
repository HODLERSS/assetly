-- Brokerage-agnostic import: SnapTrade brokerages quote in CAD, GBP, EUR, JPY, AUD, HKD, INR, ... not only USD/KRW.
-- Symbols and prices carry the listing currency; FX rates (units per USD) live in `prices` like USDKRW does;
-- the client converts through USD. Base/display currency of a profile stays USD or KRW.
alter table public.symbols drop constraint if exists symbols_currency_check;
alter table public.symbols add constraint symbols_currency_check
  check (currency ~ '^[A-Z]{3}$');

-- FX pairs the price pipeline keeps fresh (Yahoo "<CCY>=X" = units of CCY per USD)
insert into public.symbols (symbol, name, exchange, currency, kind, yahoo) values
  ('USDCAD','US Dollar / Canadian Dollar','FX','CAD','fund','CAD=X'),
  ('USDGBP','US Dollar / British Pound','FX','GBP','fund','GBP=X'),
  ('USDEUR','US Dollar / Euro','FX','EUR','fund','EUR=X'),
  ('USDJPY','US Dollar / Japanese Yen','FX','JPY','fund','JPY=X'),
  ('USDAUD','US Dollar / Australian Dollar','FX','AUD','fund','AUD=X'),
  ('USDHKD','US Dollar / Hong Kong Dollar','FX','HKD','fund','HKD=X'),
  ('USDINR','US Dollar / Indian Rupee','FX','INR','fund','INR=X'),
  ('USDCHF','US Dollar / Swiss Franc','FX','CHF','fund','CHF=X'),
  ('USDSGD','US Dollar / Singapore Dollar','FX','SGD','fund','SGD=X'),
  ('USDNZD','US Dollar / New Zealand Dollar','FX','NZD','fund','NZD=X'),
  ('USDSEK','US Dollar / Swedish Krona','FX','SEK','fund','SEK=X'),
  ('USDNOK','US Dollar / Norwegian Krone','FX','NOK','fund','NOK=X'),
  ('USDDKK','US Dollar / Danish Krone','FX','DKK','fund','DKK=X'),
  ('USDMXN','US Dollar / Mexican Peso','FX','MXN','fund','MXN=X'),
  ('USDBRL','US Dollar / Brazilian Real','FX','BRL','fund','BRL=X'),
  ('USDZAR','US Dollar / South African Rand','FX','ZAR','fund','ZAR=X'),
  ('USDTWD','US Dollar / Taiwan Dollar','FX','TWD','fund','TWD=X'),
  ('USDCNY','US Dollar / Chinese Yuan','FX','CNY','fund','CNY=X')
  on conflict (symbol) do nothing;

-- cash / debt balances per currency (pinned at 1 unit), for brokerage cash sweeps in those currencies
insert into public.symbols (symbol, name, exchange, currency, kind, yahoo)
select '$CASH.' || c, 'Cash (' || c || ')', 'CASH', c, 'cash', null
  from unnest(array['CAD','GBP','EUR','JPY','AUD','HKD','INR','CHF','SGD','NZD','SEK','NOK','DKK','MXN','BRL','ZAR','TWD','CNY']) as c
  on conflict (symbol) do nothing;
insert into public.symbols (symbol, name, exchange, currency, kind, yahoo)
select '$DEBT.' || c, 'Debt (' || c || ')', 'DEBT', c, 'debt', null
  from unnest(array['CAD','GBP','EUR','JPY','AUD','HKD','INR','CHF','SGD','NZD','SEK','NOK','DKK','MXN','BRL','ZAR','TWD','CNY']) as c
  on conflict (symbol) do nothing;
insert into public.prices (symbol, price, prev_close, change_pct, currency, market_state, as_of, source)
select s.symbol, 1, 1, 0, s.currency, 'regular', now(), 'pinned'
  from public.symbols s where s.kind in ('cash','debt') and s.symbol like '$%.%'
  on conflict (symbol) do nothing;
