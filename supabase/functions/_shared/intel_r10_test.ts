// Run: npx -y deno@2 test --allow-read supabase/functions/_shared/
// Round 6d (Lead decision, 2026-09-25): the ASSESSMENT edition loosens the beginner squeeze; daily editions do not.
import { assert, assertEquals, assertFalse, assertStringIncludes } from "jsr:@std/assert@1";
import { assessmentReader, brokenSentences, noviceGloss } from "./intel.ts";

const NOVICE = "READER PROFILE:\n- BEGINNER reader: plain words, short sentences. Sentences of at most 14 words. NO bare acronyms or jargon ANYWHERE, including watch items and bullets. Banned for this reader: EVERY financial acronym and term of art, including ROE, ROIC, EBITDA, FCF, P/E, EPS, AUM, NIM, capex, basis points. If a term is unavoidable, gloss it in-line. Never condescend.\n- Lens: growth.";

Deno.test("r10 assessment reader: 20-word sentences, well-known names kept, P/E only when explained", () => {
  const a = assessmentReader(NOVICE);
  assertStringIncludes(a, "Sentences of at most 20 words.");
  assertFalse(a.includes("at most 14 words"));
  assertFalse(/, P\/E, /.test(a));
  assertStringIncludes(a, "S&P 500, Nasdaq-100, ETF");
  assertStringIncludes(a, "P/E when you explain it once");
  assert(a.endsWith("Never condescend.\n- Lens: growth."));
  // other readers are untouched
  const pro = "READER PROFILE:\n- EXPERIENCED reader: professional vocabulary is fine.";
  assertEquals(assessmentReader(pro), pro);
});

Deno.test("r10 the assessment keeps P/E; daily editions still gloss it", () => {
  assertEquals(noviceGloss("Its P/E is 60, its price tag against profits.", ["P/E"]), "Its P/E is 60, its price tag against profits.");
  assertFalse(noviceGloss("Its P/E is 60.").includes("P/E"));
});

Deno.test("r10 the memo-list compression gpt-oss still writes is flagged for the grammar pass", () => {
  for (const s of ["It has an edge, profit and solid balance sheet.", "It has an edge, sticky contracts, profit and a balance sheet.", "It has a lasting edge, profit and strong balance sheet.",
    "It has an edge with CUDA, margins and a balance sheet.", "It offers exposure."]) assertEquals(brokenSentences(s).length, 1, s);
  // complete sentences with the same words stay
  for (const s of ["It has a dominant edge, elite margins and strong cash, but the stake is concentrated.", "It has a lasting edge, strong profits and a solid balance sheet.", "It offers broad US exposure."]) {
    assertEquals(brokenSentences(s), [], s);
  }
});
