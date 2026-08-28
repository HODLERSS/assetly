import { useEffect, useRef, useState } from "react";
import type { Api, DailyBrief } from "../lib/api";

// The Daily Brief — a personal morning research note. Collapsed to the lede by
// default; one tap opens the full 3-minute read.
export function BriefCard({ api }: { api: Api }) {
  const [brief, setBrief] = useState<DailyBrief | null | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const toggleAudio = async () => {
    if (!brief?.audio_path) return;
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
      navigator.mediaSession.metadata = new MediaMetadata({ title: "Morning Brief", artist: "Assetly", album: brief.brief_date });
      navigator.mediaSession.setActionHandler?.("pause", () => { a.pause(); setPlaying(false); });
      navigator.mediaSession.setActionHandler?.("play", () => { void a.play(); setPlaying(true); });
    }
    void a.play();
    setPlaying(true);
  };
  useEffect(() => () => { audioRef.current?.pause(); }, []);

  useEffect(() => {
    let live = true;
    api.getDailyBrief().then((b) => { if (live) setBrief(b); }).catch(() => { if (live) setBrief(null); });
    return () => { live = false; };
  }, [api]);

  if (!brief) return null;
  const d = new Date(brief.brief_date + "T12:00:00Z");
  const dateLabel = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const s = brief.sections;
  return (
    <section className="card insights" data-testid="brief-card" aria-label="Your morning brief">
      <div className="insights-head">
        <span className="insights-brand">Morning Brief · {dateLabel}</span>
        <span style={{ display: "flex", gap: 10 }}>
          {brief.audio_path && (
            <button className="insights-toggle" onClick={() => void toggleAudio()} aria-label={playing ? "Pause narration" : "Listen to your brief"}>
              {playing ? "❚❚ Pause" : "▶ Listen"}
            </button>
          )}
          <button className="insights-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
            {open ? "Close" : "Read · 3 min"}
          </button>
        </span>
      </div>
      <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5, fontWeight: open ? 400 : 500 }}>{s.lede}</p>
      {open && (
        <div data-testid="brief-body">
          <p className="sub" style={{ margin: "10px 0 2px", fontWeight: 700, textTransform: "uppercase", fontSize: 10.5 }}>Overnight</p>
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
