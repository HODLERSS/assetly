-- First-party campaign tracking (owner 10/3: "track the most granular data"). Apple hides per-campaign App Store
-- numbers below its privacy threshold, so our own tagged links count themselves:
--   campaign_hits: one row per open of a tagged link (the /get smart link: flyer QR, channel links). No IP, no user
--   agent string, no identity: the campaign tag, a platform bucket, where it sent the visitor, and the referrer's host.
--   profiles.signup_ref: the ?ref= tag a web visitor arrived with, saved once at sign-up.
create table if not exists public.campaign_hits (
  id bigserial primary key,
  at timestamptz not null default now(),
  campaign text not null,
  platform text not null,
  dest text not null,
  referrer_host text
);
create index if not exists campaign_hits_campaign_at_idx on public.campaign_hits(campaign, at);
alter table public.campaign_hits enable row level security;   -- no policies: only the service role reads it

create or replace function public.log_campaign_hit(p_campaign text, p_platform text, p_dest text, p_referrer_host text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_campaign !~ '^[a-z0-9-]{1,32}$' or p_platform not in ('ios', 'android', 'other') or p_dest not in ('app_store', 'web_app') then
    raise exception 'bad hit';
  end if;
  insert into public.campaign_hits (campaign, platform, dest, referrer_host)
  values (p_campaign, p_platform, p_dest, nullif(left(lower(coalesce(p_referrer_host, '')), 80), ''));
end $$;
revoke all on function public.log_campaign_hit(text, text, text, text) from public;
grant execute on function public.log_campaign_hit(text, text, text, text) to anon, authenticated;

alter table public.profiles add column if not exists signup_ref text;
create or replace function public.set_signup_ref(p_ref text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if p_ref !~ '^[a-z0-9-]{1,40}$' then raise exception 'bad ref'; end if;
  update public.profiles set signup_ref = p_ref where id = auth.uid() and signup_ref is null;   -- first touch only
end $$;
revoke all on function public.set_signup_ref(text) from public, anon;
grant execute on function public.set_signup_ref(text) to authenticated;
