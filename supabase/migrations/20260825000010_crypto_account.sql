alter table public.holdings drop constraint if exists holdings_account_check;
alter table public.holdings add constraint holdings_account_check
  check (account in ('brokerage','bank','401k','ira','crypto'));
