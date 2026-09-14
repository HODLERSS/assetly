import { useRef, useState } from "react";
import { signInWithApple, signInWithEmail, signInWithOAuth, signInWithPassword } from "../lib/supabase";
import { isNative } from "../lib/native";

// Canvas 3a: GitHub / Google OAuth via Supabase — no password path. Email is a passwordless
// sign-in link, so the rule holds: nothing to remember, nothing to leak.
export function AuthScreen() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [msg, setMsg] = useState<string | null>(null);
  const native = isNative();
  // App Review's demo sign-in: hidden until the wordmark is tapped five times within three seconds
  // (or ?reviewer=1 on the web). Nobody else is offered a password.
  const [reviewer, setReviewer] = useState<boolean>(() => { try { return new URLSearchParams(window.location.search).get("reviewer") === "1"; } catch { return false; } });
  const taps = useRef<number[]>([]);
  const tapWordmark = () => { const now = Date.now(); taps.current = [...taps.current.filter((t) => now - t < 3000), now]; if (taps.current.length >= 5) { setReviewer(true); taps.current = []; } };
  const [pw, setPw] = useState("");
  const signInReviewer = async () => {
    setState("sending"); setMsg(null);
    const { error } = await signInWithPassword(email.trim(), pw);
    if (error) { setState("error"); setMsg(error.message); return; }
    setState("idle");
  };
  const apple = async () => {
    setState("sending"); setMsg(null);
    const { error } = await signInWithApple();
    setState(error ? "error" : "idle"); if (error) setMsg(error);
  };

  const sendLink = async () => {
    const e = email.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) { setState("error"); setMsg("Enter a valid email address."); return; }
    setState("sending"); setMsg(null);
    const { error } = await signInWithEmail(e);
    if (error) { setState("error"); setMsg(error.message); return; }
    setState("sent");
  };

  return (
    <main className="screen" style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 12, minHeight: "100dvh" }}>
      <div style={{ textAlign: "center", marginBottom: 20 }}>
        <svg width="64" height="30" viewBox="0 0 32 12" aria-hidden="true" style={{ color: "var(--as-primary)" }}>
          <rect x="0" y="3" width="14" height="6" rx="3" fill="currentColor" />
          <rect x="17" y="3" width="14" height="6" rx="3" fill="currentColor" opacity="0.45" />
        </svg>
        <h1 className="h1" style={{ fontSize: 30 }} onClick={tapWordmark} data-testid="auth-wordmark">Assetly</h1>
        <p className="mutedc">Your positions, priced every minute.</p>
      </div>
      {native && (
        <button className="btn apple" onClick={apple} disabled={state === "sending"} data-testid="auth-apple">
          <svg width="16" height="19" viewBox="0 0 170 200" aria-hidden="true" fill="currentColor"><path d="M150.4 106.3c-.3-26.9 22-39.8 23-40.5-12.5-18.3-32-20.8-38.9-21.1-16.6-1.7-32.3 9.8-40.7 9.8-8.4 0-21.3-9.5-35-9.2-18 .3-34.6 10.5-43.9 26.6-18.7 32.4-4.8 80.5 13.4 106.8 8.9 12.9 19.5 27.4 33.4 26.9 13.4-.5 18.5-8.7 34.7-8.7 16.2 0 20.7 8.7 34.9 8.4 14.4-.3 23.5-13.1 32.3-26 10.2-15 14.4-29.5 14.6-30.2-.3-.2-28-10.8-28.3-42.8zM123.6 27.4c7.4-9 12.4-21.5 11-33.9-10.7.4-23.6 7.1-31.2 16.1-6.9 8-12.9 20.7-11.3 32.9 11.9.9 24.1-6.1 31.5-15.1z"/></svg>
          Continue with Apple
        </button>
      )}
      <button className={native ? "btn secondary" : "btn"} onClick={() => signInWithOAuth("github")}>Continue with GitHub</button>
      <button className="btn secondary" onClick={() => signInWithOAuth("google")}>Continue with Google</button>
      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "6px 0" }} aria-hidden="true">
        <span style={{ flex: 1, height: 1, background: "var(--as-rule)" }} /><span className="mutedc" style={{ fontSize: 12 }}>or</span><span style={{ flex: 1, height: 1, background: "var(--as-rule)" }} />
      </div>
      {reviewer ? (
        <form noValidate onSubmit={(ev) => { ev.preventDefault(); void signInReviewer(); }} data-testid="reviewer-form">
          <div className="field" style={{ marginBottom: 8 }}>
            <label htmlFor="rv-email">Reviewer email</label>
            <input id="rv-email" type="email" inputMode="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="field" style={{ marginBottom: 8 }}>
            <label htmlFor="rv-pw">Reviewer password</label>
            <input id="rv-pw" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} />
          </div>
          {msg && <div className="error-note" role="alert">{msg}</div>}
          <button className="btn secondary" type="submit" disabled={state === "sending"}>{state === "sending" ? "Signing in…" : "Sign in as reviewer"}</button>
        </form>
      ) : native ? (
        <p className="mutedc" style={{ fontSize: 12.5, textAlign: "center" }}>Email links open in Safari; on iPhone, sign in with Apple, GitHub or Google.</p>
      ) : state === "sent" ? (
        <p role="status" className="card" style={{ padding: 14, textAlign: "center" }}>
          Link sent to <b>{email.trim()}</b>. Open it on this device to sign in.
        </p>
      ) : (
        <form noValidate onSubmit={(ev) => { ev.preventDefault(); sendLink(); }}>
          <div className="field" style={{ marginBottom: 8 }}>
            <label htmlFor="auth-email">Email — we send a sign-in link</label>
            <input id="auth-email" type="email" inputMode="email" autoComplete="email" value={email}
              onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          </div>
          {msg && <div className="error-note" role="alert">{msg}</div>}
          <button className="btn secondary" type="submit" disabled={state === "sending"}>
            {state === "sending" ? "Sending…" : "Email me a sign-in link"}
          </button>
        </form>
      )}
      <p className="mutedc" style={{ fontSize: 12.5, textAlign: "center", marginTop: 8 }}>
        {reviewer ? "App Review access only." : "No passwords here. Your holdings stay yours — row-level security keeps every account isolated."}
      </p>
    </main>
  );
}
