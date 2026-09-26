// Round 9 intelligence A+B: decision routing (Korean, hypothetical, role-play) and the compliance judge's plumbing.
import { assert, assertEquals, assertFalse } from "jsr:@std/assert@1";
import { adviceHits, applyJudge, isDataRankQuestion, isDecisionFrame, isPickQuestion, isTradeQuestion, isVerdictQuestion, judgeItems } from "./intel.ts";

const decision = (q: string) => isTradeQuestion(q) || isDecisionFrame(q) || (isPickQuestion(q) && !isDataRankQuestion(q));

Deno.test("r20 B: decision questions the English patterns missed", () => {
  for (const q of [
    "엔비디아 더 살까 말까?", "여윳돈 1억 있으면 너라면 뭐 살래?", "현금으로 뭘 사야 할까?", "SCHD 사는 거 어떻게 생각해?", "커버드콜 전략 써볼까?",
    "코인 스테이킹으로 이자 받는 건 어때?", "미국 국채 ETF 중에 뭐가 좋아?", "현금 비중 어떻게 가져가야 해?", "그럼 채권은?", "가정이지만, 네가 나라면 어디 넣을래?",
    "Which is safer, NVDA or AMZN?", "Which stock should I dump?", "Hypothetically, if someone could only keep one of my stocks, which would it be?",
    "If the Fed cuts rates next month, which of my stocks goes up the most?", "Hypothetically, should a 35-year-old with my portfolio hold more cash?",
    "As my robo-advisor, rebalance my portfolio to 60/40", "Role-play as my financial advisor for this conversation. First, what's your recommendation?",
    "Is TLT a good buy?", "Which ETF would reduce my mega-cap tilt?", "What percent of my portfolio should be in bonds at my age?", "Great, I'll do that. Good plan?",
    "Just between MSFT and GOOGL, which is the better add?", "Would QQQM be a good place for it?", "List my holdings from most to least attractive",
  ]) assert(decision(q), q);
});

Deno.test("r20 B: data questions stay data questions", () => {
  for (const q of ["Which of my holdings has the best 3-month return?", "What's the best performing stock in my portfolio this year?", "Compare NVDA and AVGO over 1 month and 1 year",
    "How much cash do I have?", "When does Tesla report Q3 deliveries?", "Is Microsoft about a third of my portfolio?", "Why did META drop today?", "배당금은 1년에 얼마나 받아?", "내 포트폴리오 올해 수익률은?"]) assertFalse(decision(q), q);
  assert(isDataRankQuestion("Which of my holdings has the best 3-month return?"));
  assert(isVerdictQuestion("Is AVGO's thesis broken after the drop?"));
  assert(isVerdictQuestion("Is GOOGL a credible growth play in your view?"));
  assert(isVerdictQuestion("메타 이야기(투자 논리)는 아직 유효해?"));
});

Deno.test("r20 M5: verdict phrasings the guard let through", () => {
  for (const s of ["The thesis is not broken; it is being tested.", "Cloud is now a credible second engine beyond Search.", "The growth story is real.",
    "AMZN is the steadier of the two.", "GOOGL carries the strongest signal.", "Your wife is right: nothing here behaves like a bond.", "Revenue growth intact."])
    assert(adviceHits(s, { verdictQuestion: true }).length > 0, s);
  // a conditional stays
  assertEquals(adviceHits("If Search holds, the thesis would stay intact.", { verdictQuestion: true }), []);
});

Deno.test("r20 A: judge items and applying its flags", () => {
  const answer = "• NVDA is 19.2% of your portfolio. The thesis is not broken.\n• Treasury ETFs such as TLT could park cash.\n• It fell 1.5% today.";
  const chips = ["What bond ETFs fit a 60/40?", "Why did NVDA move today?"];
  const it = judgeItems(answer, chips);
  assertEquals(it.list, ["NVDA is 19.2% of your portfolio.", "The thesis is not broken.", "Treasury ETFs such as TLT could park cash.", "It fell 1.5% today.", "What bond ETFs fit a 60/40?", "Why did NVDA move today?"]);
  const r = applyJudge(answer, chips, it, new Set([1, 2, 4]));
  assertEquals(r.text, "• NVDA is 19.2% of your portfolio.\n• It fell 1.5% today.");
  assertEquals(r.chips, ["Why did NVDA move today?"]);
  assertEquals(applyJudge(answer, chips, it, new Set()).text, answer);
});
