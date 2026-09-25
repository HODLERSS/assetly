import { useEffect, useState } from "react";
import type { Investor } from "../lib/api";
import { INVESTOR_DEFAULT } from "../lib/api";

// Six tap-only questions; no typing, skippable at any point (skip keeps what was answered and fills the rest with defaults).
// Used at sign-up (Onboarding step 1) and in Settings for later edits.
// Most questions are multi-select ("pick all that fit"); experience and the drawdown reaction are one
// answer each (a person is not both "Just starting" and "Professional"; r1 + r2 design audits). Answers
// are stored as arrays either way. Every question advances with its own Continue button.
export type QuizKey = Exclude<keyof Investor, "defaulted">;
export const QUIZ: { key: QuizKey; q: string; opts: [string, string][]; single?: boolean }[] = [
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
  { key: "risk", q: "A holding drops 25% in a month. What would you most likely do?", single: true, opts: [
    ["buy_more", "Buy more"], ["hold", "Hold on"], ["trim", "Trim a bit"], ["sell", "Get out"]] },
  { key: "level", q: "How experienced are you?", single: true, opts: [
    ["novice", "Just starting"], ["intermediate", "Intermediate"], ["advanced", "Advanced"], ["pro", "Professional"]] },
];

const arr = (v: string[] | string | undefined, fallback: string[]): string[] => (Array.isArray(v) ? (v.length ? v : fallback) : v ? [v] : fallback);
export function investorLabel(v: Investor): string {
  const style = QUIZ[0].opts.filter(([k]) => arr(v.styles, ["value"]).includes(k)).map(([, l]) => l).join(" + ") || "Value";
  const lvls = arr(v.level, ["novice"]);
  const lvl = QUIZ.find((q) => q.key === "level")!.opts.filter(([k]) => lvls.includes(k)).map(([, l]) => l).join("/") || "Just starting";
  // one horizon never breaks inside itself: "3–" / "10 years" on an iPhone 16e (r3 native m6)
  const whole = (l: string) => l.replace(/–/g, "⁠–⁠").replace(/ /g, " ");
  const hz = QUIZ.find((q) => q.key === "horizon")!.opts.filter(([k]) => arr(v.horizon, ["3-10y"]).includes(k)).map(([, l]) => whole(l)).join(", ");
  return `${lvl} · ${style} · ${hz || whole("3–10 years")}`;
}

export function InvestorQuiz({ initial, draft, startAt = 0, onDone, onSkip, onProgress, doneLabel = "Continue" }: {
  initial?: Investor | null; onDone: (v: Investor) => void; doneLabel?: string;
  /** Skip hands back the answers given so far, the unanswered ones filled with defaults. */
  onSkip?: (v: Investor) => void;
  /** Raw answers (unanswered = empty) and the question on screen, on every tap: lets setup survive a reload. */
  onProgress?: (raw: Investor, index: number) => void;
  /** Resume point: raw answers exactly as the reader left them (not defaulted), and the question to open on. */
  draft?: Investor | null; startAt?: number;
}) {
  // Sign-up starts every question UNSELECTED (a tap expresses a real choice); editing starts from the saved answers.
  // Anything left empty falls back to the defaults when submitted.
  const norm = (x: Investor | null | undefined): Investor => x ? {
    styles: arr(x.styles, INVESTOR_DEFAULT.styles), purpose: arr(x.purpose, INVESTOR_DEFAULT.purpose),
    horizon: arr(x.horizon, INVESTOR_DEFAULT.horizon), target: arr(x.target, INVESTOR_DEFAULT.target),
    risk: arr(x.risk, INVESTOR_DEFAULT.risk), level: arr(x.level, INVESTOR_DEFAULT.level),
  } : { styles: [], purpose: [], horizon: [], target: [], risk: [], level: [] };
  const KEYS = ["styles", "purpose", "horizon", "target", "risk", "level"] as const;
  const complete = (x: Investor): Investor => ({
    defaulted: KEYS.filter((k) => !x[k].length),
    styles: x.styles.length ? x.styles : [...INVESTOR_DEFAULT.styles], purpose: x.purpose.length ? x.purpose : [...INVESTOR_DEFAULT.purpose],
    horizon: x.horizon.length ? x.horizon : [...INVESTOR_DEFAULT.horizon], target: x.target.length ? x.target : [...INVESTOR_DEFAULT.target],
    risk: x.risk.length ? x.risk : [...INVESTOR_DEFAULT.risk], level: x.level.length ? x.level : [...INVESTOR_DEFAULT.level],
  });
  const [v, setV] = useState<Investor>(() => draft ? { ...norm(null), ...draft } : norm(initial));
  const [i, setI] = useState(() => Math.min(Math.max(0, startAt), QUIZ.length - 1));
  useEffect(() => { onProgress?.(v, i); }, [v, i]);   // eslint-disable-line react-hooks/exhaustive-deps
  const q = QUIZ[i];
  const last = i === QUIZ.length - 1;
  const next = () => (last ? onDone(complete(v)) : setI(i + 1));
  const set = (key: QuizKey, val: string, single = false) => {
    setV((p) => {
      const cur = p[key];
      if (single) return { ...p, [key]: cur.length === 1 && cur[0] === val ? [] : [val] };   // radio, tap again to clear
      return { ...p, [key]: cur.includes(val) ? cur.filter((x) => x !== val) : [...cur, val] };
    });
  };
  return (
    <section aria-label="Investor profile" data-testid="investor-quiz">
      <p className="sub" style={{ margin: "0 0 4px" }}>Question {i + 1} of {QUIZ.length}</p>
      <p style={{ margin: "0 0 10px", fontWeight: 600 }}>{q.q}</p>
      <div className="chips" style={{ padding: 0, flexWrap: "wrap", gap: 8 }} role={q.single ? "radiogroup" : "group"} aria-label={q.q}>
        {q.opts.map(([key, label]) => {
          const on = v[q.key].includes(key);
          return (
            // a single-choice question is a radio group to VoiceOver ("radio button, 1 of 4, checked"), not a
            // set of toggle buttons (r3 + r4 newcomer)
            <button key={key} className="chip" style={on ? { fontWeight: 700 } : undefined}
              {...(q.single ? { role: "radio", "aria-checked": on } : { "aria-pressed": on })}
              onClick={() => set(q.key, key, q.single)}>{label}</button>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 14, alignItems: "center" }}>
        <button className="btn" style={{ flex: "0 0 auto", width: "auto", padding: "10px 18px" }} onClick={next}>{last ? doneLabel : "Continue"}</button>
        {i > 0 && <button className="chip" onClick={() => setI(i - 1)}>← Back</button>}
        {onSkip && <button className="chip" data-testid="quiz-skip" onClick={() => onSkip(complete(v))}>Skip for now</button>}
      </div>
    </section>
  );
}
