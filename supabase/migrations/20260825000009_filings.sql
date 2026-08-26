-- SEC filings (8-K, 10-K, 10-Q, proxies): ~9 months per held US company, from EDGAR.
-- Major forms float into news; the list feeds insights and ASK.
create table if not exists public.filings (
  symbol text not null references public.symbols(symbol) on delete cascade,
  accession text not null,
  form text not null,
  title text not null,
  filed_at date not null,
  url text not null,
  fetched_at timestamptz not null default now(),
  primary key (symbol, accession)
);
create index if not exists filings_symbol_time on public.filings (symbol, filed_at desc);
alter table public.filings enable row level security;
create policy "filings readable" on public.filings for select to authenticated using (true);
grant select on public.filings to authenticated, service_role;
select cron.schedule('assetly-filings-sync', '10 7 * * *', $$select public.invoke_edge('filings-sync')$$);
