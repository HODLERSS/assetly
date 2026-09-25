// The narration player owns the native audio session: claimed when a brief starts, handed back when it
// ends or is closed, and never touched by merely opening the app. 1.0.0 claimed it at launch, which
// stopped the user's music on every open.
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: string[] = [];
vi.mock("../lib/native", () => ({
  activateAudioSession: vi.fn(async () => { calls.push("activate"); }),
  deactivateAudioSession: vi.fn(async () => { calls.push("deactivate"); }),
}));

import * as player from "../lib/player";

const track = { id: "b1", title: "Morning brief", subtitle: "Sep 25" };

describe("narration audio session", () => {
  beforeEach(() => {
    player.__resetPlayer();
    calls.length = 0;
    const media = HTMLMediaElement.prototype as unknown as Record<string, unknown>;
    Object.defineProperty(media, "play", { configurable: true, writable: true,
      value: vi.fn(function (this: HTMLAudioElement) { calls.push("play"); this.dispatchEvent(new Event("play")); return Promise.resolve(); }) });
    Object.defineProperty(media, "pause", { configurable: true, writable: true,
      value: vi.fn(function (this: HTMLAudioElement) { this.dispatchEvent(new Event("pause")); }) });
    Object.defineProperty(media, "load", { configurable: true, writable: true, value: vi.fn() });
  });

  it("is not claimed until a brief plays", async () => {
    await import("../lib/player");
    expect(calls).toEqual([]);
  });

  it("is claimed before the audio starts, and kept through a pause", async () => {
    await player.load(track, async () => "https://cdn.test/brief.mp3");
    // the synchronous unlock play() inside the gesture has no src and no session; the real start comes after
    const firstActivate = calls.indexOf("activate");
    expect(firstActivate).toBeGreaterThan(-1);
    expect(calls.slice(firstActivate)).toEqual(["activate", "play"]);
    player.pause();
    expect(calls).not.toContain("deactivate");   // the lock-screen play button must still resume it
  });

  it("is handed back when the player is closed", async () => {
    await player.load(track, async () => "https://cdn.test/brief.mp3");
    calls.length = 0;
    player.stop();
    expect(calls).toEqual(["deactivate"]);
    player.stop();
    expect(calls).toEqual(["deactivate"]);       // released once, not on every stop
  });

  it("is handed back when playback ends on its own", async () => {
    const created: HTMLAudioElement[] = [];
    const RealAudio = window.Audio;
    vi.stubGlobal("Audio", function () { const a = new RealAudio(); created.push(a); return a; });
    await player.load(track, async () => "https://cdn.test/brief.mp3");
    calls.length = 0;
    created[0].dispatchEvent(new Event("ended"));
    expect(calls).toEqual(["deactivate"]);
    vi.unstubAllGlobals();
  });
});
