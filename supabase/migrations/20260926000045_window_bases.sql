-- Round 11 (not applied): every window base for every holding in one round trip. Ask read windows with 1 + N queries per
-- holding (up to 20 holdings x 6 queries on every question), the most expensive query family in pg_stat_statements
-- (~28k calls, 91 ms mean under load). windowReturnsBatch (_shared/history.ts) calls this; without it the functions fall
-- back to the per-holding reads.
--
-- Input: parallel arrays (symbol, window index k >= 1, cutoff). Output: per symbol the latest row as k = 0, and per
-- (symbol, k) the last row at or before its cutoff. Each lookup is one index probe on price_history_pkey (symbol, ts).
create or replace function public.window_bases(p_symbols text[], p_ks int[], p_cuts timestamptz[])
returns table (symbol text, k int, ts timestamptz, price numeric)
language sql
stable
security invoker
set search_path = public
as $$
  select s.symbol, 0 as k, l.ts, l.price
  from (select distinct unnest(p_symbols) as symbol) s
  cross join lateral (select h.ts, h.price from public.price_history h where h.symbol = s.symbol order by h.ts desc limit 1) l
  union all
  select t.symbol, t.k, b.ts, b.price
  from unnest(p_symbols, p_ks, p_cuts) as t(symbol, k, cut)
  cross join lateral (select h.ts, h.price from public.price_history h where h.symbol = t.symbol and h.ts <= t.cut order by h.ts desc limit 1) b
$$;

comment on function public.window_bases(text[], int[], timestamptz[]) is
  'Window bases: the latest price (k = 0) and, per (symbol, k), the last price at or before the cutoff.';

grant execute on function public.window_bases(text[], int[], timestamptz[]) to authenticated, service_role;
