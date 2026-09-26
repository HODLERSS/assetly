// Round 9 intelligence: events and causes must be grounded in what the writer saw.
import { assertEquals } from "jsr:@std/assert@1";
import { ungroundedCauses, ungroundedEvents, ungroundedEventSentences } from "./intel.ts";

const SRC = [
  "NEXT EARNINGS ESTIMATES: Microsoft earnings expected ~Oct 28 (est) · Meta earnings expected ~Oct 29 (est)",
  "- Microsoft [Yahoo Finance]: What's different about Microsoft's Copilot AI reboot",
  "- Meta [Yahoo Finance]: Meta Slides as Retracement Follows 32% Monthly Run",
  "- Micron [Reuters]: Micron delays HBM4 launch to next quarter, sources say",
  "- Tesla [CNBC]: Tesla Semi deliveries begin; volume ramp in 2027",
  "- Apple [Bloomberg]: Apple dividend of $0.26 payable Nov 13, ex-date Nov 9",
  "- Microsoft [Reuters]: Microsoft shares rise as Copilot demand lifts cloud outlook",
].join("\n");

Deno.test("r19: dated events need a source line with that date", () => {
  const names = ["Microsoft", "MSFT", "Meta", "META", "Apple", "AAPL", "Micron", "Tesla"];
  assertEquals(ungroundedEvents(["MSFT Copilot revenue update Monday", "Meta Q4 guidance Monday", "Microsoft earnings expected ~Oct 28 (est)",
    "Upcoming dividend ex-date Nov 9", "Micron launch delay signal", "Azure AI contract renewal", "$350 level", "No confirmed date yet"], SRC, names),
    ["MSFT Copilot revenue update Monday", "Meta Q4 guidance Monday", "Azure AI contract renewal"]);
  assertEquals(ungroundedEvents(["Microsoft earnings October 28"], SRC, names), []);
});

Deno.test("r19: a dated event inside a sentence", () => {
  const names = ["Microsoft", "MSFT", "Meta"];
  assertEquals(ungroundedEventSentences("Tech led the tape. Watch the MSFT Copilot revenue update Monday. Microsoft reports around Oct 28.", SRC, names),
    ["Watch the MSFT Copilot revenue update Monday."]);
});

Deno.test("r19: causes need a source line", () => {
  const names = ["Microsoft", "MSFT"];
  assertEquals(ungroundedCauses("Microsoft's AI spend boosted earnings.", SRC, names), ["Microsoft's AI spend boosted earnings."]);
  assertEquals(ungroundedCauses("Copilot demand lifted shares.", SRC, names), []);
  assertEquals(ungroundedCauses("Microsoft rose 3.7%.", SRC, names), []);
});
