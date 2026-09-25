-- Round 4 (2026-09-25). Chart series in one call: daily closes for the long ranges, every print for the recent window.
-- The client paged raw prints newest-first with an 8-page cap. A stock holds ~2.6k rows a year (the nightly prune
-- keeps one row per day past 7 days), but a coin trades 24/7: the last 7 days alone are ~10k minute prints, so
-- BTC and ETH hit the cap inside the dense week and every range from 1W to 5Y showed the same 5-day line
-- (BTC "1Y +3.48%" while Yahoo had -23%; r4 power-user M1).
--
-- price_history_series returns, for one symbol from p_since on:
--   * before p_daily_before: ONE row per trading day, the LAST print of that day. The day is the symbol's own
--     session date in p_tz (Asia/Seoul for KRX, America/New_York for US equities, UTC for crypto), so a KRX close
--     stamped 06:30 UTC and a US close stamped 20:00 UTC each land on the date their market printed them.
--   * at/after p_daily_before: every row (intraday detail for the recent window).
-- A 5Y coin is ~1.8k daily rows plus the recent window, instead of ~12k raw prints. PostgREST still caps a
-- response at 1000 rows, so the client orders ts desc and pages with Range, which works on a set-returning RPC.
-- security invoker: the caller's own grants and RLS on price_history apply ("history readable" is for
-- authenticated), so granting execute to anon exposes nothing: an anon call fails exactly as a direct read would.
create or replace function public.price_history_series(
  p_symbol text,
  p_since timestamptz,
  p_daily_before timestamptz,
  p_tz text default 'UTC'
) returns table (ts timestamptz, price numeric)
language sql
stable
security invoker
set search_path = public
as $$
  select d.ts, d.price
  from (
    select distinct on ((h.ts at time zone p_tz)::date) h.ts, h.price
    from public.price_history h
    where h.symbol = p_symbol
      and h.ts >= p_since
      and h.ts < p_daily_before
    order by (h.ts at time zone p_tz)::date, h.ts desc
  ) d
  union all
  select h.ts, h.price
  from public.price_history h
  where h.symbol = p_symbol
    and h.ts >= greatest(p_since, p_daily_before)
  order by 1
$$;

comment on function public.price_history_series(text, timestamptz, timestamptz, text) is
  'Chart series: last print per trading day (in p_tz) before p_daily_before, every print from p_daily_before on.';

grant execute on function public.price_history_series(text, timestamptz, timestamptz, text) to authenticated, anon;
