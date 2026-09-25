import { useEffect, useState, useSyncExternalStore } from "react";
import type { Api, BriefEdition, DailyBrief } from "../lib/api";
import { getSnapshot, load as loadTrack, loadSpeech, subscribe, toggle as togglePlayer } from "../lib/player";
import { hasDeviceVoice } from "../lib/speech";
import { Icon } from "./Icon";

// The Daily Brief — three personal research notes a trading day: morning (pre-open),
// midday pulse (11am CT), closing note (post-close) — plus the Portfolio Assessment, the
// first brief after a connect or a run of adds: quality, structure, horizons, gaps (not a tape
// note). Collapsed to the lede; one tap opens the full read. When several editions exist,
// chips switch between them and the newest is shown first.
// Section labels are plain words, not desk slang ("The tape now", "Desk view", "Tripwire" read as jargon
// to a retail reader; r1 + r2 design audits).
const ED_META: Record<BriefEdition, { title: string; tape: string; positions: string; desk: string; watch: string; read: string; chip: string }> = {
  morning: { title: "Morning Brief", tape: "Overnight", positions: "Your positions", desk: "Our read", watch: "Watch", read: "Read · 2 min", chip: "Morning" },
  midday: { title: "Midday Pulse", tape: "Right now", positions: "Your positions", desk: "Our read", watch: "Watch", read: "Read · 2 min", chip: "Midday" },
  close: { title: "Closing Note", tape: "Today", positions: "Your positions", desk: "Our read", watch: "Watch", read: "Read · 2 min", chip: "Close" },
  assessment: { title: "Portfolio Assessment", tape: "Your portfolio", positions: "Quality read", desk: "Structure & risk", watch: "What would change it", read: "Read · 2 min", chip: "Assessment" },
  // no session today (weekend or a market holiday): direction and company developments, never a tape
  weekend: { title: "Weekend Read", tape: "The week that was", positions: "At your companies", desk: "Direction", watch: "Next", read: "Read · 2 min", chip: "Weekend" },
  // Korea editions for books that hold Korean names: written on the KRX clock, dated in Korea time
  kr_open: { title: "Korea Open", tape: "Korea now", positions: "Your Korean names", desk: "Our read", watch: "Watch", read: "Read · 2 min", chip: "Korea open" },
  kr_close: { title: "Korea Close", tape: "Korea's session", positions: "Your Korean names", desk: "Into the US open", watch: "Watch", read: "Read · 2 min", chip: "Korea close" },
};

// Editions written during a session: their premise ("limits today's loss") can go stale within the hour.
const INTRADAY = new Set<BriefEdition>(["morning", "midday", "kr_open"]);
const STALE_AFTER_MS = 2 * 3600_000;   // no recorded day move (older rows): an intraday read this old is dated
const signOf = (v: number, dead: number) => (Math.abs(v) < dead ? 0 : v > 0 ? 1 : -1);

function clock(iso: string, now: Date): string {
  const d = new Date(iso);
  const t = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return d.toDateString() === now.toDateString() ? t : `${d.toLocaleDateString("en-US", { weekday: "short" })} ${t}`;
}

/** Whether a brief still describes the book on screen, and the line that dates it when it doesn't.
 *  - Assessment: stale while a newer run is pending (it predates today's adds or removals), or when it was
 *    written for different holdings.
 *  - Intraday editions: always carry their time; stale when the book's day move has flipped sign since
 *    (sections.day_sign), when written on an earlier day, or (older rows without day_sign) after 2 hours.
 *  Every field is optional: rows written before the server stamped them fall back to generated_at. */
export function briefFreshness(brief: DailyBrief, opts: { now?: Date; liveDayPct?: number | null; pendingSince?: string | null; held?: string[] | null } = {}):
  { stale: boolean; note: string | null } {
  const now = opts.now ?? new Date();
  const s = brief.sections ?? ({} as DailyBrief["sections"]);
  if (brief.edition === "assessment") {
    if (opts.pendingSince && +new Date(brief.generated_at) < +new Date(opts.pendingSince)) {
      return { stale: true, note: "Your last assessment, before today's changes. The new one is on its way." };
    }
    const was = Array.isArray(s.held) ? s.held : null, is = opts.held ?? null;
    if (was && is && (was.length !== is.length || was.some((x) => !is.includes(x)))) {
      return { stale: true, note: was.length && was.length <= 3 ? `Based on ${was.join(", ")} only.` : "Written for an earlier version of your portfolio." };
    }
    return { stale: false, note: null };
  }
  if (!INTRADAY.has(brief.edition)) return { stale: false, note: null };
  const at = s.as_of || brief.generated_at;
  const when = clock(at, now);
  const earlierDay = new Date(at).toDateString() !== now.toDateString();
  const live = opts.liveDayPct;
  const flipped = typeof s.day_sign === "number" && typeof live === "number" && Number.isFinite(live)
    && signOf(live, s.day_sign === 0 ? 0.5 : 0.1) !== 0 && signOf(live, 0.1) !== s.day_sign;
  const aged = typeof s.day_sign !== "number" && now.getTime() - +new Date(at) > STALE_AFTER_MS;
  if (earlierDay || flipped || aged) return { stale: true, note: `Written at ${when}, before the latest moves.` };
  return { stale: false, note: `Written at ${when}.` };
}

export function BriefCard({ api, liveDayPct = null, pendingSince = null, held = null }: {
  api: Api;
  /** the book's day move now, in % (the headline's figure) */
  liveDayPct?: number | null;
  /** a newer Portfolio Assessment run started at this time and hasn't landed */
  pendingSince?: string | null;
  /** the symbols held now */
  held?: string[] | null;
}) {
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

  // Reserve the card's footprint while the first fetch is in flight: a card that pops in above "Movers"
  // after paint shoves the whole screen down (measured 0.18 CLS on an iPhone SE).
  if (briefs === undefined) return (
    <section className="card insights" data-testid="brief-card-pending" aria-busy="true" aria-label="Loading your brief" style={{ minHeight: 132 }}>
      <div className="insights-head"><span className="insights-brand">Your brief</span></div>
      <div className="skel-line" style={{ width: "92%" }} /><div className="skel-line" style={{ width: "78%" }} /><div className="skel-line" style={{ width: "60%" }} />
    </section>
  );
  if (!briefs.length) return null;
  const brief = (picked && briefs.find((b) => b.edition === picked)) ?? briefs[briefs.length - 1];
  const meta = ED_META[brief.edition] ?? ED_META.morning;
  const dow = new Date(brief.brief_date + "T12:00:00Z").getUTCDay();
  const title = brief.edition === "weekend" && dow !== 0 && dow !== 6 ? "Holiday Read" : meta.title;
  const dateLabel = new Date(brief.brief_date + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric" });

  // switching edition does NOT stop playback: the mini player keeps whatever is loaded, so you can
  // read the close while the morning brief finishes talking
  const pick = (ed: BriefEdition) => { if (ed !== brief.edition) setPicked(ed); };

  const trackId = `${brief.brief_date}:${brief.edition}`;
  const isThis = player.track?.id === trackId;
  const playing = isThis && player.playing;

  // No MP3 (ElevenLabs quota gone, or the sweep has not reached this row) but a script exists: the device
  // voice reads it. The button never vanishes on the reader; only the accessible name says which voice they get.
  const voiceOnly = !brief.audio_path && !!brief.script && hasDeviceVoice();
  const canListen = !!brief.audio_path || voiceOnly;
  const toggleAudio = () => {
    if (isThis) { togglePlayer(); return; }
    const track = { id: trackId, title, subtitle: dateLabel, date: brief.brief_date };
    const path = brief.audio_path;
    // handed a RESOLVER, not a URL: the signed link expires and the player re-signs it on its own
    if (path) { void loadTrack(track, () => api.getBriefAudioUrl(path)); return; }
    if (brief.script) loadSpeech(track, brief.script);
  };

  const s = brief.sections;
  const fresh = briefFreshness(brief, { liveDayPct, pendingSince, held });
  return (
    <section className={"card insights" + (fresh.stale ? " brief-stale" : "")} data-testid="brief-card" data-stale={fresh.stale || undefined}
      aria-label={`Your ${title.toLowerCase()}`}>
      <div className="insights-head">
        <span className="insights-brand">{title} · {dateLabel}</span>
        <span className="insights-actions">
          {canListen && (
            <button className="insights-toggle" onClick={toggleAudio} aria-label={playing ? "Pause narration" : voiceOnly ? "Listen to your brief with your device voice" : "Listen to your brief"} data-testid="brief-listen">
              <Icon name={playing ? "pause" : "play"} size={15} />
            </button>
          )}
          <button className="insights-toggle" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={open ? "Close the brief" : meta.read}>
            <Icon name={open ? "close" : "book"} size={16} />
          </button>
        </span>
      </div>
      {briefs.length > 1 && (
        <div className="chips" style={{ padding: "6px 0 8px" }} role="group" aria-label="Brief editions">
          {briefs.map((b) => (
            <button key={b.edition} className="chip" aria-pressed={b.edition === brief.edition} onClick={() => pick(b.edition)}>
              {(ED_META[b.edition] ?? ED_META.morning).chip}
            </button>
          ))}
        </div>
      )}
      {fresh.note && <p className="sub brief-asof" data-testid="brief-asof">{fresh.note}</p>}
      {/* the lede itself opens the full read; the small book icon was the only way in (r2 newcomer audit) */}
      <p className="prose brief-lede" style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5, fontWeight: open || fresh.stale ? 400 : 500 }}
        role="button" tabIndex={0} aria-expanded={open} data-testid="brief-lede"
        onClick={() => { if (!window.getSelection?.()?.toString()) setOpen(!open); }}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(!open); } }}>{s.lede}</p>
      {open && (
        <div className="prose" data-testid="brief-body">
          <p className="sub" style={{ margin: "10px 0 2px", fontWeight: 700, textTransform: "uppercase", fontSize: 11 }}>{meta.tape}</p>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>{s.overnight}</p>
          <p className="sub" style={{ margin: "10px 0 2px", fontWeight: 700, textTransform: "uppercase", fontSize: 11 }}>{meta.positions}</p>
          {s.positions.map((p, i) => (
            <p key={i} style={{ margin: "0 0 7px", fontSize: 13, lineHeight: 1.5 }}>
              <strong>{p.name}</strong> — {p.note}{" "}
              <span className="sub">{meta.watch}: {p.watch}</span>
            </p>
          ))}
          <p className="sub" style={{ margin: "6px 0 2px", fontWeight: 700, textTransform: "uppercase", fontSize: 11 }}>{meta.desk}</p>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>{s.desk_view}</p>
          {brief.edition === "assessment" && s.horizon && (<>
            <p className="sub" style={{ margin: "10px 0 2px", fontWeight: 700, textTransform: "uppercase", fontSize: 11 }}>Horizons</p>
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }} data-testid="brief-horizon">{s.horizon}</p>
          </>)}
          {brief.edition === "assessment" && (s.ideas?.length ?? 0) > 0 && (<>
            <p className="sub" style={{ margin: "10px 0 2px", fontWeight: 700, textTransform: "uppercase", fontSize: 11 }}>Gaps & ideas</p>
            {s.ideas!.map((c, i) => <p key={i} style={{ margin: "0 0 3px", fontSize: 13, lineHeight: 1.5 }} data-testid="brief-idea">· {c}</p>)}
          </>)}
          {(s.calendar?.length ?? 0) > 0 && (<>
            <p className="sub" style={{ margin: "10px 0 2px", fontWeight: 700, textTransform: "uppercase", fontSize: 11 }}>Calendar</p>
            {s.calendar.map((c, i) => <p key={i} className="sub" style={{ margin: "0 0 2px", fontSize: 12.5 }}>{c}</p>)}
          </>)}
          <p className="insights-foot">Not financial advice</p>
        </div>
      )}
    </section>
  );
}
