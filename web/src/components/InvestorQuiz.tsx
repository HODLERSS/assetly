import { useState } from "react";
import type { Investor } from "../lib/api";
import { INVESTOR_DEFAULT } from "../lib/api";

// Five tap-only questions; no typing, skippable at any point (skip = novice value investor defaults).
// Used at sign-up (Onboarding step 1) and in Settings for later edits.
// every question is multi-select ("pick all that fit") and advances with its own Continue button
export const QUIZ: { key: keyof Investor; q: string; opts: [string, string][] }[] = [
  { key: "styles", q: "What kind of investor are you? Pick all that fit.", opts: [
    ["value", "Value"], ["growth", "Growth"], ["income", "Dividends & income"], ["index", "Index & passive"],
    ["ai_tech", "AI & tech"], ["trader", "Opportunistic trader"], ["crypto", "Crypto"]] },
  { key: "purpose", q: "What should Assetly do for you? Pick all that apply.", opts: [
    ["watch", "Stay on top of what I own"], ["ideas", "Find my next investment"],
    ["news", "Catch news that matters"], ["learn", "Help me learn as I go"]] },
  { key: "horizon", q: "Which holding horizons fit you? Pick all that apply.", opts: [
    ["<1y", "Under 1 year"], ["1-3y", "1–3 years"], ["3-10y", "3–10 years"], ["10y+", "10+ years"]] },
  { key: "target", q: "What yearly returns would make you happy? Pick all that apply.", opts: [
    ["4-8%", "Steady 4–8%"], ["8-12%", "Market-like 8–12%"], ["12-25%", "Aggressive 12–25%"], ["25%+", "Swing big 25%+"]] },
  { key: "risk", q: "A holding drops 25% in a month. What would you consider? Pick all that apply.", opts: [
    ["buy_more", "Buy more"], ["hold", "Hold on"], ["trim", "Trim a bit"], ["sell", "Get out"]] },
  { key: "level", q: "How experienced are you? Pick all that describe you.", opts: [
    ["novice", "Just starting"], ["intermediate", "Intermediate"], ["advanced", "Advanced"], ["pro", "Professional"]] },
];

const arr = (v: string[] | string | undefined, fallback: string[]): string[] => (Array.isArray(v) ? (v.length ? v : fallback) : v ? [v] : fallback);
export function investorLabel(v: Investor): string {
  const style = QUIZ[0].opts.filter(([k]) => arr(v.styles, ["value"]).includes(k)).map(([, l]) => l).join(" + ") || "Value";
  const lvls = arr(v.level, ["novice"]);
  const lvl = QUIZ.find((q) => q.key === "level")!.opts.filter(([k]) => lvls.includes(k)).map(([, l]) => l).join("/") || "Just starting";
  const hz = QUIZ.find((q) => q.key === "horizon")!.opts.filter(([k]) => arr(v.horizon, ["3-10y"]).includes(k)).map(([, l]) => l).join(", ");
  return `${lvl} · ${style} · ${hz || "3–10 years"}`;
}

export function InvestorQuiz({ initial, onDone, onSkip, doneLabel = "Continue" }: {
  initial?: Investor | null; onDone: (v: Investor) => void; onSkip?: () => void; doneLabel?: string;
}) {
  // Sign-up starts every question UNSELECTED (a tap expresses a real choice); editing starts from the saved answers.
  // Anything left empty falls back to the defaults when submitted.
  const norm = (x: Investor | null | undefined): Investor => x ? {
    styles: arr(x.styles, INVESTOR_DEFAULT.styles), purpose: arr(x.purpose, INVESTOR_DEFAULT.purpose),
    horizon: arr(x.horizon, INVESTOR_DEFAULT.horizon), target: arr(x.target, INVESTOR_DEFAULT.target),
    risk: arr(x.risk, INVESTOR_DEFAULT.risk), level: arr(x.level, INVESTOR_DEFAULT.level),
  } : { styles: [], purpose: [], horizon: [], target: [], risk: [], level: [] };
  const complete = (x: Investor): Investor => ({
    styles: x.styles.length ? x.styles : [...INVESTOR_DEFAULT.styles], purpose: x.purpose.length ? x.purpose : [...INVESTOR_DEFAULT.purpose],
    horizon: x.horizon.length ? x.horizon : [...INVESTOR_DEFAULT.horizon], target: x.target.length ? x.target : [...INVESTOR_DEFAULT.target],
    risk: x.risk.length ? x.risk : [...INVESTOR_DEFAULT.risk], level: x.level.length ? x.level : [...INVESTOR_DEFAULT.level],
  });
  const [v, setV] = useState<Investor>(norm(initial));
  const [i, setI] = useState(0);
  const q = QUIZ[i];
  const last = i === QUIZ.length - 1;
  const next = () => (last ? onDone(complete(v)) : setI(i + 1));
  const set = (key: keyof Investor, val: string) => {
    setV((p) => {
      const cur = p[key];
      return { ...p, [key]: cur.includes(val) ? cur.filter((x) => x !== val) : [...cur, val] };
    });
  };
  return (
    <section aria-label="Investor profile" data-testid="investor-quiz">
      <p className="sub" style={{ margin: "0 0 4px" }}>Question {i + 1} of {QUIZ.length}</p>
      <p style={{ margin: "0 0 10px", fontWeight: 600 }}>{q.q}</p>
      <div className="chips" style={{ padding: 0, flexWrap: "wrap", gap: 8 }} role="group" aria-label={q.q}>
        {q.opts.map(([key, label]) => {
          const on = v[q.key].includes(key);
          return (
            <button key={key} className="chip" aria-pressed={on} style={on ? { fontWeight: 700 } : undefined}
              onClick={() => set(q.key, key)}>{label}</button>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 14, alignItems: "center" }}>
        <button className="btn" style={{ flex: "0 0 auto", width: "auto", padding: "10px 18px" }} onClick={next}>{last ? doneLabel : "Continue"}</button>
        {i > 0 && <button className="chip" onClick={() => setI(i - 1)}>← Back</button>}
        {onSkip && <button className="chip" data-testid="quiz-skip" onClick={onSkip}>Skip — use defaults</button>}
      </div>
    </section>
  );
}
