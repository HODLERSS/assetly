// Round 9 designer: News lines anchored to headlines must not carry buy framing, wrong stories or the app's voice.
import { assert, assertEquals, assertFalse } from "jsr:@std/assert@1";
import { anchorNewsLine, cleanHeadline, headlineOk } from "./intel.ts";

Deno.test("r18: headlines that are not news lines", () => {
  for (const t of [
    "Is Meta the Best Magnificent Seven Stock to Buy After Its AI Agent Topped the App Store?",
    "Apple (NASDAQ:AAPL) Stock Price Up 1.5% - Time to Buy?",
    "Micron vs. NVIDIA: 1 AI Stock to Buy Now and 1 to Watch",
    "If You Invest $10,000 in Microsoft Today, Here’s What It Could Be Worth by 2030",
    "Why now might be a good time to invest in Alphabet?",
    "AutoZone Is Still a Buy, Analyst Says. Plus, Meta and 5 More Stocks.",
    "Credo vs. Nvidia: Which AI Chip Stock Is a Better Buy in 2026?",
    "Form 4 Microsoft Corporation For: 25 September By Investing.com",
    "Alongside a 72,474-share gift, a Broadcom (AVGO) director reported sales by two entities.",
    "Oppenheimer resets Microsoft stock price target after HQ visit",
    "3 Stocks to Watch From the Satellite and Communication Industry",
    "Qualcomm stock jumps 6% after Apple deal renewa...",
    "Could Micron Stock Reach $2,000? 1 Reason to Believe It -- and 1 Reason to Be Skeptical",
  ]) assertFalse(headlineOk(t), t);
  for (const t of ["Amazon Stocks Move Lower as Anthropic Commits $11.6 Billion Elsewhere", "Nvidia Tests Key Level Amid Trump-Xi Talks, China Challenge",
    "Microsoft Stock Is on Pace for Its Highest Close in More Than 10 Months. Here's Why."]) assert(headlineOk(t), t);
});

Deno.test("r18: headline typography", () => {
  assertEquals(cleanHeadline("Apple (AAPL) Reaches $250 Million Siri Settlement - Yahoo Finance", ["Apple"]), "Apple Reaches $250 Million Siri Settlement");
  assertEquals(cleanHeadline("Elon Musk Sighs At EU-Wide FSD Approval Delay — TSLA Stock Slips"), "Elon Musk Sighs At EU-Wide FSD Approval Delay: TSLA Stock Slips");
  assertEquals(cleanHeadline("How Meta’s Muse Saved the Market—While Savaging These Stocks"), "How Meta's Muse Saved the Market, While Savaging These Stocks");
  assertEquals(cleanHeadline("AT&amp;T lifts outlook By Investing.com"), "AT&T lifts outlook");
  assertEquals(cleanHeadline("What's Going On With Microsoft Stock Today - Microsoft", ["Microsoft"]), "What's Going On With Microsoft Stock Today");
  assertFalse(/[—–…]/.test(cleanHeadline("A — B – C…")));
});

Deno.test("r18: lines are replaced only by the headline they paraphrase, attributed, and held to the live move", () => {
  const heads = [
    { symbol: "AAPL", names: ["AAPL", "Apple"], title: "Apple (AAPL) Reaches $250 Million Siri Settlement Over Recent iPhone Claims", source: "Yahoo Finance" },
    { symbol: "AAPL", names: ["AAPL", "Apple"], title: "Apple Stock Price Up 1.5% - Time to Buy?", source: "MarketBeat" },
    { symbol: "META", names: ["META", "Meta"], title: "Meta Slides 4% as Retracement Follows 32% Monthly Run; Pinterest and Snap Inch Higher", source: "Yahoo Finance" },
    { symbol: "META", names: ["META", "Meta"], title: "This Meta stock stat doesn't make sense after the Muse mic drop", source: "Yahoo Finance" },
    { symbol: "AMZN", names: ["AMZN", "Amazon"], title: "Amazon Stocks Move Lower as Anthropic Commits $11.6 Billion Elsewhere", source: "Yahoo Finance" },
  ];
  const moves = { META: -3.33, AAPL: 1.53 };
  assertEquals(anchorNewsLine("Apple climbs toward 350 dollars before the iPhone 18 launch.", heads, 96, moves), null);
  assertEquals(anchorNewsLine("Apple rose 1.5% on Friday.", heads, 96, moves), null);
  assertEquals(anchorNewsLine("Meta drops 3.4% cooling off after a 32% monthly surge.", heads, 96, moves), null);
  assertEquals(anchorNewsLine("Meta Friday drop cools off after a 31.9% monthly surge.", heads, 96, moves), null);
  assertEquals(anchorNewsLine("Amazon slips as Anthropic commits $11.6 billion to other providers.", heads, 96, moves),
    "Yahoo Finance: Amazon Stocks Move Lower as Anthropic Commits $11.6 Billion Elsewhere");
});
