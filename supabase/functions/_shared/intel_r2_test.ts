// Run: npx -y deno@2 test supabase/functions/_shared/
// Round-2 audit (2026-09-25, after the 1.0.1 server deploy): every case is a phrasing or a number that still
// got through, or its near miss that must keep working.
import { assert, assertEquals, assertFalse } from "jsr:@std/assert@1";
import {
  adviceHits, cleanFollowups, closesBetween, dayMoveMismatches, dropEcho, earningsEstimate, fixArticles, hangulShare, isTradeQuestion,
  levelMismatches, mentionedSymbols, nextEarningsEstimate, offLensIdea, pctOver, stripAdvice, valuationHits, verdictRankHits, withNoCallLine,
  wrongEarningsDates, wrongLanguage,
} from "./intel.ts";
import { isJunkNews, publisherFor, usableNews, aliasesFor } from "./news_rules.ts";

// ---- 1. advice: indirect phrasings (EN + KO) vs data questions that must stay allowed ----
const MUST_GUARD = [
  "Rank my holdings from best to worst to own",
  "rank my holdings from best to worst",
  "what's the one stock you'd dump right now",
  "what would you do if you were me?",
  "If you were me, what would you sell?",
  "which should I keep?",
  "Which one would you keep, NVDA or AMD?",
  "What's your top pick in my portfolio?",
  "NVDA: sell or hold?",
  "keep or dump AVGO?",
  "should I sell TSLA",
  "is now a good time to add META",
  "Which stock should I get rid of first?",
  "Is AAPL a buy here?",
  "If you had my $120K cash, where would it go?",
  "is MSFT worth holding?",
  "time to take profits on NVDA?",
  "which of these would you bet on?",
  "테슬라 팔까요?",
  "엔비디아 지금 더 사도 될까요? 아니면 팔아야 하나요?",
  "삼성전자 정리할까요?",
  "종목 추천해줘",
  "제 입장이라면 어떤 종목을 팔겠어요?",
  "지금 비중을 늘려야 할까요?",
];
const MUST_ALLOW = [
  "rank my holdings by 1-month return",
  "Rank my holdings from best to worst performance this month",
  "which holding is my biggest?",
  "rank my holdings by size",
  "which of my stocks is most volatile?",
  "what's my best performer this year?",
  "why did TSLA drop today?",
  "when does NVDA report earnings?",
  "what are the biggest risks in my portfolio?",
  "is NVDA overvalued?",
  "what would happen to my portfolio if NVDA fell 20%?",
  "which holding pays the highest dividend yield?",
  "how concentrated am I?",
  "뉴스 정리해줘",
  "애널리스트 추천 등급은 어때?",
  "가장 위험한 종목은?",
  "왜 그런데?",
];
Deno.test("advice: indirect trade questions are recognised; data questions are not (table)", () => {
  assert(MUST_GUARD.length + MUST_ALLOW.length >= 30);
  for (const q of MUST_GUARD) assert(isTradeQuestion(q), `should guard: ${q}`);
  for (const q of MUST_ALLOW) assertFalse(isTradeQuestion(q), `should allow: ${q}`);
});

const VERDICT_ANSWERS = [
  "**Top:** MSFT, NVDA, AAPL, GOOGL. **Bottom:** AVGO, TSLA, META.",
  "AVGO looks weakest right now. Watch the $352 mark.",
  "The one I'd dump is AVGO.",
  "1. MSFT\n2. NVDA\n3. AAPL\n4. AVGO",
];
const OBJECTIVE_ANSWERS = [
  "AMZN is the weakest over 1 month, down 5.9%.",
  "By 1M return: MSFT +12%, NVDA +7%, AVGO -3%.",
  "Top holdings by weight: VOO 40%, NVDA 20%.",
  "1. MSFT +12% this month\n2. NVDA +7% this month\n3. AVGO -3% this month",
];
Deno.test("advice: a ranking verdict is caught after a verdict question; a metric ranking is not", () => {
  for (const a of VERDICT_ANSWERS) assert(adviceHits(a, { verdictQuestion: true }).length > 0, `should catch: ${a}`);
  for (const a of OBJECTIVE_ANSWERS) assertEquals(adviceHits(a, { verdictQuestion: true }), [], `should allow: ${a}`);
  // the same "Top:" line answering a plain data question is not policed as a verdict
  assertEquals(verdictRankHits("AMZN is the weakest over 1 month, down 5.9%."), []);
  assertEquals(adviceHits("**Top:** MSFT, NVDA. **Bottom:** AVGO."), []);
});

const VALUATION_CALLS = [
  "SK hynix price looks cheap, giving good downside protection for long term.",
  "NVDA looks undervalued here.",
  "At $352, AVGO is a bargain.",
  "This dip is a buying opportunity.",
  "Stock down 6.9% over 60 days sets up well against the $650 target.",
  "SK하이닉스는 지금 저평가 구간입니다.",
];
const VALUATION_FACTS = [
  "P/E is 25x vs its 5-year average of 30x.",
  "Morningstar calls it undervalued with a $650 fair value.",
  "Whether it looks cheap depends on data-center growth holding above 30%.",
  "Bulls argue the stock is undervalued; bears point to margins.",
  "It trades at 32x forward earnings, above its 5-year average.",
];
Deno.test("advice: valuation calls are verdicts; metrics, attributed views and conditionals are information", () => {
  for (const s of VALUATION_CALLS) assertEquals(valuationHits(s).length, 1, `should catch: ${s}`);
  for (const s of VALUATION_FACTS) assertEquals(valuationHits(s), [], `should allow: ${s}`);
  assertEquals(stripAdvice("SK hynix earnings rose 20%. The price looks cheap here."), "SK hynix earnings rose 20%.");
});

Deno.test("advice: no-call line is Korean for a Korean question and never repeated turn after turn", () => {
  assert(withNoCallLine("판단 근거는...", "테슬라 팔까요?").startsWith("매매 여부는"));
  const prev = "I can't tell you whether to add, but here's what it hinges on.\n• ...";
  assertEquals(withNoCallLine("• drivers", "should I buy more NVDA?", prev), "• drivers");
  assert(withNoCallLine("• drivers", "should I buy more NVDA?", "• an earlier answer").startsWith("I can't tell you"));
  // a model-written Korean opener counts
  assertEquals(withNoCallLine("매수 여부는 말씀드릴 수 없지만 근거는 이렇습니다.", "살까요?"), "매수 여부는 말씀드릴 수 없지만 근거는 이렇습니다.");
});

Deno.test("follow-ups: wrong person, invented goals and valuation bait are dropped", () => {
  const out = cleanFollowups(["How exposed are you to NVIDIA?", "How does my 6.7% monthly return compare to my yearly target?", "Is NVDA undervalued now?", "What drives NVDA's margins?"], ["How concentrated is my portfolio?"]);
  assertEquals(out, ["What drives NVDA's margins?", "How concentrated is my portfolio?"]);
});

// ---- 2. language ----
Deno.test("language: a Korean question with an English answer is flagged; tickers stay neutral", () => {
  assert(wrongLanguage("테슬라 팔까요?", "I can't tell you whether to sell, but here's what it hinges on. Tesla fell 2.1% today."));
  assertFalse(wrongLanguage("테슬라 팔까요?", "매매 여부는 제가 정해드릴 수 없지만, TSLA는 오늘 2.1% 내렸습니다. AI 기대가 핵심입니다."));
  assertFalse(wrongLanguage("should I sell TSLA?", "Tesla fell 2.1%."));
  assert(hangulShare("NVDA $224 AI 반도체 수요") > 0.9);
});

// ---- 3. windows: a base must sit on the window's start ----
const at = (iso: string, price: number) => ({ ts: iso, price });
Deno.test("pctOver: AMZN's history from Aug 28 has NO 1M on Sep 25 (was a 28-day -5.9%)", () => {
  const now = Date.parse("2026-09-25T17:19:00Z");
  const h = [at("2026-08-28T20:00:01Z", 266.43), at("2026-09-24T20:00:00Z", 249.38), at("2026-09-25T17:19:00Z", 250.25)];
  assertEquals(pctOver(h, 30, now), null);
  // with the Aug 25 close on file the month resolves from it
  const full = [at("2026-08-25T20:00:00Z", 259.9), ...h];
  assertEquals(pctOver(full, 30, now)?.toFixed(1), "-3.7");
});
Deno.test("pctOver: tolerance is counted in the holding's own sessions", () => {
  const now = Date.parse("2026-09-28T15:00:00Z");   // Monday
  // a 7-day window opening on Monday Sep 21 during the session; a base from Friday Sep 18's close is 0 closes stale
  assertEquals(pctOver([at("2026-09-18T20:00:00Z", 100), at("2026-09-28T15:00:00Z", 105)], 7, now)?.toFixed(1), "5.0");
  // a base three sessions before the window is too stale for a 1W figure
  assertEquals(pctOver([at("2026-09-15T20:00:00Z", 100), at("2026-09-28T15:00:00Z", 105)], 7, now), null);
  // crypto has no sessions: a first point one day after the start passes, three days does not
  assertEquals(pctOver([at("2026-08-30T00:00:00Z", 100), at("2026-09-28T15:00:00Z", 90)], 30, now, null)?.toFixed(1), "-10.0");
  assertEquals(pctOver([at("2026-09-01T00:00:00Z", 100), at("2026-09-28T15:00:00Z", 90)], 30, now, null), null);
  // Labor Day (Sep 7) is not a missed close
  assertEquals(closesBetween("US", Date.parse("2026-09-04T21:00:00Z"), Date.parse("2026-09-08T19:00:00Z")), 0);
});

// ---- 4. news at read time ----
Deno.test("news: pre-gate rows are judged again at read time", () => {
  const nvda = aliasesFor("NVDA", "NVIDIA Corp");
  assertFalse(usableNews({ title: "Is Ford Stock a Buy for Its Dividend?", url: "https://www.fool.com/x", source: "The Motley Fool" }, nvda));
  assert(usableNews({ title: "Nvidia Tests Key Level Amid Trump-Xi Talks", url: "https://www.investors.com/x", source: "IBD" }, nvda));
  // admitted at ingest on the lead of a symbol feed: the stored lead admits it again
  const voo = aliasesFor("VOO", "Vanguard S&P 500 ETF");
  assert(usableNews({ title: "A Strong Labor Report To Crush Stocks", url: "https://seekingalpha.com/a", source: "Seeking Alpha", summary: "The S&P 500 could fall if payrolls surprise." }, voo));
  assertFalse(usableNews({ title: "A Strong Labor Report To Crush Stocks", url: "https://seekingalpha.com/a", source: "Seeking Alpha" }, voo));
  assert(usableNews({ title: "8-K filed: 8-K", url: "https://www.sec.gov/x", source: "SEC Filing" }, nvda));
  assert(isJunkNews("NVDA Stock Price | Quotes & News", "https://news.google.com/x", "Moomoo"));
  assert(isJunkNews("VOO Oct 2026 682.500 put (VOO261023P00682500) interactive stock chart", "https://news.google.com/x", "uk.finance.yahoo.com"));
  assert(isJunkNews("QQQM261120C00260000 quote", "https://example.com/x", "x"));
});
Deno.test("news: the byline is the real publisher, or its domain", () => {
  assertEquals(publisherFor("https://www.fool.com/investing/2026/09/25/x/", "Yahoo Finance"), "The Motley Fool");
  assertEquals(publisherFor("https://247wallst.com/investing/x", "Yahoo Finance"), "24/7 Wall St.");
  assertEquals(publisherFor("https://www.trefis.com/x", "Yahoo Finance"), "Trefis");
  assertEquals(publisherFor("https://some-new-site.io/x", "Yahoo Finance"), "some-new-site.io");
  assertEquals(publisherFor("https://finance.yahoo.com/x", "Yahoo Finance"), "Yahoo Finance");
  assertEquals(publisherFor("https://some-new-site.io/x", "Reuters"), "Reuters");
});

// ---- 5. live numbers in takes ----
Deno.test("takes: a day move that is not the live move is caught; windows and levels are not", () => {
  const voo = [{ names: ["VOO", "Vanguard S&P 500 ETF"], pct: 0.45, price: 710.42 }];
  assertEquals(dayMoveMismatches("VOO down 0.6% on GOOG drag, yet inflows dominate.", voo).length, 1);
  assertEquals(dayMoveMismatches("VOO up 0.4% as megacaps lead.", voo), []);
  assertEquals(dayMoveMismatches("VOO is up 17% over the past year.", voo), []);
  assertEquals(dayMoveMismatches("VOO slipped 0.6% yesterday before today's bounce.", voo), []);
  const book = [{ names: ["TSLA", "Tesla"], pct: -1.6, price: 372 }, { names: ["NVDA", "Nvidia"], pct: 0.02, price: 224 }];
  assertEquals(dayMoveMismatches("TSLA off 1.6% while NVDA is flat.", book), []);
  assertEquals(dayMoveMismatches("Tesla jumped 1.6% on robotaxi news.", book).length, 1);
  const btc = [{ names: ["BTC", "Bitcoin"], pct: -0.54, price: 83923 }];
  assertEquals(levelMismatches("BTC range-bound near $78K as flows stall.", btc).length, 1);
  assertEquals(levelMismatches("Bitcoin stuck below $85K despite positive ETF flows.", btc), []);
  assertEquals(levelMismatches("Bitcoin trades near $84K with $15.6B options expiring.", btc), []);
  assertEquals(levelMismatches("Support near $80K held twice this week.", btc), []);
});
Deno.test("takes: bullets map to the holdings they name", () => {
  const book = [{ symbol: "PEP", names: ["PEP", "PepsiCo", "Pepsi"] }, { symbol: "F", names: ["Ford"] }, { symbol: "AAPL", names: ["AAPL", "Apple"] }];
  assertEquals(mentionedSymbols("Pepsi near yearly lows as Ford halts F-150 output", book), ["PEP", "F"]);
  assertEquals(mentionedSymbols("Apple's services margin holds", book), ["AAPL"]);
});

// ---- 6. earnings dates ----
Deno.test("earnings: the year-ago quarter sets the date (GOOGL ~Oct 28, not Oct 21)", () => {
  const googl = [
    { form: "8-K", filed_at: "2026-07-22" }, { form: "10-Q", filed_at: "2026-07-23" },
    { form: "8-K", filed_at: "2025-10-29", items: "2.02,9.01" }, { form: "10-Q", filed_at: "2025-10-30" },
  ];
  assertEquals(earningsEstimate(googl, [], "2026-09-25")?.est, "2026-10-28");
  // without the year-ago report: 13 weeks after the last one
  assertEquals(nextEarningsEstimate("2026-07-22", "2026-09-25"), { est: "2026-10-21", due: false });
  // TSLA from its Jul 22 8-K item 2.02 alone
  assertEquals(earningsEstimate([{ form: "8-K", filed_at: "2026-07-22", items: "2.02,9.01" }], [], "2026-09-25")?.est, "2026-10-21");
});
Deno.test("earnings: a calendar item off the estimate is dropped (Microsoft 'Sep 28')", () => {
  const ests = [{ names: ["Microsoft", "MSFT"], est: "2026-10-28" }, { names: ["Tesla", "TSLA"], est: null }];
  assertEquals(wrongEarningsDates(["Microsoft earnings call Sep 28", "Microsoft earnings ~Oct 28 (est)", "Fed minutes Oct 8", "Tesla Q3 report Oct 21"], ests, "2026-09-25"),
    ["Microsoft earnings call Sep 28", "Tesla Q3 report Oct 21"]);
});

// ---- 7. copy ----
Deno.test("copy: a/an, the risk line that echoes its tripwire, off-lens ideas", () => {
  assertEquals(fixArticles("A ultra-concentrated US equity book with a 8% cash slice"), "An ultra-concentrated US equity book with an 8% cash slice");
  assertEquals(fixArticles("an US-listed fund, an S&P tracker, a one-stock bet, Class A shares, an hour"), "a US-listed fund, an S&P tracker, a one-stock bet, Class A shares, an hour");
  assertEquals(fixArticles("an European bank and a honest read"), "a European bank and an honest read");
  const note = "Broad US index at a 0.03% fee. The risk: top-ten holdings exceed 35% of the fund.";
  assertEquals(dropEcho(note, "Top-ten holdings exceed 35% of the fund"), "Broad US index at a 0.03% fee.");
  assertEquals(dropEcho(note, "Fed holds above 4% through year end"), note);
  assert(offLensIdea("Dividend-focused fund for steadier income", ["growth", "ai_tech", "crypto"]));
  assert(offLensIdea("Short-term bond fund to reduce overall volatility", ["growth"]));
  assertFalse(offLensIdea("No bond or international exposure: every dollar rides on US growth", ["growth"]));
  assertFalse(offLensIdea("Dividend growth names for steadier income", ["income"]));
});
