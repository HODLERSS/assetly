-- Round 9 (not applied): daily-brief now resolves its edition from the ET clock and refuses to write outside the edition's
-- window (_shared/calendar.ts editionWindow). The close crons are fixed in UTC (20:05 / 20:25 / 20:45), which is 3:05-3:45 PM
-- once daylight time ends on Nov 1, 2026: every close run would then be declined until the */30 backfill at 4:30 PM EST.
-- These add the same three runs an hour later. In daylight time they resolve to "close" and find the row already written
-- (a no-op); in standard time they are the close runs.
select cron.schedule('assetly-brief-close-est',       '5 21 * * 1-5',     $$select public.invoke_edge('daily-brief')$$);
select cron.schedule('assetly-brief-close-est-sweep', '25,45 21 * * 1-5', $$select public.invoke_edge('daily-brief')$$);
