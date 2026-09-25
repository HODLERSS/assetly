// Run: npx -y deno@2 test --allow-read supabase/functions/_shared/
// Round 5 intelligence (r5-intelligence), 2026-09-25: advice leaks, the opener, husk months, GOOGL card, repair chain.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { adviceHits, liveEditions, noviceGloss, repairDrops, valuationHits, withNoCallLine, wrongEarningsMonths } from "./intel.ts";

Deno.test("r7 advice: Korean cash-buy suggestions and price verdicts are caught", () => {
  // the leaked answer to "현금으로 뭘 사야 할까?"
  assert(adviceHits("MSFT, AAPL, QQQM을 나눠 사는 게 안전해요.").length === 1);
  assert(adviceHits("QQQM을 추가하는 게 좋을 수 있어요.").length === 1);
  assert(adviceHits("MSFT를 더 담으세요.").length === 1);
  assert(adviceHits("분할 매수가 유리합니다.").length === 1);
  // information stays
  assertEquals(adviceHits("MSFT 비중은 12%이고 오늘 1.2% 올랐어요."), []);
  assertEquals(adviceHits("현금은 약 $2,500입니다."), []);
  // valuation verdicts in Korean
  for (const s of ["지금 가격이 싸다고 보긴 어려워요.", "비싸다고 판단하기는 이릅니다.", "저렴하다고 말하기 어렵습니다.", "싸다고 생각할 수 있어요."]) {
    assert(valuationHits(s).length === 1, s);
  }
  assertEquals(valuationHits("PER은 25배이고 5년 평균은 30배입니다."), []);
});

Deno.test("r7 advice: cash timing in English is a call", () => {
  for (const s of [
    "Keeping cash lets you wait for a clearer price.",
    "Holding some cash gives you room to buy on a pullback.",
    "Leaving cash on the side until prices settle is sensible.",
    "Deploying your cash gradually lowers timing risk.",
  ]) assert(valuationHits(s).length + adviceHits(s).length >= 1, s);
  // a plain fact about cash stays
  assertEquals(valuationHits("Cash is 4.2% of the portfolio, about $2,500."), []);
  assertEquals(adviceHits("Cash is 4.2% of the portfolio, about $2,500."), []);
});

Deno.test("r7 valuation: the market or multiple missing something is a call, attributed views stay", () => {
  for (const s of [
    "Waymo is an asset the 17x multiple ignores.",
    "The market still underrates Google Cloud's margins.",
    "The stock doesn't reflect the value of Waymo.",
    "Its cloud arm is overlooked by the market.",
    "A $2T IPO could double the stake's value.",
  ]) assert(valuationHits(s).length === 1, s);
  assertEquals(valuationHits("Google trades at 17x forward earnings versus a 5-year average of 21x."), []);
});

Deno.test("r7 opener: every trade or pick answer carries it unless its first sentence declines", () => {
  const q1 = "should I sell NVDA?", q2 = "should I buy more MSFT then?";
  const a1 = withNoCallLine("• NVDA is 18% of the portfolio.", q1);
  assert(a1.startsWith("I can't tell you"));
  // the next trade question, right after: still there
  assert(withNoCallLine("• MSFT is up 46% this year.", q2, a1, q1).startsWith("I can't tell you"));
  // the answer's own first sentence declines: no second opener
  const own = "That's your call, but here's the data. • MSFT is up 46%.";
  assertEquals(withNoCallLine(own, q2), own);
  // a declining sentence later in the answer does not count
  assert(withNoCallLine("• MSFT is up 46%. That's your call.", q2).startsWith("I can't tell you"));
  // Korean
  assert(withNoCallLine("• 삼성전자 비중은 9%입니다.", "삼성전자 팔까?").startsWith("매매 여부는"));
  // a pick question ("현금으로 뭘 사야 할까?")
  assert(withNoCallLine("• 현금은 $2,500입니다.", "현금으로 뭘 사야 할까?").startsWith("매매 여부는"));
  // not a trade question: untouched
  assertEquals(withNoCallLine("• NVDA rose 2%.", "why is NVDA up?"), "• NVDA rose 2%.");
});

Deno.test("r7 husk months: a sentence naming several holdings is held to every one of them", () => {
  const ests = [
    { names: ["MSFT", "Microsoft"], est: "2026-10-28" },
    { names: ["NVDA", "Nvidia"], est: "2026-11-18", range: ["2026-11-18", "2026-11-25"] as [string, string] },
  ];
  assertEquals(wrongEarningsMonths("Microsoft and Nvidia both report in late October.", ests).length, 1);
  assertEquals(wrongEarningsMonths("Nvidia reports in late October.", ests).length, 1);
  assertEquals(wrongEarningsMonths("Microsoft reports in late October and Nvidia in November.", ests), []);
});

Deno.test("r7 capex gloss reads right as a noun, a modifier and a plural subject", () => {
  assertEquals(noviceGloss("Burry's fresh Big Tech capex warning is the risk."), "Burry's fresh Big Tech equipment spending warning is the risk.");
  assertEquals(noviceGloss("Alphabet raised its capex plans."), "Alphabet raised its equipment spending plans.");
  assertEquals(noviceGloss("Capex rose 40% last quarter."), "Equipment spending rose 40% last quarter.");
});

Deno.test("r7 repair chain: fragments and advice go, ordinary sentences stay", () => {
  const lede = "S&P 500 7,737.41 (+0.4%), Nasdaq futures 30,887.75 (+0.7%), and one smaller position.";
  assertEquals(repairDrops(lede).length, 1);
  assertEquals(repairDrops("Nvidia looks cheap here."), ["Nvidia looks cheap here."]);
  assertEquals(repairDrops("It adds.").length, 1);
  assertEquals(repairDrops("Microsoft rose 3.7% in early trading after its cloud update. Nvidia is 18% of the portfolio."), []);
});

Deno.test("r7 live editions: the current edition and the one before it are regenerated, never patched", () => {
  assertEquals(liveEditions("morning"), ["morning"]);
  assertEquals(liveEditions("midday"), ["midday", "morning"]);
  assertEquals(liveEditions("close"), ["close", "midday"]);
  assertEquals(liveEditions("kr_close"), ["kr_close", "kr_open"]);
  assertEquals(liveEditions("assessment"), []);
});
