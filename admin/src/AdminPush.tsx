import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, timeAgo } from "./ui";

// The Assetly admin app's one screen: send a push by hand. It is its own site (app/admin, deployed apart from the
// consumer app, which carries none of this). Every rule that matters is enforced by the admin-push function, not here: who may use it (verified token + email allowlist), the limits,
// the in-app-only links, the broadcast count, the audit. This page only makes the safe path the easy one:
// preview on a lock screen, "Send test to me" first, a single send only after a test of the same words, and a
// broadcast that needs the recipient count typed out.
export const TITLE_MAX = 60;
export const BODY_MAX = 178;
const LINKS: { value: string; label: string }[] = [
  { value: "", label: "Open the app (Home)" },
  { value: "/brief/latest", label: "The latest brief" },
  { value: "/news", label: "News" },
  { value: "/ask", label: "Ask" },
  { value: "/settings", label: "Settings" },
];
const chars = (s: string) => [...s.trim()].length;

type Recipient = { user_id: string; email: string | null; display_name: string | null; devices: number; environments: string[]; last_brief_at: string | null; last_push_at: string | null };
type LogRow = { id: number; created_at: string; email: string | null; kind: string; title: string | null; status: string; devices: number; sent: number; dropped: number; apns_id: string | null; error: string | null };

export type AdminCall = (body: Record<string, unknown>) => Promise<{ status: number; body: Record<string, unknown> }>;

export function AdminPushScreen({ call: adminPush, onSignOut }: { call: AdminCall; onSignOut: () => void }) {
  const [phase, setPhase] = useState<"checking" | "denied" | "ready">("checking");
  const [me, setMe] = useState<string | null>(null);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [history, setHistory] = useState<LogRow[]>([]);
  const [to, setTo] = useState<string>("me");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [tested, setTested] = useState<string | null>(null);   // the words last sent to me
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");

  const refresh = useCallback(async () => {
    const [r, h] = await Promise.all([adminPush({ action: "recipients" }), adminPush({ action: "history", limit: 50 })]);
    if (r.status === 200) setRecipients((r.body.recipients ?? []) as Recipient[]);
    if (h.status === 200) setHistory((h.body.history ?? []) as LogRow[]);
  }, [adminPush]);
  useEffect(() => {
    let live = true;
    adminPush({ action: "whoami" }).then(async (r) => {
      if (!live) return;
      if (r.status !== 200 || r.body.admin !== true) { setPhase("denied"); return; }
      setMe(String(r.body.email ?? ""));
      setPhase("ready");
      await refresh();
    }).catch(() => { if (live) setPhase("denied"); });
    return () => { live = false; };
  }, [adminPush, refresh]);

  const words = `${title.trim()}\u0000${body.trim()}\u0000${link}`;
  const titleN = chars(title), bodyN = chars(body);
  const valid = titleN > 0 && titleN <= TITLE_MAX && bodyN > 0 && bodyN <= BODY_MAX;
  const optedIn = recipients.filter((r) => r.devices > 0);
  const target = useMemo(() => recipients.find((r) => r.user_id === to) ?? null, [recipients, to]);
  const now = new Date();

  const call = async (payload: Record<string, unknown>, done: (b: Record<string, unknown>) => string) => {
    setBusy(true); setNote(null); setErrors({});
    try {
      const r = await adminPush({ ...payload, title: title.trim(), body: body.trim(), link: link || null });
      if (r.status === 200 && r.body.ok !== false) { setNote({ ok: true, text: done(r.body) }); return r.body; }
      if (r.body.errors) setErrors(r.body.errors as Record<string, string>);
      setNote({ ok: false, text: String(r.body.error ?? `Failed (${r.status})`) + (r.status === 401 ? " Your session may have expired." : "") });
      return null;
    } finally { setBusy(false); void refresh(); }
  };

  if (phase === "checking") return <p className="empty" aria-busy="true">Checking access…</p>;
  if (phase === "denied") {
    return (
      <div className="empty" data-testid="admin-denied">
        <p>This account is not an Assetly admin.</p>
        <button className="btn secondary" onClick={onSignOut} data-testid="admin-sign-out">Sign out</button>
      </div>
    );
  }
  return (
    <div className="admin-push" data-testid="admin-push">
      <h2 className="h1">Send a push</h2>
      <p className="sub" style={{ marginTop: -6, marginBottom: 14 }}>Signed in as {me}. Every send is logged.{" "}
        <button className="chip" onClick={onSignOut} data-testid="admin-sign-out">Sign out</button></p>

      <div className="card" style={{ padding: 14, marginBottom: 14 }}>
        <label className="field">
          <span>Recipient</span>
          <select value={to} onChange={(e) => setTo(e.target.value)} data-testid="admin-recipient">
            <option value="me">Me (test)</option>
            {optedIn.map((r) => (
              <option key={r.user_id} value={r.user_id}>
                {(r.display_name ? `${r.display_name} · ` : "") + (r.email ?? r.user_id.slice(0, 8))} · {r.devices} device{r.devices > 1 ? "s" : ""}{r.environments.includes("sandbox") ? " · sandbox" : ""}
              </option>
            ))}
          </select>
        </label>
        {target && <p className="sub" style={{ margin: "-6px 0 12px" }} data-testid="admin-recipient-detail">Last brief {target.last_brief_at ? timeAgo(target.last_brief_at) : "never"} · last push {target.last_push_at ? timeAgo(target.last_push_at) : "never"}</p>}
        <label className="field">
          <span>Title <span className={"count" + (titleN > TITLE_MAX ? " over" : "")} data-testid="admin-title-count">{titleN}/{TITLE_MAX}</span></span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={TITLE_MAX * 2} data-testid="admin-title" placeholder="Market holiday Monday" />
          {errors.title && <div className="field-err" role="alert">{errors.title}</div>}
        </label>
        <label className="field">
          <span>Body <span className={"count" + (bodyN > BODY_MAX ? " over" : "")} data-testid="admin-body-count">{bodyN}/{BODY_MAX}</span></span>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={BODY_MAX * 2} data-testid="admin-body" placeholder="US markets are closed Monday. Your next brief is Tuesday morning." />
          {errors.body && <div className="field-err" role="alert">{errors.body}</div>}
        </label>
        <label className="field">
          <span>Tap opens</span>
          <select value={link} onChange={(e) => setLink(e.target.value)} data-testid="admin-link">
            {LINKS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
          </select>
          {errors.link && <div className="field-err" role="alert">{errors.link}</div>}
        </label>

        <div className="lock-preview" aria-label="Lock screen preview" data-testid="admin-preview">
          <div className="lp-time">{now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).replace(/\s?[AP]M$/, "")}</div>
          <div className="lp-date">{now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</div>
          <div className="lp-note">
            <span className="lp-icon" aria-hidden="true">
              <svg width="22" height="10" viewBox="0 0 32 12"><rect x="0" y="3" width="14" height="6" rx="3" fill="#F4F5F7" /><rect x="17" y="3" width="14" height="6" rx="3" fill="#F4F5F7" opacity="0.5" /></svg>
            </span>
            <span className="lp-title">{title.trim() || "Title"}</span>
            <span className="lp-when">now</span>
            <span className="lp-body">{body.trim() || "Body"}</span>
          </div>
        </div>

        <div className="actions">
          <button className="btn" disabled={busy || !valid} data-testid="admin-send-test"
            onClick={async () => { const b = await call({ action: "test" }, (x) => `Sent to your ${x.sent} device${Number(x.sent) === 1 ? "" : "s"}.`); if (b) setTested(words); }}>
            Send test to me</button>
          <button className="btn secondary" disabled={busy || !valid} data-testid="admin-dry-run"
            onClick={() => void call(to === "me" ? { action: "test", dry_run: true } : { action: "send", user_id: to, dry_run: true },
              (x) => `Dry run: valid, would reach ${x.devices} device${Number(x.devices) === 1 ? "" : "s"}. Nothing sent.`)}>
            Dry run</button>
        </div>
        {to !== "me" && (
          <div className="actions">
            <button className="btn" disabled={busy || !valid || tested !== words} data-testid="admin-send-one"
              onClick={() => void call({ action: "send", user_id: to }, (x) => `Sent to ${target?.email ?? "them"} (${x.sent} of ${x.devices} devices).`)}>
              Send to {target?.email ?? "recipient"}</button>
          </div>
        )}
        <div className="actions">
          <button className="btn secondary" disabled={busy || !valid || tested !== words || !optedIn.length} data-testid="admin-broadcast"
            onClick={() => { setTyped(""); setConfirming(true); }}>Send to everyone ({optedIn.length})</button>
        </div>
        {valid && tested !== words && <p className="sub" style={{ margin: 0 }} data-testid="admin-test-first">Send a test to yourself first: sending to others unlocks for these exact words.</p>}
        {note && (
          <div className={note.ok ? "status-note ok" : "error-note"} role="status" data-testid="admin-result" style={{ marginTop: 10 }}>
            <span className="lead">{note.ok && <Check />}{note.text}</span>
          </div>
        )}
      </div>

      <h2 className="h1" style={{ fontSize: 16 }}>History</h2>
      <div className="card hist" style={{ marginBottom: 24 }} data-testid="admin-history">
        {history.length === 0 ? <p className="sub" style={{ padding: 14, margin: 0 }}>Nothing sent yet.</p> : (
          <table>
            <thead><tr><th>When</th><th>To</th><th>Kind</th><th>Title</th><th>Result</th></tr></thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id}>
                  <td className="num">{timeAgo(h.created_at)}</td>
                  <td>{h.email ?? "—"}</td>
                  <td>{h.kind.replace("admin_", "")}</td>
                  <td>{h.title ?? ""}</td>
                  <td className={"st-" + h.status} title={h.error ?? h.apns_id ?? ""}>{h.status} {h.sent}/{h.devices}{h.dropped ? ` · ${h.dropped} removed` : ""}{h.error ? ` · ${h.error}` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {confirming && (
        <div className="sheet-back" role="dialog" aria-modal="true" aria-label="Confirm broadcast">
          <div className="sheet">
            <h2>Send to everyone?</h2>
            <p className="mutedc" style={{ marginBottom: 10 }}>
              "{title.trim()}" goes to {optedIn.length} {optedIn.length === 1 ? "person" : "people"} with notifications on. This can't be recalled.
              Type <strong>{optedIn.length}</strong> to confirm.
            </p>
            <label className="field"><span>Recipient count</span>
              <input inputMode="numeric" value={typed} onChange={(e) => setTyped(e.target.value)} data-testid="admin-confirm-count" /></label>
            <button className="btn danger" disabled={busy || typed.trim() !== String(optedIn.length)} data-testid="admin-confirm-broadcast"
              onClick={async () => { await call({ action: "broadcast", confirm_count: Number(typed) }, (x) => `Sent to ${x.recipients} people (${x.sent} devices${Number(x.failed) ? `, ${x.failed} failed` : ""}).`); setConfirming(false); }}>
              Send to {optedIn.length}</button>
            <button className="btn secondary" style={{ marginTop: 8 }} disabled={busy}
              onClick={() => void call({ action: "broadcast", confirm_count: Number(typed), dry_run: true }, (x) => `Dry run: would reach ${x.recipients} people on ${x.devices} devices. Nothing sent.`).then(() => setConfirming(false))}>
              Dry run instead</button>
            <button className="btn secondary" style={{ marginTop: 8 }} disabled={busy} onClick={() => setConfirming(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
