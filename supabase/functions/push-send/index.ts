// Push a brief to a user's devices over APNs.
//
// Inert until the APNs credentials exist: without them it answers {ok:false,reason:"not configured"}
// rather than failing, so it is safe to deploy before the Apple Developer account is in place.
//
// APNs wants a JWT signed ES256 with the .p8 key. Web Crypto's ECDSA signature is already the raw
// r||s pair that ES256 expects, so no DER unwrapping is needed.
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const b64url = (b: ArrayBuffer | Uint8Array) => {
  const bytes = b instanceof Uint8Array ? b : new Uint8Array(b);
  let s = "";
  for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const b64urlStr = (s: string) => b64url(new TextEncoder().encode(s));

/** Import the .p8 (PKCS#8 PEM) as an ECDSA P-256 signing key. */
async function importP8(pem: string): Promise<CryptoKey> {
  const body = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return await crypto.subtle.importKey("pkcs8", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

/** APNs provider token. Apple rejects tokens older than an hour, so it is minted per run. */
async function apnsJwt(keyId: string, teamId: string, p8: string): Promise<string> {
  const header = b64urlStr(JSON.stringify({ alg: "ES256", kid: keyId }));
  const payload = b64urlStr(JSON.stringify({ iss: teamId, iat: Math.floor(Date.now() / 1000) }));
  const key = await importP8(p8);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(`${header}.${payload}`));
  return `${header}.${payload}.${b64url(sig)}`;
}

type Cfg = { keyId: string; teamId: string; p8: string; bundleId: string; host: string };
async function config(admin: ReturnType<typeof createClient>): Promise<Cfg | null> {
  const get = async (env: string, secret: string) => {
    const v = Deno.env.get(env);
    if (v) return v;
    const { data } = await admin.rpc("get_secret", { secret_name: secret });
    return (data as string | null) ?? "";
  };
  const [keyId, teamId, p8] = await Promise.all([
    get("APNS_KEY_ID", "apns_key_id"), get("APNS_TEAM_ID", "apns_team_id"), get("APNS_PRIVATE_KEY", "apns_private_key"),
  ]);
  if (!keyId || !teamId || !p8) return null;
  const bundleId = Deno.env.get("APNS_BUNDLE_ID") ?? "com.assetly.app";
  // TestFlight and App Store builds use production; a build run from Xcode uses sandbox
  const host = (Deno.env.get("APNS_ENV") ?? "production") === "sandbox"
    ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com";
  return { keyId, teamId, p8, bundleId, host };
}

/** The push IS the shortest brief: the lede has already been through BLUF, the diet and the tier map. */
const ED_TITLE: Record<string, string> = {
  morning: "Morning brief", midday: "Midday pulse", close: "Closing note", assessment: "Your portfolio assessment",
};
export const pushCopy = (edition: string, lede: string): { title: string; body: string } => {
  const title = ED_TITLE[edition] ?? "Your brief";
  let body = String(lede ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  // a notification shows ~110 characters; cut on a sentence, else a word, never mid-word
  if (body.length > 110) {
    const cut = body.slice(0, 110);
    const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
    body = stop > 40 ? cut.slice(0, stop + 1) : cut.slice(0, cut.lastIndexOf(" ")) + "…";
  }
  return { title, body };
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // operator/internal only: this sends to real devices
  const itok = Deno.env.get("INTERNAL_TOKEN") ?? (await admin.rpc("get_secret", { secret_name: "internal_token" })).data ?? "";
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const isInternal = !!itok && req.headers.get("x-internal-token") === itok;
  const isSvc = !!bearer && bearer === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!isInternal && !isSvc) return json({ ok: false, error: "forbidden" }, 403);

  const body = await req.json().catch(() => ({}));
  const userId = String(body.user_id ?? "");
  const edition = String(body.edition ?? "");
  const lede = String(body.lede ?? "");
  if (!userId || !lede) return json({ ok: false, error: "user_id and lede required" }, 400);

  const cfg = await config(admin);
  if (!cfg) return json({ ok: true, sent: 0, reason: "not configured" });   // no Apple account yet: not an error

  const { data: toks } = await admin.from("push_tokens").select("token").eq("user_id", userId).eq("platform", "ios");
  if (!toks?.length) return json({ ok: true, sent: 0, reason: "no devices" });

  const { title, body: alert } = pushCopy(edition, lede);
  const jwt = await apnsJwt(cfg.keyId, cfg.teamId, cfg.p8);
  let sent = 0; const dropped: string[] = [];

  for (const t of toks) {
    const r = await fetch(`${cfg.host}/3/device/${t.token}`, {
      method: "POST",
      headers: {
        authorization: `bearer ${jwt}`,
        "apns-topic": cfg.bundleId,
        "apns-push-type": "alert",
        "apns-priority": "5",   // the brief is not urgent; 5 lets iOS batch for battery
      },
      body: JSON.stringify({
        aps: { alert: { title, body: alert }, sound: "default", "thread-id": "assetly-brief" },
        edition,
      }),
    }).catch(() => null);
    if (r?.ok) { sent++; continue; }
    // 410 Gone means the app was deleted: stop pushing to a dead device
    if (r?.status === 410) dropped.push(t.token);
  }
  if (dropped.length) await admin.from("push_tokens").delete().in("token", dropped);
  return json({ ok: true, sent, dropped: dropped.length });
});
