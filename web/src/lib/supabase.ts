import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Browser } from "@capacitor/browser";
import { isNative } from "./native";

// Local supabase-start defaults (the CLI's public demo keys) keep dev zero-config;
// production values come from Vite env at build time.
const url = import.meta.env.VITE_SUPABASE_URL ?? "http://127.0.0.1:54321";
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

// Native: PKCE, and the callback URL is handed to completeNativeAuth() by the app-URL listener, so the
// client must not try to read tokens out of window.location (which is capacitor://localhost there).
export const NATIVE_REDIRECT = "assetly://auth-callback";
export const supabase: SupabaseClient = createClient(url, anon, {
  auth: { persistSession: true, autoRefreshToken: true, flowType: isNative() ? "pkce" : "implicit", detectSessionInUrl: !isNative() },
});

export type OAuthProvider = "github" | "google";

export async function signInWithOAuth(provider: OAuthProvider) {
  if (!isNative()) {
    return supabase.auth.signInWithOAuth({ provider, options: { redirectTo: window.location.origin + window.location.pathname } });
  }
  // iOS: the provider page opens in a system browser sheet and returns through the app's URL scheme
  const res = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo: NATIVE_REDIRECT, skipBrowserRedirect: true } });
  if (res.data?.url) await Browser.open({ url: res.data.url, presentationStyle: "popover" });
  return res;
}

/** Finish a native OAuth round trip: assetly://auth-callback?code=... (PKCE) or #access_token=... (implicit). */
export async function completeNativeAuth(rawUrl: string): Promise<{ error: string | null }> {
  const q = rawUrl.includes("?") ? rawUrl.slice(rawUrl.indexOf("?") + 1).split("#")[0] : "";
  const params = new URLSearchParams(q);
  const code = params.get("code");
  if (code) { const { error } = await supabase.auth.exchangeCodeForSession(code); return { error: error?.message ?? null }; }
  const frag = new URLSearchParams(rawUrl.includes("#") ? rawUrl.slice(rawUrl.indexOf("#") + 1) : "");
  const access_token = frag.get("access_token"), refresh_token = frag.get("refresh_token");
  if (access_token && refresh_token) { const { error } = await supabase.auth.setSession({ access_token, refresh_token }); return { error: error?.message ?? null }; }
  const err = params.get("error_description") ?? params.get("error") ?? frag.get("error_description");
  return { error: err ?? "Sign-in did not complete. Try again." };
}

/** Native Sign in with Apple (App Store requirement 4.8): Apple's sheet -> identity token -> Supabase session. */
export async function signInWithApple(): Promise<{ error: string | null }> {
  const { SignInWithApple } = await import("@capacitor-community/apple-sign-in");
  const raw = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  const hashed = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  let res: { response: { identityToken: string; givenName?: string | null; familyName?: string | null } };
  try {
    res = await SignInWithApple.authorize({ clientId: "com.hodlerss.assetly", redirectURI: `${url}/auth/v1/callback`, scopes: "email name", state: raw.slice(0, 16), nonce: hashed });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    return { error: /cancel/i.test(m) ? null : "Apple sign-in did not complete. Try again." };   // a dismissed sheet is not an error
  }
  const { data, error } = await supabase.auth.signInWithIdToken({ provider: "apple", token: res.response.identityToken, nonce: raw });
  if (error) return { error: error.message };
  // Apple only sends the name on the first authorization; keep it so the profile is not a relay address
  const name = [res.response.givenName, res.response.familyName].filter(Boolean).join(" ").trim();
  if (name && data.user) {
    await supabase.auth.updateUser({ data: { full_name: name } }).catch(() => {});
    await supabase.from("profiles").update({ display_name: name }).eq("id", data.user.id);
  }
  return { error: null };
}

/** Password sign-in exists only for App Review's demo account; it is never offered to the public. */
export function signInWithPassword(email: string, password: string) {
  return supabase.auth.signInWithPassword({ email, password });
}

export function signInWithEmail(email: string) {
  return supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin + window.location.pathname },
  });
}
