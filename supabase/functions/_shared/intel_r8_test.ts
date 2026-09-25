// Run: npx -y deno@2 test --allow-read supabase/functions/_shared/
// Round 6 live smoke (firstrun account during a KRX holiday), 2026-09-25: the husk path of Ask.
import { assert, assertEquals, assertFalse, assertStringIncludes } from "jsr:@std/assert@1";
import { buildHusk, dayMoveDump, type HuskInput, labelClosedMoves, normalizeBullets, themeOf, wrongDividendTiming } from "./intel.ts";

const book: HuskInput = {
  holdings: [
    { name: "BTC", symbol: "BTC-USD", kind: "crypto", usd: 25000 },
    { name: "NVDA", symbol: "NVDA", kind: "stock", usd: 18000 },
    { name: "VOO", symbol: "VOO", kind: "etf", usd: 15000 },
    { name: "SK hynix", symbol: "000660.KS", kind: "stock", usd: 9000 },
    { name: "AAPL", symbol: "AAPL", kind: "stock", usd: 8000 },
    { name: "KO", symbol: "KO", kind: "stock", usd: 6500 },
  ],
  cashUsd: 18500, assetsUsd: 100000, today: "2026-09-25",
  reports: [
    { name: "NVDA", est: "2026-11-18", range: ["2026-11-18", "2026-11-25"] },
    { name: "AAPL", est: "2026-10-29" },
    { name: "KO", est: "2027-01-10" },
  ],
  dividends: [
    { name: "VOO", annualUsd: 180, nextEx: "2026-12-22" },
    { name: "AAPL", annualUsd: 36, nextEx: "2026-11-09" },
    { name: "KO", annualUsd: 190, nextEx: "2026-11-30" },
    { name: "NVDA", annualUsd: 1, nextEx: "2026-12-04" },
  ],
};

Deno.test("r8 husk: 4-5 bullets, one per line, specific to this portfolio", () => {
  const en = buildHusk(book, false);
  const lines = en.split("\n");
  assert(lines.length >= 4 && lines.length <= 5, en);
  assert(lines.every((l) => l.startsWith("• ")));
  assertStringIncludes(en, "BTC 25.0%, NVDA 18.0%, VOO 15.0%");
  assertStringIncludes(en, "58% of the portfolio");
  assertStringIncludes(en, "crypto 25.0%");
  assertStringIncludes(en, "cash 18.5% ($18,500)");
  // reports inside 45 days (to Nov 9) only: AAPL ~Oct 29; NVDA (from Nov 18) and KO (January) are out
  assertStringIncludes(en, "(estimates): AAPL ~Oct 29.");
  assertFalse(/NVDA mid|KO ~Jan/.test(en));
  // dividends: income, and only ex-dates within 45 days (AAPL Nov 9; KO Nov 30 and VOO Dec 22 are out)
  assertStringIncludes(en, "KO, VOO, AAPL, NVDA pay about $407 a year together");
  assertStringIncludes(en, "in the next 45 days: AAPL ~Nov 9.");
  assertFalse(/KO ~Nov|VOO ~Dec/.test(en));
  // a span that starts inside the window counts
  assertStringIncludes(buildHusk({ ...book, today: "2026-10-10" }, false), "NVDA mid to late November");
  assertStringIncludes(en, "What a buyer usually weighs");
  // it never names anything to buy
  assertFalse(/\b(buy|add|consider) (NVDA|VOO|AAPL|KO|BTC)\b/i.test(en));
});

Deno.test("r8 husk: Korean version carries the same facts", () => {
  const ko = buildHusk(book, true);
  const lines = ko.split("\n");
  assert(lines.length >= 4 && lines.length <= 5, ko);
  assertStringIncludes(ko, "집중도");
  assertStringIncludes(ko, "암호화폐 25.0%");
  assertStringIncludes(ko, "현금 18.5%($18,500)");
  assertStringIncludes(ko, "배당락");
  assertFalse(/배당이 곧 들어오는/.test(ko));
});

Deno.test("r8 husk: no reports, no payers, no crypto still reads as 4-5 bullets", () => {
  const plain = buildHusk({ holdings: [{ name: "TSLA", symbol: "TSLA", kind: "stock", usd: 9000 }], cashUsd: 1000, assetsUsd: 10000, today: "2026-09-25", reports: [], dividends: [] }, false);
  assertEquals(plain.split("\n").length, 5);
  assertStringIncludes(plain, "No holding has an earnings report expected in the next 45 days.");
  assertStringIncludes(plain, "no holding pays a dividend on record");
  assertStringIncludes(plain, "how much to keep in cash (10.0% now)");
  assertStringIncludes(plain, "your only holding, TSLA, is 90%");
  // a sliver holding reads "under 0.1%" and its theme stays out of the mix line
  const sliver = buildHusk({ holdings: [{ name: "TSLA", symbol: "TSLA", kind: "stock", usd: 96800 }, { name: "VOO", symbol: "VOO", kind: "etf", usd: 2600 }, { name: "NVDA", symbol: "NVDA", kind: "stock", usd: 30 }], cashUsd: 570, assetsUsd: 100000, today: "2026-09-25", reports: [], dividends: [] }, false);
  assertStringIncludes(sliver, "your three largest holdings (TSLA 96.8%, VOO 2.6%, NVDA under 0.1%)");
  assertStringIncludes(sliver, "• Mix: EV and autos 96.8%, broad US index 2.6%, and cash 0.6% ($570).");
  assertStringIncludes(sliver, "already in the top three");
  assertEquals(themeOf("TSLA", "stock"), "EV and autos");
  assertEquals(themeOf("ETH-USD", null), "crypto");
});

Deno.test("r8 semicolon table: any 3+ short clauses become bullets", () => {
  const run = "• BTC down 0.9% (largest 25% weight); cash stable $18.5k; SK hynix up 1.2%; Samsung up 3.3%";
  const out = normalizeBullets(run).split("\n");
  assertEquals(out.length, 4);
  assertEquals(out[1], "• Cash stable $18.5k.");
  // long prose clauses joined by semicolons stay one bullet
  const prose = "• Nvidia leads the portfolio and moves it more than any other holding by a wide margin today; its report is expected in mid to late November with guidance as the swing factor; the rest of the book is diversified across funds and cash reserves for now";
  assertEquals(normalizeBullets(prose).split("\n").length, 1);
});

Deno.test("r8 closed market: day moves get their session or go", () => {
  const closed = [{ names: ["SK hynix", "000660.KS"], label: "Wed" }, { names: ["Samsung", "Samsung Electronics", "005930.KS"], label: "Wed" }];
  assertEquals(labelClosedMoves("• SK hynix up 1.2%.\n• Samsung up 3.3%.", closed), "• SK hynix up 1.2% (Wed).\n• Samsung up 3.3% (Wed).");
  assertEquals(labelClosedMoves("• SK hynix up 1.2% and Samsung Electronics up 3.3%.", closed), "• SK hynix up 1.2% (Wed) and Samsung Electronics up 3.3% (Wed).");
  // already labelled, or a window: untouched
  assertEquals(labelClosedMoves("• Samsung rose 3.3% on Wednesday.", closed), "• Samsung rose 3.3% on Wednesday.");
  assertEquals(labelClosedMoves("• SK hynix is up 12.4% over 1M.", closed), "• SK hynix is up 12.4% over 1M.");
  // called today's: dropped
  assertEquals(labelClosedMoves("• Samsung is up 3.3% today.\n• NVDA rose 1.1% today.", closed), "• NVDA rose 1.1% today.");
  // an open market's move is not touched
  assertEquals(labelClosedMoves("• NVDA up 1.1%.", closed), "• NVDA up 1.1%.");
  // Korean label, never doubled
  const kc = [{ names: ["삼성전자", "Samsung"], label: "수요일" }];
  assertEquals(labelClosedMoves("• 삼성전자 +3.3%.", kc), "• 삼성전자 +3.3% (수요일).");
  assertEquals(labelClosedMoves("• 삼성전자 +3.3% (수요일).", kc), "• 삼성전자 +3.3% (수요일).");
});

Deno.test("r8 pick answers that only list day moves are husks", () => {
  const h = [["BTC"], ["NVDA"], ["SK hynix"], ["Samsung"], ["VOO"]].map((names) => ({ names }));
  assert(dayMoveDump("• BTC down 0.9%.\n• NVDA up 1.1%.\n• SK hynix up 1.2%.\n• Samsung up 3.3%.", h));
  assertFalse(dayMoveDump("• NVDA is 18% of the portfolio and rose 1.1% today.\n• Its report is expected in mid to late November.", h));
});

Deno.test("r8 dividend timing is checked against the next ex-date", () => {
  const divs = [{ names: ["AAPL", "Apple"], nextEx: "2026-11-09" }, { names: ["VOO"], nextEx: "2026-12-22" }, { names: ["KO"], nextEx: "2026-10-01" }];
  // VOO is not within 45 days
  assertEquals(wrongDividendTiming("배당이 곧 들어오는 주식은 AAPL, VOO 등", divs, "2026-09-25").length, 1);
  assertEquals(wrongDividendTiming("Dividends are coming soon from VOO.", divs, "2026-09-25").length, 1);
  assertEquals(wrongDividendTiming("KO's dividend is coming up soon.", divs, "2026-09-25"), []);
  assertEquals(wrongDividendTiming("곧 배당락을 앞둔 종목은 AAPL입니다.", divs, "2026-09-25"), []);
  // no timing claim: untouched
  assertEquals(wrongDividendTiming("VOO pays about $180 a year.", divs, "2026-09-25"), []);
});
