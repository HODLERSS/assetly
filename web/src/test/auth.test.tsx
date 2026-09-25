// Sign-in screen: provider order, marks, legal links, and copy a retail investor trusts.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const native = vi.hoisted(() => ({ on: false, opened: [] as string[] }));
vi.mock("../lib/native", () => ({
  isNative: () => native.on,
  openExternal: async (u: string) => { native.opened.push(u); },
}));
const oauth = vi.hoisted(() => vi.fn().mockResolvedValue({ data: {}, error: null }));
vi.mock("../lib/supabase", () => ({
  signInWithOAuth: oauth,
  signInWithEmail: vi.fn().mockResolvedValue({ error: null }),
  signInWithApple: vi.fn().mockResolvedValue({ error: null }),
  signInWithPassword: vi.fn().mockResolvedValue({ error: { message: "Invalid login credentials" } }),
}));

import { AuthScreen } from "../screens/Auth";
import { PRIVACY_URL, TERMS_URL } from "../lib/legal";

beforeEach(() => { native.on = false; native.opened = []; oauth.mockClear(); });

const order = () => [...document.querySelectorAll("[data-testid^='auth-'], form")]
  .map((el) => el.getAttribute("data-testid") ?? "email-form")
  .filter((t) => ["auth-apple", "auth-google", "email-form", "auth-github"].includes(t));

describe("sign-in screen", () => {
  it("iOS: Apple, then Google, then email; GitHub last as a quiet text link", () => {
    native.on = true;
    render(<AuthScreen />);
    expect(order()).toEqual(["auth-apple", "auth-google", "email-form", "auth-github"]);
    expect(screen.getByTestId("auth-github").className).toMatch(/\blinky\b/);
    expect(screen.getByTestId("auth-github").className).not.toMatch(/\bbtn\b/);
  });
  it("web: Google leads (no Apple button), GitHub still reachable at the end", async () => {
    render(<AuthScreen />);
    expect(order()).toEqual(["auth-google", "email-form", "auth-github"]);
    await userEvent.click(screen.getByTestId("auth-github"));
    expect(oauth).toHaveBeenCalledWith("github");
  });
  it("provider buttons carry their marks; Google's in its own colours", () => {
    native.on = true;
    render(<AuthScreen />);
    expect(screen.getByTestId("auth-apple").querySelector("svg")?.getAttribute("fill")).toBe("currentColor");
    const fills = [...screen.getByTestId("auth-google").querySelectorAll("path")].map((p) => p.getAttribute("fill"));
    expect(fills).toEqual(["#EA4335", "#4285F4", "#FBBC05", "#34A853"]);
  });
  it("says what the product does, and trust in plain words", () => {
    render(<AuthScreen />);
    expect(screen.getByTestId("auth-tagline").textContent).not.toMatch(/priced every minute/i);
    expect(screen.getByTestId("auth-subline").textContent).toBe("A daily brief on what you own, live prices, and answers about your holdings.");   // r3-r5 design m10
    expect(screen.getByTestId("auth-trust").textContent).toBe("Read-only. We can never trade or move money.");
    expect(document.body.textContent).not.toMatch(/row-level/i);
  });
  it("links the Terms and Privacy Policy before an account exists (in-app sheet on iOS)", async () => {
    render(<AuthScreen />);
    const legal = screen.getByTestId("auth-legal");
    expect(legal.textContent).toBe("By continuing you agree to the Terms and Privacy Policy.");
    expect(screen.getByRole("link", { name: "Terms" }).getAttribute("href")).toBe(TERMS_URL);
    expect(screen.getByRole("link", { name: "Privacy Policy" }).getAttribute("href")).toBe(PRIVACY_URL);
    native.on = true;
    render(<AuthScreen />);
    await userEvent.click(screen.getAllByRole("link", { name: "Privacy Policy" })[1]);
    expect(native.opened).toEqual([PRIVACY_URL]);
  });
  it("a wrong password reads as a person would say it", async () => {
    render(<AuthScreen />);
    await userEvent.click(screen.getByTestId("toggle-password"));
    await userEvent.type(screen.getByLabelText(/email/i), "a@b.co");
    await userEvent.type(screen.getByLabelText(/password/i), "nope");
    await userEvent.click(screen.getByRole("button", { name: /^sign in$/i }));
    expect((await screen.findByRole("alert")).textContent).toBe("That email and password don't match. Try again or use a sign-in link.");
  });
});
