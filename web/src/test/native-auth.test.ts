// Native sign-in plumbing: the URL Supabase hands back through assetly://auth-callback and the reviewer form.
import { describe, it, expect, vi, beforeEach } from "vitest";

const exchange = vi.fn(), setSession = vi.fn();
vi.mock("../lib/native", () => ({ isNative: () => true, openExternal: vi.fn(), onAuthReturn: () => () => {}, onOAuthReturn: () => () => {}, openConnectPortal: vi.fn(), platformTag: () => "ios" }));
vi.mock("@capacitor/browser", () => ({ Browser: { open: vi.fn(), close: vi.fn() } }));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ auth: { exchangeCodeForSession: exchange, setSession, signInWithOAuth: vi.fn(), signInWithIdToken: vi.fn(), signInWithPassword: vi.fn() }, from: () => ({}) }),
}));

describe("completeNativeAuth", () => {
  beforeEach(() => { exchange.mockReset(); setSession.mockReset(); });
  it("exchanges a PKCE code", async () => {
    exchange.mockResolvedValue({ error: null });
    const { completeNativeAuth } = await import("../lib/supabase");
    expect(await completeNativeAuth("assetly://auth-callback?code=abc123")).toEqual({ error: null });
    expect(exchange).toHaveBeenCalledWith("abc123");
  });
  it("falls back to fragment tokens (implicit)", async () => {
    setSession.mockResolvedValue({ error: null });
    const { completeNativeAuth } = await import("../lib/supabase");
    expect(await completeNativeAuth("assetly://auth-callback#access_token=A&refresh_token=R&type=magiclink")).toEqual({ error: null });
    expect(setSession).toHaveBeenCalledWith({ access_token: "A", refresh_token: "R" });
  });
  it("reports the provider's error text and never throws", async () => {
    const { completeNativeAuth } = await import("../lib/supabase");
    const r = await completeNativeAuth("assetly://auth-callback?error=access_denied&error_description=User+cancelled");
    expect(r.error).toMatch(/cancelled/i);
    expect(exchange).not.toHaveBeenCalled();
  });
  it("a bogus URL is a soft error", async () => {
    const { completeNativeAuth } = await import("../lib/supabase");
    expect((await completeNativeAuth("assetly://auth-callback")).error).toMatch(/try again/i);
  });
});
