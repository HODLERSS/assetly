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
