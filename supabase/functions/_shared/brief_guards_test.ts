// 10/1 owner regenerations of the morning brief, and the same classes found in the owner's briefs of 9/24-10/1.
// Run: deno test -A supabase/functions/_shared/brief_guards_test.ts
import { assert, assertEquals } from "jsr:@std/assert@1";
import { fixNamedWeights, fixNoteWeight, fixRecoveryClaims, ledeFallback, mangledFigureHits, PLAIN_WORDS_RULE, repairMangledFigures } from "./brief_guards.ts";
import { plainScrub, PORTFOLIO_PLAIN } from "./intel.ts";

const BOOK = [
  { names: ["MARA"], weight: 33.7 }, { names: ["SK hynix"], weight: 21.4 }, { names: ["AMD"], weight: 5.7 },
  { names: ["Samsung Electronics (Pref)", "Samsung Electronics", "Samsung"], weight: 3.6 }, { names: ["Industrial Bank of Korea", "IBK"], weight: 2.2 },
];

Deno.test("weights: the 10/1 swap is put back (SK hynix 21.4%, the pair 55.1%)", () => {
  assertEquals(fixNamedWeights("MARA at 33.7% and SK hynix at 55.1% means 21.4% of the portfolio rides two single-name bets.", BOOK),
    "MARA at 33.7% and SK hynix at 21.4% means 55.1% of the portfolio rides two single-name bets.");
});
Deno.test("weights: a holding's own weight within 0.15 point stands; a wrong one is corrected", () => {
  assertEquals(fixNamedWeights("MARA at 33.7% and SK hynix at 21.3% set the downside.", BOOK), "MARA at 33.7% and SK hynix at 21.3% set the downside.");
  assertEquals(fixNamedWeights("SK hynix is 24.0% of assets.", BOOK), "SK hynix is 21.4% of assets.");
  assertEquals(fixNamedWeights("MARA's 35.2% weight sets the downside.", BOOK), "MARA's 33.7% weight sets the downside.");
  assertEquals(fixNamedWeights("Samsung Pref (3.6%) led the Korean stocks with a 4.5% move.", BOOK), "Samsung Pref (3.6%) led the Korean stocks with a 4.5% move.");
  assertEquals(fixNamedWeights("IBK (2.9%) barely moved.", BOOK), "IBK (2.2%) barely moved.");
  // a rounded whole-number weight is fine
  assertEquals(fixNamedWeights("MARA at 34% is the anchor.", BOOK), "MARA at 34% is the anchor.");
});
Deno.test("weights: moves, returns and yields beside a name are left alone", () => {
  for (const t of ["MARA is 5.5% lower on the day.", "SK hynix is 409% up over a year.", "MARA at 5.5% below its open.", "SK hynix's 0.17% yield is small.",
    "Samsung Pref (+4.8%) rebounded.", "AMD is 278% higher than a year ago."]) assertEquals(fixNamedWeights(t, BOOK), t);
});
Deno.test("weights: a combined claim must be the sum of the holdings named", () => {
  assertEquals(fixNamedWeights("MARA and SK hynix together make up 50.2% of assets.", BOOK), "MARA and SK hynix together make up 55.1% of assets.");
  assertEquals(fixNamedWeights("MARA at 35.4% and SK hynix at 20.3% mean over half the portfolio sits in two single-name bets.", BOOK),
    "MARA at 33.7% and SK hynix at 21.4% mean over half the portfolio sits in two single-name bets.");
  assertEquals(fixNamedWeights("MARA and SK hynix together make up 55.1% of assets.", BOOK), "MARA and SK hynix together make up 55.1% of assets.");
  // a group share in a sentence that names two holdings is not their sum
  assertEquals(fixNamedWeights("SK hynix and Samsung Pref rose together, and Korean stocks are 28.9% of assets.", BOOK), "SK hynix and Samsung Pref rose together, and Korean stocks are 28.9% of assets.");
});

Deno.test("recovery: 10/1 'recovers only part' of a smaller drop becomes 'more than erases'", () => {
  assertEquals(fixRecoveryClaims("Samsung Pref's 4.8% rebound recovers only part of Wednesday's 4.3% drop."),
    "Samsung Pref's 4.8% rebound more than erases Wednesday's 4.3% drop.");
  assertEquals(fixRecoveryClaims("A 4.8% rebound in today's session recovers only part of Wednesday's 4.3% drop, and the 0.81% yield is thin for a defensive preference share."),
    "A 4.8% rebound in today's session more than erases Wednesday's 4.3% drop, and the 0.81% yield is thin for a defensive preference share.");
  assertEquals(fixRecoveryClaims("Samsung Pref's 4.8% rebound only partly recovers Wednesday's 4.3% drop."), "Samsung Pref's 4.8% rebound more than erases Wednesday's 4.3% drop.");
  assertEquals(fixRecoveryClaims("The 4.5% gain recovered some of Tuesday's 4.3% decline."), "The 4.5% gain fully erased Tuesday's 4.3% decline.");
});
Deno.test("recovery: the reverse ('more than erases' a bigger drop) becomes partial; true claims stand", () => {
  assertEquals(fixRecoveryClaims("MARA's 2.0% gain more than erases Tuesday's 5.5% drop."), "MARA's 2.0% gain recovers only part of Tuesday's 5.5% drop.");
  for (const t of ["Samsung Pref's 2.1% rebound recovers only part of Wednesday's 4.3% drop.",
    // compounding: after a 4.3% drop, 4.4% is still short of the 4.49% needed
    "A 4.4% rebound recovers only part of the 4.3% drop.",
    "Samsung Pref's 4.8% rebound more than erases Wednesday's 4.3% drop.",
    "SK hynix rose 3.1% on Solidigm IPO talk."]) assertEquals(fixRecoveryClaims(t), t);
});

Deno.test("mangled figures: the 9/29-10/1 range casualties are repaired, never left as 'word-150B' / 'WordB'", () => {
  assertEquals(repairMangledFigures("Solidigm IPO talk-150B is unfiled speculation."), "Solidigm IPO talk is unfiled speculation.");
  assertEquals(repairMangledFigures("SolidigmB is unfiled speculation, not valuation."), "Solidigm is unfiled speculation, not valuation.");
  assertEquals(repairMangledFigures("Solidigm IPO chatterB is unconfirmed by management."), "Solidigm IPO chatter is unconfirmed by management.");
  assertEquals(repairMangledFigures("Solidigm IPO-150B could unlock $50B+ in value."), "Solidigm IPO could unlock $50B+ in value.");   // 9/29 morning
  for (const t of ["The $8.2B World Labs deal.", "A $100-150B range.", "F-35B jets.", "H-1B visas.", "IBM and AMD.", "a 409% one-year rally"]) assertEquals(repairMangledFigures(t), t);
  assertEquals(mangledFigureHits("SolidigmB and talk-150B"), ["SolidigmB", "talk-150B"]);
});

Deno.test("plain words: the 10/1 card jargon reads in everyday English", () => {
  const s = (t: string) => plainScrub(t, PORTFOLIO_PLAIN);
  assertEquals(s("KOSPI 6,971.35 (+1.9%) confirms Seoul's bid carried into tonight."), "KOSPI 6,971.35 (+1.9%) confirms Seoul's buying carried into tonight.");
  assertEquals(s("Samsung Pref led, catching the same AI-memory bid as hynix."), "Samsung Pref led, catching the same AI-memory buying as hynix.");
  assertEquals(s("If hynix holds the bid into Thursday, AMD has support."), "If hynix holds its gains into Thursday, AMD has support.");
  assertEquals(s("The $8.2B World Labs deal deploys cash at cycle peak."), "The $8.2B World Labs deal deploys cash at the top of the cycle.");
  assertEquals(s("The 0.17% yield is rounding error against 21.3% concentration."), "The 0.17% yield is too small to matter against 21.3% concentration.");
  assertEquals(s("The yield is a rounding error."), "The yield is too small to matter.");
  assertEquals(s("Multiple compression is the risk."), "A lower price relative to earnings is the risk.");
  assertEquals(s("Insider selling is a yellow flag."), "Insider selling is a warning sign.");
  assertEquals(s("The Korean sleeve now accounts for 28.9% of assets."), "The Korean holdings now account for 28.9% of assets.");
  assertEquals(s("The Korean sleeve's rebound added back $11,400."), "The Korean holdings' rebound added back $11,400.");
  assertEquals(s("SK hynix added 1.1% while the rest of the sleeve sold off."), "SK hynix added 1.1% while the rest of those holdings sold off.");
  assertEquals(s("Korean sleeve gave back $789."), "Korean holdings gave back $789.");
  assertEquals(s("The Korean sleeve is the swing factor."), "The Korean holdings are the swing factor.");
  assertEquals(s("CEO Thiel dumping 27,505 shares is the largest risk."), "CEO Thiel selling 27,505 shares is the largest risk.");
  assertEquals(s("CEO Thiel dumped 27,505 shares."), "CEO Thiel sold 27,505 shares.");
  assertEquals(s("VIX 16.45 keeps vol contained."), "VIX 16.45 keeps price swings contained.");
  assertEquals(s("It gave back 5.5% on a JPMorgan PT cut."), "It gave back 5.5% on a JPMorgan price target cut.");
  assertEquals(s("A risk-off day hit the high-beta chip stocks hardest."), "A cautious day hit the more volatile chip stocks hardest.");
  assertEquals(s("SK hynix is the canary."), "SK hynix is the early warning sign.");
  // look-alikes stay: a takeover bid, a bid for a company, the card's "tape bid", the fine sense of PT as a time zone
  for (const t of ["Netflix made a takeover bid for the studio.", "Its bid to win the contract failed.", "Results at 9:00 AM PT.", "Investors bid up shares."]) assertEquals(s(t), t);
  // idempotent
  const once = s("The Korean sleeve's bid is a rounding error at cycle peak.");
  assertEquals(s(once), once);
});

Deno.test("the empty-lede fallback is built from verified figures only", () => {
  assertEquals(ledeFallback(1253500, [{ name: "MARA", weight: 33.72 }, { name: "SK hynix", weight: 21.41 }]),
    "Your portfolio is worth $1.25 million. MARA is the largest holding at 33.7% of assets, and with SK hynix at 21.4% the two make up 55.1% of it.");
  assertEquals(ledeFallback(48210, [{ name: "VOO", weight: 61 }]), "Your portfolio is worth $48,200. VOO is the largest holding at 61.0% of assets.");
  assert(ledeFallback(0, []).length > 0);
});

Deno.test("the writer is told the plain words, the recovery arithmetic and the weight rule up front", () => {
  for (const w of ['never "bid"', "cycle peak", "rounding error", "multiple compression", "yellow flag", "sleeve", "dumping", "RECOVERY ARITHMETIC", "WEIGHTS"]) assert(PLAIN_WORDS_RULE.includes(w), w);
});

Deno.test("note weights: a bare weight in a holding's own note is that holding's (10/1 full regeneration)", () => {
  const hynix = BOOK[1];
  assertEquals(fixNoteWeight("SK hynix's 3.2% rally validates AI-chip demand but 35.0% concentration leaves portfolio vulnerable to valuation dilution from the Solidigm IPO.", hynix, BOOK),
    "SK hynix's 3.2% rally validates AI-chip demand but 21.4% concentration leaves portfolio vulnerable to valuation dilution from the Solidigm IPO.");
  assertEquals(fixNoteWeight("The 21.3% stake drives most of the portfolio gain.", hynix, BOOK), "The 21.3% stake drives most of the portfolio gain.");
  // 10/1 forced-fallback regeneration: the Korean stocks' share (29.6%) hung on SK hynix
  assertEquals(fixNoteWeight("The 29.6% Korean anchor added 3.2% in Thursday's Korean session.", hynix, BOOK), "The 21.4% Korean anchor added 3.2% in Thursday's Korean session.");
  // another holding named, a group share, or a move: left alone
  for (const t of ["Together with MARA, a 55.1% weight rides two bets.", "Korean stocks are a 29.5% weight.", "It rose 3.2% stake-free.", "Up 35.0% this year."]) assertEquals(fixNoteWeight(t, hynix, BOOK), t);
});
