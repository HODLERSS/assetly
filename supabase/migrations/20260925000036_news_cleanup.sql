-- ONE-OFF CLEANUP of public.news rows stored before news-sync's ingest gate (2026-09-25). Idempotent: every
-- statement is safe to re-run. Rows written by filings-sync ('SEC Filing') and transcripts-sync
-- ('Earnings Call') are never touched: their titles repeat across companies by design ("8-K filed: 8-K").
-- Preview counts first (read-only), then run the body:
--   select count(*) filter (where title ~ '&(amp|quot|apos|lt|gt|nbsp|#[0-9]+|#x[0-9a-f]+);') as encoded,
--          count(*) filter (where title ~* '(historical prices|option(s)? chain|stock price,? (news|quote|chart)|quote (&|and) (history|news|chart))'
--                              or url ~* '(/quote/|option-?chain|historical-?(prices|data)|moomoo\.com|stocktwits\.com/[^/]+/message/|reddit\.com)'
--                              or source ~* '^(moomoo|moomoo\.com|futu|futubull)$') as junk
--   from public.news where source not in ('SEC Filing', 'Earnings Call');

-- 1. HTML entities in titles ("&amp;" reached the reader). Twice, for double-encoded titles ("&amp;amp;").
do $$
begin
  for i in 1..2 loop
    update public.news set title =
      replace(replace(replace(replace(replace(replace(replace(replace(replace(title,
        '&amp;', '&'), '&quot;', '"'), '&#39;', ''''), '&#x27;', ''''), '&apos;', ''''), '&lt;', '<'), '&gt;', '>'), '&nbsp;', ' '), '&#8217;', '’')
    where source not in ('SEC Filing', 'Earnings Call')
      and title ~ '&(amp|quot|apos|lt|gt|nbsp|#39|#x27|#8217);';
  end loop;
end $$;

-- 2. Quote pages, option chains, price listings and single-user social posts are not news.
delete from public.news
where source not in ('SEC Filing', 'Earnings Call')
  and (
    title ~* '(historical prices|price history|option(s)? chain|options? prices?|stock price,? (news|quote|chart)|quote (&|and) (history|news|chart)|stock quote|real-?time quote|stock price today|live stock price)'
    or title ~* '(call|put)s?\M[^.]{0,40}\m[0-9]{1,5}\.[0-9]{3}\M'
    or url ~* '(/quote/|/options?([/?#]|$)|option-?chain|historical-?(prices|data)|/history([/?#]|$))'
    or url ~* '(moomoo\.com|futunn\.com|stocktwits\.com/[^/]+/message/|reddit\.com|//(www\.)?(x|twitter)\.com/|threads\.net|facebook\.com|tiktok\.com)'
    -- Moomoo's byline is user posts ("$Broadcom (AVGO.US)$ Shorted 32 shares ...") and option chains; Stocktwits
    -- runs a real newsroom and stays
    or source ~* '^(moomoo|moomoo\.com|futu|futubull|reddit)$'
    or title ~ '^\s*\$[^$]{1,60}\([A-Z0-9.]{1,12}\)\$'
  );

-- 3. One row per story: the same headline stored under several URLs or tickers keeps its EARLIEST row.
--    (news-sync now also refuses a title already stored under any symbol.)
with keyed as (
  select id, symbol,
         btrim(regexp_replace(lower(title), '[^a-z0-9가-힣]+', ' ', 'g')) as k,
         row_number() over (
           partition by btrim(regexp_replace(lower(title), '[^a-z0-9가-힣]+', ' ', 'g'))
           order by published_at asc nulls last, fetched_at asc, id
         ) as rn
  from public.news
  where source not in ('SEC Filing', 'Earnings Call')
)
delete from public.news n using keyed
where n.id = keyed.id and keyed.rn > 1 and length(keyed.k) >= 12;

-- 4. The byline is the real publisher: a Yahoo feed item that links to thestreet.com is TheStreet.
update public.news set source = case
    when url ~* '^https?://([a-z0-9-]+\.)*thestreet\.com' then 'TheStreet'
    when url ~* '^https?://([a-z0-9-]+\.)*fool\.com' then 'Motley Fool'
    when url ~* '^https?://([a-z0-9-]+\.)*247wallst\.com' then '24/7 Wall St.'
    when url ~* '^https?://([a-z0-9-]+\.)*supplychaindive\.com' then 'Supply Chain Dive'
    when url ~* '^https?://([a-z0-9-]+\.)*reuters\.com' then 'Reuters'
    when url ~* '^https?://([a-z0-9-]+\.)*bloomberg\.com' then 'Bloomberg'
    when url ~* '^https?://([a-z0-9-]+\.)*cnbc\.com' then 'CNBC'
    when url ~* '^https?://([a-z0-9-]+\.)*barrons\.com' then 'Barron''s'
    when url ~* '^https?://([a-z0-9-]+\.)*marketwatch\.com' then 'MarketWatch'
    when url ~* '^https?://([a-z0-9-]+\.)*investors\.com' then 'Investor''s Business Daily'
    when url ~* '^https?://([a-z0-9-]+\.)*benzinga\.com' then 'Benzinga'
    when url ~* '^https?://([a-z0-9-]+\.)*zacks\.com' then 'Zacks'
    when url ~* '^https?://([a-z0-9-]+\.)*insidermonkey\.com' then 'Insider Monkey'
    when url ~* '^https?://([a-z0-9-]+\.)*gurufocus\.com' then 'GuruFocus'
    when url ~* '^https?://([a-z0-9-]+\.)*investing\.com' then 'Investing.com'
    else substring(url from '^https?://(?:www\.)?([^/]+)')
  end
where source = 'Yahoo Finance'
  and url !~* '^https?://([a-z0-9-]+\.)*yahoo\.com'
  and substring(url from '^https?://(?:www\.)?([^/]+)') is not null;

-- 5. OPTIONAL, review before running: headlines from the last 30 days whose title names neither the ticker
--    nor the first word of the company name ("Is Ford Stock a Buy for Its Dividend?" under NVDA). This is a
--    coarser test than news-sync's gate (no brand aliases, no lead check), so preview it and delete by hand:
--   select n.symbol, s.name, n.source, n.title
--   from public.news n join public.symbols s on s.symbol = n.symbol
--   where n.source not in ('SEC Filing', 'Earnings Call', 'K-News') and n.published_at > now() - interval '30 days'
--     and n.title !~* ('\m' || regexp_replace(split_part(n.symbol, '.', 1), '[^A-Za-z0-9]', '', 'g') || '\M')
--     and n.title !~* ('\m' || split_part(regexp_replace(s.name, '[^A-Za-z0-9 ]', ' ', 'g'), ' ', 1) || '\M')
--   order by n.symbol, n.published_at desc;
