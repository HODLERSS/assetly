// r13 intelligence M1: code answers that answer the question, and a weekend-aware "Today" line.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { fixBookDayClaims, fixCurrentPriceClaims, fixGroupSharePctFirst, intentAnswer, type IntentRow, sessionDayLine, TECH_GROUP_LABEL, dualClassFacts } from "./intel.ts";

Deno.test("r31 final: ETF intent, honest fallback for non-performance questions, stocks-and-funds base", async () => {
  const { isPerformanceQuestion, honestFallback, fixEquityBaseClaims } = await import("./intel.ts");
  const rs: IntentRow[] = [
    { name: "SOXL", symbol: "SOXL", kind: "etf", usd: 6058, weight: 23.4, qty: 40, currency: "USD", price: 151.45, avgCost: 35, costUsd: 1400, glUsd: 4658, dayPct: 3.5, dayUsd: 204, leveraged: true, tech: true },
    { name: "VOO", symbol: "VOO", kind: "etf", usd: 3554, weight: 13.8, qty: 5, currency: "USD", price: 710, avgCost: 450, costUsd: 2250, glUsd: 1304, dayPct: 0.5, dayUsd: 18 },
    { name: "AAPL", symbol: "AAPL", kind: "stock", usd: 3411, weight: 13.2, qty: 10, currency: "USD", price: 341, avgCost: 180, costUsd: 1800, glUsd: 1611, dayPct: 0.1, dayUsd: 3 },
    { name: "ETH", symbol: "ETH", kind: "crypto", usd: 2687, weight: 10.4, qty: 1, currency: "USD", price: 2687, avgCost: 2500, costUsd: 2500, glUsd: 187, dayPct: -0.4, dayUsd: -11 },
  ];
  const e = intentAnswer("What is an ETF, and which of mine are ETFs?", rs, [], { totalUsd: 25837, sessionLabel: "in Friday's session", athTracked: false })!;
  assert(e.includes("An ETF (exchange-traded fund)") && e.includes("Your ETFs and funds: SOXL 23.4% (a 3x leveraged fund), VOO 13.8%") && e.includes("Single stocks: AAPL") && e.includes("Crypto: ETH"), e);
  assert(!isPerformanceQuestion("What is an ETF, and which of mine are ETFs?"));
  assert(isPerformanceQuestion("How did I do this week?"));
  const h = honestFallback(rs, 11.6);
  assert(h.startsWith("I couldn't put a complete answer together just now. Here's what I can tell you:") && h.includes("SOXL (leveraged ETF) 23.4%") && h.includes("ETH (crypto)"), h);
  assertEquals(fixEquityBaseClaims("Stocks and funds lose about $9,700 from the $22,837 invested there.", 20150, 2687), "Stocks and funds lose about $9,700 from the $20,150 invested there.");
  assertEquals(fixEquityBaseClaims("Stocks and funds: $20,150.", 20150, 2687), "Stocks and funds: $20,150.");
});

Deno.test("r31 final intelligence: cut-off first line goes; the lead is restored (C09, C13)", async () => {
  const { stripLeadFragment, bookWindowLead, ensureLeads } = await import("./intel.ts");
  const c09 = "**SemiAnalysis는 GPU 수요가 극단적이라 했고, Micron은 신제품 효과 지연을 경고\n• AAPL 13.6%, MSFT 13.2%, META 12.8% 순입니다.";
  const s09 = stripLeadFragment(c09);
  assertEquals(s09, "• AAPL 13.6%, MSFT 13.2%, META 12.8% 순입니다.");
  const out09 = ensureLeads(s09, [{ line: "• 비중이 가장 큰 종목: NVDA 19.2% ($675,210), AAPL 13.6% ($478,000), MSFT 13.2% ($464,000).", keys: ["NVDA"] }]);
  assert(out09.startsWith("• 비중이 가장 큰 종목: NVDA 19.2%"), out09);
  assertEquals(stripLeadFragment("Well, it depends...\n• NVDA is 19.2%."), "• NVDA is 19.2%.");
  assertEquals(stripLeadFragment("**NVDA** leads at 19.2%.\n• More."), "**NVDA** leads at 19.2%.\n• More.");
  const totals = "1W: +$41,200 (+1.2%) · 1M: +$190,300 (+5.9%) · YTD: +$351,034 (+11.5%) · 1Y: +$802,000 (+29.5%)";
  const bl = bookWindowLead("What's my portfolio's YTD return?", totals)!;
  assertEquals(bl.line, "• Your portfolio this year: +$351,034 (+11.5%).");
  const c13 = "• Leaders: NVDA +38.1%, AAPL +22.0%.\n• Drags: TSLA −12.3%, AVGO −4.0%.";
  assert(ensureLeads(c13, [bl]).startsWith("• Your portfolio this year: +$351,034 (+11.5%)."));
  assertEquals(ensureLeads("Your portfolio is up +11.5% this year.", [bl]), "Your portfolio is up +11.5% this year.");
});

Deno.test("r31 e2e p02: the honest fallback never trails an answer (F2); a compare covers every named holding (F3); cash drag (F5)", async () => {
  const { mergeLeadAndFallback, isHonestFallback, ensureLeads, cashDragClaims, unheldTickersIn } = await import("./intel.ts");
  const lead = "• 3 of your holdings are negative over 3 months: SK hynix −27.1%, Samsung −7.9%, TSLA −0.8%.";
  const honest = "I couldn't put a complete answer together just now. Here's what I can tell you:\n• Your holdings: BTC (crypto) 25.2%, NVDA (stock) 19.2%.\n• Try asking again, or rephrase the question.";
  assertEquals(mergeLeadAndFallback(lead, honest), lead);
  assertEquals(mergeLeadAndFallback("", honest), honest);
  assertEquals(mergeLeadAndFallback(lead, "• Today your portfolio is +0.27% (+$9,447).\n• Longer windows: 1M +5.9%."), `${lead}\n• Today your portfolio is +0.27% (+$9,447).\n• Longer windows: 1M +5.9%.`);
  assert(isHonestFallback(honest) && !isHonestFallback(lead));
  const cmpLead = "• NVDA: 1M +5.6%, 1Y +26.7%.\n• AVGO: 1M +2.1%, 1Y +40.3%.";
  const modelOnlyNvda = "• NVDA: 1 month +5.6%, 1 year +26.7%. It is 19.2% of your portfolio.";
  const fixed = ensureLeads(modelOnlyNvda, [{ line: cmpLead, keys: ["5.6%", "26.7%", "2.1%", "40.3%", "NVDA", "AVGO"] }]);
  assert(fixed.startsWith(cmpLead) && fixed.includes("AVGO: 1M +2.1%"), fixed);
  assertEquals(unheldTickersIn("Compare NVDA and AVGO over 1M and 1Y", ["NVDA", "AAPL"]), ["AVGO"]);
  assertEquals(unheldTickersIn("Compare NVDA and AVGO over 1M and 1Y", ["NVDA", "AVGO"]), []);
  assertEquals(unheldTickersIn("How is my YTD ETF return vs the S&P?", ["VOO"]), []);
  assertEquals(cashDragClaims("Up 13.6% this year ($11,781). Cash in your emergency fund earns nothing, so it drags the total down.").length, 1);
  assertEquals(cashDragClaims("Cash is 15.9% of assets."), []);
});

Deno.test("r31 brief: the live row's exact wording is caught", async () => {
  const { productVersionClaims, lowYieldIncomeClaims } = await import("./intel.ts");
  assertEquals(productVersionClaims("Apple rose on iPhone 17 launch optimism.", "Apple's iPhone 18 lineup ships in stores").length, 1);
  assertEquals(lowYieldIncomeClaims("The 0.7% yield adds meaningful income to your portfolio.", 0.7).length, 1);
});

Deno.test("r31 r14 A+B: risk intent, share classes, tech-and-chip share figure-first", () => {
  const rs: IntentRow[] = [
    { name: "SOXL", symbol: "SOXL", kind: "etf", usd: 6045, weight: 23.4, qty: 40, currency: "USD", price: 151.45, avgCost: 35, costUsd: 1400, glUsd: 4645, dayPct: 3.5, dayUsd: 204, leveraged: true, tech: true },
    { name: "AAPL", symbol: "AAPL", kind: "stock", usd: 3410, weight: 13.2, qty: 10, currency: "USD", price: 341, avgCost: 180, costUsd: 1800, glUsd: 1610, dayPct: 0.1, dayUsd: 3, tech: true },
    { name: "TSLA", symbol: "TSLA", kind: "stock", usd: 2971, weight: 11.5, qty: 8, currency: "USD", price: 371, avgCost: 250, costUsd: 2000, glUsd: 971, dayPct: -1.5, dayUsd: -45, tech: false },
  ];
  const r = intentAnswer("What's my biggest risk right now?", rs, [], { totalUsd: 25837, sessionLabel: "in Friday's session", athTracked: false, cashPct: 11.6 })!;
  assert(r.includes("Largest holding: SOXL, 23.4%") && r.includes("Tech and chip holdings: 36.6%") && r.includes("SOXL is a leveraged fund") && r.includes("Cash: 11.6%"), r);
  assert(dualClassFacts("What's the difference between BRK.B and BRK.A?").length > 0);
  const g = [{ label: TECH_GROUP_LABEL, value: 48.1 }];
  assertEquals(fixGroupSharePctFirst("About 70% of your money sits in tech and chip stocks.", g), "About 48.1% of your money sits in tech and chip stocks.");
  assertEquals(fixGroupSharePctFirst("About 49% of your money sits in tech stocks.", g), "About 49% of your money sits in tech stocks.");
});

Deno.test("r31 M2: the whole-book day figure is Home's; a current price is the latest price", () => {
  const hs = [{ names: ["AMZN"] }, { names: ["NVDA"] }];
  assertEquals(fixBookDayClaims("Portfolio gained ≈ $11,155 on Friday, about 0.32%.", { usd: 9447, pct: 0.27 }, hs), "Portfolio gained $9,447 on Friday, about 0.27%.");
  assertEquals(fixBookDayClaims("Your portfolio was +$9,450 (+0.27%) in Friday's session.", { usd: 9447, pct: 0.27 }, hs), "Your portfolio was +$9,450 (+0.27%) in Friday's session.");
  assertEquals(fixBookDayClaims("AMZN added $377 to the portfolio on Friday.", { usd: 9447, pct: 0.27 }, hs), "AMZN added $377 to the portfolio on Friday.");
  assertEquals(fixBookDayClaims("The portfolio is up $410,000 this year.", { usd: 9447, pct: 0.27 }, hs), "The portfolio is up $410,000 this year.");
  const f = [{ names: ["NVDA"], price: 225.07, prevClose: 224.58 }];
  assertEquals(fixCurrentPriceClaims("NVDA's current price: previous session close $224.58, up 0.2%.", f), "NVDA's current price: latest close $225.07, up 0.2%.");
  assertEquals(fixCurrentPriceClaims("NVDA closed Thursday at $224.58.", f), "NVDA closed Thursday at $224.58.");
});

const row = (o: Partial<IntentRow> & { name: string; usd: number }): IntentRow => ({ symbol: o.name, kind: "stock", weight: 0, qty: 10, currency: "USD", price: 100, avgCost: null, costUsd: null, glUsd: null,
  dayPct: 0, dayUsd: 0, heads: [], ...o });
const TOTAL = 3519234;
const rows = [
  row({ name: "NVDA", usd: 675210, weight: 19.2, costUsd: 300000, glUsd: 375210, avgCost: 100, qty: 3000 }),
  row({ name: "META", usd: 450996, weight: 12.8, dayPct: -3.3, dayUsd: -15390, heads: [{ title: "Meta loses jury verdict", source: "Reuters", date: "09/25" }] }),
  row({ name: "TSLA", usd: 260477, weight: 7.4, costUsd: 174090, glUsd: 86387, avgCost: 217.61, qty: 800, price: 325.6, maxClose: 479.86 }),
  row({ name: "AAPL", usd: 478000, weight: 13.6, costUsd: 200000, glUsd: 278000, price: 341.07, maxClose: 341.07 }),
  row({ name: "AVGO", usd: 91731, weight: 2.6 }),
  row({ name: "SOXL", usd: 100000, weight: 2.8, kind: "etf", leveraged: true }),
];
const ctx = { totalUsd: TOTAL, sessionLabel: "in Friday's session", athTracked: true };

Deno.test("r31 M1(b): the Today line on a closed day names the session and Home's figure", () => {
  assertEquals(sessionDayLine({ open: false, usd: 9447, pct: 0.27, weekday: "Friday" }), "• Markets are closed; in Friday's session your portfolio was +$9,447 (+0.27%).");
  assertEquals(sessionDayLine({ open: true, usd: -120, pct: -0.01, weekday: "Friday" }), "• Today your portfolio is −0.01% (−$120).");
});

Deno.test("r31 M1(a): smallest holding, cost basis, why, stress, tax, ATH", () => {
  const small = intentAnswer("What's my smallest holding?", rows, [], ctx)!;
  assert(small.startsWith("• Your smallest holdings: AVGO 2.6%"), small);
  const basis = intentAnswer("What's my cost basis in TSLA?", rows, [rows[2]], ctx)!;
  assert(basis.includes("TSLA: cost basis $174,090 (800 shares at $217.61)") && basis.includes("+$86,387"), basis);
  const tot = intentAnswer("What's my total cost basis?", rows, [], ctx)!;
  assert(tot.includes("Total cost basis $674,090"), tot);
  const why = intentAnswer("Why did META drop today?", rows, [rows[1]], ctx)!;
  assert(why.includes("META fell 3.3% in Friday's session") && why.includes("Meta loses jury verdict") && why.includes("Reuters"), why);
  const nas = intentAnswer("What happens if the Nasdaq drops 20%?", rows, [], ctx)!;
  assert(/If every stock and fund you hold fell 20%/.test(nas) && /SOXL is a leveraged fund/.test(nas), nas);
  const one = intentAnswer("What if TSLA falls 20%?", rows, [rows[2]], ctx)!;
  assert(one.includes("If TSLA fell 20%: −$52,095"), one);
  const tax = intentAnswer("How much tax would I owe if I sold all my AAPL today?", rows, [rows[3]], ctx)!;
  assert(tax.includes("doesn't give tax advice") && tax.includes("AAPL: unrealized gain +$278,000"), tax);
  const ath = intentAnswer("Which of my stocks hit an all-time high today?", rows, [], ctx)!;
  assert(ath.includes("AAPL ($341.07)") && ath.includes("TSLA 32.1% below"), ath);
  assertEquals(intentAnswer("Which of my stocks hit an all-time high today?", rows, [], { ...ctx, athTracked: false }), "• Record highs aren't tracked yet.");
  assertEquals(intentAnswer("What's my most profitable holding?", rows, [], ctx), null);
});
