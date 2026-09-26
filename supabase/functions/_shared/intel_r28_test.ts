// r11 P4: wrong facts held to computed data.
import { assertEquals } from "jsr:@std/assert@1";
import { companySizeClaims, countClaims, directionCauseClaims, groupShareFirstClaims, pointContributionClaims, productVersionClaims, rankPositionClaims, relativeGapClaims } from "./intel.ts";

Deno.test("r28 P4: date gaps, company size, group shares, points, product generations, cause direction, counts, the drag", () => {
  const tsla = [{ names: ["TSLA", "Tesla"], dates: { earnings: "2026-10-21", deliveries: "2026-10-02", exdate: null } }];
  assertEquals(relativeGapClaims("TSLA Q3 deliveries ~Oct 2, one week before earnings.", tsla).length, 1);
  assertEquals(relativeGapClaims("TSLA Q3 deliveries ~Oct 2, about three weeks before earnings.", tsla), []);
  const caps = [{ names: ["NVDA"], mcap: 4.4e12 }, { names: ["AAPL"], mcap: 3.6e12 }];
  assertEquals(companySizeClaims("AAPL is the biggest company by far.", caps).length, 1);
  assertEquals(companySizeClaims("NVDA is the largest company you own.", caps), []);
  assertEquals(groupShareFirstClaims("About ~83% mega-cap tech (5 names).", [{ label: /(?:mega[- ]?cap )?tech/, value: 69.5 }]).length, 1);
  assertEquals(groupShareFirstClaims("About 70% mega-cap tech.", [{ label: /(?:mega[- ]?cap )?tech/, value: 69.5 }]), []);
  assertEquals(pointContributionClaims("TSLA는 약 15%p를 끌어내렸습니다.", [{ names: ["TSLA"], weight: 10, pct: { 30: -17 } }]).length, 1);
  assertEquals(pointContributionClaims("TSLA took about 1.7 points off.", [{ names: ["TSLA"], weight: 10, pct: { 30: -17 } }]), []);
  assertEquals(productVersionClaims("Apple's iPhone 17 cycle drove the gain.", "Apple iPhone 18 pre-orders beat estimates").length, 1);
  assertEquals(productVersionClaims("Apple's iPhone 18 cycle drove the gain.", "Apple iPhone 18 pre-orders beat estimates"), []);
  assertEquals(directionCauseClaims("META fell 3.3% after JPMorgan's bullish call.").length, 1);
  assertEquals(directionCauseClaims("META fell 3.3% after a jury verdict.").length, 0);
  const facts = [{ names: ["NVDA"] }, { names: ["TSLA"] }];
  assertEquals(countClaims("Your book holds nine single stocks.", facts, { stocks: 8, funds: 1, holdings: 9 }).length, 1);
  assertEquals(countClaims("Your book holds eight single stocks.", facts, { stocks: 8, funds: 1, holdings: 9 }), []);
  const f = [{ names: ["TSLA"], pct: { 30: -2 }, weight: 10 }, { names: ["AVGO"], pct: { 30: -4.4 }, weight: 10 }, { names: ["MSFT"], pct: { 30: 5 }, weight: 10 }];
  assertEquals(rankPositionClaims("TSLA was the drag this month.", f).length, 1);
  assertEquals(rankPositionClaims("AVGO was the drag this month.", f), []);
});
