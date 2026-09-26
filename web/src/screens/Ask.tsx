import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { getTextScale, LARGE_TEXT, subscribeTextScale } from "../lib/shell";
import type { Api } from "../lib/api";

// ASK: grounded Q&A about the user's own portfolio, presented as a chat.
// Suggestions read the way a person asks ("provide insights", "1W and 1M movement in $ and %" read as a
// query language; r1-r3 design audits).
export const ASK_FIRST_QUESTION = "How healthy is my portfolio?";
const SUGGESTIONS = [
  ASK_FIRST_QUESTION,
  "How did I do this week and this month?",
  "What should I watch this week?",
  "What's my biggest risk right now?",
];

// An answer can take up to ~40s when the model retries (ask's budget). Three dots for 40 seconds read as
// broken (r3 intelligence: a 97s first answer), so the wait says what is happening as it grows.
export const ASK_SLOW_MS = 8_000;
export const ASK_SLOWER_MS = 20_000;
const WAIT_COPY = ["", "Still thinking…", "Taking longer than usual, pulling fresh data…"];
// the Retry beside it is the "try again" (r5 designer m-f: the line repeated its own button)
export const ASK_FAILED = "That didn't go through.";
export const ASK_OFFLINE = "You're offline. Ask needs a connection.";
const offline = () => typeof navigator !== "undefined" && navigator.onLine === false;

type Turn = { q: string; a: string | null; followups?: string[]; error?: string };

// Minimal markdown for what the model actually emits: **bold**, bullet lines, light headers.
function inline(text: string): ReactNode[] {
  const parts = text.split(/\*\*([^*]+)\*\*/g);
  return parts.map((p, i) => (i % 2 ? <strong key={i}>{p}</strong> : <span key={i}>{p}</span>));
}
function Md({ text }: { text: string }) {
  return (
    <>
      {text.split("\n").map((ln, i) => {
        const t = ln.trim();
        if (!t) return <div key={i} style={{ height: 6 }} />;
        const li = t.match(/^(?:[••\-\*]|\d+\.)\s+(.*)$/);
        if (li) return <div key={i} className="md-li">{inline(li[1])}</div>;
        const h = t.match(/^#{1,4}\s+(.*)$/);
        if (h) return <div key={i} style={{ fontWeight: 700, margin: "4px 0 2px" }}>{inline(h[1])}</div>;
        return <div key={i}>{inline(t)}</div>;
      })}
    </>
  );
}

const ASK_STORE = "assetly-ask-v1";
const todayKey = () => new Date().toLocaleDateString("en-CA");
// sessionStorage: the chat survives tab switches and backgrounding, but a hard refresh
// (or killing the app) starts clean — the user's explicit "reset" gesture.
function loadTurns(): Turn[] {
  try {
    const raw = sessionStorage.getItem(ASK_STORE);
    if (!raw) return [];
    const v = JSON.parse(raw) as { date?: string; turns?: Turn[] };
    if (v.date !== todayKey() || !Array.isArray(v.turns)) return [];   // a new day starts fresh
    const t = v.turns.filter((x) => x && typeof x.q === "string");
    while (t.length && t[t.length - 1].a === null) t.pop();   // drop questions that died mid-flight
    return t;
  } catch { return []; }
}

const NARROW_Q = "(max-width: 359px)";
const isNarrow = (): boolean => { try { return window.matchMedia(NARROW_Q).matches; } catch { return false; } };
const subscribeNarrow = (cb: () => void) => {
  try {
    const m = window.matchMedia(NARROW_Q);
    m.addEventListener?.("change", cb);
    return () => m.removeEventListener?.("change", cb);
  } catch { return () => {}; }
};

export function AskScreen({ api, onAnswered, autoAsk = null }: { api: Api; onAnswered?: () => void; autoAsk?: { question: string; key: string } | null }) {
  const [q, setQ] = useState("");
  const largeText = useSyncExternalStore(subscribeTextScale, getTextScale) >= LARGE_TEXT;
  // under 360pt wide the long placeholder is cut too ("Ask about your portfolic" at 320; r10 designer)
  const narrow = useSyncExternalStore(subscribeNarrow, isNarrow, () => false);
  const [turns, setTurns] = useState<Turn[]>(loadTurns);
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState<0 | 1 | 2>(0);   // how long the current answer has taken: see WAIT_COPY
  const retryRef = useRef<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const autoRef = useRef<string | null>(null);
  // the connect moment asks the first question on the user's behalf, once per key, once the data is in
  useEffect(() => {
    if (!autoAsk || autoRef.current === autoAsk.key || busy) return;
    if (turns.some((t) => t.q === autoAsk.question)) { autoRef.current = autoAsk.key; return; }
    autoRef.current = autoAsk.key;
    void submit(autoAsk.question);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoAsk]);

  useEffect(() => {
    try { sessionStorage.setItem(ASK_STORE, JSON.stringify({ date: todayKey(), turns: turns.slice(-30) })); } catch { /* storage unavailable */ }
  }, [turns]);
  useEffect(() => { endRef.current?.scrollIntoView?.({ block: "end", behavior: "smooth" }); }, [turns, busy]);

  const submit = async (question: string) => {
    const text = question.trim();
    if (!text || busy) return;
    setQ("");
    // the keyboard goes down on send: the answer is the thing to read, and it streamed into the 40% of the
    // screen the keyboard left (r2 native audit m2)
    inputRef.current?.blur();
    setBusy(true);
    // the conversation so far, so a follow-up ("why did that happen?") is answered about the last answer
    const history = turns.filter((t) => t.a && !t.error).map((t) => ({ q: t.q, a: t.a as string }));
    setTurns((t) => [...t, { q: text, a: null }]);
    setWait(0);
    const t1 = setTimeout(() => setWait(1), ASK_SLOW_MS), t2 = setTimeout(() => setWait(2), ASK_SLOWER_MS);
    try {
      if (offline()) throw new Error("offline");
      const { answer, followups } = await api.ask(text, history);
      setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, a: answer, followups } : x)));
    } catch {
      // the server's own messages ("The analyst lost the thread…", "not configured") are not for a reader
      setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, a: "", error: offline() ? ASK_OFFLINE : ASK_FAILED } : x)));
    } finally { clearTimeout(t1); clearTimeout(t2); setWait(0); setBusy(false); onAnswered?.(); }
  };
  // Retry asks the failed question again in its place, with the same conversation before it
  const retry = (i: number) => {
    const failed = turns[i];
    if (!failed || busy) return;
    setTurns((t) => t.filter((_, j) => j !== i));
    retryRef.current = failed.q;
  };
  useEffect(() => {
    const q0 = retryRef.current;
    if (q0 === null) return;
    retryRef.current = null;
    void submit(q0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turns]);

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 className="h1">Ask</h2>
        {turns.length > 0 && !busy && (
          <button className="chip" data-testid="ask-new-chat" onClick={() => { setTurns([]); setQ(""); }}>New chat</button>
        )}
      </div>
      <p className="mutedc" style={{ fontSize: 12.5, margin: "2px 0 10px" }}>
        Answers about your holdings, from your own numbers.
      </p>
      {turns.length === 0 && (
        <div className="chips wrap">
          {SUGGESTIONS.map((sug) => (
            <button key={sug} className="chip" onClick={() => void submit(sug)}>{sug}</button>
          ))}
        </div>
      )}
      <div className="chat">
        {turns.map((t, i) => (
          <div key={i} style={{ display: "grid", gap: 10 }}>
            <div className="bubble user">{t.q}</div>
            {t.a === null && (<>
              <div className="bubble ai typing" aria-busy="true" aria-label="Thinking"><i /><i /><i /></div>
              {wait > 0 && <p className="sub ask-wait" data-testid="ask-wait" aria-live="polite">{WAIT_COPY[wait]}</p>}
            </>)}
            {t.a !== null && !t.error && (
              <div className="bubble ai" data-testid="ask-answer">
                <Md text={t.a} />
                <p className="bubble-foot">Not financial advice</p>
              </div>
            )}
            {t.error && (
              <div className="error-note inline-note" role="alert" data-testid="ask-error">
                <span>{t.error}</span>
                {i === turns.length - 1 && <button className="chip" disabled={busy} onClick={() => retry(i)}>Retry</button>}
              </div>
            )}
            {i === turns.length - 1 && !busy && t.a && !t.error && (t.followups?.length ?? 0) > 0 && (
              <div className="chips wrap" style={{ padding: 0 }} aria-label="Follow-up questions">
                {t.followups!.map((f) => (
                  <button key={f} className="chip" onClick={() => void submit(f)}>{f}</button>
                ))}
              </div>
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <form className="ask-composer" onSubmit={(e) => { e.preventDefault(); void submit(q); }}>
        <input ref={inputRef} aria-label="Ask about your portfolio" value={q} onChange={(e) => setQ(e.target.value)}
               placeholder={largeText && narrow ? "Ask…" : largeText || narrow ? "Ask a question…" : "Ask about your portfolio…"} enterKeyHint="send" autoComplete="off" />
        {/* the button keeps its width while an answer is on the way: "…" shrank it to 49px and the field jumped
            27px wider and back on every question (r5 designer m-g). The label stays for the width, hidden. */}
        <button className="btn ask-send" disabled={busy || !q.trim()} aria-busy={busy || undefined} aria-label={busy ? "Waiting for the answer" : undefined}>
          <span style={busy ? { visibility: "hidden" } : undefined}>Send</span>
          {busy && <span className="ask-send-wait" aria-hidden="true"><span className="step-mark active" /></span>}
        </button>
      </form>
    </>
  );
}
