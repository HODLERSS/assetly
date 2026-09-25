// Run: npx -y deno@2 test --allow-read supabase/functions/_shared/
// Round 7 native: "BTC surged past $87,000" when its highest close was $86,602.91 and it trades at $84,077.
import { assertEquals } from "jsr:@std/assert@1";
import { crossedLevelClaims, levelMismatches } from "./intel.ts";

const btc = [{ names: ["BTC", "Bitcoin"], pct: -0.3, price: 84077, high: 86602.91, low: 78200 }];

Deno.test("r14: a level the price never reached is not 'surged past' / 'hit' / 'fell below'", () => {
  assertEquals(crossedLevelClaims("Bitcoin surged past $87,000 this week on ETF buying.", btc).length, 1);
  assertEquals(crossedLevelClaims("Bitcoin hit $88K before easing.", btc).length, 1);
  assertEquals(crossedLevelClaims("Bitcoin fell below $75,000 on Tuesday.", btc).length, 1);
  assertEquals(crossedLevelClaims("Bitcoin climbed above $86,000 this week.", btc), []);
  assertEquals(crossedLevelClaims("A move above $90,000 would be a new high.", btc), []);
  assertEquals(crossedLevelClaims("Bitcoin needs to reclaim $87,000 to confirm the trend.", btc), []);
  // without a known high/low nothing is judged
  assertEquals(crossedLevelClaims("Bitcoin surged past $87,000.", [{ names: ["Bitcoin"], pct: null }]), []);
  // every card guard (levelMismatches) carries the check
  assertEquals(levelMismatches("Bitcoin surged past $87,000 this week.", btc).length, 1);
});
