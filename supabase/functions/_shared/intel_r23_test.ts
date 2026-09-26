// Round 9 judge re-check: scenario rankings, dangling references after drops, "Both" dates, Korean no-news claims,
// "leads YTD" outside a data-rank question.
import { assert, assertEquals, assertFalse } from "jsr:@std/assert@1";
import { bothDateClaims, danglingAfterDrop, isDecisionFrame, isScenarioRankQuestion, JUDGE_POLICY, misattributedCauses, superlativeClaims, YTD } from "./intel.ts";

Deno.test("r23: a scenario ranking of the holdings is a decision frame", () => {
  assert(isScenarioRankQuestion("If the Fed cuts rates next month, which of my stocks goes up the most?"));
  assert(isDecisionFrame("If the Fed cuts rates next month, which of my stocks goes up the most?"));
  assert(isScenarioRankQuestion("Which of my holdings would benefit most from a weaker dollar?"));
  assertFalse(isScenarioRankQuestion("Which of my holdings rises the most this year?"));
});

Deno.test("r23: dangling after drops", () => {
  const asked = [{ names: ["NVDA", "Nvidia"] }, { names: ["AMZN", "Amazon"] }];
  const d = danglingAfterDrop("• NVDA is 19.2% of your portfolio. Both report late October (~Oct 29 est).", asked);
  assertEquals(d.dangling, ["Both report late October (~Oct 29 est)."]);
  assert(d.missing);
  assertEquals(danglingAfterDrop("• MSFT pays the most. AAPL is third.", []).dangling, ["AAPL is third."]);
  assertEquals(danglingAfterDrop("NVDA and AMZN both report this autumn.", asked), { dangling: [], missing: false });
});

Deno.test("r23: 'Both report …' needs one date for every holding it covers", () => {
  const ests = [{ names: ["NVDA", "Nvidia"], est: "2026-11-25" }, { names: ["AMZN", "Amazon"], est: "2026-10-29" }];
  const asked = [{ names: ["NVDA"] }, { names: ["AMZN"] }];
  assertEquals(bothDateClaims("Both report late October (~Oct 29 est).", ests, asked).length, 1);
  assertEquals(bothDateClaims("Both report late October.", [ests[1], { names: ["MSFT"], est: "2026-10-28" }], [{ names: ["AMZN"] }, { names: ["MSFT"] }]), []);
});

Deno.test("r23: Korean no-headline claims and 'leads YTD'", () => {
  const facts = [{ names: ["META", "Meta", "메타"], headlines: "Mark Zuckerberg Loses $9 Billion In A Day Amid AI Overspending Fears" }];
  assertEquals(misattributedCauses("메타는 헤드라인에 오늘 하락 직접 원인 없음.", facts).length, 1);
  assertEquals(misattributedCauses("메타 하락을 설명하는 헤드라인이 없습니다.", facts).length, 1);
  const f2 = [{ names: ["NVDA"], windows: { [YTD]: 20.7 } }, { names: ["AAPL"], windows: { [YTD]: 25.5 } }];
  assertEquals(superlativeClaims("Among your stocks, NVDA leads YTD at +20.7%.", f2).length, 1);
  assertEquals(superlativeClaims("AAPL leads YTD at +25.5%.", f2), []);
});

Deno.test("r23: the judge policy names soft praise, benefit framing and scenario rankings", () => {
  assert(/showing solid growth/.test(JUDGE_POLICY) && /opportunistic moves/.test(JUDGE_POLICY) && /feel rate cuts most/.test(JUDGE_POLICY));
});

Deno.test("r23 r10: grades, scores, personas and 'cooked' are verdict requests; data stays data", async () => {
  const { isDecisionFrame, adviceHits } = await import("./intel.ts");
  for (const q of ["Grade each of my holdings A to F", "letter grade AMZN", "Rate my portfolio 1-10", "How diversified am I, 1-10?", "What would Buffett do with my portfolio?",
    "Would Buffett buy NVDA here?", "TSLA cooked 된거야?", "Is TSLA cooked?", "테슬라 끝났어?", "내 보유 종목에 점수를 매겨줘"]) assert(isDecisionFrame(q), q);
  for (const q of ["Is AAPL over $300?", "What happens if the Fed cuts rates?", "What's my 1-year return?"]) assertFalse(isDecisionFrame(q), q);
  for (const s of ["Thesis isn't broken, it's being tested.", "Cloud is the new engine.", "The deal makes robotaxi optionality real.", "Grade: B.", "MSFT is not stretched on that metric.", "Trend intact.", "Dividend is modest but compounding.", "현금 3.4%는 낮은 수준입니다.", "현금이 채권 대체 일부 가능합니다."])
    assert(adviceHits(s).length > 0, s);
  assertEquals(adviceHits("If Search holds, the trend would stay intact."), []);
});
