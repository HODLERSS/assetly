// Run: npx -y deno@2 test supabase/functions/_shared/
// Every case here is a failure seen in production (audit 2026-09-25) or its near miss.
import { assert, assertEquals, assertFalse, assertStringIncludes } from "jsr:@std/assert@1";
import {
  adviceHits, aliasesFor, booksKorean, centrality, cleanFollowups, decodeEntities, deDirect, dedupePhrases, earningsLine, fixPriceConfusions, liveNotYesterday,
  isEarningsCallTitle, isJunkNews, isTradeFollowup, isTradeQuestion, lastEarnings, newsRelevant, nextEarningsEstimate, partOfMonth,
  pctOver, pctText, plainScrub, priceConfusions, publisherFor, stripAdvice, titleKey, withNoCallLine,
} from "./intel.ts";
import { parseYahooDaily } from "./history.ts";
import { dayTag } from "./calendar.ts";

const NOW = Date.parse("2026-09-25T15:00:00Z");
const day = (n: number) => new Date(NOW - n * 86400000).toISOString();

Deno.test("pctOver: 7 days of history gives a 1W figure and NO 1M figure (TSLA 3.7% twice)", () => {
  const h = [{ ts: day(7.2), price: 100 }, { ts: day(3), price: 101 }, { ts: day(0), price: 103.7 }];
  assertEquals(pctOver(h, 7, NOW)?.toFixed(1), "3.7");
  assertEquals(pctOver(h, 30, NOW), null);
  assertEquals(pctText(pctOver(h, 30, NOW)), "not enough price history yet");
});
Deno.test("pctOver: the base is the price AS OF the window start, not the first point after it", () => {
  const h = [{ ts: day(40), price: 50 }, { ts: day(31), price: 80 }, { ts: day(29), price: 90 }, { ts: day(0), price: 100 }];
  assertEquals(pctOver(h, 30, NOW)?.toFixed(1), "25.0");   // from 80 (day -31), never 90 (day -29)
});
Deno.test("pctOver: no price on or before the window's start means no figure; a 3-week gap does not resolve", () => {
  assertEquals(pctOver([{ ts: day(5), price: 100 }, { ts: day(0), price: 110 }], 7, NOW), null);   // never a later base (round 2)
  assertEquals(pctOver([{ ts: day(8), price: 100 }, { ts: day(0), price: 110 }], 7, NOW)?.toFixed(1), "10.0");
  assertEquals(pctOver([{ ts: day(9), price: 100 }, { ts: day(0), price: 110 }], 30, NOW), null);
  assertEquals(pctOver([{ ts: day(0), price: 110 }], 7, NOW), null);
});

Deno.test("earnings: a conference talk is not an earnings call", () => {
  assertFalse(isEarningsCallTitle("NVIDIA Corporation (NVDA) Presents at Goldman Sachs Communacopia + Technology Conference 2026 Transcript"));
  assert(isEarningsCallTitle("NVIDIA Corporation (NVDA) Q2 2027 Earnings Call Transcript"));
  assert(isEarningsCallTitle("Apple Inc. (AAPL) Q3 2026 Earnings Conference Call Transcript"));
});
Deno.test("earnings: NVDA last reported Aug 26 (8-K + 10-Q), next ~Nov 25, never Dec 10", () => {
  const filings = [
    { form: "8-K", filed_at: "2026-09-03" }, { form: "10-Q", filed_at: "2026-08-26" }, { form: "8-K", filed_at: "2026-08-26" },
    { form: "8-K", filed_at: "2026-08-17" }, { form: "10-Q", filed_at: "2026-05-20" }, { form: "8-K", filed_at: "2026-05-20" },
  ];
  const tr = [{ title: "NVIDIA Corporation (NVDA) Presents at Goldman Sachs Communacopia + Technology Conference 2026 Transcript", published_at: "2026-09-10T20:57:07Z" }];
  assertEquals(lastEarnings(filings, tr, "2026-09-25"), { date: "2026-08-26", source: "8-K with 10-Q/10-K" });
  assertEquals(nextEarningsEstimate("2026-08-26", "2026-09-25"), { est: "2026-11-25", due: false });
  const line = earningsLine("Nvidia", filings, tr, "2026-09-25")!;
  assertStringIncludes(line, "last reported Aug 26");
  assertStringIncludes(line, "late November");
  assertStringIncludes(line, "~Nov 25 (est");
});
Deno.test("earnings: item 2.02 wins; a call transcript for the same quarter defers to the filing", () => {
  const filings = [{ form: "8-K", filed_at: "2026-07-29", items: "2.02,9.01" }, { form: "10-K", filed_at: "2026-07-29" }, { form: "8-K", filed_at: "2026-08-10", items: "5.02" }];
  const tr = [{ title: "Microsoft (MSFT) Q4 2026 Earnings Call Transcript", published_at: "2026-07-30T01:00:00Z" }];
  assertEquals(lastEarnings(filings, tr, "2026-09-25")?.date, "2026-07-29");
  assertEquals(lastEarnings([], tr, "2026-09-25"), { date: "2026-07-30", source: "earnings call" });
  assertEquals(lastEarnings([{ form: "8-K", filed_at: "2026-09-03" }], [], "2026-09-25"), null);   // a lone 8-K proves nothing
});
Deno.test("earnings: a report just overdue is 'due', not a quarter away", () => {
  assertEquals(nextEarningsEstimate("2026-05-20", "2026-08-24").due, true);
  assertEquals(nextEarningsEstimate("2026-02-25", "2026-09-25"), { est: "2026-11-25", due: false });
  assertEquals(partOfMonth("2026-11-05"), "early November");
});

Deno.test("advice: the audit's verdicts are caught", () => {
  for (const s of [
    "**Verdict: hold**, and revisit after the next earnings report.",
    "**Add to NVDA next.** Your $120K cash sits idle.",
    "Skip AVGO and AMZN for now.",
    "In your 401k, swap QQQM to an international or bond fund.",
    "You should trim your winners before earnings.",
    "I'd hold through the print.",
    "NVDA is a strong buy here.",
    "• Sell half of TSLA.",
  ]) assert(adviceHits(s).length > 0, s);
});
Deno.test("advice: information and scenarios are not instructions", () => {
  for (const s of [
    "A sell case would rest on data-center growth slowing below 30%.",
    "Buy ratings dominate: 45 of 50 analysts.",
    "Holding NVDA through earnings means riding a 6% implied move.",
    "Adding to it would lift its weight to 25% of assets.",
    "Keep in mind the lockup expires in November.",
    "Increase in capex is the main risk.",
    "The bull case: Blackwell demand outruns supply into 2027.",
  ]) assertEquals(adviceHits(s), [], s);
});
Deno.test("advice: stripAdvice deletes only the offending sentence", () => {
  assertEquals(stripAdvice("• NVDA is 19% of assets.\n• **Add to NVDA next.** Your cash sits idle."), "• NVDA is 19% of assets.\n• Your cash sits idle.");
});
Deno.test("trade questions get one short no-call line, once", () => {
  assert(isTradeQuestion("should I sell NVDA"));
  assert(isTradeQuestion("Is now a good time to buy Meta?"));
  assert(isTradeQuestion("How much NVDA should I buy with the cash?"));
  assert(isTradeQuestion("엔비디아 팔아야 할까?"));
  assertFalse(isTradeQuestion("why did NVDA drop today?"));
  const a = withNoCallLine("• Data-center demand is the swing factor.", "should I sell NVDA");
  assert(a.startsWith("I can't tell you whether to trade it"));
  assertEquals(withNoCallLine(a, "should I sell NVDA"), a);
  assertEquals(withNoCallLine("• x", "why did it drop"), "• x");
});
Deno.test("follow-ups: never 'should I buy/sell/add'", () => {
  for (const f of ["Should I add to Meta on this dip?", "How much NVDA should I buy with the cash?", "Which holding should I add to next?", "Should I trim my winners?", "Is it time to sell TSLA?"]) assert(isTradeFollowup(f), f);
  for (const f of ["Why did Meta jump this month?", "What would change the NVDA outlook?", "How concentrated is my book?"]) assertFalse(isTradeFollowup(f), f);
  assertEquals(cleanFollowups(["Should I add to Meta on this dip?", "Why did Meta jump this month?"], ["What drives NVDA next", "Why did Meta jump this month?"]),
    ["Why did Meta jump this month?", "What drives NVDA next?"]);
});

const POS = [
  { names: ["TSLA", "Tesla"], price: 377.94, value: 264526 },
  { names: ["NVDA", "Nvidia"], price: 224.47, value: 112.24 },
];
Deno.test("price vs position value: both audit cases are flagged and corrected", () => {
  const a = "TSLA closed yesterday near $264,526, up 1.6% on the week.";
  assertEquals(priceConfusions(a, POS).length, 1);
  assertEquals(fixPriceConfusions(a, POS), "TSLA closed yesterday near $377.94, up 1.6% on the week.");
  assertEquals(fixPriceConfusions("NVDA sits near $112, flat so far.", POS), "NVDA sits near $224.47, flat so far.");
});
Deno.test("price vs position value: a position quoted as a position is left alone", () => {
  assertEquals(priceConfusions("Your NVDA stake is worth $112 today.", POS), []);
  assertEquals(priceConfusions("Tesla closed at $377.94.", POS), []);
  assertEquals(priceConfusions("Your Tesla position at $264,526 is 7% of assets.", POS), []);
});

Deno.test("won only for books with something Korean", () => {
  assertFalse(booksKorean([{ symbol: "NVDA", currency: "USD" }, { symbol: "$CASH", currency: "USD" }]));
  assert(booksKorean([{ symbol: "005930.KS", currency: "KRW" }]));
  assert(booksKorean([{ symbol: "$CASH.KRW", currency: "KRW" }]));
});

const MAP: [RegExp, string][] = [[/\bVIX\b/g, "the market's fear gauge"], [/\bP\/E\b/g, "price-to-earnings ratio"], [/\b(net interest margin)\b/gi, "profit on lending"]];
Deno.test("plain-language scrub never doubles a gloss and is idempotent", () => {
  const once = plainScrub("The VIX, the market's fear gauge, fell 3.3%.", MAP);
  assertEquals(once, "The market's fear gauge fell 3.3%.");
  assertEquals(plainScrub(once, MAP), once);
  assertEquals(plainScrub("VIX (the market's fear gauge) rose.", MAP), "The market's fear gauge rose.");
  assertEquals(plainScrub("Stocks slipped as the VIX, the market's fear gauge, rose.", MAP), "Stocks slipped as the market's fear gauge rose.");
  assertEquals(plainScrub('{"a":"VIX, the market\'s fear gauge, rose."}', MAP), '{"a":"The market\'s fear gauge rose."}');
  assertEquals(plainScrub("VIX rose 2%.", MAP), "the market's fear gauge rose 2%.");
  assertEquals(plainScrub("Its P/E (price-to-earnings ratio) is 40.", MAP), "Its price-to-earnings ratio is 40.");
  assertEquals(plainScrub("Its net interest margin, profit on lending, held.", MAP), "Its profit on lending held.");
  assertEquals(dedupePhrases("the market's fear gauge, the market's fear gauge, fell"), "the market's fear gauge, fell");
  assertEquals(dedupePhrases("It rose, then it rose again."), "It rose, then it rose again.");
});

Deno.test("news: entities decode, including double-encoded ones", () => {
  assertEquals(decodeEntities("AT&amp;T&#39;s deal &amp;amp; more &#x2014; done"), "AT&T's deal & more — done");
});
Deno.test("news: option chains, quote pages and social posts are dropped", () => {
  assert(isJunkNews("QQQM Nov 2026 260.000 call (QQQM261120C00260000) Historical Prices", "https://finance.yahoo.com/quote/QQQM261120C00260000/history"));
  assert(isJunkNews("Invesco NASDAQ 100 ETF (QQQM) Stock Price, News, Quote & History", "https://finance.yahoo.com/quote/QQQM/"));
  assert(isJunkNews("Shorted 32 shares at $363.58 and took profit", "https://www.moomoo.com/community/feed/123"));
  assert(isJunkNews("$Broadcom (AVGO.US)$ Shorted 32 shares at $363.58 and took profit at $352.36", "https://news.google.com/rss/articles/x", "Moomoo"));
  assert(isJunkNews("MSFT 270319 600.00C (MSFT270319C600000) Stock Options Chain | Quotes & News", "https://news.google.com/rss/articles/y", "Moomoo"));
  assertFalse(isJunkNews("TSLA Stock Dips: Tesla Gears Up To Ramp European Production", "https://news.google.com/rss/articles/z", "Stocktwits"));
  assertFalse(isJunkNews("Broadcom beats on AI revenue, guides higher", "https://www.reuters.com/technology/broadcom-2026-09-10/"));
});
Deno.test("news: the holding must be central, not a passing mention", () => {
  const nv = aliasesFor("NVDA", "NVIDIA Corporation");
  assertFalse(newsRelevant("Is Ford Stock a Buy for Its Dividend?", nv, "Ford yields 5%.", true));
  assertFalse(newsRelevant("What mortgage rate surges mean for home improvement stocks", nv));
  assert(newsRelevant("Nvidia's Blackwell ramp beats estimates", nv));
  assert(newsRelevant("Chip stocks rally as $NVDA leads", nv));
  assert(newsRelevant("Why the chip sector moved", nv, "Nvidia rose 4% after its CEO spoke.", true));
  assertFalse(newsRelevant("Why the chip sector moved", nv, "Nvidia rose 4% after its CEO spoke.", false));
  const v = aliasesFor("V", "Visa Inc.");
  assertFalse(newsRelevant("V for victory: markets climb", v));
  assert(newsRelevant("Visa raises its dividend", v));
  assert(newsRelevant("How Has Visa's Growth Story Changed?", aliasesFor("V", "VISA INC CLASS A")));
  assert(newsRelevant("Do Rising Card Delinquencies Change The Bull Case For Capital One Stock?", aliasesFor("COF", "CAPITAL ONE FINANCIAL CORP")));
  assert(newsRelevant("Arm Drops 3.3% as More AI Cores Test Royalty Economics", aliasesFor("ARM", "Arm Holdings plc")));
  assertFalse(newsRelevant("Best Banks: Ensuring Privacy And Security Wins Customer Trust", aliasesFor("BAC", "BANK OF AMERICA CORP")));
  assert(newsRelevant("삼성전자 주가 급등", aliasesFor("005930.KS", "Samsung Electronics Co., Ltd.", "삼성전자")));
  assert(newsRelevant("Palantir wins Army deal", aliasesFor("PLTR", "Palantir Technologies Inc.")));
  assertFalse(newsRelevant("Advanced materials stocks slip", aliasesFor("AMD", "Advanced Micro Devices, Inc.")));
});
Deno.test("news: syndicated titles share one key; the earliest-named holding wins", () => {
  assertEquals(titleKey("These are stocks getting lifted up by Meta&#39;s Muse - Yahoo Finance"), titleKey("These are stocks getting lifted up by Meta's Muse"));
  const t = "Meta and Nvidia lead the AI trade";
  assert(centrality(t, aliasesFor("META", "Meta Platforms, Inc.")) < centrality(t, aliasesFor("NVDA", "NVIDIA Corporation")));
});
Deno.test("news: an aggregator item carries its real publisher", () => {
  assertEquals(publisherFor("https://www.thestreet.com/investing/x", "Yahoo Finance"), "TheStreet");
  assertEquals(publisherFor("https://finance.yahoo.com/news/x.html", "Yahoo Finance"), "Yahoo Finance");
  assertEquals(publisherFor("https://example-news.io/a", "Yahoo Finance"), "example-news.io");
});

Deno.test("history: daily bars are stamped at the session close; today's live bar is skipped", () => {
  const body = { chart: { result: [{
    meta: { exchangeTimezoneName: "America/New_York", instrumentType: "EQUITY", currency: "USD", currentTradingPeriod: { regular: { end: Date.parse("2026-09-25T20:00:00Z") / 1000 } } },
    timestamp: [Date.parse("2026-09-23T13:30:00Z") / 1000, Date.parse("2026-09-24T13:30:00Z") / 1000, Date.parse("2026-09-25T13:30:00Z") / 1000],
    indicators: { quote: [{ close: [370.1, null, 377.9] }] },
  }] } };
  assertEquals(parseYahooDaily(body, NOW), [{ ts: "2026-09-23T20:00:00.000Z", price: 370.1 }]);
  const crypto = { chart: { result: [{ meta: { exchangeTimezoneName: "UTC", instrumentType: "CRYPTOCURRENCY" }, timestamp: [Date.parse("2026-09-23T00:00:00Z") / 1000], indicators: { quote: [{ close: [84000] }] } }] } };
  assertEquals(parseYahooDaily(crypto, NOW), [{ ts: "2026-09-23T23:59:59.000Z", price: 84000 }]);
  const lse = { chart: { result: [{ meta: { exchangeTimezoneName: "Europe/London", currency: "GBp", currentTradingPeriod: { regular: { end: Date.parse("2026-09-25T15:30:00Z") / 1000 } } }, timestamp: [Date.parse("2026-09-23T07:00:00Z") / 1000], indicators: { quote: [{ close: [7200] }] } }] } };
  assertEquals(parseYahooDaily(lse, NOW), [{ ts: "2026-09-23T15:30:00.000Z", price: 72 }]);
});

Deno.test("opening read: a live move called 'yesterday' becomes 'so far today'; a real yesterday stays", () => {
  const live = [{ names: ["Microsoft", "MSFT"], pct: 3.66 }, { names: ["Meta", "META"], pct: -2.81 }];
  assertEquals(liveNotYesterday("Your Microsoft stake jumped 3.7% yesterday. Meta fell 2.8% yesterday.", live),
    "Your Microsoft stake jumped 3.7% so far today. Meta fell 2.8% so far today.");
  assertEquals(liveNotYesterday("Microsoft slipped 0.5% yesterday before today's jump.", live), "Microsoft slipped 0.5% yesterday before today's jump.");
  assertEquals(liveNotYesterday("Yesterday's 3.7% jump in Microsoft led.", live), "Today's 3.7% jump in Microsoft led.");
});
Deno.test("no unsupported 'directly' causal links", () => {
  assertEquals(deDirect("Oracle's cut hits your Microsoft and Amazon directly."), "Oracle's cut hits your Microsoft and Amazon.");
  assertEquals(deDirect("It directly hurts margins."), "It hurts margins.");
  assertEquals(deDirect("You own it directly, not through a fund."), "You own it directly, not through a fund.");
});

Deno.test("session tags: a live move is today's, a finished session is named", () => {
  assertStringIncludes(dayTag("US", new Date("2026-09-25T14:01:00Z")), "today's Friday US session, LIVE, 31 min in");
  assertStringIncludes(dayTag("US", new Date("2026-09-25T12:30:00Z")), "Thursday, Sep 24 US session, past");
  assertStringIncludes(dayTag(null), "crypto");
});
