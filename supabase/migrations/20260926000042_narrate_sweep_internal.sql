-- Round 8: the 10-minute narrate sweep has returned 401 "not signed in" on every run. invoke_edge() sends the
-- PUBLISHABLE key (vault 'edge_bearer'), which is not a service role, and narrate's sweep (no user target) accepts only
-- the service role or the internal token. The sweep now carries the internal token (vault 'internal_token'), which
-- narrate already checks, so the sweep runs again without opening narrate to the public key.
create or replace function public.invoke_edge_internal(fn text)
returns void
language plpgsql
security definer
as $$
declare base text; key text; itok text;
begin
  select decrypted_secret into base from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into key  from vault.decrypted_secrets where name = 'edge_bearer';
  select decrypted_secret into itok from vault.decrypted_secrets where name = 'internal_token';
  if base is null or key is null or itok is null then return; end if;
  perform net.http_post(
    url := base || '/functions/v1/' || fn,
    headers := jsonb_build_object('Authorization', 'Bearer ' || key, 'apikey', key, 'Content-Type', 'application/json', 'x-internal-token', itok),
    body := '{}'::jsonb,
    timeout_milliseconds := 50000);
end $$;
revoke all on function public.invoke_edge_internal(text) from public, anon, authenticated;

do $$ begin
  perform cron.unschedule('assetly-narrate-backfill');
exception when others then null;
end $$;
select cron.schedule('assetly-narrate-backfill', '*/10 * * * *', $$select public.invoke_edge_internal('narrate')$$);
