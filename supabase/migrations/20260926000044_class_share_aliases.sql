-- Round 9 newcomer (not applied): one listing, one symbol. "BRKB" was registered beside "BRK.B" (both Yahoo BRK-B), ranked
-- first in search as "Berkshire Hathaway Inc. -", carried its own (wrong) price row and a 26-day-old card with a
-- valuation verdict. A class share written without its dot, or with Yahoo's dash, is the same listing as the dotted form.
--
-- 1. Holdings on an alias move to the canonical symbol, unless that user already holds the canonical one in the same
--    account under the same nickname (then the alias row stays, still priced; merge by hand). Lots follow the holding
--    (they reference holding_id).
-- 2. The alias symbol is deactivated (out of search and the price loop), its price row and its cards removed.
-- Prod today: one holding (user 25a9c12f…, BRKB ×20 in brokerage), no conflict.
with alias as (
  select s.symbol as alias, regexp_replace(s.yahoo, '^([A-Z]{1,4})-([A-Z])$', '\1.\2') as canon
  from public.symbols s
  where s.yahoo ~ '^[A-Z]{1,4}-[A-Z]$'
    and s.symbol <> regexp_replace(s.yahoo, '^([A-Z]{1,4})-([A-Z])$', '\1.\2')
    and exists (select 1 from public.symbols c where c.symbol = regexp_replace(s.yahoo, '^([A-Z]{1,4})-([A-Z])$', '\1.\2'))
)
update public.holdings h set symbol = a.canon
from alias a
where h.symbol = a.alias
  and not exists (
    select 1 from public.holdings x
    where x.user_id = h.user_id and x.symbol = a.canon and x.account = h.account and coalesce(x.nickname, '') = coalesce(h.nickname, '')
  );

with alias as (
  select s.symbol as alias
  from public.symbols s
  where s.yahoo ~ '^[A-Z]{1,4}-[A-Z]$'
    and s.symbol <> regexp_replace(s.yahoo, '^([A-Z]{1,4})-([A-Z])$', '\1.\2')
    and exists (select 1 from public.symbols c where c.symbol = regexp_replace(s.yahoo, '^([A-Z]{1,4})-([A-Z])$', '\1.\2'))
    and not exists (select 1 from public.holdings h where h.symbol = s.symbol)
)
update public.symbols s set active = false from alias a where s.symbol = a.alias;

delete from public.insights i using public.symbols s
where i.symbol = s.symbol and s.active = false and s.yahoo ~ '^[A-Z]{1,4}-[A-Z]$';
delete from public.prices p using public.symbols s
where p.symbol = s.symbol and s.active = false and s.yahoo ~ '^[A-Z]{1,4}-[A-Z]$';
