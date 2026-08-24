-- price_history retention: keep every tick for 7 days; beyond that keep the last
-- point per (symbol, day). Runs nightly. Chart ranges: 1D/1W use ticks+15m bars,
-- 1M/3M use daily closes — this prune preserves exactly what the charts need.
select cron.schedule('assetly-history-prune', '17 3 * * *', $$
  delete from public.price_history ph
  using (
    select symbol, ts,
           row_number() over (partition by symbol, date_trunc('day', ts) order by ts desc) rn
    from public.price_history
    where ts < now() - interval '7 days'
  ) d
  where ph.symbol = d.symbol and ph.ts = d.ts and d.rn > 1
$$);
