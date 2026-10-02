// 10/2 Shorts QA: Ask's per-holding day $ was today's value x the day %, not the prior value x % (Home's figure)
import { assertEquals } from "jsr:@std/assert@1";
import { fixHoldingDayDollars } from "./intel.ts";

const rows = [{ names: ["Applied Digital", "APLD"], dayUsd: 2319, valueUsd: 25500 }, { names: ["AMD"], dayUsd: 1200, valueUsd: 33000 }];
const fix = (s: string) => fixHoldingDayDollars(s, rows);

Deno.test("a holding's overstated day $ is set to its true day $", () => {
  assertEquals(fix("Applied Digital (+10%) lifts $2.5k today."), "Applied Digital (+10%) lifts $2.3k today.");
  assertEquals(fix("APLD added +$2,550 so far."), "APLD added +$2,319 so far.");
});

Deno.test("values, rounding, multi-holding and longer windows are left alone", () => {
  for (const s of ["Applied Digital is worth $25,500.", "Applied Digital gained $2,300 today.",
    "AMD and APLD lifted the book $3.4k today.", "APLD is up 40% this year, a $7,300 gain."]) assertEquals(fix(s), s);
});

Deno.test("several holdings in one sentence: each attached figure is set to its own day $", () => {
  const rows2 = [{ names: ["APLD"], dayUsd: 1049, valueUsd: 21915 }, { names: ["AVGO"], dayUsd: 943, valueUsd: 35307 }];
  assertEquals(fixHoldingDayDollars("AI capacity boost lifts APLD (+$1,049) and AVGO (+$966) today.", rows2),
    "AI capacity boost lifts APLD (+$1,049) and AVGO (+$943) today.");
  assertEquals(fixHoldingDayDollars("APLD (+5.1%, +$1,049) and AVGO (+2.7%, +$966) lead today.", rows2),
    "APLD (+5.1%, +$1,049) and AVGO (+2.7%, +$943) lead today.");
});
