import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Api } from "../lib/api";

// ASK — grounded Q&A about the user's own portfolio, presented as a chat.
const SUGGESTIONS = [
  "Assess my portfolio and provide insights",
  "What was my 1W and 1M movement in $ and %?",
  "What should I watch this week?",
  "Which of my holdings would I add to today, and what would have to be true?",
];

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

export function AskScreen({ api, onAnswered, autoAsk = null }: { api: Api; onAnswered?: () => void; autoAsk?: { question: string; key: string } | null }) {
  const [q, setQ] = useState("");
  const [turns, setTurns] = useState<Turn[]>(loadTurns);
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
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
    setBusy(true);
    setTurns((t) => [...t, { q: text, a: null }]);
    try {
      const { answer, followups } = await api.ask(text);
      setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, a: answer, followups } : x)));
    } catch (e) {
      setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, a: "", error: e instanceof Error ? e.message : "Something broke — try again." } : x)));
    } finally { setBusy(false); onAnswered?.(); }
  };

  return (
    <>
      <h2 className="h1">Ask</h2>
      <p className="mutedc" style={{ fontSize: 12.5, margin: "2px 0 10px" }}>
        Your holdings, your numbers — answered from your data.
      </p>
      {turns.length === 0 && (
        <div className="chips" style={{ flexWrap: "wrap" }}>
          {SUGGESTIONS.map((sug) => (
            <button key={sug} className="chip" onClick={() => void submit(sug)}>{sug}</button>
          ))}
        </div>
      )}
      <div className="chat">
        {turns.map((t, i) => (
          <div key={i} style={{ display: "grid", gap: 10 }}>
            <div className="bubble user">{t.q}</div>
            {t.a === null && (
              <div className="bubble ai typing" aria-busy="true" aria-label="Thinking"><i /><i /><i /></div>
            )}
            {t.a !== null && !t.error && (
              <div className="bubble ai" data-testid="ask-answer">
                <Md text={t.a} />
                <p className="bubble-foot">Not financial advice</p>
              </div>
            )}
            {t.error && <div className="error-note" role="alert">{t.error}</div>}
            {i === turns.length - 1 && !busy && t.a && !t.error && (t.followups?.length ?? 0) > 0 && (
              <div className="chips" style={{ flexWrap: "wrap", padding: 0 }} aria-label="Follow-up questions">
                {t.followups!.map((f) => (
                  <button key={f} className="chip" onClick={() => void submit(f)}>{f}</button>
                ))}
              </div>
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <form
        style={{ position: "fixed", left: 0, right: 0, bottom: "calc(52px + env(safe-area-inset-bottom))", maxWidth: 480, margin: "0 auto", padding: "8px 16px", background: "var(--as-bg)", display: "flex", gap: 8 }}
        onSubmit={(e) => { e.preventDefault(); void submit(q); }}>
        <input aria-label="Ask about your portfolio" value={q} onChange={(e) => setQ(e.target.value)}
               placeholder="Ask about your portfolio…" style={{ flex: 1, padding: 12, border: "1px solid var(--as-rule)", borderRadius: 22, background: "var(--as-surface)", minHeight: 44 }} />
        <button className="btn" style={{ width: "auto", padding: "0 18px", borderRadius: 22 }} disabled={busy || !q.trim()}>{busy ? "…" : "Send"}</button>
      </form>
    </>
  );
}
