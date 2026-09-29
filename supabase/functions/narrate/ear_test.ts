// r12 D: the spoken script speaks the card's figures and reads marks as words.
import { assertEquals } from "jsr:@std/assert@1";
import { earWords, roundPct } from "./ear.ts";

Deno.test("r12 D: card decimals under 10%, whole numbers above", () => {
  assertEquals(roundPct(3.7), "3.7");     // was "4": the card said +3.7%
  assertEquals(roundPct(4.0), "4");
  assertEquals(roundPct(0.27), "0.3");
  assertEquals(roundPct(12.9), "13");
});

Deno.test("r12 D: '~' and '(est)' in words, month names, s-possessive", () => {
  assertEquals(earWords("Earnings ~Oct 28 (est)."), "Earnings around October 28, estimated.");
  assertEquals(earWords("Next report ~$3.1B."), "Next report around $3.1B.");
  assertEquals(earWords("Meta Platforms's ad engine held up."), "Meta Platforms' ad engine held up.");
  assertEquals(earWords("Tesla's deliveries land Oct 2."), "Tesla's deliveries land October 2.");
  assertEquals(earWords("It's a quiet day."), "It's a quiet day.");
});

import { speakable, earAudit } from "./ear.ts";
Deno.test("9/28 owner feedback: figures, dates, times and symbols are spoken as words", () => {
  assertEquals(speakable("A 45000 dollars (as of the 4:00 PM ET close) loss today."), "A forty-five thousand dollar loss today.");
  assertEquals(speakable("SK hynix dropped 5 percent to 1,761,000 won."), "SK hynix dropped five percent to one point seven six million won.");
  assertEquals(speakable("Wednesday, September twenty‑third, and November 3 earnings."), "Wednesday, September twenty-third, and November third earnings.");
  assertEquals(speakable("It rose plus 1.2 percent. S&P 500 minus 0.8 percent."), "It rose one point two percent. The S and P five hundred down zero point eight percent.");
  assertEquals(speakable("Opens Wed Sep 23 09:30 ET."), "Opens Wednesday September twenty-third nine thirty Eastern Time.");
  assertEquals(speakable("It was 2,450 won, then 205,500 won."), "It was two thousand four hundred fifty won, then two hundred five thousand five hundred won.");
});
Deno.test("9/28 owner feedback: trade slang is said plainly", () => {
  assertEquals(speakable("Your Korean sleeve gave back 15000 dollars on MARA's dip."), "Your Korean holdings gave back fifteen thousand dollars on Mara's drop.");
  assertEquals(speakable("Samsung Pref led the KOSPI lower; the drawdown deepened."), "Samsung Electronics preferred shares led the KOSPI lower; the decline deepened.");
});
Deno.test("speakable output passes the ear audit and is idempotent", () => {
  const x = speakable("NVIDIA rose 1.7 percent to 229 dollars; the 150 billion dollars buyback. Q3 report ~Oct 28 (est).");
  assertEquals(earAudit(x), []);
  assertEquals(speakable(x), x);
});
Deno.test("9/28: pause tags are left exactly as written", () => {
  assertEquals(speakable('Hi. <break time="0.5s" /> MARA fell 2.4 percent. <break time="0.6s" /> Bye.'), 'Hi. <break time="0.5s" /> Mara fell two point four percent. <break time="0.6s" /> Bye.');
});
Deno.test("9/28 owner: clock times read as 'four PM Eastern Time'", () => {
  assertEquals(speakable("The market closed at 4:00 PM ET."), "The market closed at four PM Eastern Time.");
  assertEquals(speakable("Korea opens 9:00 AM KST."), "Korea opens nine AM Korea time.");
});

Deno.test("speakable: companies are said by name, never spelled as tickers (owner 9/29)", () => {
  const out = speakable("MARA fell 4% while GOOGL and NVDA rose; MARA Holdings is your largest. Alphabet's cloud grew. 000660.KS closed higher.", [["RDDT", "Reddit"]]);
  assertEquals(/\b(MARA|GOOGL|NVDA|000660)\b/.test(out), false, out);
  assertEquals(out.includes("Mara fell four percent"), true, out);
  assertEquals(out.includes("Google and NVIDIA rose"), true, out);
  assertEquals(out.includes("Mara is your largest"), true, out);
  assertEquals(out.includes("Google's cloud"), true, out);
  assertEquals(out.includes("SK hynix closed higher"), true, out);
  assertEquals(speakable(out), out);   // idempotent
  assertEquals(speakable("RDDT jumped.", [["RDDT", "Reddit"]]), "Reddit jumped.");
  assertEquals(speakable("AMD and the US market."), "AMD and the US market.");
});
