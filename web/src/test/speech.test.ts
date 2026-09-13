// Device voice: script chunking, pauses, voice choice, and the engine's pause/resume/seek contract
// against a stubbed speechSynthesis (jsdom has none).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { estimateSeconds, hasDeviceVoice, pickVoice, scriptToChunks, VoiceEngine } from "../lib/speech";

const SCRIPT = `Good evening, it's Sunday, September 13. Here's your closing note. <break time="0.7s" /> The book gained 223 dollars today, leaving total assets at 23000 dollars. <break time="0.7s" /> Invesco Nasdaq 100: Your largest stock holding barely moved, up 0.9 percent, and it carries the most of your gain. The Nasdaq tracker spreads risk across many names and pays a small dividend. It is the steady core of the book and the reason the day ended green rather than red, which matters more than the size of the move. <break time="0.6s" /> That's your brief. Talk soon.`;

describe("scriptToChunks", () => {
  it("turns <break/> tags into pauses on the preceding chunk and drops every other tag", () => {
    const c = scriptToChunks(SCRIPT);
    expect(c.length).toBeGreaterThanOrEqual(4);
    expect(c[0].text).toBe("Good evening, it's Sunday, September 13. Here's your closing note.");
    expect(c[0].pauseMs).toBe(700);
    expect(c[1].pauseMs).toBe(700);
    expect(c[c.length - 1].text).toBe("That's your brief. Talk soon.");
    expect(c[c.length - 1].pauseMs).toBe(0);
    expect(c.every((x) => !/<[^>]*>/.test(x.text))).toBe(true);
  });
  it("splits a long passage at sentence ends so no utterance runs past Chrome's cutoff", () => {
    const c = scriptToChunks(SCRIPT);
    expect(c.every((x) => x.text.length <= 240)).toBe(true);
    // the long third passage became more than one chunk, and only its LAST chunk carries the 0.6s pause
    const tail = c.filter((x) => /Nasdaq|steady core/.test(x.text));
    expect(tail.length).toBeGreaterThanOrEqual(2);
    expect(tail.slice(0, -1).every((x) => x.pauseMs === 0)).toBe(true);
    expect(tail[tail.length - 1].pauseMs).toBe(600);
  });
  it("caps a pause and accepts ms units", () => {
    const c = scriptToChunks('One. <break time="4s" /> Two. <break time="250ms"/> Three.');
    expect(c.map((x) => x.pauseMs)).toEqual([1500, 250, 0]);
  });
  it("estimates ear time from words and pauses, scaled by rate", () => {
    const c = scriptToChunks(SCRIPT);
    const at1 = estimateSeconds(c, 1);
    expect(at1).toBeGreaterThan(25);
    expect(at1).toBeLessThan(60);
    expect(estimateSeconds(c, 2)).toBeLessThan(at1);
  });
});

const voice = (name: string, lang = "en-US", extra: Partial<SpeechSynthesisVoice> = {}) =>
  ({ name, lang, default: false, localService: true, voiceURI: name, ...extra }) as SpeechSynthesisVoice;

describe("pickVoice", () => {
  it("prefers a premium or enhanced English voice, then a stock neural one, then any en-US", () => {
    expect(pickVoice([voice("Samantha"), voice("Ava (Premium)"), voice("Daniel", "en-GB")])?.name).toBe("Ava (Premium)");
    expect(pickVoice([voice("Samantha"), voice("Evan (Enhanced)")])?.name).toBe("Evan (Enhanced)");
    expect(pickVoice([voice("Fred"), voice("Google US English")])?.name).toBe("Google US English");
    expect(pickVoice([voice("Fred"), voice("Kyoko", "ja-JP")])?.name).toBe("Fred");
  });
  it("falls back to any English voice, then the default, and to null with no voices", () => {
    expect(pickVoice([voice("Daniel", "en-GB"), voice("Kyoko", "ja-JP")])?.name).toBe("Daniel");
    expect(pickVoice([voice("Kyoko", "ja-JP", { default: true }), voice("Ting-Ting", "zh-CN")])?.name).toBe("Kyoko");
    expect(pickVoice([])).toBeNull();
  });
});

// ---- engine against a stub synth: utterances end when the test says so ----
type Stub = { speak: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn>; getVoices: () => SpeechSynthesisVoice[]; addEventListener: ReturnType<typeof vi.fn>; spoken: SpeechSynthesisUtterance[] };
let stub: Stub;
class FakeUtterance {
  text: string; voice: unknown = null; lang = ""; rate = 1; onend: ((e: unknown) => void) | null = null; onerror: ((e: unknown) => void) | null = null;
  constructor(t: string) { this.text = t; }
}
beforeEach(() => {
  vi.useFakeTimers();
  stub = { speak: vi.fn((u: SpeechSynthesisUtterance) => { stub.spoken.push(u); }), cancel: vi.fn(), getVoices: () => [voice("Samantha")], addEventListener: vi.fn(), spoken: [] };
  vi.stubGlobal("speechSynthesis", stub);
  vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("VoiceEngine", () => {
  it("is detected only when the browser has a speech engine", () => {
    expect(hasDeviceVoice()).toBe(true);
    vi.stubGlobal("speechSynthesis", undefined);
    expect(hasDeviceVoice()).toBe(false);
  });
  it("chains chunks through onend with the scripted pause, and reports the end", () => {
    const ev = { onStart: vi.fn(), onProgress: vi.fn(), onEnd: vi.fn(), onError: vi.fn() };
    const e = new VoiceEngine(ev);
    e.load('One. <break time="0.7s" /> Two.');
    e.play();
    expect(ev.onStart).toHaveBeenCalledTimes(1);
    expect(stub.cancel).toHaveBeenCalled();
    expect(stub.spoken.map((u) => u.text)).toEqual(["One."]);
    expect(stub.spoken[0].voice).toMatchObject({ name: "Samantha" });
    stub.spoken[0].onend?.({} as SpeechSynthesisEvent);
    expect(stub.spoken.length).toBe(1);          // the pause is honored before the next utterance
    vi.advanceTimersByTime(700);
    expect(stub.spoken.map((u) => u.text)).toEqual(["One.", "Two."]);
    stub.spoken[1].onend?.({} as SpeechSynthesisEvent);
    vi.advanceTimersByTime(0);
    expect(ev.onEnd).toHaveBeenCalledTimes(1);
    expect(e.isActive).toBe(false);
  });
  it("pause cancels and resume restarts the SAME chunk; stop rewinds", () => {
    const ev = { onStart: vi.fn(), onProgress: vi.fn(), onEnd: vi.fn(), onError: vi.fn() };
    const e = new VoiceEngine(ev);
    e.load("One. Two. Three.".replace(/\. /g, '. <break time="0.1s" /> '));
    e.play();
    stub.spoken[0].onend?.({} as SpeechSynthesisEvent); vi.advanceTimersByTime(100);
    expect(stub.spoken.map((u) => u.text)).toEqual(["One.", "Two."]);
    e.pause();
    expect(e.isActive).toBe(false);
    stub.spoken[1].onerror?.({ error: "interrupted" } as SpeechSynthesisErrorEvent);   // what cancel() produces on real engines
    expect(ev.onError).not.toHaveBeenCalled();
    e.resume();
    expect(stub.spoken.map((u) => u.text)).toEqual(["One.", "Two.", "Two."]);
    e.stop();
    e.play();
    expect(stub.spoken[stub.spoken.length - 1].text).toBe("One.");
  });
  it("seek lands on the chunk that owns that second and a rate change restarts at the new speed", () => {
    const ev = { onStart: vi.fn(), onProgress: vi.fn(), onEnd: vi.fn(), onError: vi.fn() };
    const e = new VoiceEngine(ev);
    const many = Array.from({ length: 6 }, (_, i) => `Sentence number ${i + 1} has exactly eight words here.`).join(' <break time="0.5s" /> ');
    e.load(many);
    e.play();
    e.seekTo(e.duration - 1);
    expect(stub.spoken[stub.spoken.length - 1].text).toMatch(/number 6/);
    e.setRate(2);
    expect(stub.spoken[stub.spoken.length - 1].rate).toBe(2);
    expect(e.duration).toBeLessThan(20);
  });
  it("surfaces a real engine error and goes idle", () => {
    const ev = { onStart: vi.fn(), onProgress: vi.fn(), onEnd: vi.fn(), onError: vi.fn() };
    const e = new VoiceEngine(ev);
    e.load("One.");
    e.play();
    stub.spoken[0].onerror?.({ error: "synthesis-failed" } as SpeechSynthesisErrorEvent);
    expect(ev.onError).toHaveBeenCalledWith(expect.stringMatching(/device voice stopped/i));
    expect(e.isActive).toBe(false);
  });
});
