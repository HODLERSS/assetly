-- Seoul editions: a KRX open pulse (9:20 AM KST) and a KRX closing note (3:40 PM KST) on KRX trading days,
-- written only for books that hold Korean names. daily-brief checks the KST calendar itself (holidays skip).
-- The edition rides the URL: invoke_edge appends the name to /functions/v1/, so a query string passes through.
alter table public.daily_briefs drop constraint if exists daily_briefs_edition_check;
alter table public.daily_briefs add constraint daily_briefs_edition_check
  check (edition in ('morning', 'midday', 'close', 'assessment', 'weekend', 'kr_open', 'kr_close'));
select cron.unschedule(jobid) from cron.job where jobname in ('assetly-brief-kr-open', 'assetly-brief-kr-open-sweep', 'assetly-brief-kr-close', 'assetly-brief-kr-close-sweep');
select cron.schedule('assetly-brief-kr-open',        '20 0 * * 1-5', $$select public.invoke_edge('daily-brief?edition=kr_open')$$);
select cron.schedule('assetly-brief-kr-open-sweep',  '45 0 * * 1-5', $$select public.invoke_edge('daily-brief?edition=kr_open')$$);
select cron.schedule('assetly-brief-kr-close',       '40 6 * * 1-5', $$select public.invoke_edge('daily-brief?edition=kr_close')$$);
select cron.schedule('assetly-brief-kr-close-sweep', '5 7 * * 1-5',  $$select public.invoke_edge('daily-brief?edition=kr_close')$$);
