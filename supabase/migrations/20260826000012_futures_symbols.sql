-- US index futures for the pre-open pulse (Home movers card before the US open).
insert into public.symbols (symbol, name, exchange, currency, kind, yahoo, active)
values ('ES=F', 'S&P 500 Futures', 'CME', 'USD', 'etf', 'ES=F', true),
       ('NQ=F', 'Nasdaq 100 Futures', 'CME', 'USD', 'etf', 'NQ=F', true)
on conflict (symbol) do nothing;
