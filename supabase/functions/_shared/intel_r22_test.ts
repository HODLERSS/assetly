// Round 9 newcomer 2-5: theme claims, ideas that contradict the book, the quality note, one symbol per listing.
import { assert, assertEquals, assertFalse } from "jsr:@std/assert@1";
import { canonicalSymbol, glossedCardHits, cleanNote, fixThemeHeavy, ideaContradictions, themeClaims, themeOf } from "./intel.ts";

const themes = [{ name: "financials", pct: 28.5 }, { name: "healthcare", pct: 19.4 }, { name: "dividend equity", pct: 11.9 }, { name: "AI semiconductors", pct: 12.6 }];

Deno.test("r22 newcomer 2: theme claims against the computed weights", () => {
  assertEquals(themeOf("BRK.B", "equity"), "financials");
  assertEquals(themeOf("BRKB", "equity"), "financials");
  assertEquals(themeClaims("Healthcare is the single biggest thematic weight at 19.4%.", themes).length, 1);
  assertEquals(themeClaims("Financials are the biggest theme at 28.5%.", themes), []);
  assertEquals(fixThemeHeavy("A concentrated, healthcare-heavy dividend book.", themes), "A concentrated, financials-heavy dividend book.");
  assertEquals(fixThemeHeavy("A financials-heavy book.", themes), "A financials-heavy book.");
});

Deno.test("r22 newcomer 3: ideas that contradict the book", () => {
  const book = [
    { names: ["Samsung Electronics", "005930.KS"], theme: "AI semiconductors", pct: 12.6, region: "KR" as const },
    { names: ["SCHD", "Schwab U.S. Dividend Equity ETF"], theme: "dividend equity", pct: 11.9, region: "US" as const },
    { names: ["JNJ", "Johnson & Johnson"], theme: "healthcare", pct: 19.4, region: "US" as const },
  ];
  assert(ideaContradictions("All-US book: developed-market ex-US index funds", book));
  assert(ideaContradictions("Income gap: dividend-growth ETFs beyond SCHD for higher yield", book));
  assert(ideaContradictions("No income sleeve: dividend-growth ETFs", book, ["No income sleeve: dividend-growth ETFs"]));
  assertFalse(ideaContradictions("No bond exposure: short-term Treasury funds", book));
  assertFalse(ideaContradictions("All-US book: developed-market ex-US index funds", book.slice(1)));
});

Deno.test("r22 newcomer 4: the quality note", () => {
  const ko = cleanNote("Coca-Cola compounds through pricing power. The risk: iconic brand moat, low-single-digit volume growth, high margins, strong cash generation, manageable leverage.");
  assertFalse(ko.note.includes("The risk: iconic"), ko.note);
  const jpm = cleanNote("JPM earns a premium return on equity. The risk: Q3 NII miss >consensus tripwire.");
  assertFalse(/tripwire/i.test(jpm.note), jpm.note);
  assertEquals(jpm.note, "JPM earns a premium return on equity. The risk: Q3 NII miss above consensus.");
  const schd = cleanNote("SCHD holds 100 dividend payers. The risk: SCHD trails the S&P 500 over any three-year period. The risk: SCHD trails the S&P 500 over any three-year period.");
  assertEquals((schd.note.match(/The risk:/g) ?? []).length, 1);
  assert(cleanNote("JNJ has a deep pharma pipeline and a AAA balance sheet.").needsRisk);
  assertFalse(cleanNote("JNJ has a deep pipeline, but Stelara biosimilars erode sales.").needsRisk);
});

Deno.test("r22 newcomer 5: one symbol per listing", () => {
  assertEquals(canonicalSymbol("BRKB", "BRK-B"), "BRK.B");
  assertEquals(canonicalSymbol("BRK-B", "BRK-B"), "BRK.B");
  assertEquals(canonicalSymbol("BRK.B"), "BRK.B");
  assertEquals(canonicalSymbol("AAPL", "AAPL"), "AAPL");
  assertEquals(canonicalSymbol("005930.KS", "005930.KS"), "005930.KS");
  assertEquals(canonicalSymbol("BTC-USD"), "BTC-USD");
});

Deno.test("r22 minor: a stored card carrying the old gloss is detected", () => {
  assertEquals(glossedCardHits(["It deepens JNJ's immunology lasting edge over competitors against AbbVie."]).length, 1);
  assertEquals(glossedCardHits(["Its moat (lasting edge over competitors) is wide."]), []);
  assertEquals(glossedCardHits(["JNJ's immunology lead held."]), []);
});
