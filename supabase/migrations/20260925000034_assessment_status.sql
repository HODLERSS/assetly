-- Portfolio Assessment progress, one row per user, so the client can show a progress card from the first
-- add or connect until the assessment lands (a new account used to watch a plain price tracker for minutes
-- with no sign that anything was coming).
--   queued   brokerage-connected accepted the run (step: sync -> news)
--   running  brief-retry is on attempt N (step: writing)
--   ready    the assessment row is in daily_briefs (finished_at set)
--   failed   attempts ran out, or the book is empty / under $100 (error says which)
-- started_at is the run's start (reset by every new run); updated_at moves on every step, so a client can
-- treat a row stuck in queued/running for more than ~15 minutes as failed.
-- Writes come only from the edge functions (service role); a user reads their own row.
create table if not exists public.assessment_status (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  state        text not null check (state in ('queued', 'running', 'ready', 'failed')),
  step         text,
  attempt      int not null default 0,
  started_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  finished_at  timestamptz,
  error        text
);

alter table public.assessment_status enable row level security;

drop policy if exists assessment_status_own_select on public.assessment_status;
create policy assessment_status_own_select on public.assessment_status
  for select to authenticated using (auth.uid() = user_id);

revoke all on public.assessment_status from anon;
grant select on public.assessment_status to authenticated;
grant select, insert, update, delete on public.assessment_status to service_role;
