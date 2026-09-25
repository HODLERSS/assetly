import { useEffect, useState } from "react";
import type { AssessState } from "../lib/assessment";
import { Icon } from "./Icon";

// Home's "Building your assessment" card. Honest progress only: the two steps it shows are the two
// things the app can actually observe (portfolio intelligence written, assessment written), plus the
// elapsed time against the usual 2-4 minutes. No fake percentage.
export function AssessmentCard({ state, onRetry, onDismiss, onOpenNews }: {
  state: AssessState; onRetry: () => void; onDismiss: () => void; onOpenNews?: () => void;
}) {
  const [, tick] = useState(0);
  useEffect(() => {   // keep "started 2 min ago" honest while the card is up
    if (state.phase !== "pending") return;
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, [state.phase]);
  if (state.phase === "idle" || state.phase === "ready") return null;
  // short enough for one line at 393pt ("BUILDING YOUR FIRST PORTFOLIO ASSESSME…" was cut), and a run
  // that failed says what happened in the title and the body alike: "paused" over "didn't finish" read as
  // two different states (r2 + r3 design audits)
  const title = state.phase === "error" ? "Assessment didn't finish" : state.first ? "Your first assessment" : "Updating your assessment";
  const mins = state.startedAt ? Math.floor((Date.now() - +new Date(state.startedAt)) / 60_000) : 0;
  const started = mins < 1 ? "started just now" : `started ${mins} min ago`;

  return (
    <section className="card insights assess-card" data-testid="assessment-card" aria-live="polite"
      aria-busy={state.phase === "pending"} aria-label={title}>
      <div className="insights-head">
        <span className="insights-brand">{title}</span>
        {state.phase !== "pending" && (
          <button className="chip" onClick={onDismiss} aria-label="Dismiss"><Icon name="close" size={12} /></button>
        )}
      </div>
      {state.phase === "error" ? (<>
        {/* the raw cause ("brokerage-connected failed") is not for the reader: one plain line, one action */}
        <p style={{ margin: "6px 0 0" }} role="alert">Your holdings are safe; only the write-up is missing.</p>
        <div className="assess-actions"><button className="chip" onClick={onRetry}>Try again</button></div>
      </>) : state.phase === "slow" ? (<>
        <p style={{ margin: "6px 0 0" }}>This is taking longer than usual. It'll show up here as soon as it's ready.</p>
        <div className="assess-actions">
          {/* one button shape in the row: both chips (a 17px rectangle sat next to a 14px pill; r3 design m4) */}
          <button className="chip" onClick={onRetry}>Try again</button>
          {state.intelligenceReady && onOpenNews && <button className="chip" onClick={onOpenNews}>See today's news</button>}
        </div>
      </>) : (<>
        <ol className="assess-steps">
          {/* progress, not a bullet list: done = check, working = spinning ring, next = hollow circle */}
          <li data-done={state.intelligenceReady} data-step={state.intelligenceReady ? "done" : "active"}>
            <StepMark step={state.intelligenceReady ? "done" : "active"} />
            Reading the news on your holdings
            {state.intelligenceReady && onOpenNews && <button className="chip" onClick={onOpenNews}>See today's news</button>}
          </li>
          <li data-done="false" data-step={state.intelligenceReady ? "active" : "next"}>
            <StepMark step={state.intelligenceReady ? "active" : "next"} />
            Writing your assessment
          </li>
        </ol>
        <p className="assess-foot">Usually takes 2 to 4 minutes ({started}). Feel free to leave; we'll keep working.</p>
      </>)}
    </section>
  );
}

function StepMark({ step }: { step: "done" | "active" | "next" }) {
  if (step === "done") return <span className="step-mark done" aria-label="Done"><Icon name="check" size={12} /></span>;
  return <span className={`step-mark ${step}`} aria-label={step === "active" ? "In progress" : "Up next"} />;
}
