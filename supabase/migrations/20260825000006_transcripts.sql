-- Earnings call transcripts: latest 4 per held company; floated into news and fed to
-- the MARA insights prompt. Fetched daily.
create table if not exists public.transcripts (
  symbol text not null references public.symbols(symbol) on delete cascade,
  url text not null,
  title text not null,
  content text not null,
  published_at timestamptz,
  fetched_at timestamptz not null default now(),
  primary key (symbol, url)
);
alter table public.transcripts enable row level security;
create policy "transcripts readable" on public.transcripts for select to authenticated using (true);
grant select on public.transcripts to authenticated, service_role;
select cron.schedule('assetly-transcripts-sync', '40 6 * * *', $$select public.invoke_edge('transcripts-sync')$$);
