// Internal accounts that are not real readers: test fixtures, the YouTube/TikTok Shorts demo books
// (minjae.m.lee+dailyNNN), the App Review demo and the showcase book (owner 10/2: no scheduled briefs and no
// ElevenLabs narration for them). Same list as the app-funnel exclusions. An explicit per-user call still
// writes a text brief (the Shorts pipeline asks for its own, --no-audio).
export const isDemoEmail = (email: string | null | undefined): boolean => {
  const e = String(email ?? "").toLowerCase();
  return e.endsWith("@assetly.test") || e.endsWith("assetly.test") || e.startsWith("minjae.m.lee+daily")
    || e === "minjae.m.lee+reviewer@gmail.com" || e === "minjae.m.lee+showcase@gmail.com";
};
