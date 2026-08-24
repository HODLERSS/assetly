import { useState } from "react";
import { signInWithEmail, signInWithOAuth } from "../lib/supabase";

// Canvas 3a: GitHub / Google OAuth via Supabase — no password path. Email is a passwordless
// sign-in link, so the rule holds: nothing to remember, nothing to leak.
export function AuthScreen() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [msg, setMsg] = useState<string | null>(null);

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
        <svg width="64" height="30" viewBox="0 0 32 12" aria-hidden="true">
          <rect x="0" y="3" width="14" height="6" rx="3" fill="#2A3F92" />
          <rect x="17" y="3" width="14" height="6" rx="3" fill="#2A3F92" opacity="0.45" />
        </svg>
        <h1 className="h1" style={{ fontSize: 30 }}>Assetly</h1>
        <p className="mutedc">Your positions, priced every minute.</p>
      </div>
      <button className="btn" onClick={() => signInWithOAuth("github")}>Continue with GitHub</button>
      <button className="btn secondary" onClick={() => signInWithOAuth("google")}>Continue with Google</button>
      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "6px 0" }} aria-hidden="true">
        <span style={{ flex: 1, height: 1, background: "var(--as-rule)" }} /><span className="mutedc" style={{ fontSize: 12 }}>or</span><span style={{ flex: 1, height: 1, background: "var(--as-rule)" }} />
      </div>
      {state === "sent" ? (
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
        No passwords here. Your holdings stay yours — row-level security keeps every account isolated.
      </p>
    </main>
  );
}
