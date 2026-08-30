-- Portfolio Assessment: a fourth edition written at the connect moment / after a run of manual adds.
-- Never chosen by the clock; the crons keep producing morning / midday / close.
alter table public.daily_briefs drop constraint if exists daily_briefs_edition_check;
alter table public.daily_briefs add constraint daily_briefs_edition_check
  check (edition in ('morning','midday','close','assessment'));
