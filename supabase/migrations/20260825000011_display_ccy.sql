-- Currency matrix: per-market display currency, totals stay on base_currency.
alter table public.profiles
  add column if not exists display_us text not null default 'USD' check (display_us in ('USD','KRW')),
  add column if not exists display_kr text not null default 'KRW' check (display_kr in ('USD','KRW'));
