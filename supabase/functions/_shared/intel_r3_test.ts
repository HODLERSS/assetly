// Run: npx -y deno@2 test --allow-read supabase/functions/_shared/
// Round-3 audit (2026-09-25, after the round-2b deploy): every string here was served to a user.
import { assert, assertEquals, assertFalse } from "jsr:@std/assert@1";
import {
  adviceHits, brokenSentences, CARD_PLAIN, cardCopyHits, curatedListHits, deliveriesEstimate, fixGlossArticles, isPickQuestion, isTradeQuestion,
  normalizeBullets, plainScrub, unsupportedDated, valuationHits, withNoCallLine, wrongDeliveriesDates,
} from "./intel.ts";

Deno.test("r3 advice: where the user's cash should go is a trade question (EN + KO); data questions stay allowed", () => {
  for (const q of ["If you had my $120K cash, where would it go?", "where should I put my cash?", "What should I buy with my $10K?", "what would you do with my cash?",
    "what do you recommend I do with my cash?", "invest my savings where?", "what is the one stock you would dump right now?", "현금 1억으로 뭘 사면 좋을까요?", "예수금 어디에 넣을까요?", "여윳돈으로 무엇을 사면 좋을까요?"]) {
    assert(isTradeQuestion(q), q);
  }
  for (const q of ["how much cash do I hold?", "what is my cash as a share of assets?", "현금 비중이 얼마예요?"]) assertFalse(isTradeQuestion(q), q);
  assert(isPickQuestion("what's the one stock you'd dump right now"));
  assert(isPickQuestion("If you had my $120K cash, where would it go?"));
  assertFalse(isPickQuestion("why did NVDA fall today?"));
});

const BOOK = [
  { symbol: "MSFT", names: ["MSFT", "Microsoft"] }, { symbol: "NVDA", names: ["NVDA", "Nvidia"] }, { symbol: "META", names: ["META", "Meta"] },
  { symbol: "AVGO", names: ["AVGO", "Broadcom"] }, { symbol: "AMZN", names: ["AMZN", "Amazon"] }, { symbol: "TSLA", names: ["TSLA", "Tesla"] },
];
Deno.test("r3 advice: a shortlist answering a pick question is caught; a whole-book fact table is not", () => {
  const dump = "That's your call; here's what each carries.\n• **META**: fell 3.4% Friday after a 31% month.\n• **AVGO**: China risk headline.\n• **AMZN**: down 4.3% over 1 month.\n• **TSLA**: robotaxi execution risk.";
  assertEquals(curatedListHits(dump, BOOK).length, 4);
  const cash = "**MSFT**: cloud and AI tools drive real revenue growth.\n**NVDA**: more would put extra weight on one stock.";
  assertEquals(curatedListHits(cash, BOOK).length, 2);
  const table = BOOK.map((b) => `• ${b.symbol}: one neutral fact.`).join("\n");
  assertEquals(curatedListHits(table, BOOK), []);
  assertEquals(curatedListHits("Concentration is the main driver of your book.", BOOK), []);
});

Deno.test("r3 opener: the model's own 'the call is yours' / '본인 판단' is recognised, so no second opener", () => {
  assertEquals(withNoCallLine("The call is yours; here is what each side rests on.", "What's your top pick?"), "The call is yours; here is what each side rests on.");
  assertEquals(withNoCallLine("Decision is yours. • NVDA carries the most weight.", "which would you keep?"), "Decision is yours. • NVDA carries the most weight.");
  const ko = "정리 여부는 본인 판단이지만 근거는 이렇습니다.";
  assertEquals(withNoCallLine(ko, "제 입장이라면 어떤 종목을 정리할까요?"), ko);
});

Deno.test("r3 bullets: '• A. • B.' on one line becomes one bullet per line", () => {
  assertEquals(normalizeBullets("• NVDA trades at 32x. • Growth is 60%. • Margins are 75%."), "• NVDA trades at 32x.\n• Growth is 60%.\n• Margins are 75%.");
  assertEquals(normalizeBullets("Plain sentence."), "Plain sentence.");
});

Deno.test("r3 facts: deliveries are ~2 days after the quarter ends, not earnings; an invented deliveries date is caught", () => {
  assertEquals(deliveriesEstimate("TSLA", "2026-09-25"), { quarter: "Q3 2026", est: "2026-10-02" });
  assertEquals(deliveriesEstimate("TSLA", "2026-10-01"), { quarter: "Q3 2026", est: "2026-10-02" });
  assertEquals(deliveriesEstimate("TSLA", "2026-10-03"), { quarter: "Q4 2026", est: "2027-01-02" });
  assertEquals(deliveriesEstimate("NVDA", "2026-09-25"), null);
  const facts = [{ names: ["TSLA", "Tesla"], est: "2026-10-02" }, { names: ["NVDA", "Nvidia"], est: null }];
  assertEquals(wrongDeliveriesDates("StoneX stays bullish into TSLA's Q3 deliveries due late October.", facts, "2026-09-25").length, 1);
  assertEquals(wrongDeliveriesDates("Tesla's Q3 deliveries report comes out Oct 2.", facts, "2026-09-25"), []);
  assertEquals(wrongDeliveriesDates("Tesla's deliveries land in early October.", facts, "2026-09-25"), []);
  assertEquals(wrongDeliveriesDates("Tesla reports earnings around Oct 21.", facts, "2026-09-25"), []);
  assertEquals(wrongDeliveriesDates("Q3 deliveries report lands ~Oct 2, weeks before earnings around Oct 21.", facts, "2026-09-25"), []);
});

Deno.test("r3 briefs: a dated claim with no date in the data is dropped; the estimates pass", () => {
  const source = "NEXT EARNINGS ESTIMATES:\n- Microsoft: next report expected around late October, ~Oct 28 (est)\n- Nvidia: ~Nov 18 (est)\nFRESH HEADLINES: Tesla's Q3 Sales Report Comes Out Oct. 2";
  assertEquals(unsupportedDated(["Microsoft earnings call Sep 28", "Meta AI spend guidance Sep 30", "Microsoft ~Oct 28 (est)", "Tesla Q3 sales Oct 2", "Nvidia expected around late November"], source, "2026-09-25"),
    ["Microsoft earnings call Sep 28", "Meta AI spend guidance Sep 30"]);
});

Deno.test("r3 cards: valuation framing, endorsement and pipeline wording never reach a card", () => {
  for (const s of ["Samsung's 45% undervaluation framing keeps value buyers interested.", "The dividend hike gives KO a clear near-term catalyst.", "AVGO is the top pick in chips."]) assertEquals(valuationHits(s).length, 1, s);
  assertEquals(valuationHits("Morningstar sees a 45% undervaluation against its fair value."), []);
  assertEquals(adviceHits("The dividend hike gives KO a clear near-term catalyst.").length, 1);
  assertEquals(cardCopyHits("Two-year price history is unavailable, so the longer trend is unclear.").length, 1);
  assertEquals(cardCopyHits("Samsung is up 242.7% from the 1Y low on the memory upcycle.").length, 1);
  assertEquals(cardCopyHits("Samsung is up 231.6% over the past year on the memory upcycle."), []);
  const plain = plainScrub("NVDA keeps ripping into a show-me tape while bulls lean on Blackwell.", CARD_PLAIN);
  assertFalse(/ripping|tape|bulls/i.test(plain), plain);
  assertEquals(plainScrub("TSLA keeps ripping into a show-me tape.", CARD_PLAIN), "TSLA keeps rising fast into a market that wants proof.");
});

Deno.test("r3 grammar: broken sentences from the newcomer's first assessment are caught; clean ones pass", () => {
  for (const s of ["Watch QQQ on sustained a shrinking price tag relative.", "Total assets $26,600 cash $2,500.", "A 20% drop triggers risk for book overall performance.", "The fund tracks the the Nasdaq 100."]) {
    assertEquals(brokenSentences(s).length, 1, s);
  }
  for (const s of ["Watch QQQ if its price tag keeps shrinking relative to earnings.", "Total assets are $26,600, with $2,500 in cash.", "It sits at 7.8% of assets."]) assertEquals(brokenSentences(s), [], s);
  assertEquals(fixGlossArticles("Watch QQQ on sustained a shrinking price tag relative to earnings."), "Watch QQQ on sustained shrinking price tag relative to earnings.");
});
