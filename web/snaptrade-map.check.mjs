// Brokerage-agnostic import: the mapper must handle every variant SnapTrade's unified schema allows, modelled per
// brokerage family (no accounts needed). Run: node snaptrade-map.test.mjs
import { buildSync } from "esbuild";
import { writeFileSync } from "fs";
const out = buildSync({ entryPoints: ["../supabase/functions/snaptrade-sync/map.ts"], bundle: false, write: false, format: "esm", platform: "neutral" }).outputFiles[0].text;
writeFileSync("/tmp/snaptrade-map.mjs", out);
const { normalizePosition, normalizeBalance, normalizeCrypto, accountLabel } = await import("/tmp/snaptrade-map.mjs");

const U = (kind, symbol, extra = {}, inst = {}) => ({ instrument: { kind, symbol, raw_symbol: inst.raw_symbol ?? symbol.replace(/\.[A-Z]+$/, ""), description: inst.description ?? symbol, currency: inst.currency ?? "USD", exchange: inst.exchange ?? "XNAS", ...inst }, units: "10", price: "100", cost_basis: "90", currency: inst.currency ?? "USD", ...extra });
let pass = 0, fail = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (ok) pass++; else { fail++; console.log("FAIL", name, "\n  got ", JSON.stringify(got), "\n  want", JSON.stringify(want)); } };
const pick = (m, keys) => Object.fromEntries(keys.map((k) => [k, m[k]]));

// ---- US full-service (Fidelity, Schwab, E*TRADE, Vanguard, Wells, Chase, TIAA, Edward Jones, Empower, PNC, US Bank) ----
eq("stock", pick(normalizePosition(U("stock", "NVDA", {}, { description: "NVIDIA CORP" })), ["sym", "kind", "ccy", "units", "avg", "price", "yahoo"]), { sym: "NVDA", kind: "equity", ccy: "USD", units: 10, avg: 90, price: 100, yahoo: null });
eq("etf", pick(normalizePosition(U("etf", "QQQM")), ["sym", "kind"]), { sym: "QQQM", kind: "etf" });
eq("mutual fund", pick(normalizePosition(U("mutualfund", "FXAIX", {}, { description: "FIDELITY 500 INDEX FUND" })), ["sym", "kind"]), { sym: "FXAIX", kind: "fund" });
eq("Fidelity FCASH sweep (other)", normalizePosition(U("other", "FCASH", {}, { description: "FDIC INSURED DEPOSIT" })), { skip: "cash" });
eq("SPAXX money market flagged cash_equivalent", normalizePosition(U("mutualfund", "SPAXX", { cash_equivalent: true })), { skip: "cash" });
eq("Vanguard VMFXX by name", normalizePosition(U("mutualfund", "VMFXX", {}, { description: "VANGUARD FEDERAL MONEY MARKET" })), { skip: "cash" });
eq("option skipped", normalizePosition(U("option", "AAPL  261218C00240000")), { skip: "option" });
eq("short position skipped", normalizePosition(U("stock", "TSLA", { units: "-5" })), { skip: "short" });
eq("zero units skipped", normalizePosition(U("stock", "TSLA", { units: "0" })), { skip: "zero" });
eq("class share BRKB", pick(normalizePosition(U("stock", "BRKB", {}, { description: "BERKSHIRE HATHAWAY INC CLASS B" })), ["sym", "yahoo"]), { sym: "BRK.B", yahoo: "BRK-B" });
eq("class share BRK.B already dotted", pick(normalizePosition(U("stock", "BRK.B", {}, { raw_symbol: "BRK.B", description: "Berkshire Hathaway Inc. Class B" })), ["sym", "yahoo"]), { sym: "BRK.B", yahoo: "BRK-B" });
eq("ADR", pick(normalizePosition(U("adr", "TSM", {}, { description: "TAIWAN SEMICONDUCTOR ADR" })), ["sym", "kind"]), { sym: "TSM", kind: "equity" });
eq("CEF", pick(normalizePosition(U("cef", "PTY")), ["kind"]), { kind: "equity" });
eq("bond CUSIP (other) unsupported", normalizePosition(U("other", "912828ZT0", {}, { description: "US TREASURY NOTE 2.5% 2030" })), { skip: "unsupported" });
eq("null price and cost basis", pick(normalizePosition(U("stock", "AAPL", { price: null, cost_basis: null })), ["price", "avg"]), { price: null, avg: null });
eq("no cost basis (Robinhood style)", pick(normalizePosition(U("stock", "AAPL", { cost_basis: undefined })), ["avg"]), { avg: null });

// ---- US app brokers with crypto + fractional (Robinhood, Webull, Public, tastytrade, Alpaca, eToro) ----
eq("fractional units", pick(normalizePosition(U("stock", "AMZN", { units: "0.3271" })), ["units"]), { units: 0.3271 });
eq("crypto at Robinhood", pick(normalizePosition(U("crypto", "BTC", {}, { exchange: null, currency: "USD" })), ["sym", "kind", "yahoo", "exch"]), { sym: "BTC", kind: "crypto", yahoo: "BTC-USD", exch: "CRYPTO" });
eq("crypto pair BTC-USD", pick(normalizePosition(U("crypto", "BTC-USD")), ["sym", "yahoo"]), { sym: "BTC", yahoo: "BTC-USD" });
eq("crypto pair ETHUSD (no separator)", pick(normalizePosition(U("crypto", "ETHUSD")), ["sym", "yahoo"]), { sym: "ETH", yahoo: "ETH-USD" });
eq("crypto pair SOL/USDT", pick(normalizePosition(U("crypto", "SOL/USDT")), ["sym"]), { sym: "SOL" });

// ---- crypto exchanges (Coinbase, Kraken, Binance) ----
eq("Kraken XXBT", pick(normalizePosition(U("crypto", "XXBT")), ["sym", "yahoo"]), { sym: "BTC", yahoo: "BTC-USD" });
eq("Kraken XBT", normalizeCrypto("XBT"), "BTC");
eq("Kraken XETH", normalizeCrypto("XETH"), "ETH");
eq("Kraken XXDG", normalizeCrypto("XXDG"), "DOGE");
eq("Kraken ZUSD fiat as asset skipped", normalizePosition(U("crypto", "ZUSD")), { skip: "cash" });
eq("Binance BTCUSDT", normalizeCrypto("BTCUSDT"), "BTC");
eq("Coinbase ETH", pick(normalizePosition(U("crypto", "ETH", { units: "1.5", price: "2500", cost_basis: "2000" })), ["sym", "units", "avg"]), { sym: "ETH", units: 1.5, avg: 2000 });
eq("USDC stablecoin stays a crypto position", pick(normalizePosition(U("crypto", "USDC")), ["sym"]), { sym: "USDC" });

// ---- Canada (Questrade, Wealthsimple, TD Direct, Webull Canada) ----
eq("TSX listing keeps .TO and CAD", pick(normalizePosition(U("etf", "VAB.TO", {}, { raw_symbol: "VAB", currency: "CAD", exchange: "XTSE", description: "VANGUARD CDN AGGREGATE BOND INDEX ETF" })), ["sym", "ccy", "kind", "exch"]), { sym: "VAB.TO", ccy: "CAD", kind: "etf", exch: "XTSE" });
eq("US stock in a CAD account priced in USD", pick(normalizePosition(U("stock", "AAPL", { currency: "USD" }, { currency: "USD" })), ["ccy"]), { ccy: "USD" });
eq("TSXV listing", pick(normalizePosition(U("stock", "XYZ.V", {}, { currency: "CAD", exchange: "XTSX" })), ["sym", "ccy"]), { sym: "XYZ.V", ccy: "CAD" });

// ---- UK / EU (Trading212, AJ Bell, DEGIRO, Bux) ----
eq("LSE in pence (GBX) -> GBP /100", pick(normalizePosition(U("stock", "VOD.L", { price: "7250", cost_basis: "6800", currency: "GBX" }, { currency: "GBX", exchange: "XLON" })), ["sym", "ccy", "price", "avg"]), { sym: "VOD.L", ccy: "GBP", price: 72.5, avg: 68 });
eq("XETRA in EUR", pick(normalizePosition(U("stock", "SAP.DE", {}, { currency: "EUR", exchange: "XETR" })), ["sym", "ccy"]), { sym: "SAP.DE", ccy: "EUR" });
eq("Euronext Amsterdam", pick(normalizePosition(U("stock", "ASML.AS", {}, { currency: "EUR" })), ["sym", "ccy"]), { sym: "ASML.AS", ccy: "EUR" });

// ---- India (Zerodha, Upstox), Australia (CommSec, Stake), Hong Kong (moomoo) ----
eq("NSE in INR", pick(normalizePosition(U("stock", "RELIANCE.NS", {}, { currency: "INR", exchange: "XNSE" })), ["sym", "ccy"]), { sym: "RELIANCE.NS", ccy: "INR" });
eq("ASX in AUD", pick(normalizePosition(U("stock", "BHP.AX", {}, { currency: "AUD", exchange: "XASX" })), ["sym", "ccy"]), { sym: "BHP.AX", ccy: "AUD" });
eq("HKEX in HKD", pick(normalizePosition(U("stock", "0700.HK", {}, { currency: "HKD", exchange: "XHKG" })), ["sym", "ccy"]), { sym: "0700.HK", ccy: "HKD" });
eq("non-ISO currency falls back to USD", pick(normalizePosition(U("stock", "AAPL", { currency: "???" }, { currency: "???" })), ["ccy"]), { ccy: "USD" });

// ---- IBKR (multi-currency, book-value cost basis) ----
eq("book value cost basis divided by units", pick(normalizePosition(U("stock", "MSFT", { units: "20", price: "400", cost_basis: "7000" })), ["avg"]), { avg: 350 });
eq("per-share cost basis kept", pick(normalizePosition(U("stock", "MSFT", { units: "20", price: "400", cost_basis: "350" })), ["avg"]), { avg: 350 });
eq("units as number not string", pick(normalizePosition(U("stock", "MSFT", { units: 7 })), ["units"]), { units: 7 });

// ---- legacy shape (pre-May-2026 accounts: /positions and /holdings) ----
const L = (over = {}, meta = {}) => ({ symbol: { symbol: { symbol: "VAB.TO", raw_symbol: "VAB", description: "VANGUARD CDN AGGREGATE BOND INDEX ETF", currency: { code: "CAD" }, exchange: { code: "TSX", suffix: ".TO" }, type: { code: "et" }, ...meta } }, units: 40, price: 113.15, average_purchase_price: 108.3353, fractional_units: 1.44, currency: { code: "CAD" }, cash_equivalent: false, ...over });
eq("legacy ETF", pick(normalizePosition(L()), ["sym", "ccy", "kind", "units", "avg", "price"]), { sym: "VAB.TO", ccy: "CAD", kind: "etf", units: 40, avg: 108.3353, price: 113.15 });
eq("legacy option shape skipped", normalizePosition({ symbol: { option_symbol: { ticker: "AAPL  261218C00240000" } }, units: -50, price: 38.4 }), { skip: "option" });
eq("legacy stock", pick(normalizePosition(L({ currency: { code: "USD" } }, { symbol: "AAPL", raw_symbol: "AAPL", description: "APPLE INC", currency: { code: "USD" }, exchange: { code: "NASDAQ" }, type: { code: "cs" } })), ["sym", "kind", "ccy"]), { sym: "AAPL", kind: "equity", ccy: "USD" });

// ---- exclusions, balances, account labels ----
eq("excluded symbol", normalizePosition(U("stock", "MARA"), new Set(["MARA"])), { skip: "excluded" });
eq("USD cash", normalizeBalance({ currency: { code: "USD" }, cash: 1234.5 }), { sym: "$CASH", ccy: "USD", amount: 1234.5, debt: false });
eq("CAD cash", normalizeBalance({ currency: { code: "CAD" }, cash: 500 }), { sym: "$CASH.CAD", ccy: "CAD", amount: 500, debt: false });
eq("KRW cash", normalizeBalance({ currency: { code: "KRW" }, cash: 3000000 }), { sym: "$CASH.KRW", ccy: "KRW", amount: 3000000, debt: false });
eq("margin debt", normalizeBalance({ currency: { code: "USD" }, cash: -2500 }), { sym: "$DEBT", ccy: "USD", amount: 2500, debt: true });
eq("zero cash ignored", normalizeBalance({ currency: { code: "USD" }, cash: 0 }), null);
eq("unified balance currency as string", normalizeBalance({ currency: "GBP", cash: "12.5" }), { sym: "$CASH.GBP", ccy: "GBP", amount: 12.5, debt: false });
eq("account label", accountLabel({ institution_name: "Fidelity", number: "Z12-345998" }), "Fidelity …5998");
eq("account label no number", accountLabel({ institution_name: "Robinhood" }), "Robinhood");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
