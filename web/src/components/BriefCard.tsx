import { useEffect, useRef, useState } from "react";
import type { Api, BriefEdition, DailyBrief } from "../lib/api";

// The Daily Brief — three personal research notes a trading day: morning (pre-open),
// midday pulse (11am CT), closing note (post-close). Collapsed to the lede; one tap
// opens the full read. When several editions exist for the day, chips switch between
// them and the newest is shown first.
const ED_META: Record<BriefEdition, { title: string; tape: string; read: string; chip: string }> = {
  morning: { title: "Morning Brief", tape: "Overnight", read: "Read · 3 min", chip: "Morning" },
  midday: { title: "Midday Pulse", tape: "The tape now", read: "Read · 2 min", chip: "Midday" },
  close: { title: "Closing Note", tape: "Today's tape", read: "Read · 2 min", chip: "Close" },
};

export function BriefCard({ api }: { api: Api }) {
  const [briefs, setBriefs] = useState<DailyBrief[] | undefined>(undefined);
  const [picked, setPicked] = useState<BriefEdition | null>(null);
  const [open, setOpen] = useState(false);
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

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
  useEffect(() => () => { audioRef.current?.pause(); }, []);

  if (!briefs?.length) return null;
  const brief = (picked && briefs.find((b) => b.edition === picked)) ?? briefs[briefs.length - 1];
  const meta = ED_META[brief.edition];

  const stopAudio = () => { audioRef.current?.pause(); audioRef.current = null; setPlaying(false); };
  const pick = (ed: BriefEdition) => { if (ed !== brief.edition) { stopAudio(); setPicked(ed); } };

  const toggleAudio = async () => {
    if (!brief.audio_path) return;
    if (audioRef.current) {
      if (playing) { audioRef.current.pause(); setPlaying(false); }
      else { void audioRef.current.play(); setPlaying(true); }
      return;
    }
    const url = await api.getBriefAudioUrl(brief.audio_path);
    if (!url) return;
    const a = new Audio(url);
    audioRef.current = a;
    a.onended = () => setPlaying(false);
    if ("mediaSession" in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({ title: meta.title, artist: "Assetly", album: brief.brief_date });
      navigator.mediaSession.setActionHandler?.("pause", () => { a.pause(); setPlaying(false); });
      navigator.mediaSession.setActionHandler?.("play", () => { void a.play(); setPlaying(true); });
    }
    void a.play();
    setPlaying(true);
  };

  const d = new Date(brief.brief_date + "T12:00:00Z");
  const dateLabel = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const s = brief.sections;
  return (
    <section className="card insights" data-testid="brief-card" aria-label={`Your ${meta.title.toLowerCase()}`}>
      <div className="insights-head">
        <span className="insights-brand">{meta.title} · {dateLabel}</span>
        <span style={{ display: "flex", gap: 10 }}>
          {brief.audio_path && (
            <button className="insights-toggle" onClick={() => void toggleAudio()} aria-label={playing ? "Pause narration" : "Listen to your brief"}>
              {playing ? "❚❚ Pause" : "▶ Listen"}
            </button>
          )}
          <button className="insights-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
            {open ? "Close" : meta.read}
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
          <p className="sub" style={{ margin: "10px 0 2px", fontWeight: 700, textTransform: "uppercase", fontSize: 10.5 }}>Your positions</p>
          {s.positions.map((p, i) => (
            <p key={i} style={{ margin: "0 0 7px", fontSize: 13, lineHeight: 1.5 }}>
              <strong>{p.name}</strong> — {p.note}{" "}
              <span className="sub">Watch: {p.watch}</span>
            </p>
          ))}
          <p className="sub" style={{ margin: "6px 0 2px", fontWeight: 700, textTransform: "uppercase", fontSize: 10.5 }}>Desk view</p>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>{s.desk_view}</p>
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
