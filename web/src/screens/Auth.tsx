import { useState, type MouseEvent } from "react";
import { signInWithApple, signInWithEmail, signInWithOAuth, signInWithPassword } from "../lib/supabase";
import { isNative, openExternal } from "../lib/native";
import { PRIVACY_URL, TERMS_URL } from "../lib/legal";

// Canvas 3a: Apple (iOS) / Google OAuth via Supabase, plus a passwordless email link. A password
// field is offered for the accounts that have one — it is visible, not hidden behind a gesture, so
// App Review can reach the demo account the way any other user would.
// Order is what a retail investor trusts: Apple, Google, then email. GitHub stays for the accounts
// created with it, as a quiet text link at the end (the launch audit found it read as "side project"
// when it was the one filled button).
export function AuthScreen() {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [usePassword, setUsePassword] = useState(false);
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [msg, setMsg] = useState<string | null>(null);
  const native = isNative();

  const apple = async () => {
    setState("sending"); setMsg(null);
    const { error } = await signInWithApple();
    setState(error ? "error" : "idle"); if (error) setMsg(error);
  };

  const signInPassword = async () => {
    setState("sending"); setMsg(null);
    const { error } = await signInWithPassword(email.trim(), pw);
    if (error) {
      setState("error");
      setMsg(/invalid login credentials/i.test(error.message) ? "That email and password don't match. Try again or use a sign-in link." : error.message);
      return;
    }
    setState("idle");
  };

  const sendLink = async () => {
    const e = email.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) { setState("error"); setMsg("Enter a valid email address."); return; }
    setState("sending"); setMsg(null);
    const { error } = await signInWithEmail(e);
    if (error) { setState("error"); setMsg(error.message); return; }
    setState("sent");
  };

  // On iOS a policy opens in the in-app browser sheet; on the web, a new tab (the anchor's own behaviour).
  const legal = (url: string) => (ev: MouseEvent) => { if (native) { ev.preventDefault(); void openExternal(url); } };

  return (
    // Not `.screen`: that class carries the tab bar's bottom padding and no top inset, so centring in
    // 100dvh pushed the logo up under the status-bar strip on every iPhone (r2 native audit, 2026-09-25).
    // .auth-screen centres inside the real safe area instead.
    <main className="auth-screen">
      <div style={{ textAlign: "center", marginBottom: 20 }}>
        <svg width="64" height="30" viewBox="0 0 32 12" aria-hidden="true" style={{ color: "var(--as-primary)" }}>
          <rect x="0" y="3" width="14" height="6" rx="3" fill="currentColor" />
          <rect x="17" y="3" width="14" height="6" rx="3" fill="currentColor" opacity="0.45" />
        </svg>
        <h1 className="h1" style={{ fontSize: 30 }} data-testid="auth-wordmark">Assetly</h1>
        <p className="mutedc" data-testid="auth-tagline">Your portfolio, explained every day.</p>
        <p className="mutedc" style={{ fontSize: 13.5, marginTop: 4 }}>An AI brief on what you own, live prices, and answers about your holdings.</p>
      </div>
      {native && (
        <button className="btn apple auth-provider" onClick={apple} disabled={state === "sending"} data-testid="auth-apple">
          <AppleMark />
          Continue with Apple
        </button>
      )}
      <button className="btn secondary google auth-provider" onClick={() => signInWithOAuth("google")} data-testid="auth-google">
        <GoogleMark />
        Continue with Google
      </button>
      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "6px 0" }} aria-hidden="true">
        <span style={{ flex: 1, height: 1, background: "var(--as-rule)" }} /><span className="mutedc" style={{ fontSize: 12 }}>or</span><span style={{ flex: 1, height: 1, background: "var(--as-rule)" }} />
      </div>
      {state === "sent" ? (
        <p role="status" className="card" style={{ padding: 14, textAlign: "center" }} data-testid="link-sent">
          Link sent to <b>{email.trim()}</b>. Open it on this device to sign in.
        </p>
      ) : (
        <form noValidate data-testid="email-form"
          onSubmit={(ev) => { ev.preventDefault(); if (usePassword) void signInPassword(); else void sendLink(); }}>
          <div className="field" style={{ marginBottom: 8 }}>
            <label htmlFor="auth-email">Email</label>
            <input id="auth-email" type="email" inputMode="email" autoComplete={usePassword ? "username" : "email"} value={email}
              enterKeyHint={usePassword ? "next" : "go"} autoCapitalize="none" autoCorrect="off" spellCheck={false}
              onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          </div>
          {usePassword && (
            <div className="field" style={{ marginBottom: 8 }} data-testid="password-field">
              <label htmlFor="auth-pw">Password</label>
              <input id="auth-pw" type="password" autoComplete="current-password" enterKeyHint="go" value={pw} onChange={(e) => setPw(e.target.value)} />
            </div>
          )}
          {msg && <div className="error-note" role="alert">{msg}</div>}
          <button className="btn secondary" type="submit" disabled={state === "sending"}>
            {state === "sending" ? (usePassword ? "Signing in…" : "Sending…") : usePassword ? "Sign in" : "Email me a sign-in link"}
          </button>
          <button type="button" className="linky" data-testid="toggle-password" style={{ marginTop: 10 }}
            onClick={() => { setUsePassword((v) => !v); setMsg(null); setState("idle"); }}>
            {usePassword ? "Email me a sign-in link instead" : "Use a password instead"}
          </button>
        </form>
      )}
      <p className="mutedc" style={{ fontSize: 12.5, textAlign: "center", marginTop: 8 }} data-testid="auth-trust">
        Read-only. We can never trade or move money.
      </p>
      <button type="button" className="linky auth-github" onClick={() => signInWithOAuth("github")} data-testid="auth-github">
        Continue with GitHub
      </button>
      {/* the legal line is the last thing on the page */}
      <p className="auth-legal" data-testid="auth-legal">
        By continuing you agree to the <a href={TERMS_URL} target="_blank" rel="noreferrer noopener" onClick={legal(TERMS_URL)}>Terms</a> and{" "}
        <a href={PRIVACY_URL} target="_blank" rel="noreferrer noopener" onClick={legal(PRIVACY_URL)}>Privacy Policy</a>.
      </p>
    </main>
  );
}

/** Apple logo, single colour (currentColor): black on the light button, white on the dark one, per Apple's HIG. */
function AppleMark() {
  return (
    <svg width="16" height="19" viewBox="0 0 170 200" aria-hidden="true" fill="currentColor"><path d="M150.4 106.3c-.3-26.9 22-39.8 23-40.5-12.5-18.3-32-20.8-38.9-21.1-16.6-1.7-32.3 9.8-40.7 9.8-8.4 0-21.3-9.5-35-9.2-18 .3-34.6 10.5-43.9 26.6-18.7 32.4-4.8 80.5 13.4 106.8 8.9 12.9 19.5 27.4 33.4 26.9 13.4-.5 18.5-8.7 34.7-8.7 16.2 0 20.7 8.7 34.9 8.4 14.4-.3 23.5-13.1 32.3-26 10.2-15 14.4-29.5 14.6-30.2-.3-.2-28-10.8-28.3-42.8zM123.6 27.4c7.4-9 12.4-21.5 11-33.9-10.7.4-23.6 7.1-31.2 16.1-6.9 8-12.9 20.7-11.3 32.9 11.9.9 24.1-6.1 31.5-15.1z"/></svg>
  );
}

/** Google "G", in its four official colours (Google Identity branding: the mark is never recoloured). */
function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}
