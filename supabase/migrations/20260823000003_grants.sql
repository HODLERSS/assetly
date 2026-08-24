-- API-role grants. RLS governs row visibility; these are the table-level grants the
-- PostgREST roles need at all. anon gets nothing user-facing: Assetly requires sign-in.
grant usage on schema public to anon, authenticated, service_role;

-- service role (pipelines, admin): everything
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- signed-in users: full DML on their RLS-guarded tables, read on shared market data
grant select, insert, update, delete on public.profiles, public.holdings, public.lots to authenticated;
grant select on public.symbols, public.prices, public.price_history, public.news, public.portfolio to authenticated;

-- future objects created by migrations inherit the same shape
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
