// Run: npx -y deno@2 test --allow-read supabase/functions/_shared/
// Round-4 audit (2026-09-25): every string here was served or spoken.
import { assert, assertEquals, assertFalse } from "jsr:@std/assert@1";
import {
  canonicalCalendar, dayMoveMismatches, isTradeQuestion, normalizeBullets, scriptProblems, unsupportedCauses, valuationHits, verblessList,
  withNoCallLine, wrongEarningsMonths,
} from "./intel.ts";
import { isJunkNews, staleRedated, titleKey } from "./news_rules.ts";

Deno.test("r4 opener: the model's 'is yours' / '정하실 몫' counts; a trade question after an unrelated one gets its opener", () => {
  const a = "Deciding which position to trim is yours; here is what each carries.";
  assertEquals(withNoCallLine(a, "Which one would you trim first?"), a);
  const k = "매도 여부는 본인이 정하실 몫입니다. 근거는 이렇습니다.";
  assertEquals(withNoCallLine(k, "테슬라 팔까요?"), k);
  // the previous turn said "your call" but was about something else: this trade question still gets one
  assert(withNoCallLine("• MSFT is up 46% over 3 months.", "Is it time to take profits on MSFT?", "That's your call; here's the data.", "what is my biggest holding?").startsWith("I can't tell you"));
  // right after another trade question that got one: no repeat
  assertEquals(withNoCallLine("• MSFT is up 46%.", "Is it time to take profits on MSFT?", "That's your call; here's the data.", "should I sell NVDA?"), "• MSFT is up 46%.");
});

Deno.test("r4 questions: 'on sale', 'a bargain', 'cheap now', 'buy the dip' are trade questions", () => {
  for (const q of ["META fell 3% today. Is it on sale now?", "Is NVDA a bargain here?", "is AVGO cheap now?", "worth buying the dip on META?", "Is this a good entry for TSLA?", "메타 싸졌는데 사도 돼?"]) assert(isTradeQuestion(q), q);
  for (const q of ["Why did META fall 3% today?", "What is META's P/E?"]) assertFalse(isTradeQuestion(q), q);
});

Deno.test("r4 valuation: the app's own 'not fully priced', 'leaves cushion', 'story still solid', cash nudges", () => {
  for (const s of [
    "Anthropic stake reportedly valued at $124B is a hidden asset the market isn't fully pricing.",
    "17x earnings versus the S&P 500's 25x leaves cushion.",
    "A pullback after a big run is normal; the long-term story still looks solid.",
    "Another piece calls it 24% undervalued.",
    "Holding cash lets you buy during a pullback or after a profit report.",
  ]) assertEquals(valuationHits(s).length, 1, s);
  for (const s of ["Morningstar calls it 24% undervalued.", "It trades at 17x earnings versus the S&P 500's 25x.", "Bulls argue it is undervalued; bears point to capex."]) assertEquals(valuationHits(s), [], s);
});

Deno.test("r4 bullets: a semicolon-joined fact table becomes one bullet per holding", () => {
  assertEquals(normalizeBullets("• NVDA $224, 19.1%; AAPL $336, 13.6%; MSFT $480, 13.2%; META $749, 12.9%"),
    "• NVDA $224, 19.1%.\n• AAPL $336, 13.6%.\n• MSFT $480, 13.2%.\n• META $749, 12.9%.");
  assertEquals(normalizeBullets("• Rates rose; stocks fell."), "• Rates rose; stocks fell.");
});

Deno.test("r4 numbers: today's figure must be today's, with its sign; report months must fit the estimate", () => {
  const facts = [{ names: ["AVGO", "Broadcom"], pct: 0.45 }, { names: ["portfolio", "포트폴리오", "자산"], pct: 0.15 }];
  assertEquals(dayMoveMismatches("AVGO is down 0.4% today on China headlines.", facts, 0.15).length, 1);
  assertEquals(dayMoveMismatches("원화로 보면 자산은 47억 원이고, 오늘 +2.6%입니다.", facts, 0.15).length, 1);
  assertEquals(dayMoveMismatches("자산은 오늘 +0.15%, 1주 +2.6%입니다.", facts, 0.15), []);
  assertEquals(dayMoveMismatches("AVGO is up 0.5% today.", facts, 0.15), []);
  const ests = [{ names: ["NVDA", "Nvidia"], est: "2026-11-18", range: ["2026-11-18", "2026-11-25"] as [string, string] }];
  assertEquals(wrongEarningsMonths("Your largest position, Nvidia, reports in December.", ests).length, 1);
  assertEquals(wrongEarningsMonths("Nvidia reports in mid to late November.", ests), []);
  assertEquals(wrongEarningsMonths("Nvidia는 12월에 실적을 발표합니다.", ests).length, 1);
});

Deno.test("r4 brief: a list with no verb is a fragment; calendar lines come from the estimates", () => {
  assertEquals(verblessList("S&P500 index 7,737.41 (+0.4%), Nasdaq futures 30,887.75 (+0.7%), and one smaller position.").length, 1);
  assertEquals(verblessList("The S&P 500 rose 0.4%, Nasdaq futures gained 0.4%, and Microsoft added 3.7%."), []);
  const ests = [
    { names: ["Microsoft", "MSFT"], label: "Microsoft", est: "2026-10-28" },
    { names: ["Apple", "AAPL"], label: "Apple", est: "2026-10-29" },
    { names: ["Meta", "META"], label: "Meta", est: "2026-10-28" },
    { names: ["Nvidia", "NVDA"], label: "Nvidia", est: "2026-11-18", range: ["2026-11-18", "2026-11-25"] as [string, string] },
  ];
  const src = "NEXT EARNINGS: Microsoft ~Oct 28 (est)\nMARKET: Fed decision Oct 29 at 2 PM";
  assertEquals(canonicalCalendar(["Oct 28 earnings call MSFT", "Oct 29 earnings preview AAPL", "Oct 28 AI spend update META", "Nov 25 earnings estimate NVDA", "Fed decision Oct 29"], ests, src, "2026-09-25"),
    ["Microsoft earnings expected ~Oct 28 (est)", "Apple earnings expected ~Oct 29 (est)", "Nvidia earnings expected mid to late November (est)", "Fed decision Oct 29"]);
});

Deno.test("r4 listen: a script may only restate the brief", () => {
  const sections = "Microsoft rose 3.7% on AI demand. Microsoft is 13.2% of assets. Nvidia slipped 0.2%.";
  const bad = scriptProblems([
    "Your portfolio's growth outlook improves sharply.",
    "Microsoft's rally lifts AI exposure, boosting future returns.",
    "Higher exposure to fast-growing AI revenue should enhance long-term returns for your portfolio.",
    "It aligns with your long-term goals.",
    "Microsoft added 3.7% weight to your holdings.",
    "If NVIDIA falls below 0.2%, the AI exposure cushion could evaporate.",
    "Microsoft rose 3.7% on AI demand.",
  ].join(" "), sections, "2026-09-25");
  assertEquals(bad.length, 6);
  assertFalse(bad.includes("Microsoft rose 3.7% on AI demand."));
});

Deno.test("r4 causes: profit-taking and 'X warned' need a headline", () => {
  assertEquals(unsupportedCauses("META's 3.4% drop looks like profit-taking after a big run.", "Headlines: Meta launches Muse agents").length, 1);
  assertEquals(unsupportedCauses("트윌리오가 경고했고 투자자들이 이익을 확정하려고 팔았습니다.", "Headlines: Meta launches Muse agents").length, 1);
  assertEquals(unsupportedCauses("Twilio warned on Meta's Muse.", "Twilio Stock Drops After HSBC Delivers Stark Warning"), []);
});

Deno.test("r4 news: 13F 'Stock Bought by', report spam, exchange suffixes, re-dated stories", () => {
  assert(isJunkNews("Meta Platforms, Inc. $META Stock Bought by InTrack Investment Management Inc", "https://news.google.com/x", "MarketBeat"));
  assert(isJunkNews("Grid Scale Stationary Battery Storage Market Outlook 2026-2035 - Featuring Profiles of Tesla", "https://news.google.com/x", "GlobeNewswire"));
  assert(isJunkNews("Tent-Shape Options Strategy For Tesla Stock", "https://news.google.com/x", "Investor's Business Daily"));
  assertEquals(titleKey("I'm Riding Meta (NASDAQ:META)"), titleKey("I'm Riding Meta"));
  assert(staleRedated({ url: "https://www.fool.com/investing/2026/07/21/tsla-stock-jumps-3-ahead-of-q2-report/", published_at: "2026-09-25T15:00:00Z" }));
  assertFalse(staleRedated({ url: "https://www.fool.com/investing/2026/09/25/x/", published_at: "2026-09-25T15:00:00Z" }));
});
