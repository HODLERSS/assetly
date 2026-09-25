// Shared fixtures for the behaviour suites (client.test.tsx). ui.test.tsx keeps its own copy.
import { vi } from "vitest";
import type { Api, PortfolioRow, Profile } from "../lib/api";

export const profile: Profile = { id: "u-test", display_name: "Minjae", base_currency: "USD", display_us: "USD", display_kr: "KRW", markets: ["US", "KR"], onboarded_at: "2026-08-23T00:00:00Z" };
export const row = (over: Partial<PortfolioRow>): PortfolioRow => ({
  holding_id: "h1", symbol: "RDDT", account: "brokerage", nickname: "", name: "Reddit", currency: "USD", kind: "equity",
  qty: 24, cost_basis: 4021.0, avg_cost: 167.54, price: 200, change_pct: 5.26,
  as_of: new Date().toISOString(), value: 4800, total_gl: 779, ...over,
});

export function stubApi(over: Partial<Api> = {}): Api {
  return {
    getProfile: vi.fn().mockResolvedValue(profile),
    completeOnboarding: vi.fn().mockResolvedValue(undefined),
    updateInvestor: vi.fn().mockResolvedValue(undefined),
    searchSymbols: vi.fn().mockResolvedValue([{ symbol: "MARA", name: "MARA Holdings", exchange: "NASDAQ", currency: "USD", kind: "equity" }]),
    ensureSymbol: vi.fn().mockResolvedValue(undefined),
    refreshNews: vi.fn().mockResolvedValue(true),
    getFxRate: vi.fn().mockResolvedValue(1380),
    getFxRates: vi.fn().mockResolvedValue({ USD: 1, KRW: 1380 }),
    getFxInfo: vi.fn().mockResolvedValue({ rate: 1381, asOf: new Date(Date.now() - 60000).toISOString() }),
    updateBaseCurrency: vi.fn().mockResolvedValue(undefined),
    updateDisplayCcy: vi.fn().mockResolvedValue(undefined),
    getPulse: vi.fn().mockResolvedValue([]),
    firstBrief: vi.fn().mockResolvedValue(undefined),
    refreshPortfolioInsights: vi.fn().mockResolvedValue(null),
    refreshSymbolInsights: vi.fn().mockResolvedValue(null),
    snaptrade: vi.fn().mockResolvedValue({ ok: true, connected: false }),
    snaptradeEvents: vi.fn().mockResolvedValue([]),
    snaptradeEventsSeen: vi.fn().mockResolvedValue(undefined),
    excludeImport: vi.fn().mockResolvedValue(undefined),
    snaptradeSync: vi.fn().mockResolvedValue(undefined),
    brokerageConnected: vi.fn().mockResolvedValue(undefined),
    getDailyBriefs: vi.fn().mockResolvedValue([]),
    getAssessmentStatus: vi.fn().mockResolvedValue({ status: "pending", generatedAt: null, intelligenceAt: null }),
    getBriefAudioUrl: vi.fn().mockResolvedValue(null),
    warmup: vi.fn().mockResolvedValue(undefined),
    getInsights: vi.fn().mockResolvedValue(null),
    getPortfolioInsights: vi.fn().mockResolvedValue(null),
    ask: vi.fn().mockResolvedValue({ answer: "ok", followups: [] }),
    getHistory: vi.fn().mockResolvedValue([
      { ts: "2026-08-20T20:00:00Z", price: 190 }, { ts: "2026-08-21T14:00:00Z", price: 188 },
      { ts: "2026-08-21T20:00:00Z", price: 195 }, { ts: "2026-08-22T20:00:00Z", price: 197 },
    ]),
    getPortfolio: vi.fn().mockResolvedValue([row({})]),
    addPosition: vi.fn().mockResolvedValue(undefined),
    getLots: vi.fn().mockResolvedValue([{ id: "l1", holding_id: "h1", qty: 10, cost_per_share: 166.55, acquired_on: "2026-07-22", note: null }]),
    addLot: vi.fn().mockResolvedValue(undefined),
    updateLot: vi.fn().mockResolvedValue(undefined),
    deleteLot: vi.fn().mockResolvedValue(undefined),
    removeHolding: vi.fn().mockResolvedValue(undefined),
    setHoldingAccount: vi.fn().mockImplementation(async (id: string) => id),
    getNews: vi.fn().mockResolvedValue([
      { id: "n1", symbol: "RDDT", title: "Reddit posts strong quarter", url: "https://ex.test/1", source: "Yahoo Finance", published_at: new Date().toISOString() },
    ]),
    signOut: vi.fn().mockResolvedValue(undefined),
    ...over,
  } as Api;
}
