// e2e p06 F2: a known coin ticker typed as a 2-5 letter query brings the coin beside the equity.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { withCryptoTicker, type Row } from "./crypto.ts";

const interlink: Row = { symbol: "LINK", name: "Interlink Electronics, Inc.", yahoo: "LINK", kind: "equity", exchange: "NASDAQ", currency: "USD" };

Deno.test("crypto: LINK brings Chainlink first, Interlink second", () => {
  const out = withCryptoTicker("LINK", [interlink]);
  assertEquals(out.map((r) => `${r.symbol}:${r.kind}`), ["LINK:crypto", "LINK:equity"]);
  assertEquals(out[0].name, "Chainlink");
  assertEquals(out[0].yahoo, "LINK-USD");
});

Deno.test("crypto: a coin already in the results is not doubled; a non-coin query is untouched; a small coin goes last", () => {
  const chain: Row = { symbol: "LINK", name: "Chainlink USD", yahoo: "LINK-USD", kind: "crypto", exchange: "Crypto", currency: "USD" };
  assertEquals(withCryptoTicker("link", [chain, interlink]).length, 2);
  assertEquals(withCryptoTicker("AAPL", [interlink]), [interlink]);
  const out = withCryptoTicker("ENA", [interlink]);
  assert(out[out.length - 1].kind === "crypto" && out[0] === interlink);
});
