-- Assetly core schema. User data is RLS-isolated; market data is shared read-only.
create extension if not exists pgcrypto;

-- ---------- profiles ----------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  base_currency text not null default 'USD' check (base_currency in ('USD','KRW')),
  markets text[] not null default '{US}',
  onboarded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy "own profile read"  on public.profiles for select using (auth.uid() = id);
create policy "own profile write" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'user_name', split_part(new.email,'@',1)));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- symbols (shared catalog) ----------
create table public.symbols (
  symbol text primary key,
  name text not null,
  exchange text not null default 'NASDAQ',
  currency text not null default 'USD' check (currency in ('USD','KRW')),
  kind text not null default 'equity' check (kind in ('equity','etf','fund','crypto')),
  yahoo text,                        -- yahoo quote symbol when it differs (e.g. 005935.KS, BTC-USD)
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.symbols enable row level security;
create policy "symbols readable" on public.symbols for select to authenticated using (true);

-- ---------- holdings & lots ----------
create table public.holdings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  symbol text not null references public.symbols(symbol),
  nickname text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, symbol)
);
alter table public.holdings enable row level security;
create policy "own holdings" on public.holdings for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table public.lots (
  id uuid primary key default gen_random_uuid(),
  holding_id uuid not null references public.holdings(id) on delete cascade,
  qty numeric(20,8) not null check (qty > 0),
  cost_per_share numeric(20,8) not null check (cost_per_share >= 0),
  acquired_on date,
  note text,
  created_at timestamptz not null default now()
);
alter table public.lots enable row level security;
create policy "own lots" on public.lots for all
  using (exists (select 1 from public.holdings h where h.id = holding_id and h.user_id = auth.uid()))
  with check (exists (select 1 from public.holdings h where h.id = holding_id and h.user_id = auth.uid()));

-- ---------- prices (current quote per symbol; service-role writes only) ----------
create table public.prices (
  symbol text primary key references public.symbols(symbol) on delete cascade,
  price numeric(20,8) not null check (price > 0),
  prev_close numeric(20,8),
  change_pct numeric(12,6),
  currency text not null default 'USD',
  market_state text not null default 'unknown',
  as_of timestamptz not null,
  source text not null,
  updated_at timestamptz not null default now()
);
alter table public.prices enable row level security;
create policy "prices readable" on public.prices for select to authenticated using (true);

create table public.price_history (
  symbol text not null references public.symbols(symbol) on delete cascade,
  ts timestamptz not null,
  price numeric(20,8) not null,
  primary key (symbol, ts)
);
alter table public.price_history enable row level security;
create policy "history readable" on public.price_history for select to authenticated using (true);

-- ---------- news (service-role writes only) ----------
create table public.news (
  id uuid primary key default gen_random_uuid(),
  symbol text not null references public.symbols(symbol) on delete cascade,
  title text not null,
  url text not null,
  source text not null,
  published_at timestamptz,
  summary text,
  importance smallint check (importance between 1 and 5),
  fetched_at timestamptz not null default now(),
  unique (symbol, url)
);
alter table public.news enable row level security;
create policy "news readable" on public.news for select to authenticated using (true);
create index news_symbol_time on public.news (symbol, published_at desc);

-- ---------- updated_at maintenance ----------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger touch_profiles before update on public.profiles for each row execute function public.touch_updated_at();
create trigger touch_holdings before update on public.holdings for each row execute function public.touch_updated_at();

-- ---------- portfolio view (per-user derived numbers; RLS of base tables applies) ----------
create view public.portfolio as
  select h.user_id, h.id as holding_id, h.symbol, s.name, s.currency, s.kind,
         sum(l.qty) as qty,
         sum(l.qty * l.cost_per_share) as cost_basis,
         case when sum(l.qty) > 0 then sum(l.qty * l.cost_per_share) / sum(l.qty) end as avg_cost,
         p.price, p.change_pct, p.as_of,
         sum(l.qty) * p.price as value,
         sum(l.qty) * p.price - sum(l.qty * l.cost_per_share) as total_gl
  from public.holdings h
  join public.symbols s using (symbol)
  left join public.lots l on l.holding_id = h.id
  left join public.prices p on p.symbol = h.symbol
  group by h.user_id, h.id, h.symbol, s.name, s.currency, s.kind, p.price, p.change_pct, p.as_of;
alter view public.portfolio set (security_invoker = true);

-- ---------- seed catalog ----------
insert into public.symbols (symbol, name, exchange, currency, kind, yahoo) values
 ('MARA','MARA Holdings','NASDAQ','USD','equity','MARA'),
 ('RDDT','Reddit','NYSE','USD','equity','RDDT'),
 ('AMD','Advanced Micro Devices','NASDAQ','USD','equity','AMD'),
 ('META','Meta Platforms','NASDAQ','USD','equity','META'),
 ('NVDA','NVIDIA','NASDAQ','USD','equity','NVDA'),
 ('AAPL','Apple','NASDAQ','USD','equity','AAPL'),
 ('INTC','Intel','NASDAQ','USD','equity','INTC'),
 ('ARM','Arm Holdings','NASDAQ','USD','equity','ARM'),
 ('MSTR','Strategy','NASDAQ','USD','equity','MSTR'),
 ('BRK.B','Berkshire Hathaway B','NYSE','USD','equity','BRK-B'),
 ('005930.KS','삼성전자','KRX','KRW','equity','005930.KS'),
 ('005935.KS','삼성전자우','KRX','KRW','equity','005935.KS'),
 ('000660.KS','SK하이닉스','KRX','KRW','equity','000660.KS'),
 ('BTC','Bitcoin','CRYPTO','USD','crypto','BTC-USD'),
 ('ETH','Ethereum','CRYPTO','USD','crypto','ETH-USD'),
 ('FXAIX','Fidelity 500 Index','MUTF','USD','fund','FXAIX'),
 ('QQQM','Invesco Nasdaq 100','NASDAQ','USD','etf','QQQM');
