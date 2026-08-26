import { useRef, useState } from "react";
import type { Api } from "../lib/api";

// ASK — grounded Q&A about the user's own portfolio. Direct, analytical, concise.
const SUGGESTIONS = [
  "What was my 1W movement in $ and %?",
  "What should I watch this week?",
  "Am I too concentrated?",
];

type Turn = { q: string; a: string | null; error?: string };

export function AskScreen({ api }: { api: Api }) {
  const [q, setQ] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

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
      <div ref={listRef} style={{ display: "grid", gap: 10, marginBottom: 84 }}>
        {turns.map((t, i) => (
          <div key={i}>
            <p className="sub" style={{ margin: "0 0 4px", fontWeight: 600 }}>{t.q}</p>
            {t.a === null && <div className="chart-skeleton" style={{ height: 44 }} aria-busy="true" aria-label="Thinking" />}
            {t.a !== null && !t.error && (
              <div className="card insights" data-testid="ask-answer" style={{ whiteSpace: "pre-wrap", fontSize: 13.5, lineHeight: 1.5, padding: "12px 14px" }}>
                {t.a}
                <p className="insights-foot">Not financial advice</p>
              </div>
            )}
            {t.error && <div className="error-note" role="alert">{t.error}</div>}
          </div>
        ))}
      </div>
      <form
        style={{ position: "fixed", left: 0, right: 0, bottom: "calc(52px + env(safe-area-inset-bottom))", maxWidth: 480, margin: "0 auto", padding: "8px 16px", background: "var(--as-bg)", display: "flex", gap: 8 }}
        onSubmit={(e) => { e.preventDefault(); void submit(q); }}>
        <input aria-label="Ask about your portfolio" value={q} onChange={(e) => setQ(e.target.value)}
               placeholder="Ask about your portfolio…" style={{ flex: 1, padding: 12, border: "1px solid var(--as-rule)", borderRadius: 6, background: "var(--as-surface)", minHeight: 44 }} />
        <button className="btn" style={{ width: "auto", padding: "0 18px" }} disabled={busy || !q.trim()}>{busy ? "…" : "Ask"}</button>
      </form>
    </>
  );
}
