-- Which holdings each portfolio-intelligence bullet is about, and the book it was written against.
-- Round-2 audit (2026-09-25): the card led with "Pepsi near yearly lows" and "Ford halted F-150 production"
-- four minutes after PEP and F were removed. insights-sync now drops a bullet naming a symbol that left the
-- book while it was writing, and stores these so the client can hide a bullet about a holding removed since:
--   bullet_symbols  jsonb   string[][] parallel to bullets   (e.g. [["PEP","F"],["AAPL"],[]])
--   news5_symbols   jsonb   string[][] parallel to news5
--   held_symbols    text[]  the book's non-cash symbols when the row was written
-- Nullable; rows written before this migration (or by an older function) have none of them.
alter table public.portfolio_insights add column if not exists bullet_symbols jsonb;
alter table public.portfolio_insights add column if not exists news5_symbols jsonb;
alter table public.portfolio_insights add column if not exists held_symbols text[];
