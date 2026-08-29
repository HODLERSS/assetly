-- Replace session advisory locks (they leak through the connection pooler when a request is killed)
-- with a row lease that expires on its own. try_user_lock/release_user_lock keep their names/signatures.
alter table public.snaptrade_tokens add column if not exists sync_lock_until timestamptz;
create or replace function public.try_user_lock(p_user uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare got int;
begin
  update public.snaptrade_tokens set sync_lock_until = now() + interval '3 minutes'
   where user_id = p_user and (sync_lock_until is null or sync_lock_until < now());
  get diagnostics got = row_count;
  return got > 0;
end $$;
create or replace function public.release_user_lock(p_user uuid) returns boolean
language sql security definer set search_path = public as $$
  update public.snaptrade_tokens set sync_lock_until = null where user_id = p_user returning true;
$$;
revoke all on function public.try_user_lock(uuid), public.release_user_lock(uuid) from public;
grant execute on function public.try_user_lock(uuid), public.release_user_lock(uuid) to service_role;
