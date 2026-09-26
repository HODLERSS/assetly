// Run: npx -y deno@2 test --allow-read supabase/functions/_shared/
// Round 8 newcomer + native: one sanitize() for every surface, product denylist, parenthetical glosses, thesis concept,
// headline-anchored news, stale news, ETF ex-date, buildHusk mix.
import { assert, assertEquals, assertFalse, assertStringIncludes } from "jsr:@std/assert@1";
import { anchorNewsLine, buildHusk, glossParenthetical, parseDividends, productPushHits, sanitize, staleNewsTitle, valuationHits } from "./intel.ts";

Deno.test("r16: one sanitize() removes advice, verdicts, promo and product pushes, keeps lines, and can empty an idea", () => {
  assertEquals(sanitize("Crypto risk: hedge with stablecoin yield platforms to smooth volatility", { ideaSurface: true }), "");
  assertEquals(sanitize("• TSLA is down 17.3% this year.\n• Long-term AI and robotics thesis for Tesla is intact."), "• TSLA is down 17.3% this year.");
  assertEquals(sanitize("• NVDA is 19.2% of your portfolio.\n• It fell -1.5% today."), "• NVDA is 19.2% of your portfolio.\n• It fell −1.5% today.");
  assertEquals(sanitize("A $211 gain lifts today's book to $116,500, keeping the portfolio on track."), "A $211 gain lifts today's book to $116,500.");
  assertEquals(sanitize("No bond exposure: one driver moves everything", { ideaSurface: true }), "No bond exposure: one driver moves everything");
});

Deno.test("r16: product categories the app never points to", () => {
  for (const s of ["Idle cash: stablecoin yield platforms", "Consider a covered-call strategy for income.", "You could buy on margin to add exposure.", "Leveraged ETFs to boost upside.", "Look into crypto lending platforms for yield."]) {
    assertEquals(productPushHits(s).length, 1, s);
  }
  assertEquals(productPushHits("Staking platforms were in the news after an outage."), []);
  assertEquals(productPushHits("Staking platforms were in the news after an outage.", true).length, 1);
});

Deno.test("r16: 'thesis … intact' in any order is a verdict; attributed or conditional stays", () => {
  for (const s of ["Long-term AI and robotics thesis … is intact.", "The thesis remains intact despite the drop.", "Tesla's long-term story still holds.", "The case is unchanged."]) assertEquals(valuationHits(s).length, 1, s);
  assertEquals(valuationHits("Whether the thesis holds depends on the next delivery report."), []);
  assertEquals(valuationHits("Morningstar says the thesis is intact."), []);
});

Deno.test("r16: glosses are parenthetical and cannot break grammar", () => {
  assertEquals(glossParenthetical("It defends Amazon's retail moat and its moat in cloud."), "It defends Amazon's retail moat (lasting edge over competitors) and its moat in cloud.");
  assertEquals(glossParenthetical("A wide megacap gap of P/E."), "A wide megacap (biggest companies) gap of P/E (price tag against profits).");
  assertEquals(glossParenthetical("Its P/E is 60.", ["P/E"]), "Its P/E is 60.");
});

Deno.test("r16: news lines are the source headline; stale quarter previews go", () => {
  const heads = [{ symbol: "NVDA", names: ["NVDA", "Nvidia"], title: "Nvidia CEO Pushes Back On The 'AI Apocalypse' Narrative - Yahoo Finance" }, { symbol: "TSLA", names: ["TSLA", "Tesla"], title: "TSLA Stock Jumps 3% Ahead Of Q2 Report" }];
  // round 9: a line sharing one word with the headline is not its paraphrase: dropped, never swapped for it
  assertEquals(anchorNewsLine("NVDA CEO warns AI slowdown risk despite hype", heads), null);
  assertEquals(anchorNewsLine("Nvidia CEO pushes back on the AI apocalypse narrative", heads), "Yahoo Finance: Nvidia CEO Pushes Back On The 'AI Apocalypse' Narrative".replace("Yahoo Finance: ", ""));
  assertEquals(anchorNewsLine("AAPL iPhone demand firm", heads), null);
  assert(staleNewsTitle("TSLA Stock Jumps 3% Ahead Of Q2 Report", "2026-09-25T10:00:00Z", "2026-09-25"));
  assertFalse(staleNewsTitle("Tesla stock slides ahead of Q3 deliveries", "2026-09-25T10:00:00Z", "2026-09-25"));
  assert(staleNewsTitle("Apple unveils new Watch", "2026-09-01T10:00:00Z", "2026-09-25"));
});

Deno.test("r16: VOO's ex-date is Sep 28 (year-ago analogue before the after-today test)", () => {
  const ts = (ymd: string) => Date.parse(ymd + "T13:30:00Z") / 1000;
  const body = { chart: { result: [{ events: { dividends: Object.fromEntries(["2024-12-23", "2025-03-27", "2025-06-30", "2025-09-29", "2025-12-22", "2026-03-27", "2026-06-26"].map((d, i) => [String(i), { amount: 1.8, date: ts(d) }])) } }] } };
  assertEquals(parseDividends(body, 710, "2026-09-25", "VOO")!.nextEx, "2026-09-28");
});

Deno.test("r16: the husk Mix line covers every theme (TSLA's EV theme was left out)", () => {
  const hs = [["NVDA", 30], ["AAPL", 20], ["QQQM", 15], ["BTC-USD", 10], ["TSLA", 8], ["VOO", 7]].map(([s, u]) => ({ name: String(s), symbol: String(s), kind: s === "BTC-USD" ? "crypto" : s === "QQQM" || s === "VOO" ? "etf" : "stock", usd: Number(u) * 100 }));
  const h = buildHusk({ holdings: hs, cashUsd: 1000, assetsUsd: 10000, today: "2026-09-25", reports: [], dividends: [] }, false);
  assertStringIncludes(h, "EV and autos 8.0%");
});
