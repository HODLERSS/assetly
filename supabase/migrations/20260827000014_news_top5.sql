-- Top-5 portfolio-weighted news signals (News tab, All holdings scope).
alter table public.portfolio_insights add column if not exists news5 jsonb;
