-- 8-K item numbers from EDGAR (e.g. '2.02,9.01'). Item 2.02 "Results of Operations and Financial Condition"
-- is the earnings release itself, so it dates a company's last report exactly and anchors every
-- next-earnings estimate. The old estimate ran from the newest transcript of any kind: Nvidia's Sep 10
-- Goldman Sachs conference talk became its "last call", and every brief said "profit report around
-- December 10" (it reported Aug 26; the next report is about Nov 25).
-- filings-sync writes the column when it exists and silently skips it before this migration runs;
-- the next daily lap (07:10 UTC) fills it for every filing inside the 270-day window.
alter table public.filings add column if not exists items text;
