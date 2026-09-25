-- Dividends per symbol (round 4 newcomer, an income investor: Ask said "SCHD paid $0.96 quarterly"; SCHD's last
-- was $0.2665 and $0.9555 was VTI's, and "how much income does my portfolio make" had no data to answer from).
-- Filled from Yahoo's chart events (events=div) by _shared/history.ts refreshDividends: the insights lap, Ask and
-- warmup refresh symbols whose data is older than three days. Nullable; everything runs without these columns.
alter table public.symbols add column if not exists div_last numeric;          -- last payment per share
alter table public.symbols add column if not exists div_last_ex date;          -- its ex-dividend date
alter table public.symbols add column if not exists div_ttm numeric;           -- sum of payments in the last 12 months
alter table public.symbols add column if not exists div_freq_days int;         -- median days between payments
alter table public.symbols add column if not exists div_next_ex date;          -- estimate: last ex-date + rhythm
alter table public.symbols add column if not exists div_yield numeric;         -- ttm / price, percent
alter table public.symbols add column if not exists div_as_of timestamptz;     -- when this was refreshed
