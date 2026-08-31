import { useEffect, useState, useSyncExternalStore } from "react";
import { clock, cycleRate, getSnapshot, seek, SKIP_SECONDS, skip, stop, subscribe, toggle } from "../lib/player";

// The floating now-playing bar, docked above the tab bar the way YouTube Music and Podcasts do it.
// It is rendered once at the App level and never unmounts, so it is visible from every tab while a
// brief is playing — which is the point: you can read the news while your brief keeps talking.
export function MiniPlayer() {
  const s = useSyncExternalStore(subscribe, getSnapshot);
  // while a finger is on the scrubber the thumb must follow the FINGER, not the audio clock
  const [scrub, setScrub] = useState<number | null>(null);

  // reserve room at the bottom of the scroll area so the bar never covers the last row of content
  useEffect(() => {
    const on = !!s.track;
    document.body.classList.toggle("has-miniplayer", on);
    return () => document.body.classList.remove("has-miniplayer");
  }, [s.track]);

  if (!s.track) return null;

  const duration = s.duration || 0;
  const shown = scrub ?? s.position;
  const remaining = Math.max(0, duration - shown);
  const pct = duration > 0 ? (shown / duration) * 100 : 0;

  return (
    <div className="miniplayer" data-testid="mini-player" role="region" aria-label="Now playing">
      <div className="mp-line">
        <div className="mp-what">
          <span className="mp-title">{s.track.title}</span>
          <span className="mp-sub">
            {s.error ? s.error : s.loading ? "Loading audio" : `${s.track.subtitle} · ${clock(shown)} / ${clock(duration)}`}
          </span>
        </div>
        <div className="mp-controls">
          <button className="mp-btn" onClick={() => skip(-SKIP_SECONDS)} aria-label={`Back ${SKIP_SECONDS} seconds`} disabled={s.loading}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 5V2L7 6l5 4V7a6 6 0 1 1-6 6" />
            </svg>
            <span className="mp-skipnum" aria-hidden="true">{SKIP_SECONDS}</span>
          </button>
          <button className="mp-btn mp-play" onClick={toggle} aria-label={s.playing ? "Pause" : "Play"} data-testid="mini-player-toggle" disabled={s.loading}>
            {s.playing ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1.2" /><rect x="14" y="5" width="4" height="14" rx="1.2" /></svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.6c0-.8.9-1.3 1.6-.9l8 6.4c.6.4.6 1.4 0 1.8l-8 6.4c-.7.4-1.6-.1-1.6-.9V5.6Z" /></svg>
            )}
          </button>
          <button className="mp-btn" onClick={() => skip(SKIP_SECONDS)} aria-label={`Forward ${SKIP_SECONDS} seconds`} disabled={s.loading}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 5V2l5 4-5 4V7a6 6 0 1 0 6 6" />
            </svg>
            <span className="mp-skipnum" aria-hidden="true">{SKIP_SECONDS}</span>
          </button>
          <button className="mp-btn mp-rate" onClick={cycleRate} aria-label={`Playback speed ${s.rate} times. Tap to change.`} data-testid="mini-player-rate">
            {s.rate}&times;
          </button>
          <button className="mp-btn mp-close" onClick={stop} aria-label="Stop and close the player">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
      </div>
      <div className="mp-seek">
        <span className="mp-time" aria-hidden="true">{clock(shown)}</span>
        <span className="mp-track" style={{ ["--mp-pct" as string]: `${pct}%` }}>
          <input
            type="range" min={0} max={Math.max(duration, 0.1)} step={0.5} value={shown}
            onChange={(e) => setScrub(Number(e.target.value))}
            onPointerUp={() => { if (scrub !== null) { seek(scrub); setScrub(null); } }}
            onKeyUp={() => { if (scrub !== null) { seek(scrub); setScrub(null); } }}
            onBlur={() => { if (scrub !== null) { seek(scrub); setScrub(null); } }}
            aria-label="Seek through the narration"
            aria-valuetext={`${clock(shown)} of ${clock(duration)}`}
            disabled={s.loading || duration <= 0}
          />
        </span>
        <span className="mp-time" aria-hidden="true">-{clock(remaining)}</span>
      </div>
    </div>
  );
}
