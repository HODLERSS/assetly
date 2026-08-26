import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Api } from "../lib/api";

// ASK — grounded Q&A about the user's own portfolio, presented as a chat.
const SUGGESTIONS = [
  "What was my 1W movement in $ and %?",
  "What should I watch this week?",
  "Am I too concentrated?",
];

type Turn = { q: string; a: string | null; error?: string };

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

export function AskScreen({ api }: { api: Api }) {
  const [q, setQ] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView?.({ block: "end", behavior: "smooth" }); }, [turns, busy]);

  const submit = async (question: string) => {
    const text = question.trim();
    if (!text || busy) return;
    setQ("");
    setBusy(true);
    setTurns((t) => [...t, { q: text, a: null }]);
    try {
      const a = await api.ask(text);
      setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, a } : x)));
    } catch (e) {
      setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, a: "", error: e instanceof Error ? e.message : "Something broke — try again." } : x)));
    } finally { setBusy(false); }
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
