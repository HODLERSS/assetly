// 10/1 round 2: "US stocks today: … US stocks today: …" in Ask. Run: deno test -A supabase/functions/_shared/lead_echo_test.ts
import { assert, assertEquals, assertFalse } from "jsr:@std/assert@1";
import { dropLeadEchoes, statesLead } from "./intel.ts";

const LEAD = "• US stocks today: +$3,157 (+1.72%).";
const NAMES = ["Accenture", "ACN", "NVDA", "Nvidia"];

Deno.test("statesLead: a rounded restatement states the lead; a substring of another figure does not", () => {
  assert(statesLead("US stocks are up $3,157 (+1.7%) today.", LEAD));
  assert(statesLead("Up 1.72% today.", LEAD));
  assertFalse(statesLead("ACN +2.74% and NVDA +0.9%.", "• US stocks today: +$3,201 (+1.74%)."), "74% inside 2.74% is not 1.74%");
  assertFalse(statesLead("Up 2% today.", LEAD), "an integer is too coarse for a small figure");
  assert(statesLead("NVDA is up 5.6% over a month and 40.0% over a year.", "• NVDA: 1 month +5.6%, 1 year +40.0%."));
});

Deno.test("dropLeadEchoes: the label copy and the whole-book dollar echo go; holdings lines stay", () => {
  const a = [LEAD, "• US stocks today: +$3,157 (+1.7%).", "• Portfolio up $3,157 (+1.68%) today.", "• ACN +18.1% on AI deals; it added ~$2,490."].join("\n");
  assertEquals(dropLeadEchoes(a, LEAD, NAMES), [LEAD, "• ACN +18.1% on AI deals; it added ~$2,490."].join("\n"));
});

Deno.test("dropLeadEchoes: a sentence that names a holding or carries other figures is not an echo", () => {
  const a = [LEAD, "• Portfolio up $3,157 today, mostly Accenture.", "Your portfolio is worth $184,000."].join("\n");
  assertEquals(dropLeadEchoes(a, LEAD, NAMES), a);
});

Deno.test("dropLeadEchoes: no lead in the text, nothing changes; a duplicated lead line keeps one copy", () => {
  const a = "• Portfolio up $3,157 (+1.68%) today.";
  assertEquals(dropLeadEchoes(a, LEAD, NAMES), a);
  assertEquals(dropLeadEchoes(`${LEAD}\n${LEAD}\n• NVDA +0.9%.`, LEAD, NAMES), `${LEAD}\n• NVDA +0.9%.`);
  assertEquals(dropLeadEchoes(a, null, NAMES), a);
});

Deno.test("dropLeadEchoes: a Korean lead with a Korea line", () => {
  const lead = "• 미국, 오늘: +$3,157 (+1.72%).\n• 한국, 오늘: +$162 (+0.40%).";
  const a = `${lead}\n• 미국, 오늘: +$3,157 (+1.7%).\n• 포트폴리오 오늘 +$3,157 상승.\n• 엔비디아 +0.9%.`;
  assertEquals(dropLeadEchoes(a, lead, ["엔비디아"]), `${lead}\n• 엔비디아 +0.9%.`);
});

Deno.test("dropLeadEchoes: a leading whole-book clause with the lead's figure goes, the holding clause stays", () => {
  const lead = "• US stocks today: +$3,205 (+1.74%).";
  const a = `${lead}\n• Portfolio up $3,205 (+1.71%); ACN surged 18.3% on its AI-deal rally.\n• Portfolio up $9,999 today, led by ACN.`;
  assertEquals(dropLeadEchoes(a, lead, ["ACN"]), `${lead}\n• ACN surged 18.3% on its AI-deal rally.\n• Portfolio up $9,999 today, led by ACN.`);
});
