// APNs over HTTP/2 with a provider token, shared by push-send (the brief pipeline) and admin-push (the internal tool).
//
// Everything that decides WHAT is sent (payload, headers, which host, what a failure means for the token) is a pure
// function here, so it is unit-tested without Apple or a database (apns_test.ts). The two functions only wire it to
// Supabase and fetch.
//
// Token hosts: a build run from Xcode registers with the sandbox, TestFlight and App Store builds with production,
// and a token is only valid on the host that issued it. The app reports its environment with the token
// (push_tokens.environment); a BadDeviceToken is retried once on the other host before the token is judged dead,
// which also repairs a row saved with the wrong environment.

export type ApnsEnv = "production" | "sandbox";
export const APNS_HOST: Record<ApnsEnv, string> = {
  production: "https://api.push.apple.com",
  sandbox: "https://api.sandbox.push.apple.com",
};
export const otherEnv = (e: ApnsEnv): ApnsEnv => (e === "production" ? "sandbox" : "production");
export const asEnv = (v: unknown): ApnsEnv => (v === "sandbox" ? "sandbox" : "production");

export type Device = { token: string; environment?: string | null };
export type Message = {
  title: string;
  body: string;
  /** an in-app route the tap opens (validated by isInAppLink) */
  link?: string | null;
  /** apns-collapse-id: a newer push with the same id replaces the older one instead of stacking */
  collapseId?: string | null;
  /** aps.thread-id: Notification Center groups by it */
  threadId?: string | null;
  badge?: number | null;
  /** extra top-level keys for the app (brief_date, edition) */
  data?: Record<string, unknown>;
  /** 5 lets iOS batch for battery; 10 is immediate. A brief is not urgent. */
  priority?: 5 | 10;
};

// ---------- base64url + ES256 provider token ----------

const b64url = (b: ArrayBuffer | Uint8Array) => {
  const bytes = b instanceof Uint8Array ? b : new Uint8Array(b);
  let s = "";
  for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const b64urlStr = (s: string) => b64url(new TextEncoder().encode(s));

/** Import the .p8 (PKCS#8 PEM) as an ECDSA P-256 signing key. */
export async function importP8(pem: string): Promise<CryptoKey> {
  const body = pem.replace(/-----[^-]+-----/g, "").replace(/\\n/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return await crypto.subtle.importKey("pkcs8", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

/** Provider token. Web Crypto's ECDSA signature is already the raw r||s pair ES256 wants: no DER unwrapping. */
export async function mintApnsJwt(keyId: string, teamId: string, p8: string, iat: number): Promise<string> {
  const header = b64urlStr(JSON.stringify({ alg: "ES256", kid: keyId }));
  const payload = b64urlStr(JSON.stringify({ iss: teamId, iat }));
  const key = await importP8(p8);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(`${header}.${payload}`));
  return `${header}.${payload}.${b64url(sig)}`;
}

/**
 * Apple rejects a provider token older than an hour AND answers 429 TooManyProviderTokenUpdates to a sender that
 * changes its token more often than every 20 minutes. push-send runs once per user per brief, so minting per call
 * would trip that on a busy cron. A token is reused while it is under 40 minutes old (kept in a service-only row).
 */
export const JWT_REUSE_S = 40 * 60;
export const jwtReusable = (cached: { jwt: string; iat: number; key_id: string } | null, keyId: string, nowS: number): boolean =>
  !!cached && !!cached.jwt && cached.key_id === keyId && nowS - cached.iat >= 0 && nowS - cached.iat < JWT_REUSE_S;

// ---------- payload + headers ----------

/** The in-app routes a push may open. Anything else is refused: a push must never carry an arbitrary URL. */
export const EDITIONS = ["morning", "midday", "close", "assessment", "weekend", "kr_open", "kr_close"] as const;
const LINK_RE = new RegExp(`^/(home|news|ask|settings|brief/latest|brief/\\d{4}-\\d{2}-\\d{2}/(${EDITIONS.join("|")}))$`);
export const isInAppLink = (v: unknown): v is string => typeof v === "string" && LINK_RE.test(v);

export function buildPayload(m: Message): Record<string, unknown> {
  const aps: Record<string, unknown> = { alert: { title: m.title, body: m.body }, sound: "default" };
  if (m.threadId) aps["thread-id"] = m.threadId;
  if (typeof m.badge === "number") aps.badge = m.badge;
  const out: Record<string, unknown> = { aps, ...(m.data ?? {}) };
  if (m.link && isInAppLink(m.link)) out.link = m.link;
  return out;
}

export function apnsHeaders(jwt: string, bundleId: string, m: Message): Record<string, string> {
  const h: Record<string, string> = {
    authorization: `bearer ${jwt}`,
    "apns-topic": bundleId,
    "apns-push-type": "alert",
    "apns-priority": String(m.priority ?? 5),
    "content-type": "application/json",
  };
  // apns-collapse-id is capped at 64 bytes
  if (m.collapseId) h["apns-collapse-id"] = m.collapseId.slice(0, 64);
  return h;
}

// ---------- the brief's own copy ----------

/** The push IS the shortest brief: the lede has already been through BLUF, the diet and the tier map. */
const ED_TITLE: Record<string, string> = {
  morning: "Morning brief", midday: "Midday pulse", close: "Closing note", assessment: "Your portfolio assessment",
  weekend: "Weekend read", kr_open: "Korea open", kr_close: "Korea close",
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

/** A brief push: grouped by edition, one per edition per day (a regeneration replaces, never stacks), opens that brief. */
export function briefMessage(edition: string, briefDate: string, lede: string): Message {
  const { title, body } = pushCopy(edition, lede);
  return {
    title, body,
    link: `/brief/${briefDate}/${edition}`,
    collapseId: `brief-${briefDate}-${edition}`,
    threadId: `brief-${edition}`,
    badge: 1,   // one unread brief; the app clears it on open
    data: { brief_date: briefDate, edition },
    priority: 5,
  };
}

// ---------- sending ----------

export type DeviceResult = {
  token_tail: string; environment: ApnsEnv; status: number; apns_id: string | null; reason: string | null;
  ok: boolean; dead: boolean; env_fixed?: ApnsEnv;
};
export type SendOutcome = { results: DeviceResult[]; sent: number; dead: string[]; envFixes: { token: string; environment: ApnsEnv }[] };
type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/** What a failed answer means for the token. */
export const isDeadReason = (status: number, reason: string | null): boolean =>
  status === 410 || reason === "Unregistered" || reason === "BadDeviceToken" || reason === "DeviceTokenNotForTopic";
const retryable = (status: number) => status === 429 || status >= 500 || status === 0;

async function post(fetchFn: Fetch, env: ApnsEnv, token: string, headers: Record<string, string>, body: string):
  Promise<{ status: number; apns_id: string | null; reason: string | null }> {
  try {
    const r = await fetchFn(`${APNS_HOST[env]}/3/device/${token}`, { method: "POST", headers, body });
    let reason: string | null = null;
    if (!r.ok) { try { reason = (await r.json())?.reason ?? null; } catch { reason = null; } }
    else { try { await r.body?.cancel(); } catch { /* drained */ } }
    return { status: r.status, apns_id: r.headers.get("apns-id"), reason };
  } catch (e) {
    return { status: 0, apns_id: null, reason: e instanceof Error ? e.message.slice(0, 120) : "network" };
  }
}

export async function sendToDevices(devices: Device[], m: Message, opts: {
  jwt: string; bundleId: string; fetchFn?: Fetch; sleep?: (ms: number) => Promise<void>;
}): Promise<SendOutcome> {
  const fetchFn = opts.fetchFn ?? ((u, i) => fetch(u, i));
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const headers = apnsHeaders(opts.jwt, opts.bundleId, m);
  const body = JSON.stringify(buildPayload(m));
  const out: SendOutcome = { results: [], sent: 0, dead: [], envFixes: [] };
  for (const d of devices) {
    const env = asEnv(d.environment);
    let r = await post(fetchFn, env, d.token, headers, body);
    if (retryable(r.status)) { await sleep(400); r = await post(fetchFn, env, d.token, headers, body); }
    let usedEnv = env, fixed: ApnsEnv | undefined;
    // a token from the other host: try it there once before calling it dead
    if (r.status === 400 && r.reason === "BadDeviceToken") {
      const alt = await post(fetchFn, otherEnv(env), d.token, headers, body);
      if (alt.status === 200) { r = alt; usedEnv = otherEnv(env); fixed = usedEnv; out.envFixes.push({ token: d.token, environment: usedEnv }); }
    }
    const ok = r.status === 200;
    const dead = !ok && isDeadReason(r.status, r.reason);
    if (ok) out.sent++;
    if (dead) out.dead.push(d.token);
    out.results.push({ token_tail: d.token.slice(-6), environment: usedEnv, status: r.status, apns_id: r.apns_id, reason: r.reason, ok, dead, ...(fixed ? { env_fixed: fixed } : {}) });
  }
  return out;
}

/** The push_log status for an outcome. */
export const outcomeStatus = (o: SendOutcome, devices: number): "sent" | "partial" | "failed" | "no_devices" =>
  devices === 0 ? "no_devices" : o.sent === devices ? "sent" : o.sent > 0 ? "partial" : "failed";
export const firstError = (o: SendOutcome): string | null => {
  const bad = o.results.find((r) => !r.ok);
  return bad ? `${bad.status} ${bad.reason ?? ""}`.trim() : null;
};
