// Round 9 v44 re-check items 4-6: ordering, metric superlatives, cross-holding P/E, won conversion, market and dividend
// leads, counts.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { countClaims, crossMetricClaims, dividendLead, marketLead, metricSuperlativeClaims, orderingClaims, peFigures, wonConversionClaims } from "./intel.ts";

const names = [{ names: ["NVDA", "Nvidia"] }, { names: ["AAPL", "Apple"] }, { names: ["MSFT", "Microsoft"] }, { names: ["AVGO", "Broadcom"] }, { names: ["TSLA", "Tesla"] }, { names: ["GOOGL", "Alphabet"] }];

Deno.test("r24: an order its own figures contradict", () => {
  assertEquals(orderingClaims("YTD leader is NVDA at +20.7%, followed by AAPL +25.5%.", names).length, 1);
  assertEquals(orderingClaims("AAPL leads YTD at +25.5%, followed by NVDA +20.7%.", names), []);
  assertEquals(orderingClaims("NVDA is up 20.7% and AAPL 25.5%.", names), []);
});

Deno.test("r24: highest / lowest on a computed metric", () => {
  const f = [{ names: ["MSFT"], yieldPct: 0.7, weight: 13.2 }, { names: ["AVGO"], yieldPct: 0.74, weight: 5 }, { names: ["NVDA"], yieldPct: 0.02, weight: 19.2 }];
  assertEquals(metricSuperlativeClaims("MSFT has the highest yield at 0.7%.", f).length, 1);
  assertEquals(metricSuperlativeClaims("AVGO has the highest yield at 0.74%.", f), []);
  assertEquals(metricSuperlativeClaims("NVDA is your largest position.", f), []);
  assertEquals(metricSuperlativeClaims("MSFT is your largest position.", f).length, 1);
});

Deno.test("r24: a P/E from another holding", () => {
  assertEquals(peFigures("Alphabet trades at 17x forward earnings; P/E of 32 for MSFT"), [17, 32]);
  const f = [{ names: ["MSFT"], pes: [32] }, { names: ["GOOGL"], pes: [17] }];
  assertEquals(crossMetricClaims("MSFT trades at 17x P/E.", f).length, 1);
  assertEquals(crossMetricClaims("MSFT trades at 32x earnings.", f), []);
});

Deno.test("r24: $10 billion is not 10조", () => {
  assertEquals(wonConversionClaims("걸프 10조 클라우드 투자가 발표됐습니다.", "Microsoft plans $10 billion Gulf cloud push", 1355).length, 1);
  assertEquals(wonConversionClaims("걸프 13.6조 클라우드 투자.", "Microsoft plans $10 billion Gulf cloud push", 1355), []);
});

Deno.test("r24: market and dividend leads, counts", () => {
  assertEquals(marketLead("How did the market do today?", [{ label: "S&P 500", pct: 0.52, price: 7743.41 }], false), "• The market: S&P 500 +0.5% (7,743.41).");
  assertEquals(marketLead("How did NVDA do today?", [{ label: "S&P 500", pct: 0.52 }], false), null);
  assert(dividendLead("Which of my holdings pays the biggest dividend?", [{ label: "MSFT", annual: 3300, yieldPct: 0.7 }, { label: "AAPL", annual: 1500, yieldPct: 0.31 }, { label: "NVDA", annual: 30, yieldPct: 0.02 }], false)!.includes("MSFT $3,300 (0.70%), AAPL $1,500"));
  assertEquals(countClaims("Two holdings are in the red: TSLA −1.5%.", names).length, 1);
  assertEquals(countClaims("Two holdings are in the red: TSLA and AVGO.", names), []);
});
