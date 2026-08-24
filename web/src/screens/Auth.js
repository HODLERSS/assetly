import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { signInWithEmail, signInWithOAuth } from "../lib/supabase";
// Canvas 3a: GitHub / Google OAuth via Supabase — no password path. Email is a passwordless
// sign-in link, so the rule holds: nothing to remember, nothing to leak.
export function AuthScreen() {
    const [email, setEmail] = useState("");
    const [state, setState] = useState("idle");
    const [msg, setMsg] = useState(null);
    const sendLink = async () => {
        const e = email.trim();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) {
            setState("error");
            setMsg("Enter a valid email address.");
            return;
        }
        setState("sending");
        setMsg(null);
        const { error } = await signInWithEmail(e);
        if (error) {
            setState("error");
            setMsg(error.message);
            return;
        }
        setState("sent");
    };
    return (_jsxs("main", { className: "screen", style: { display: "flex", flexDirection: "column", justifyContent: "center", gap: 12, minHeight: "100dvh" }, children: [_jsxs("div", { style: { textAlign: "center", marginBottom: 20 }, children: [_jsxs("svg", { width: "64", height: "30", viewBox: "0 0 32 12", "aria-hidden": "true", children: [_jsx("rect", { x: "0", y: "3", width: "14", height: "6", rx: "3", fill: "#2A3F92" }), _jsx("rect", { x: "17", y: "3", width: "14", height: "6", rx: "3", fill: "#2A3F92", opacity: "0.45" })] }), _jsx("h1", { className: "h1", style: { fontSize: 30 }, children: "Assetly" }), _jsx("p", { className: "mutedc", children: "Your positions, priced every minute." })] }), _jsx("button", { className: "btn", onClick: () => signInWithOAuth("github"), children: "Continue with GitHub" }), _jsx("button", { className: "btn secondary", onClick: () => signInWithOAuth("google"), children: "Continue with Google" }), _jsxs("div", { style: { display: "flex", alignItems: "center", gap: 10, margin: "6px 0" }, "aria-hidden": "true", children: [_jsx("span", { style: { flex: 1, height: 1, background: "var(--as-rule)" } }), _jsx("span", { className: "mutedc", style: { fontSize: 12 }, children: "or" }), _jsx("span", { style: { flex: 1, height: 1, background: "var(--as-rule)" } })] }), state === "sent" ? (_jsxs("p", { role: "status", className: "card", style: { padding: 14, textAlign: "center" }, children: ["Link sent to ", _jsx("b", { children: email.trim() }), ". Open it on this device to sign in."] })) : (_jsxs("form", { onSubmit: (ev) => { ev.preventDefault(); sendLink(); }, children: [_jsxs("div", { className: "field", style: { marginBottom: 8 }, children: [_jsx("label", { htmlFor: "auth-email", children: "Email \u2014 we send a sign-in link" }), _jsx("input", { id: "auth-email", type: "email", inputMode: "email", autoComplete: "email", value: email, onChange: (e) => setEmail(e.target.value), placeholder: "you@example.com" })] }), msg && _jsx("div", { className: "error-note", role: "alert", children: msg }), _jsx("button", { className: "btn secondary", type: "submit", disabled: state === "sending", children: state === "sending" ? "Sending…" : "Email me a sign-in link" })] })), _jsx("p", { className: "mutedc", style: { fontSize: 12.5, textAlign: "center", marginTop: 8 }, children: "No passwords here. Your holdings stay yours \u2014 row-level security keeps every account isolated." })] }));
}
