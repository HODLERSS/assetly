-- Weekend / holiday read: one brief per non-trading US day, written after 9 AM ET, replacing the morning /
-- midday / close editions that used to be generated from a tape that was not moving. Weekday market holidays
-- are already covered by the Mon-Fri crons (daily-brief turns a clock-resolved edition into the weekend read
-- whenever the US market is closed); Saturday and Sunday need their own ticks.
alter table public.daily_briefs drop constraint if exists daily_briefs_edition_check;
alter table public.daily_briefs add constraint daily_briefs_edition_check check (edition in ('morning', 'midday', 'close', 'assessment', 'weekend'));
select cron.unschedule(jobid) from cron.job where jobname in ('assetly-brief-weekend', 'assetly-brief-weekend-sweep');
select cron.schedule('assetly-brief-weekend',       '5 14 * * 0,6',     $$select public.invoke_edge('daily-brief')$$);
select cron.schedule('assetly-brief-weekend-sweep', '35 14,15 * * 0,6', $$select public.invoke_edge('daily-brief')$$);
