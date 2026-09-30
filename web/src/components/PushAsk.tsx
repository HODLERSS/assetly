import { useEffect, useState } from "react";
import type { Api } from "../lib/api";
import { softAskDueNow, softAskNotNow, upgradePush } from "../lib/push";
import { Icon } from "./Icon";

// The soft ask (1.0.3). Briefs already arrive quietly (provisional authorization); once the reader has used a
// couple, this offers the louder kind in the app's own words before iOS asks in its own. Shown at most once:
// "Turn on alerts" hands over to the system prompt, "Not now" is remembered and never comes back. The rules
// for WHEN are lib/push softAskDue (app only, notifications on here, still quiet, not answered, used the brief).
export function PushAsk({ api, recheck = "" }: { api: Api; recheck?: string }) {
  const [due, setDue] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<null | "on" | "declined">(null);
  useEffect(() => {
    let live = true;
    void softAskDueNow().then((v) => { if (live) setDue(v); });
    return () => { live = false; };
  }, [recheck]);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(null), 5000);
    return () => clearTimeout(t);
  }, [done]);

  if (done) {
    return (
      <div className={"status-note" + (done === "on" ? " ok" : "")} role="status" data-testid="push-ask-result">
        <span className="lead"><Icon name="check" />{done === "on" ? "Alerts on. You'll hear when your brief is ready." : "No alerts. Briefs still arrive quietly in Notification Center."}</span>
      </div>
    );
  }
  if (!due) return null;
  return (
    <section className="card next-steps push-ask" data-testid="push-ask" aria-label="Brief alerts">
      <strong>Get a buzz when your brief is ready?</strong>
      <p className="sub" style={{ margin: "4px 0 0" }}>Your briefs arrive quietly in Notification Center now. Alerts put them on your lock screen, with a sound.</p>
      <div className="next-steps-actions">
        <button className="chip primary" disabled={busy} data-testid="push-ask-yes" onClick={async () => {
          setBusy(true);
          try {
            const r = await upgradePush((token, env) => api.savePushToken(token, "ios", env));
            setTimeout(r.off, 15_000);   // long enough for the token event; App's own listener stays for the session
            setDone(r.status === "authorized" ? "on" : "declined");
            setDue(false);
          } finally { setBusy(false); }
        }}>Turn on alerts</button>
        <button className="chip" disabled={busy} data-testid="push-ask-no" onClick={() => { softAskNotNow(); setDue(false); }}>Not now</button>
      </div>
    </section>
  );
}
