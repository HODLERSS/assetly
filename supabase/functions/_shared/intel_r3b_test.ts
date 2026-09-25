// Run: npx -y deno@2 test --allow-read supabase/functions/_shared/
// Round-3 native review follow-ups (2026-09-25).
import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { earningsEstimate, earningsLine, historicalClaims, plainScrub, PORTFOLIO_PLAIN, spanOfMonth, wrongEarningsDates } from "./intel.ts";

Deno.test("plain words: book -> portfolio, tape -> market, names -> stocks; look-alikes stay", () => {
  const cases: [string, string][] = [
    ["Your book leans on two megacaps.", "Your portfolio leans on two megacaps."],
    ["The book's biggest risk is one theme.", "The portfolio's biggest risk is one theme."],
    ["A quiet tape left your tech names flat.", "A quiet market left your tech stocks flat."],
    ["Every single name here moved with Nvidia.", "Every single stock here moved with Nvidia."],
    ["Bank book value rose 4%.", "Bank book value rose 4%."],
    ["The company's name changed in May.", "The company's name changed in May."],
  ];
  for (const [a, b] of cases) assertEquals(plainScrub(a, PORTFOLIO_PLAIN), b);
});

Deno.test("history: a comparison with a year or an all-time level not in the data is dropped", () => {
  const src = "Headlines:\n- This Diversified Vanguard ETF Is at Its Most Concentrated Point Since 1965\n- Nvidia hits a record high";
  assertEquals(historicalClaims("Tech concentration at 1965 highs is the quiet risk.", "no such headline", "2026-09-25").length, 1);
  assertEquals(historicalClaims("Tech concentration at 1965 highs is the quiet risk.", src, "2026-09-25"), []);
  assertEquals(historicalClaims("The S&P 500 sits at an all-time high.", "no such headline", "2026-09-25").length, 1);
  assertEquals(historicalClaims("Nvidia closed at a record high.", src, "2026-09-25"), []);
  assertEquals(historicalClaims("Revenue grew 12% versus 2025.", "no such headline", "2026-09-25"), []);   // last year is not history
});

// NVDA's real filings: last report Aug 26, 2026; the same quarter a year earlier Nov 19, 2025
const f8 = (d: string) => ({ form: "8-K", filed_at: d, items: "2.02,9.01" });
const q = (d: string, form = "10-Q") => ({ form, filed_at: d });
const NVDA = [q("2026-08-26"), f8("2026-08-26"), q("2026-05-20"), f8("2026-05-20"), q("2026-02-25", "10-K"), f8("2026-02-25"), q("2025-11-19"), f8("2025-11-19"), q("2025-08-27"), f8("2025-08-27")];
const MSFT = [q("2026-07-29", "10-K"), f8("2026-07-29"), q("2025-10-29"), f8("2025-10-29"), q("2025-07-30", "10-K"), f8("2025-07-30")];
Deno.test("earnings: when last year's date and a quarter on disagree by >5 days, the estimate is a span, never a day", () => {
  const e = earningsEstimate(NVDA, [], "2026-09-25")!;
  assertEquals(e.range, ["2026-11-18", "2026-11-25"]);
  const line = earningsLine("Nvidia", NVDA, [], "2026-09-25")!;
  assertStringIncludes(line, "mid to late November");
  assertEquals(/~Nov \d/.test(line), false);
  // agreeing estimates keep their day
  assertEquals(earningsEstimate(MSFT, [], "2026-09-25")?.range, undefined);
  assertStringIncludes(earningsLine("Microsoft", MSFT, [], "2026-09-25")!, "~Oct 28 (est");
  assertEquals(spanOfMonth(["2026-10-21", "2026-10-28"]), "late October");
  assertEquals(spanOfMonth(["2026-11-28", "2026-12-03"]), "late November to early December");
  // a calendar item anywhere in the span passes; one far outside it is dropped
  const ests = [{ names: ["Nvidia"], est: e.est, range: e.range }];
  assertEquals(wrongEarningsDates(["Nvidia earnings Nov 25", "Nvidia earnings Nov 18", "Nvidia earnings Dec 10"], ests, "2026-09-25"), ["Nvidia earnings Dec 10"]);
});
