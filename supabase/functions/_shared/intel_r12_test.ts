// Run: npx -y deno@2 test --allow-read supabase/functions/_shared/
// Round 7 intelligence + poweruser audit (showcase book: NVDA 19.2%, AAPL 13.6%, MSFT 13.2%, META 12.8%, …).
import { assert, assertEquals, assertFalse, assertStringIncludes } from "jsr:@std/assert@1";
import {
  buildHusk, digitsForWritten, dropInstructionEcho, fixFractions, fixWeights, holdingRankClaims, holdingRankPremise, isPickQuestion, isRankQuestion,
  isSellQuestion, labelClosedMoves, labelLiveFigures, normalizeBullets, perLine, plainDataWords, stripAdvice, suggestionHits, tidyNumbers, valuationHits,
  weightAsMoveHits, withNoCallLine, wrongYieldClaims,
} from "./intel.ts";
import { backfillUrl } from "./history.ts";

const book = [
  { names: ["NVDA", "Nvidia", "엔비디아"], weight: 19.2 }, { names: ["AAPL", "Apple", "애플"], weight: 13.6 }, { names: ["MSFT", "Microsoft", "마이크로소프트"], weight: 13.2 },
  { names: ["META", "Meta", "메타"], weight: 12.8 }, { names: ["TSLA", "Tesla", "테슬라"], weight: 4.1 },
];

Deno.test("r12 MAJOR 1: a bulleted multi-line answer survives the whole guard chain unchanged", () => {
  const answer = "• Today: up $9,447 (+0.27%).\n• Past week: up $61,200 (+1.8%).\n• Past month: up $152,000 (+4.6%).\n• Largest holding: NVDA at 19.2% of your portfolio.";
  let x = normalizeBullets(answer);
  x = stripAdvice(x, { verdictQuestion: false });
  x = labelClosedMoves(x, []) || x;
  x = fixFractions(x, book, [{ label: /\bcash\b/i, value: 3.4 }]);
  x = fixWeights(x, book);
  x = dropInstructionEcho(x);
  x = withNoCallLine(x, "How much is my portfolio up today, and over the past week and month?");
  x = plainDataWords(tidyNumbers(digitsForWritten(x)));
  assertEquals(x, answer);
  // each transform on its own keeps the lines
  for (const f of [(t: string) => fixFractions(t, book), (t: string) => fixWeights(t, book), dropInstructionEcho]) assertEquals(f(answer).split("\n").length, 4);
  // a line the transform empties goes; the rest keep their bullets
  assertEquals(dropInstructionEcho("• Per the data block, NVDA pays $3,000.\n• NVDA is 19.2%."), "• NVDA is 19.2%.");
  assertEquals(perLine("• a\n\n• b", (l) => l.toUpperCase()), "• A\n\n• B");
  assertEquals(fixFractions("• Top holding: NVDA is a third of the portfolio.\n• Cash is small.", book), "• Top holding: NVDA is 19.2% of the portfolio.\n• Cash is small.");
});

Deno.test("r12 MAJOR 2: named buy suggestions under a decision question; exactly one opener; KR shortlist names", () => {
  const g1 = "Adding to the index fund (QQQM) would increase broad market exposure. Buying more dividend-paying shares like Microsoft or Broadcom could raise annual income. Consider more shares in under-weighted areas like Google or Amazon before earnings.";
  const names = [{ names: ["QQQM", "Nasdaq-100"] }, { names: ["MSFT", "Microsoft"] }, { names: ["AVGO", "Broadcom"] }, { names: ["GOOGL", "Google"] }, { names: ["AMZN", "Amazon"] }];
  assertEquals(suggestionHits(g1, names).length, 3);
  assertEquals(suggestionHits("애플을 더 담는 게 좋을 수 있어요.", [{ names: ["애플"] }]).length, 1);
  assertEquals(suggestionHits("NVDA is 19.2% of the portfolio and adding to it would lift the tech share.", [{ names: ["QQQM"] }]), []);
  // two stacked Korean refusals become one
  const b2 = "매매 결정은 고객님께 달려 있지만, 현금 활용에 참고할 점을 알려드릴게요.\n• 현금은 3.4%입니다.";
  const out = withNoCallLine(b2, "현금으로 뭘 사야 할까?");
  assertEquals(out, b2);
  const stacked = withNoCallLine("• 현금은 3.4%입니다. 매매 결정은 고객님께 달려 있습니다.", "현금으로 뭘 사야 할까?");
  assertEquals(stacked.match(/정해드릴 수 없|달려 있/g)?.length, 1);
  assert(stacked.startsWith("무엇을 살지는"));
  // a follow-up turn marked as a decision gets the opener even when its own wording is not a trade question
  assert(withNoCallLine("• Cash is 3.4%.", "and with the $120K instead?", "", "", true).startsWith("I can't tell you what to buy"));
});

Deno.test("r12 MAJOR 3: a false 'biggest holding' premise is corrected", () => {
  assertEquals(holdingRankPremise("Apple is my biggest holding. How exposed am I to iPhone sales?", book), "Your biggest holding is NVDA at 19.2%, not AAPL; AAPL is 13.6%.");
  assertEquals(holdingRankPremise("NVDA is my biggest holding, right?", book), null);
  assertEquals(holdingRankPremise("Tesla is my smallest position?", book), null);
  assertStringIncludes(holdingRankPremise("애플이 제일 큰 종목이지?", book, true) ?? "", "NVDA(19.2%)");
  assertEquals(holdingRankClaims("Apple is 13.6% of your portfolio, the biggest single holding.", book).length, 1);
  assertEquals(holdingRankClaims("NVDA is the biggest holding at 19.2%.", book), []);
});

Deno.test("r12 MAJOR 4: 'which' questions pass through; the husk fits sell, rank and one-holding questions", () => {
  for (const q of ["Which holdings report earnings next?", "How much dividend income do I get, and from which holdings?", "Which of my holdings pays the biggest dividend?"]) assertFalse(isPickQuestion(q), q);
  for (const q of ["Which stock should I dump?", "which one would you trim first?", "Which of my stocks should I sell?", "Which holding is the best to buy more of?"]) assert(isPickQuestion(q), q);
  assert(isSellQuestion("Should I sell TSLA or hold it?")); assert(isSellQuestion("which one would you trim first?")); assertFalse(isSellQuestion("What should I buy with $10K?"));
  assert(isRankQuestion("Rank my holdings from best to worst"));
  const base = { holdings: [{ name: "NVDA", symbol: "NVDA", kind: "stock", usd: 675000 }, { name: "AAPL", symbol: "AAPL", kind: "stock", usd: 477000 }, { name: "TSLA", symbol: "TSLA", kind: "stock", usd: 144000 }],
    cashUsd: 120000, assetsUsd: 3516000, today: "2026-09-25", reports: [], dividends: [{ name: "NVDA", annualUsd: 3000, nextEx: "2026-12-16", current: true }] };
  const sell = buildHusk({ ...base, mode: "sell" }, false);
  assertStringIncludes(sell, "What a seller usually weighs here");
  assertFalse(sell.includes("buyer"));
  assertStringIncludes(sell, "at the current rate");
  const rank = buildHusk({ ...base, mode: "rank", returns1m: { NVDA: 5.6, AAPL: 10.1, TSLA: -3.2 } }, false);
  assertStringIncludes(rank, "By weight: NVDA 19.2%, AAPL 13.6%, TSLA 4.1%.");
  assertStringIncludes(rank, "By 1-month return: AAPL +10.1%, NVDA +5.6%, TSLA -3.2%.");
  const focus = buildHusk({ ...base, mode: "sell", focus: { name: "TSLA", weight: 4.1, usd: 144000, gainUsd: 38000, dayPct: -1.5, r1m: -3.2, r3m: 12.4, report: "~Oct 21" } }, false);
  assertStringIncludes(focus, "TSLA is 4.1% of your portfolio ($144,000), up $38,000 since you bought.");
  assertStringIncludes(focus, "today -1.5%, 1 month -3.2%, 3 months +12.4%");
  assertStringIncludes(focus, "What a seller usually weighs here");
  // reports come in date order
  const dated = buildHusk({ ...base, reports: [{ name: "AAPL", est: "2026-10-29" }, { name: "TSLA", est: "2026-10-21" }, { name: "MSFT", est: "2026-10-28" }] }, false);
  assertStringIncludes(dated, "TSLA ~Oct 21, MSFT ~Oct 28, AAPL ~Oct 29");
});

Deno.test("r12 MAJOR 5: a figure after a move verb is never rewritten to a weight; stored weight-as-move and wrong yields are caught", () => {
  const hs = [{ names: ["META", "Meta"], weight: 12.8 }, { names: ["MSFT", "Microsoft"], weight: 13.2 }];
  assertEquals(fixWeights("META dropped 3.3% and makes up 12.8% of assets.", hs), "META dropped 3.3% and makes up 12.8% of assets.");
  assertEquals(fixWeights("MSFT climbed 3.7%, a 13.2% weight.", hs), "MSFT climbed 3.7%, a 13.2% weight.");
  assertEquals(fixWeights("META is 15.0% of assets.", hs), "META is 12.8% of assets.");
  const facts = [{ names: ["META", "Meta"], weight: 12.8, pct: -3.33 }, { names: ["MSFT", "Microsoft"], weight: 13.2, pct: 3.66 }];
  assertEquals(weightAsMoveHits("META dropped 12.8% and makes up 12.8% of assets. MSFT climbed 3.7%.", facts), ["META dropped 12.8% and makes up 12.8% of assets."]);
  assertEquals(wrongYieldClaims("Your dividend yield sits near 0.5%.", [0.3, 0.34]).length, 1);
  assertEquals(wrongYieldClaims("Your dividend yield is 0.34% at the current rate.", [0.3, 0.34]), []);
});

Deno.test("r12 MAJOR 6: card verdicts in the app's voice", () => {
  for (const s of ["Friday's 3.3% drop is a cooldown after a 31.9% monthly surge, not a thesis break.", "The Cambridge Analytica jury loss is a legal headline, not a near-term financial hit.",
    "It makes Google Cloud the clear second growth engine.", "A $2T IPO would double that on paper.", "A $211 gain lifts the book, keeping the portfolio on track."]) {
    assertEquals(valuationHits(s).length, 1, s);
  }
  assertEquals(valuationHits("Morningstar says the thesis remains intact after the quarter."), []);
});

Deno.test("r12 minor + poweruser: live figures labelled, 5y backfill starts two weeks early", () => {
  assertEquals(labelLiveFigures("A $211 gain lifts today's book to $116,500.", [211, 116620], "as of 4:05 PM ET"), "A $211 gain lifts today's book to $116,500 (as of 4:05 PM ET).");
  assertEquals(labelLiveFigures("NVDA pays $3,000 a year.", [211, 116620], "as of 4:05 PM ET"), "NVDA pays $3,000 a year.");
  const now = Date.parse("2026-09-25T22:00:00Z");
  const u = backfillUrl("TSLA", "5y", now);
  const p1 = Number(/period1=(\d+)/.exec(u)![1]) * 1000;
  assert(new Date(p1).toISOString().slice(0, 10) <= "2021-09-11", new Date(p1).toISOString());
  assertStringIncludes(backfillUrl("TSLA", "1mo", now), "range=1mo");
});
