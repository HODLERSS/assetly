-- Three daily editions: morning (pre-open), midday (11am CT), close (post-close 3:05pm CT)
alter table public.daily_briefs add column if not exists edition text not null default 'morning'
  check (edition in ('morning','midday','close'));
alter table public.daily_briefs drop constraint if exists daily_briefs_user_id_brief_date_key;
alter table public.daily_briefs add constraint daily_briefs_user_date_edition_key unique (user_id, brief_date, edition);

-- reschedule: one edition per window; the function resolves the edition from the clock
do $$ begin
  perform cron.unschedule('assetly-daily-brief');
  exception when others then null;
end $$;
do $$ begin
  perform cron.unschedule('assetly-daily-brief-sweep');
  exception when others then null;
end $$;
select cron.schedule('assetly-brief-morning',       '35 12 * * 1-5', $$select public.invoke_edge('daily-brief')$$);
select cron.schedule('assetly-brief-morning-sweep', '0,15,30 13 * * 1-5', $$select public.invoke_edge('daily-brief')$$);
select cron.schedule('assetly-brief-midday',        '0 16 * * 1-5', $$select public.invoke_edge('daily-brief')$$);
select cron.schedule('assetly-brief-midday-sweep',  '20,40 16 * * 1-5', $$select public.invoke_edge('daily-brief')$$);
select cron.schedule('assetly-brief-close',         '5 20 * * 1-5', $$select public.invoke_edge('daily-brief')$$);
select cron.schedule('assetly-brief-close-sweep',   '25,45 20 * * 1-5', $$select public.invoke_edge('daily-brief')$$);
