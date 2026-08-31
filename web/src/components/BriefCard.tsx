import { useEffect, useState, useSyncExternalStore } from "react";
import type { Api, BriefEdition, DailyBrief } from "../lib/api";
import { getSnapshot, load as loadTrack, subscribe, toggle as togglePlayer } from "../lib/player";

// The Daily Brief — three personal research notes a trading day: morning (pre-open),
// midday pulse (11am CT), closing note (post-close) — plus the Portfolio Assessment, the
// first brief after a connect or a run of adds: quality, structure, horizons, gaps (not a tape
// note). Collapsed to the lede; one tap opens the full read. When several editions exist,
// chips switch between them and the newest is shown first.
const ED_META: Record<BriefEdition, { title: string; tape: string; positions: string; desk: string; watch: string; read: string; chip: string }> = {
  morning: { title: "Morning Brief", tape: "Overnight", positions: "Your positions", desk: "Desk view", watch: "Watch", read: "Read · 2 min", chip: "Morning" },
  midday: { title: "Midday Pulse", tape: "The tape now", positions: "Your positions", desk: "Desk view", watch: "Watch", read: "Read · 2 min", chip: "Midday" },
  close: { title: "Closing Note", tape: "Today's tape", positions: "Your positions", desk: "Desk view", watch: "Watch", read: "Read · 2 min", chip: "Close" },
  assessment: { title: "Portfolio Assessment", tape: "Your book", positions: "Quality read", desk: "Structure & risk", watch: "Tripwire", read: "Read · 2 min", chip: "Assessment" },
};

export function BriefCard({ api }: { api: Api }) {
  const [briefs, setBriefs] = useState<DailyBrief[] | undefined>(undefined);
  const [picked, setPicked] = useState<BriefEdition | null>(null);
  const [open, setOpen] = useState(false);
  const player = useSyncExternalStore(subscribe, getSnapshot);

  useEffect(() => {
    let live = true; let tries = 0;
    const load = () => api.getDailyBriefs().then((b) => {
      if (!live) return;
      setBriefs(b);
      // a fresh account's first brief is still generating: keep looking for ~4 minutes
      if (!b.length && tries++ < 16) setTimeout(load, 15000);
    }).catch(() => { if (live) setBriefs([]); });
    load();
    return () => { live = false; };
  }, [api]);

  if (!briefs?.length) return null;
  const brief = (picked && briefs.find((b) => b.edition === picked)) ?? briefs[briefs.length - 1];
  const meta = ED_META[brief.edition];
  const dateLabel = new Date(brief.brief_date + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric" });

  // switching edition does NOT stop playback: the mini player keeps whatever is loaded, so you can
  // read the close while the morning brief finishes talking
  const pick = (ed: BriefEdition) => { if (ed !== brief.edition) setPicked(ed); };

  const trackId = `${brief.brief_date}:${brief.edition}`;
  const isThis = player.track?.id === trackId;
  const playing = isThis && player.playing;

  const toggleAudio = () => {
    const path = brief.audio_path;
    if (!path) return;
    if (isThis) { togglePlayer(); return; }
    // handed a RESOLVER, not a URL: the signed link expires and the player re-signs it on its own
    void loadTrack({ id: trackId, title: meta.title, subtitle: dateLabel, date: brief.brief_date }, () => api.getBriefAudioUrl(path));
  };

  const s = brief.sections;
  return (
    <section className="card insights" data-testid="brief-card" aria-label={`Your ${meta.title.toLowerCase()}`}>
      <div className="insights-head">
        <span className="insights-brand">{meta.title} · {dateLabel}</span>
        <span className="insights-actions">
          {brief.audio_path && (
            <button className="insights-toggle" onClick={toggleAudio} aria-label={playing ? "Pause narration" : "Listen to your brief"} data-testid="brief-listen">
              <span className="ico" aria-hidden="true">{playing ? "❚❚" : "▶"}</span>
            </button>
          )}
          <button className="insights-toggle" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={open ? "Close the brief" : meta.read}>
            <span className="ico" aria-hidden="true">{open ? "✕" : "📖"}</span>
          </button>
        </span>
      </div>
      {briefs.length > 1 && (
        <div className="chips" style={{ padding: "6px 0 8px" }} role="group" aria-label="Brief editions">
          {briefs.map((b) => (
            <button key={b.edition} className="chip" aria-pressed={b.edition === brief.edition} onClick={() => pick(b.edition)}>
              {ED_META[b.edition].chip}
            </button>
          ))}
        </div>
      )}
      <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5, fontWeight: open ? 400 : 500 }}>{s.lede}</p>
      {open && (
        <div data-testid="brief-body">
          <p className="sub" style={{ margin: "10px 0 2px", fontWeight: 700, textTransform: "uppercase", fontSize: 10.5 }}>{meta.tape}</p>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>{s.overnight}</p>
          <p className="sub" style={{ margin: "10px 0 2px", fontWeight: 700, textTransform: "uppercase", fontSize: 10.5 }}>{meta.positions}</p>
          {s.positions.map((p, i) => (
            <p key={i} style={{ margin: "0 0 7px", fontSize: 13, lineHeight: 1.5 }}>
              <strong>{p.name}</strong> — {p.note}{" "}
              <span className="sub">{meta.watch}: {p.watch}</span>
            </p>
          ))}
          <p className="sub" style={{ margin: "6px 0 2px", fontWeight: 700, textTransform: "uppercase", fontSize: 10.5 }}>{meta.desk}</p>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>{s.desk_view}</p>
          {brief.edition === "assessment" && s.horizon && (<>
            <p className="sub" style={{ margin: "10px 0 2px", fontWeight: 700, textTransform: "uppercase", fontSize: 10.5 }}>Horizons</p>
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }} data-testid="brief-horizon">{s.horizon}</p>
          </>)}
          {brief.edition === "assessment" && (s.ideas?.length ?? 0) > 0 && (<>
            <p className="sub" style={{ margin: "10px 0 2px", fontWeight: 700, textTransform: "uppercase", fontSize: 10.5 }}>Gaps & ideas</p>
            {s.ideas!.map((c, i) => <p key={i} style={{ margin: "0 0 3px", fontSize: 13, lineHeight: 1.5 }} data-testid="brief-idea">· {c}</p>)}
          </>)}
          {(s.calendar?.length ?? 0) > 0 && (<>
            <p className="sub" style={{ margin: "10px 0 2px", fontWeight: 700, textTransform: "uppercase", fontSize: 10.5 }}>Calendar</p>
            {s.calendar.map((c, i) => <p key={i} className="sub" style={{ margin: "0 0 2px", fontSize: 12.5 }}>{c}</p>)}
          </>)}
          <p className="insights-foot">Not financial advice</p>
        </div>
      )}
    </section>
  );
}
