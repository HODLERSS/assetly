-- A signed-in user may create a connect state row for THEMSELF (equivalent to starting a connect from the app).
-- Needed by the connect-reliability probe, which drives the real callback path without the service key.
-- The callback still validates user_id + 1h expiry server-side; the row is consumed (deleted) on first use.
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'snaptrade_oauth_states' and policyname = 'own state insert') then
    create policy "own state insert" on public.snaptrade_oauth_states for insert to authenticated with check (user_id = auth.uid());
  end if;
end $$;
