// e2e p06 F2: typing "LINK" returned only NASDAQ:LINK (Interlink Electronics); Chainlink needed its full name. A 2-5
// letter query that is a known coin ticker adds the coin beside the equity. The coin goes FIRST when it is a large
// coin (the top tier of this list, by market cap), so Chainlink outranks a micro-cap stock; a small coin goes after
// the equities. Pure, so it is unit-tested without the handler.
export type Row = { symbol: string; name: string; yahoo: string; kind: string; exchange: string; currency: "USD" | "KRW" };
// ordered roughly by market cap (2026); the first TOP_TIER entries outrank an equity of the same ticker
export const COINS: [string, string][] = [
  ["BTC", "Bitcoin"], ["ETH", "Ethereum"], ["XRP", "XRP"], ["SOL", "Solana"], ["BNB", "BNB"], ["DOGE", "Dogecoin"], ["ADA", "Cardano"], ["TRX", "TRON"],
  ["AVAX", "Avalanche"], ["LINK", "Chainlink"], ["TON", "Toncoin"], ["SUI", "Sui"], ["XLM", "Stellar"], ["HBAR", "Hedera"], ["DOT", "Polkadot"], ["LTC", "Litecoin"],
  ["BCH", "Bitcoin Cash"], ["SHIB", "Shiba Inu"], ["UNI", "Uniswap"], ["PEPE", "Pepe"], ["NEAR", "NEAR Protocol"], ["APT", "Aptos"], ["AAVE", "Aave"], ["ICP", "Internet Computer"],
  ["POL", "Polygon"], ["MATIC", "Polygon"], ["ETC", "Ethereum Classic"], ["XMR", "Monero"], ["ATOM", "Cosmos"], ["TAO", "Bittensor"], ["ONDO", "Ondo"], ["ARB", "Arbitrum"],
  ["OP", "Optimism"], ["FIL", "Filecoin"], ["ALGO", "Algorand"], ["VET", "VeChain"], ["RENDER", "Render"], ["INJ", "Injective"], ["FET", "Fetch.ai"], ["KAS", "Kaspa"],
  ["TIA", "Celestia"], ["SEI", "Sei"], ["IMX", "Immutable"], ["GRT", "The Graph"], ["MKR", "Maker"], ["LDO", "Lido DAO"], ["CRO", "Cronos"], ["WLD", "Worldcoin"], ["JUP", "Jupiter"], ["ENA", "Ethena"],
];
export const TOP_TIER = 40;
export function withCryptoTicker(q: string, rows: Row[]): Row[] {
  const t = String(q ?? "").trim().toUpperCase();
  if (!/^[A-Z]{2,6}$/.test(t)) return rows;
  const i = COINS.findIndex(([tk]) => tk === t);
  if (i < 0) return rows;
  const yahoo = `${t}-USD`;
  if (rows.some((r) => r.yahoo === yahoo || (r.kind === "crypto" && r.symbol === t))) return rows;
  const coin: Row = { symbol: t, name: COINS[i][1], yahoo, kind: "crypto", exchange: "Crypto", currency: "USD" };
  return i < TOP_TIER ? [coin, ...rows].slice(0, 12) : [...rows.slice(0, 11), coin];
}
