-- per-user advisory lock so concurrent sync triggers (callback + webhooks) serialize instead of racing
create or replace function public.try_user_lock(p_user uuid) returns boolean
language sql security definer set search_path = public as $$
  select pg_try_advisory_lock(hashtext('snaptrade-sync:' || p_user::text));
$$;
create or replace function public.release_user_lock(p_user uuid) returns boolean
language sql security definer set search_path = public as $$
  select pg_advisory_unlock(hashtext('snaptrade-sync:' || p_user::text));
$$;
revoke all on function public.try_user_lock(uuid), public.release_user_lock(uuid) from public;
grant execute on function public.try_user_lock(uuid), public.release_user_lock(uuid) to service_role;
