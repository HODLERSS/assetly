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
  const title = state.first ? "Building your first Portfolio Assessment" : "Updating your Portfolio Assessment";
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
        <p style={{ margin: "6px 0 0" }} role="alert">{state.error ?? "Something went wrong."} Your holdings are saved; only the write-up is missing.</p>
        <div className="assess-actions"><button className="btn" style={{ width: "auto" }} onClick={onRetry}>Try again</button></div>
      </>) : state.phase === "slow" ? (<>
        <p style={{ margin: "6px 0 0" }}>This is taking longer than usual. It will appear here and on your brief card as soon as it's written.</p>
        <div className="assess-actions">
          <button className="btn secondary" style={{ width: "auto" }} onClick={onRetry}>Try again</button>
          {state.intelligenceReady && onOpenNews && <button className="chip" onClick={onOpenNews}>Read your Intelligence</button>}
        </div>
      </>) : (<>
        <ol className="assess-steps">
          <li data-done={state.intelligenceReady}>
            {state.intelligenceReady ? <Icon name="check" size={12} /> : <span className="progress-dot" aria-hidden="true" />}
            Reading your holdings and their news
            {state.intelligenceReady && onOpenNews && <button className="chip" onClick={onOpenNews}>Read it in News</button>}
          </li>
          <li data-done="false">
            {state.intelligenceReady ? <span className="progress-dot" aria-hidden="true" /> : <span aria-hidden="true" style={{ width: 12 }} />}
            Writing your Portfolio Assessment
          </li>
        </ol>
        <p className="assess-foot">Usually 2 to 4 minutes · {started}. You can leave this screen; it keeps going.</p>
      </>)}
    </section>
  );
}
