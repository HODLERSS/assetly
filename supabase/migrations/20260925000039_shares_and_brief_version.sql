-- Round 3 (2026-09-25).
-- 1. Company size for Ask: shares outstanding from SEC filings (filings-sync, dei:EntityCommonStockSharesOutstanding,
--    else weighted diluted shares), so "TSLA is cheaper per share than AVGO, is it the better deal?" is checked
--    against market caps instead of a model inferring company value from a share price.
alter table public.symbols add column if not exists shares_outstanding numeric;
alter table public.symbols add column if not exists shares_as_of date;
-- 2. Which version of daily-brief wrote a row. A clock edition written by an older version (null = before this
--    column) is regenerated once by the next sweep for the same edition and date, so a day's pre-fix editions
--    ("Microsoft earnings call Sep 28") do not stay up until tomorrow. daily-brief writes its GEN_VERSION.
alter table public.daily_briefs add column if not exists gen_version int;
-- Both nullable; every function runs without them (reads fall back, writes retry without the column).
