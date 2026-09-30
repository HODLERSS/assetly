// The parts of push-send and admin-push that touch storage, behind a small interface so both handlers are tested
// against an in-memory store (push_send_test.ts, admin_push_test.ts) and run against Supabase in production
// (supabaseStore below).
import {
  asEnv, briefMessage, firstError, jwtReusable, type Device, type Message, mintApnsJwt, outcomeStatus, type SendOutcome, sendToDevices,
} from "./apns.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

export type LogRow = {
  user_id: string | null; kind: string; title?: string | null; body?: string | null; link?: string | null; status: string;
  apns_id?: string | null; error?: string | null; devices?: number; sent?: number; dropped?: number; results?: unknown;
  dedupe_key?: string | null; actor_id?: string | null;
};

export interface PushStore {
  secret(name: string): Promise<string>;
  devices(userId: string): Promise<Device[]>;
  latestBriefDate(userId: string, edition: string): Promise<string | null>;
  /** insert a log row; with a dedupe_key, null when that key was already claimed by a send that did not fail */
  claim(row: LogRow): Promise<number | null>;
  finish(id: number, patch: Partial<LogRow>): Promise<void>;
  dropTokens(tokens: string[]): Promise<void>;
  setEnvironment(token: string, environment: string): Promise<void>;
  cachedJwt(): Promise<{ jwt: string; iat: number; key_id: string } | null>;
  saveJwt(v: { jwt: string; iat: number; key_id: string } | null): Promise<void>;
}

export type ApnsConfig = { keyId: string; teamId: string; p8: string; bundleId: string };

/** The APNs credentials, from function env first, else the Vault (get_secret). Null until all three exist. */
export async function apnsConfig(store: PushStore, env: (k: string) => string | undefined): Promise<ApnsConfig | null> {
  const get = async (e: string, s: string) => env(e) || (await store.secret(s).catch(() => "")) || "";
  const [keyId, teamId, p8] = await Promise.all([
    get("APNS_KEY_ID", "apns_key_id"), get("APNS_TEAM_ID", "apns_team_id"), get("APNS_PRIVATE_KEY", "apns_private_key"),
  ]);
  if (!keyId || !teamId || !p8) return null;
  return { keyId: keyId.trim(), teamId: teamId.trim(), p8, bundleId: env("APNS_BUNDLE_ID") || "com.hodlerss.assetly" };
}

/** A provider token no younger than Apple allows us to rotate: reused from the store while under 40 minutes old. */
export async function providerToken(store: PushStore, cfg: ApnsConfig, nowS: number): Promise<string> {
  const cached = await store.cachedJwt().catch(() => null);
  if (jwtReusable(cached, cfg.keyId, nowS)) return cached!.jwt;
  const jwt = await mintApnsJwt(cfg.keyId, cfg.teamId, cfg.p8, nowS);
  await store.saveJwt({ jwt, iat: nowS, key_id: cfg.keyId }).catch(() => {});
  return jwt;
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>;
export type Deps = { store: PushStore; env: (k: string) => string | undefined; fetchFn?: Fetch; now?: () => number; sleep?: (ms: number) => Promise<void> };

/**
 * Send one message to one user's devices and write it to push_log. With a dedupe key, a second call for the same key
 * sends nothing (reason "duplicate"). Dead tokens are deleted; a token that answered on the other host is re-filed.
 */
export async function deliver(deps: Deps, cfg: ApnsConfig, userId: string, m: Message, log: { kind: string; dedupeKey?: string | null; actorId?: string | null }):
  Promise<{ status: string; sent: number; devices: number; dropped: number; apns_id: string | null; error: string | null; reason?: string; log_id?: number | null }> {
  const { store } = deps;
  const devices = await store.devices(userId);
  if (!devices.length) return { status: "no_devices", sent: 0, devices: 0, dropped: 0, apns_id: null, error: null, reason: "no devices" };
  const logId = await store.claim({
    user_id: userId, kind: log.kind, title: m.title, body: m.body, link: m.link ?? null, status: "sending",
    devices: devices.length, dedupe_key: log.dedupeKey ?? null, actor_id: log.actorId ?? null,
  });
  if (logId === null) return { status: "duplicate", sent: 0, devices: devices.length, dropped: 0, apns_id: null, error: null, reason: "duplicate" };
  let outcome: SendOutcome;
  const nowS = Math.floor((deps.now?.() ?? Date.now()) / 1000);
  try {
    const jwt = await providerToken(store, cfg, nowS);
    outcome = await sendToDevices(devices, m, { jwt, bundleId: cfg.bundleId, fetchFn: deps.fetchFn, sleep: deps.sleep });
    // a rejected provider token (key revoked or rotated): forget it so the next call mints a fresh one
    if (outcome.results.some((r) => r.reason === "InvalidProviderToken" || r.reason === "ExpiredProviderToken")) await store.saveJwt(null).catch(() => {});
  } catch (e) {
    const error = e instanceof Error ? e.message.slice(0, 200) : String(e);
    await store.finish(logId, { status: "failed", error });
    return { status: "failed", sent: 0, devices: devices.length, dropped: 0, apns_id: null, error, log_id: logId };
  }
  if (outcome.dead.length) await store.dropTokens(outcome.dead).catch(() => {});
  for (const f of outcome.envFixes) await store.setEnvironment(f.token, f.environment).catch(() => {});
  const status = outcomeStatus(outcome, devices.length);
  const apns_id = outcome.results.find((r) => r.ok)?.apns_id ?? null;
  const error = firstError(outcome);
  await store.finish(logId, { status, sent: outcome.sent, dropped: outcome.dead.length, apns_id, error, results: outcome.results });
  return { status, sent: outcome.sent, devices: devices.length, dropped: outcome.dead.length, apns_id, error, log_id: logId };
}

/** The ET calendar date, which is how brief_date is keyed. */
export const etDate = (ms: number) => new Date(ms).toLocaleDateString("en-CA", { timeZone: "America/New_York" });

/** push-send's body: the brief pipeline's request, validated. */
export async function briefPush(deps: Deps, body: { user_id?: unknown; edition?: unknown; lede?: unknown; brief_date?: unknown }):
  Promise<{ status: number; body: Record<string, unknown> }> {
  const userId = String(body.user_id ?? "");
  const edition = String(body.edition ?? "");
  const lede = String(body.lede ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(userId) || !lede.trim()) return { status: 400, body: { ok: false, error: "user_id and lede required" } };
  if (!/^[a-z_]{3,20}$/.test(edition)) return { status: 400, body: { ok: false, error: "edition required" } };
  const cfg = await apnsConfig(deps.store, deps.env);
  if (!cfg) return { status: 200, body: { ok: true, sent: 0, reason: "not configured" } };   // no APNs key yet: not an error
  // the brief row was written a moment ago: its date keys the dedupe, so a retry of the same edition never re-pushes
  const given = typeof body.brief_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.brief_date) ? body.brief_date : null;
  const briefDate = given ?? (await deps.store.latestBriefDate(userId, edition).catch(() => null)) ?? etDate(deps.now?.() ?? Date.now());
  const m = briefMessage(edition, briefDate, lede);
  const r = await deliver(deps, cfg, userId, m, { kind: "brief", dedupeKey: `brief:${userId}:${briefDate}:${edition}` });
  return { status: 200, body: { ok: true, ...r } };
}

// ---------- the Supabase-backed store ----------

export function supabaseStore(admin: Db): PushStore {
  return {
    async secret(name) {
      const { data } = await admin.rpc("get_secret", { secret_name: name });
      return (data as string | null) ?? "";
    },
    async devices(userId) {
      const { data } = await admin.from("push_tokens").select("token, environment").eq("user_id", userId).eq("platform", "ios");
      return ((data ?? []) as { token: string; environment: string | null }[]).map((d) => ({ token: d.token, environment: asEnv(d.environment) }));
    },
    async latestBriefDate(userId, edition) {
      const { data } = await admin.from("daily_briefs").select("brief_date").eq("user_id", userId).eq("edition", edition)
        .order("generated_at", { ascending: false }).limit(1).maybeSingle();
      return (data?.brief_date as string | undefined) ?? null;
    },
    async claim(row) {
      const { data, error } = await admin.from("push_log").insert(row).select("id").single();
      if (!error) return data.id as number;
      if (row.dedupe_key && (error.code === "23505" || /duplicate key/i.test(error.message ?? ""))) {
        // a failed earlier attempt may be retried; a sent (or in-flight) one may not
        const { data: re } = await admin.from("push_log").update({ ...row, created_at: new Date().toISOString() })
          .eq("dedupe_key", row.dedupe_key).eq("status", "failed").select("id");
        return re?.length ? (re[0].id as number) : null;
      }
      throw new Error(`push_log: ${error.message}`);
    },
    async finish(id, patch) { await admin.from("push_log").update(patch).eq("id", id); },
    async dropTokens(tokens) { if (tokens.length) await admin.from("push_tokens").delete().in("token", tokens); },
    async setEnvironment(token, environment) { await admin.from("push_tokens").update({ environment }).eq("token", token); },
    async cachedJwt() {
      const { data } = await admin.from("apns_provider_token").select("jwt, iat, key_id").eq("id", 1).maybeSingle();
      return data ? { jwt: String(data.jwt), iat: Number(data.iat), key_id: String(data.key_id) } : null;
    },
    async saveJwt(v) {
      if (!v) { await admin.from("apns_provider_token").delete().eq("id", 1); return; }
      await admin.from("apns_provider_token").upsert({ id: 1, ...v, updated_at: new Date().toISOString() });
    },
  };
}
