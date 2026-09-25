-- ONE-OFF CLEANUP of public.news rows stored before news-sync's ingest gate (2026-09-25). Idempotent: every
-- statement is safe to re-run, and each only narrows or corrects what the gate would have refused anyway.
-- Rows written by filings-sync ('SEC Filing') and transcripts-sync ('Earnings Call') are never touched: their
-- titles repeat across companies by design ("8-K filed: 8-K"). Off-topic rows are NOT deleted here: SQL cannot
-- apply the alias and lead rules, so every reader applies them at read time instead (_shared/news_rules.ts
-- usableNews in the functions, web/src/lib/news.ts in the News tab).
--
-- PREVIEW FIRST (read-only; run in the SQL editor and sanity-check the counts before applying):
--   with n as (select * from public.news where source not in ('SEC Filing', 'Earnings Call')),
--   keyed as (select id, fetched_at, coalesce(published_at, fetched_at) as at, btrim(regexp_replace(lower(title), '[^a-z0-9가-힣]+', ' ', 'g')) as k from n)
--   select
--     (select count(*) from n where title ~ '&(amp|quot|apos|lt|gt|nbsp|hellip|mdash|ndash|lsquo|rsquo|ldquo|rdquo|#[0-9]+|#x[0-9a-fA-F]+);') as step1_encoded_titles,
--     (select count(*) from n where
--          title ~* '(historical prices|price history|option(s)? chain|options? prices?|stock price,? (news|quote|chart)|stock price\s*[|:-]\s*(quotes?|news|chart)|quotes? (&|and) (history|news|chart)|stock quote|real-?time quote|stock price today|live stock price|interactive stock chart)'
--       or title ~* '(call|put)s?\M[^.]{0,40}\m[0-9]{1,5}\.[0-9]{3}\M' or title ~* '\m[0-9]{1,5}\.[0-9]{3}\s+(call|put)\M'
--       or title ~ '\m[A-Z]{1,6}[0-9]{6}[CP][0-9]{6,8}\M'
--       or url ~* '(/quote/|/options?([/?#]|$)|option-?chain|historical-?(prices|data)|/history([/?#]|$))'
--       or url ~* '(moomoo\.com|futunn\.com|stocktwits\.com/[^/]+/message/|reddit\.com|//(www\.)?(x|twitter)\.com/|threads\.net|facebook\.com|tiktok\.com|youtube\.com/shorts)'
--       or source ~* '^(moomoo|moomoo\.com|futu|futubull|webull community|reddit|pluang)$'
--       or title ~ '^\s*\$[^$]{1,60}\([A-Z0-9.]{1,12}\)\$') as step2_junk_rows,
--     (select count(*) from keyed a where length(a.k) >= 12 and exists (select 1 from keyed b where b.k = a.k
--         and (b.at, b.fetched_at, b.id) < (a.at, a.fetched_at, a.id) and abs(extract(epoch from a.at - b.at)) <= 3 * 86400)) as step3_duplicate_rows,
--     (select count(*) from n where source in ('Yahoo Finance', 'Yahoo') and url !~* '^https?://([a-z0-9-]+\.)*yahoo\.com' and url ~* '^https?://') as step4_bylines;
-- Production on 2026-09-25 17:30 UTC (28,569 rows): 1,528 encoded titles, 711 junk rows, 7,439 duplicates within
-- three days, 11,219 Yahoo bylines to correct. Every junk row sampled was an option-chain or price-history page.

-- 1. HTML entities in titles ("&amp;" reached the reader). Three passes, for double- and triple-encoded titles.
do $$
begin
  for i in 1..3 loop
    update public.news set title =
      replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(title,
        '&amp;', '&'), '&quot;', '"'), '&#39;', ''''), '&#x27;', ''''), '&apos;', ''''), '&lt;', '<'), '&gt;', '>'), '&nbsp;', ' '),
        '&#8217;', '’'), '&#x2019;', '’'), '&#8216;', '‘'), '&#x2018;', '‘'), '&#8220;', '“'), '&#8221;', '”'), '&hellip;', '…'), '&mdash;', '—'), '&ndash;', '–'), '&rsquo;', '’')
    where source not in ('SEC Filing', 'Earnings Call')
      and title ~ '&(amp|quot|apos|lt|gt|nbsp|hellip|mdash|ndash|rsquo|#39|#x27|#8217|#x2019|#8216|#x2018|#8220|#8221);';
  end loop;
end $$;

-- 2. Quote pages, option chains, price listings and single-user social posts are not news (the same rules as
--    news_rules.ts isJunkNews).
delete from public.news
where source not in ('SEC Filing', 'Earnings Call')
  and (
    title ~* '(historical prices|price history|option(s)? chain|options? prices?|stock price,? (news|quote|chart)|stock price\s*[|:-]\s*(quotes?|news|chart)|quotes? (&|and) (history|news|chart)|stock quote|real-?time quote|stock price today|live stock price|interactive stock chart)'
    or title ~* '(call|put)s?\M[^.]{0,40}\m[0-9]{1,5}\.[0-9]{3}\M'
    or title ~* '\m[0-9]{1,5}\.[0-9]{3}\s+(call|put)\M'
    or title ~ '\m[A-Z]{1,6}[0-9]{6}[CP][0-9]{6,8}\M'                                   -- an OCC option symbol
    or url ~* '(/quote/|/options?([/?#]|$)|option-?chain|historical-?(prices|data)|/history([/?#]|$))'
    or url ~* '(moomoo\.com|futunn\.com|stocktwits\.com/[^/]+/message/|reddit\.com|//(www\.)?(x|twitter)\.com/|threads\.net|facebook\.com|tiktok\.com|youtube\.com/shorts)'
    -- Moomoo's byline is user posts ("$Broadcom (AVGO.US)$ Shorted 32 shares ...") and option chains; Stocktwits
    -- runs a real newsroom and stays
    or source ~* '^(moomoo|moomoo\.com|futu|futubull|webull community|reddit|pluang)$'
    or title ~ '^\s*\$[^$]{1,60}\([A-Z0-9.]{1,12}\)\$'
  );

-- 3. One row per story: the same headline stored under several URLs or tickers within three days keeps its
--    EARLIEST row. The window matters: a recurring column title ("Stock Market Today ...") on different days is
--    a different story. (news-sync now also refuses a title already stored under any symbol.)
with keyed as (
  select id, fetched_at, coalesce(published_at, fetched_at) as at,
         btrim(regexp_replace(lower(title), '[^a-z0-9가-힣]+', ' ', 'g')) as k
  from public.news
  where source not in ('SEC Filing', 'Earnings Call')
)
delete from public.news n
using keyed a
where n.id = a.id
  and length(a.k) >= 12
  and exists (
    select 1 from keyed b
    where b.k = a.k
      and (b.at, b.fetched_at, b.id) < (a.at, a.fetched_at, a.id)
      and abs(extract(epoch from a.at - b.at)) <= 3 * 86400
  );

-- 4. The byline is the real publisher: a Yahoo feed item that links to fool.com is The Motley Fool; one we have
--    no name for shows its domain (the same map as news_rules.ts publisherFor).
update public.news set source = case
    when url ~* '^https?://([a-z0-9-]+\.)*thestreet\.com' then 'TheStreet'
    when url ~* '^https?://([a-z0-9-]+\.)*fool\.com' then 'The Motley Fool'
    when url ~* '^https?://([a-z0-9-]+\.)*247wallst\.com' then '24/7 Wall St.'
    when url ~* '^https?://([a-z0-9-]+\.)*supplychaindive\.com' then 'Supply Chain Dive'
    when url ~* '^https?://([a-z0-9-]+\.)*manufacturingdive\.com' then 'Manufacturing Dive'
    when url ~* '^https?://([a-z0-9-]+\.)*trefis\.com' then 'Trefis'
    when url ~* '^https?://([a-z0-9-]+\.)*cryptoprowl\.com' then 'CryptoProwl'
    when url ~* '^https?://([a-z0-9-]+\.)*barchart\.com' then 'Barchart'
    when url ~* '^https?://([a-z0-9-]+\.)*marketbeat\.com' then 'MarketBeat'
    when url ~* '^https?://([a-z0-9-]+\.)*morningstar\.com' then 'Morningstar'
    when url ~* '^https?://([a-z0-9-]+\.)*nasdaq\.com' then 'Nasdaq'
    when url ~* '^https?://([a-z0-9-]+\.)*tipranks\.com' then 'TipRanks'
    when url ~* '^https?://([a-z0-9-]+\.)*simplywall\.st' then 'Simply Wall St'
    when url ~* '^https?://([a-z0-9-]+\.)*reuters\.com' then 'Reuters'
    when url ~* '^https?://([a-z0-9-]+\.)*bloomberg\.com' then 'Bloomberg'
    when url ~* '^https?://([a-z0-9-]+\.)*cnbc\.com' then 'CNBC'
    when url ~* '^https?://([a-z0-9-]+\.)*wsj\.com' then 'WSJ'
    when url ~* '^https?://([a-z0-9-]+\.)*barrons\.com' then 'Barron''s'
    when url ~* '^https?://([a-z0-9-]+\.)*marketwatch\.com' then 'MarketWatch'
    when url ~* '^https?://([a-z0-9-]+\.)*investors\.com' then 'Investor''s Business Daily'
    when url ~* '^https?://([a-z0-9-]+\.)*benzinga\.com' then 'Benzinga'
    when url ~* '^https?://([a-z0-9-]+\.)*zacks\.com' then 'Zacks'
    when url ~* '^https?://([a-z0-9-]+\.)*seekingalpha\.com' then 'Seeking Alpha'
    when url ~* '^https?://([a-z0-9-]+\.)*insidermonkey\.com' then 'Insider Monkey'
    when url ~* '^https?://([a-z0-9-]+\.)*gurufocus\.com' then 'GuruFocus'
    when url ~* '^https?://([a-z0-9-]+\.)*investing\.com' then 'Investing.com'
    when url ~* '^https?://([a-z0-9-]+\.)*forbes\.com' then 'Forbes'
    when url ~* '^https?://([a-z0-9-]+\.)*businessinsider\.com' then 'Business Insider'
    else substring(url from '^https?://(?:www\.)?([^/]+)')
  end
where source in ('Yahoo Finance', 'Yahoo')
  and url !~* '^https?://([a-z0-9-]+\.)*yahoo\.com'
  and substring(url from '^https?://(?:www\.)?([^/]+)') is not null;
