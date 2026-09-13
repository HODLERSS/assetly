// Device voice: the browser's own speech engine reads the narration script when there is no MP3
// (ElevenLabs quota exhausted, key gone, or the sweep has not reached the row yet). No account, no
// quota, works offline. The script is the same one ElevenLabs would have read: numbers already
// spoken-form, tickers already names, <break/> tags for the pauses.
//
// Engine notes that shaped this file:
//  - speechSynthesis.pause() is unreliable on iOS and Android WebViews (it can silently stop or
//    never resume), so "pause" here is cancel + remember the chunk, and "resume" restarts that chunk.
//  - Chrome cuts a single utterance that runs past ~15 seconds, so the script is spoken as short
//    sentence-sized utterances chained by their onend.
//  - getVoices() is empty on first call in Safari and Chrome until voiceschanged fires.

export type Chunk = { text: string; pauseMs: number };

export const hasDeviceVoice = (): boolean => {
  if (typeof window === "undefined") return false;
  const w = window as unknown as { speechSynthesis?: unknown; SpeechSynthesisUtterance?: unknown };
  return !!w.speechSynthesis && typeof w.SpeechSynthesisUtterance === "function";
};

const MAX_CHUNK = 220;      // characters; ~12s of speech, under Chrome's utterance cutoff
const MAX_PAUSE_MS = 1500;  // an SSML break longer than this reads as a stall, not a pause

/** SSML-ish script -> spoken chunks. <break time="0.7s" /> becomes a real pause after the chunk that
 *  precedes it; every other tag is dropped; long passages split at sentence ends. */
export function scriptToChunks(script: string): Chunk[] {
  const out: Chunk[] = [];
  // split keeps the capture groups: [text, num, unit, text, num, unit, ..., text]
  const parts = script.split(/<break\s+time="?([\d.]+)\s*(ms|s)"?\s*\/?>/i);
  for (let i = 0; i < parts.length; i += 3) {
    const text = (parts[i] ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    const num = Number(parts[i + 1]);
    const unit = (parts[i + 2] ?? "s").toLowerCase();
    const pauseMs = parts[i + 1] !== undefined && Number.isFinite(num) ? Math.min(unit === "ms" ? num : num * 1000, MAX_PAUSE_MS) : 0;
    const sentences = text.match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g) ?? [];
    let buf = "";
    const flush = (p: number) => { if (buf.trim()) out.push({ text: buf.trim(), pauseMs: p }); buf = ""; };
    for (const sn of sentences) {
      if (buf && buf.length + sn.length > MAX_CHUNK) flush(0);
      buf += (buf ? " " : "") + sn.trim();
    }
    flush(pauseMs);
  }
  return out;
}

/** Ear-time estimate: ~155 words a minute at 1x. Good enough for a progress bar and the mm:ss readout. */
export const estimateSeconds = (chunks: Chunk[], rate = 1): number => {
  const words = chunks.reduce((a, c) => a + c.text.split(/\s+/).filter(Boolean).length, 0);
  const pauses = chunks.reduce((a, c) => a + c.pauseMs, 0) / 1000;
  return Math.round((words / 2.6 + pauses) / Math.max(rate, 0.5));
};

// Preference order for the voice: the premium / enhanced downloads on iOS and macOS first, then the
// stock neural voices, then anything English. Names are what Safari and Chrome actually report.
const PREFERRED = [/premium/i, /enhanced/i, /natural/i, /siri/i, /google us english/i, /\b(ava|zoe|samantha|allison|nicky|joelle|evan|tom)\b/i];

export function pickVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  if (!voices.length) return null;
  const en = voices.filter((v) => /^en[-_]/i.test(v.lang));
  const pool = en.length ? en : voices;
  const us = pool.filter((v) => /^en[-_]us/i.test(v.lang));
  const cands = us.length ? us : pool;
  for (const re of PREFERRED) { const hit = cands.find((v) => re.test(v.name)); if (hit) return hit; }
  return cands.find((v) => v.default) ?? cands.find((v) => v.localService) ?? cands[0];
}

export type EngineEvents = {
  onStart: () => void;
  onProgress: (positionSeconds: number) => void;
  onEnd: () => void;
  onError: (message: string) => void;
};

export class VoiceEngine {
  private chunks: Chunk[] = [];
  private idx = 0;
  private active = false;
  private chunkStart = 0;
  private timer: number | null = null;
  private ticker: number | null = null;
  private voice: SpeechSynthesisVoice | null = null;
  private voicesAsked = false;
  rate = 1;

  constructor(private ev: EngineEvents) {}

  load(script: string) { this.chunks = scriptToChunks(script); this.idx = 0; this.chunkStart = 0; }
  get duration(): number { return estimateSeconds(this.chunks, this.rate); }
  get isActive(): boolean { return this.active; }
  get chunkCount(): number { return this.chunks.length; }

  private prefix(i: number): number { return estimateSeconds(this.chunks.slice(0, i), this.rate); }

  /** Seconds into the script: whole chunks spoken plus wall-clock time inside the current one. */
  position(): number {
    if (!this.chunks.length) return 0;
    const base = this.prefix(this.idx);
    const cur = this.chunks[this.idx];
    if (!this.active || !this.chunkStart || !cur) return base;
    return Math.min(base + (Date.now() - this.chunkStart) / 1000, base + estimateSeconds([cur], this.rate));
  }

  private synth(): SpeechSynthesis { return window.speechSynthesis; }

  private resolveVoice(): SpeechSynthesisVoice | null {
    if (this.voice) return this.voice;
    this.voice = pickVoice(this.synth().getVoices());
    if (!this.voice && !this.voicesAsked) {
      this.voicesAsked = true;
      try { this.synth().addEventListener("voiceschanged", () => { this.voice = pickVoice(this.synth().getVoices()); }, { once: true }); } catch { /* older WebKit */ }
    }
    return this.voice;
  }

  /** Start (or restart) from a chunk. Call from a user gesture the first time in a session. */
  play(fromIdx = this.idx) {
    this.clear();
    this.synth().cancel();
    this.idx = Math.max(0, Math.min(fromIdx, this.chunks.length));
    this.active = true;
    this.ev.onStart();
    this.speakNext();
    this.ticker = window.setInterval(() => this.ev.onProgress(this.position()), 500);
  }

  private speakNext() {
    if (!this.active) return;
    if (this.idx >= this.chunks.length) { this.finish(); this.ev.onEnd(); return; }
    const c = this.chunks[this.idx];
    const u = new SpeechSynthesisUtterance(c.text);
    const v = this.resolveVoice();
    if (v) u.voice = v;
    u.lang = v?.lang ?? "en-US";
    u.rate = this.rate;
    u.onend = () => {
      if (!this.active) return;
      this.idx++; this.chunkStart = 0;
      this.timer = window.setTimeout(() => this.speakNext(), c.pauseMs);
    };
    u.onerror = (e) => {
      if (!this.active) return;
      const kind = (e as SpeechSynthesisErrorEvent).error;
      if (kind === "interrupted" || kind === "canceled") return;   // our own cancel(), or the OS took the audio focus
      this.finish();
      this.ev.onError("The device voice stopped (" + String(kind) + "). Tap play to try again.");
    };
    this.chunkStart = Date.now();
    this.synth().speak(u);
  }

  /** Pause = cancel and remember the chunk; resume restarts that chunk (the reliable form on every engine). */
  pause() { this.active = false; this.clear(); this.chunkStart = 0; this.synth().cancel(); }
  resume() { if (!this.active) this.play(this.idx); }

  seekTo(seconds: number) {
    let i = 0;
    while (i < this.chunks.length - 1 && this.prefix(i + 1) <= seconds) i++;
    const was = this.active;
    this.pause();
    this.idx = i;
    if (was) this.play(i);
  }

  setRate(r: number) {
    this.rate = r;
    if (this.active) { const i = this.idx; this.pause(); this.play(i); }
  }

  stop() { this.active = false; this.clear(); this.idx = 0; this.chunkStart = 0; this.synth().cancel(); }

  private finish() { this.active = false; this.clear(); this.idx = 0; this.chunkStart = 0; }
  private clear() {
    if (this.timer !== null) clearTimeout(this.timer);
    if (this.ticker !== null) clearInterval(this.ticker);
    this.timer = null; this.ticker = null;
  }
}
