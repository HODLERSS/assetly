-- Session-aware insights: the function itself decides staleness (50-min window +
-- regenerate-after-open rule), so the cron just offers more chances to act.
-- Off-cycle laps with nothing stale are DB-only no-ops (no model calls).
select cron.schedule('assetly-insights-sync', '7,22,37,52 * * * *', $$select public.invoke_edge('insights-sync')$$);
