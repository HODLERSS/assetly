import { useState } from "react";
import type { Investor } from "../lib/api";
import { INVESTOR_DEFAULT } from "../lib/api";

// Five tap-only questions; no typing, skippable at any point (skip = novice value investor defaults).
// Used at sign-up (Onboarding step 1) and in Settings for later edits.
export const QUIZ: { key: keyof Investor; q: string; multi?: boolean; opts: [string, string][] }[] = [
  { key: "styles", q: "What kind of investor are you?", multi: true, opts: [
    ["value", "Value"], ["growth", "Growth"], ["income", "Dividends & income"], ["index", "Index & passive"],
    ["ai_tech", "AI & tech"], ["trader", "Opportunistic trader"], ["crypto", "Crypto"]] },
  { key: "purpose", q: "What should Assetly do for you most?", opts: [
    ["watch", "Stay on top of what I own"], ["ideas", "Find my next investment"],
    ["news", "Catch news that matters"], ["learn", "Help me learn as I go"]] },
  { key: "horizon", q: "How long do you usually hold?", opts: [
    ["<1y", "Under 1 year"], ["1-3y", "1–3 years"], ["3-10y", "3–10 years"], ["10y+", "10+ years"]] },
  { key: "target", q: "What yearly return would make you happy?", opts: [
    ["4-8%", "Steady 4–8%"], ["8-12%", "Market-like 8–12%"], ["12-25%", "Aggressive 12–25%"], ["25%+", "Swing big 25%+"]] },
  { key: "risk", q: "A holding drops 25% in a month. You…", opts: [
    ["buy_more", "Buy more"], ["hold", "Hold on"], ["trim", "Trim a bit"], ["sell", "Get out"]] },
  { key: "level", q: "How experienced are you?", opts: [
    ["novice", "Just starting"], ["intermediate", "Intermediate"], ["advanced", "Advanced"], ["pro", "Professional"]] },
];

export function investorLabel(v: Investor): string {
  const style = QUIZ[0].opts.filter(([k]) => v.styles.includes(k)).map(([, l]) => l).join(" + ") || "Value";
  const lvl = QUIZ[4].opts.find(([k]) => k === v.level)?.[1] ?? "Just starting";
  return `${lvl} · ${style} · ${QUIZ[1].opts.find(([k]) => k === v.horizon)?.[1] ?? v.horizon}`;
}

export function InvestorQuiz({ initial, onDone, onSkip, doneLabel = "Continue" }: {
  initial?: Investor | null; onDone: (v: Investor) => void; onSkip?: () => void; doneLabel?: string;
}) {
  const [v, setV] = useState<Investor>(initial ?? { ...INVESTOR_DEFAULT, styles: [...INVESTOR_DEFAULT.styles] });
  const [i, setI] = useState(0);
  const q = QUIZ[i];
  const last = i === QUIZ.length - 1;
  const next = () => (last ? onDone(v) : setI(i + 1));
  const set = (key: keyof Investor, val: string) => {
    if (key === "styles") {
      setV((p) => {
        const has = p.styles.includes(val);
        const styles = has ? p.styles.filter((x) => x !== val) : [...p.styles, val].slice(-2);   // up to two styles
        return { ...p, styles: styles.length ? styles : ["value"] };
      });
      return;   // multi-select: stay on the question until Continue
    }
    const nv = { ...v, [key]: val };
    setV(nv);
    setTimeout(() => (last ? onDone(nv) : setI(i + 1)), 120);   // single-select: one tap advances (final tap submits the merged answers)
  };
  return (
    <section aria-label="Investor profile" data-testid="investor-quiz">
      <p className="sub" style={{ margin: "0 0 4px" }}>Question {i + 1} of {QUIZ.length}</p>
      <p style={{ margin: "0 0 10px", fontWeight: 600 }}>{q.q}</p>
      <div className="chips" style={{ padding: 0, flexWrap: "wrap", gap: 8 }} role="group" aria-label={q.q}>
        {q.opts.map(([key, label]) => {
          const on = q.key === "styles" ? v.styles.includes(key) : v[q.key] === key;
          return (
            <button key={key} className="chip" aria-pressed={on} style={on ? { fontWeight: 700 } : undefined}
              onClick={() => set(q.key, key)}>{label}</button>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 14, alignItems: "center" }}>
        {q.multi && <button className="btn" style={{ flex: "0 0 auto", width: "auto", padding: "10px 18px" }} onClick={next}>{last ? doneLabel : "Continue"}</button>}
        {!q.multi && i > 0 && <button className="chip" onClick={() => setI(i - 1)}>← Back</button>}
        {onSkip && <button className="chip" data-testid="quiz-skip" onClick={onSkip}>Skip — use defaults</button>}
      </div>
    </section>
  );
}
