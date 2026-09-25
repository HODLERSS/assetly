import { describe, it, expect } from "vitest";
import { exchangeLabel, rankSymbols, searchQuery } from "../lib/search";
import { decodeEntities, dedupeNews, titleKey } from "../lib/news";
import type { NewsItem, SymbolRow } from "../lib/api";

const s = (symbol: string, name: string, over: Partial<SymbolRow> = {}): SymbolRow => ({ symbol, name, exchange: "NASDAQ", currency: "USD", kind: "equity", ...over });

describe("rankSymbols", () => {
  it("the exact ticker leads, then name matches; leveraged products sink below plain listings", () => {
    const rows = [s("TSLZ", "T-Rex 2X Inverse Tesla Daily Target ETF"), s("AEHR", "Aehr Test Systems"), s("TSLA", "Tesla, Inc."), s("TSLL", "Direxion Daily TSLA Bull 2X Shares")];
    expect(rankSymbols("tsla", rows.filter((r) => r.symbol !== "AEHR")).map((r) => r.symbol)).toEqual(["TSLA", "TSLL", "TSLZ"]);
    // name hit first; leveraged and inverse products sink below every plain listing, unless asked for (r3)
    expect(rankSymbols("tesla", rows).map((r) => r.symbol)).toEqual(["TSLA", "AEHR", "TSLZ", "TSLL"]);
    expect(rankSymbols("tesla 2x", rows)[0].symbol).not.toBe("AEHR");
    expect(rankSymbols("vanguard", [s("BSV", "Vanguard Short-Term Bond ETF"), s("VOO", "Vanguard S&P 500 ETF")]).map((r) => r.symbol)).toEqual(["BSV", "VOO"]);
  });
  it("indices, futures and FX pairs are hidden unless the query asks for them", () => {
    const rows = [s("^VIX", "CBOE Volatility Index", { exchange: "CBOE" }), s("USDKRW", "US Dollar / Korean Won", { exchange: "FX", currency: "KRW", kind: "fund" }),
                  s("ES=F", "S&P 500 Futures", { exchange: "CME" }), s("XOM", "Exxon Mobil", { exchange: "NYQ" })];
    expect(rankSymbols("x", rows).map((r) => r.symbol)).toEqual(["XOM"]);
    expect(rankSymbols("^vix", rows).map((r) => r.symbol)).toContain("^VIX");
    expect(rankSymbols("usdkrw", rows).map((r) => r.symbol)).toContain("USDKRW");
  });
  it("cash lists the reader's own currency first; KRW only leads when asked or for a KRW base", () => {
    const rows = [s("$CASH.KRW", "Cash (KRW)", { kind: "cash", currency: "KRW", exchange: "CASH" }), s("$CASH.EUR", "Cash (EUR)", { kind: "cash", currency: "EUR", exchange: "CASH" }), s("$CASH", "Cash (USD)", { kind: "cash", exchange: "CASH" })];
    expect(rankSymbols("cash", rows)[0].symbol).toBe("$CASH");
    expect(rankSymbols("cash", rows, "KRW")[0].symbol).toBe("$CASH.KRW");
    expect(rankSymbols("cash krw", rows)[0].symbol).toBe("$CASH.KRW");
  });
  it("exchange names are normalized on the way out", () => {
    expect(rankSymbols("xom", [s("XOM", "Exxon", { exchange: "XNYS" })])[0].exchange).toBe("NYSE");
  });
});

describe("search helpers", () => {
  it("common misspellings are forgiven", () => {
    expect(searchQuery(" Nvidea ")).toBe("nvidia");
    expect(searchQuery("telsa")).toBe("tesla");
    expect(searchQuery("VOO")).toBe("VOO");
  });
  it("one label per venue", () => {
    for (const [c, l] of [["XNAS", "NASDAQ"], ["NMS", "NASDAQ"], ["ARCX", "NYSE Arca"], ["NYSEArca", "NYSE Arca"], ["BATS Trading", "Cboe"], ["PNK", "OTC"], ["AMEX", "NYSE American"], ["KRX", "KRX"], ["CRYPTO", "Crypto"], ["LSE", "LSE"]]) {
      expect(exchangeLabel(c), c).toBe(l);
    }
  });
});

describe("news hygiene", () => {
  const n = (id: string, title: string, url: string): NewsItem => ({ id, symbol: "QCOM", title, url, source: "Yahoo &amp; Co", published_at: null });
  it("decodes entities, numeric and double-encoded included", () => {
    expect(decodeEntities("AT&amp;T&#39;s &quot;deal&quot; &#x2014; now")).toBe("AT&T's \"deal\" — now");
    expect(decodeEntities("S&amp;amp;P")).toBe("S&P");
    expect(decodeEntities("R&D &unknown; stays")).toBe("R&D &unknown; stays");
  });
  it("one copy per story, by URL or by the same headline", () => {
    const out = dedupeNews([
      n("1", "Qualcomm's CMO reveals the secret behind Snapdragon's rise", "https://a/1"),
      n("2", "Qualcomm&#39;s CMO reveals the secret behind Snapdragon’s rise!", "https://b/2"),
      n("3", "Different story", "https://a/1"),
      n("4", "Different story", "https://c/4"),
    ]);
    expect(out.map((x) => x.id)).toEqual(["1", "4"]);
    expect(out[0].source).toBe("Yahoo & Co");
    expect(titleKey("Snapdragon's rise")).toBe(titleKey("snapdragon’s  RISE"));
  });
});
