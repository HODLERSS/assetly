-- Push notifications, 1.0.3: the APNs environment per device, a send log, and the admin tool's audit trail.
--
-- push_tokens.environment: a build run from Xcode registers with the APNs sandbox, TestFlight and App Store builds
-- with production, and a token only works on the host it came from. The app reports which one it is, so push-send
-- routes each device to its own host instead of one project-wide setting.
alter table public.push_tokens add column if not exists environment text not null default 'production';
alter table public.push_tokens drop constraint if exists push_tokens_environment_check;
alter table public.push_tokens add constraint push_tokens_environment_check check (environment in ('production', 'sandbox'));
-- one device, one account: a token is the device, so it belongs to whoever signed in on it last (claim_push_token)
create index if not exists push_tokens_token_idx on public.push_tokens(token);

-- A device hands its token to the signed-in account. Security definer because the same device may still be
-- registered to the account that used it before (a shared phone, a sign-out without Off), and row-level rules
-- rightly stop one user deleting another's rows: without this, the previous account's briefs kept arriving on
-- the phone of whoever signed in next.
create or replace function public.claim_push_token(p_token text, p_platform text default 'ios', p_environment text default 'production')
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if coalesce(length(p_token), 0) < 16 or length(p_token) > 200 or p_token !~ '^[0-9A-Fa-f]+$' then raise exception 'bad token'; end if;
  if p_environment not in ('production', 'sandbox') then raise exception 'bad environment'; end if;
  delete from public.push_tokens where token = p_token and user_id <> auth.uid();
  insert into public.push_tokens (user_id, token, platform, environment, last_seen_at)
  values (auth.uid(), p_token, coalesce(p_platform, 'ios'), p_environment, now())
  on conflict (user_id, token) do update set platform = excluded.platform, environment = excluded.environment, last_seen_at = now();
end $$;
revoke all on function public.claim_push_token(text, text, text) from public, anon;
grant execute on function public.claim_push_token(text, text, text) to authenticated;

-- One row per notification to one user (all of their devices), written only by the service role.
-- dedupe_key makes a send idempotent: the brief pipeline claims "brief:<user>:<date>:<edition>" before it sends,
-- and a second claim (a retry, a regeneration, a duplicate cron) finds the row and sends nothing.
create table if not exists public.push_log (
  id          bigint generated always as identity primary key,
  user_id     uuid references auth.users(id) on delete cascade,
  kind        text not null,                 -- brief | admin_single | admin_test | admin_broadcast
  title       text,
  body        text,
  link        text,
  status      text not null,                 -- sending | sent | partial | failed | no_devices | dry_run
  apns_id     text,                          -- the first device's apns-id; every device is in `results`
  error       text,
  devices     int not null default 0,
  sent        int not null default 0,
  dropped     int not null default 0,        -- dead tokens removed (410 / BadDeviceToken)
  results     jsonb,
  dedupe_key  text unique,
  actor_id    uuid,                          -- the admin who sent it, for admin kinds
  created_at  timestamptz not null default now()
);
create index if not exists push_log_created_idx on public.push_log(created_at desc);
create index if not exists push_log_user_idx on public.push_log(user_id, created_at desc);
alter table public.push_log enable row level security;
revoke all on public.push_log from anon, authenticated;
grant all on public.push_log to service_role;

-- Every admin-push call, allowed or refused, with who, what and the outcome. Service role only.
create table if not exists public.admin_audit (
  id          bigint generated always as identity primary key,
  actor_id    uuid,
  actor_email text,
  action      text not null,
  target      text,
  payload     jsonb,
  result      jsonb,
  ok          boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists admin_audit_actor_idx on public.admin_audit(actor_id, action, created_at desc);
alter table public.admin_audit enable row level security;
revoke all on public.admin_audit from anon, authenticated;
grant all on public.admin_audit to service_role;

-- The APNs provider token, reused for up to 40 minutes: Apple answers 429 TooManyProviderTokenUpdates to a sender
-- that changes it more often than every 20. One row; service role only (it can send pushes for an hour).
create table if not exists public.apns_provider_token (
  id         int primary key default 1 check (id = 1),
  key_id     text not null,
  jwt        text not null,
  iat        bigint not null,
  updated_at timestamptz not null default now()
);
alter table public.apns_provider_token enable row level security;
revoke all on public.apns_provider_token from anon, authenticated;
grant all on public.apns_provider_token to service_role;
