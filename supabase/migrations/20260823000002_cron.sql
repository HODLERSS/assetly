-- Production schedules: price-sync every minute, news-sync every 15 minutes.
-- Uses pg_cron + pg_net calling the deployed edge functions. The gateway verifies the
-- anon/publishable key, so the PUBLIC publishable key is the bearer — no privileged secret is
-- stored anywhere; functions use their platform-injected service key internally:
--   select vault.create_secret('https://<ref>.supabase.co', 'project_url');
--   select vault.create_secret('<sb_publishable_key>', 'edge_bearer');
-- Locally (supabase start) pg_cron is available but the jobs are no-ops until the two
-- vault secrets exist; tests invoke the functions directly instead.
create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.invoke_edge(fn text) returns void
language plpgsql security definer as $$
declare base text; key text;
begin
  select decrypted_secret into base from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into key  from vault.decrypted_secrets where name = 'edge_bearer';
  if base is null or key is null then return; end if;   -- not configured yet: no-op
  perform net.http_post(
    url := base || '/functions/v1/' || fn,
    headers := jsonb_build_object('Authorization', 'Bearer ' || key, 'apikey', key, 'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 50000);
end $$;
revoke all on function public.invoke_edge(text) from public, anon, authenticated;

select cron.schedule('assetly-price-sync', '* * * * *',    $$select public.invoke_edge('price-sync')$$);
select cron.schedule('assetly-news-sync',  '*/15 * * * *', $$select public.invoke_edge('news-sync')$$);
