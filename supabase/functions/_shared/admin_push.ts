// admin-push: the internal tool for sending a push by hand. Every rule that keeps it safe lives here and is
// unit-tested (admin_push_test.ts); the function file only wires it to Supabase.
//
//  - identity: the caller's access token is verified server side (signature + expiry via getClaims, then the user
//    is read back with the service role) and the email on the ACCOUNT, not a claim in the token, must be verified
//    and in the allowlist (ADMIN_EMAILS env, else Vault admin_emails, else the owner only). Never trust the client.
//  - validation: title 1-60 characters, body 1-178, an optional link restricted to in-app routes (apns.isInAppLink)
//  - rate limits: 50 single sends per hour per admin, 1 broadcast per 10 minutes; dry runs are free
//  - a broadcast must name the recipient count it is about to reach (confirm_count), so a stale page can't blast
//  - every call, refused or not, is written to admin_audit; every send to push_log
import { buildPayload, type Message } from "./apns.ts";
import { apnsConfig, deliver, type Deps, type PushStore, supabaseStore } from "./push_core.ts";

export const TITLE_MAX = 60;
export const BODY_MAX = 178;
export const SINGLE_PER_HOUR = 50;
export const BROADCAST_EVERY_MS = 10 * 60_000;
export const DEFAULT_ADMINS = ["minjae.m.lee@gmail.com"];

export type Actor = { id: string; email: string; confirmed: boolean };
export type Recipient = {
  user_id: string; email: string | null; display_name: string | null; devices: number; environments: string[];
  last_seen_at: string | null; last_brief_at: string | null; last_push_at: string | null;
};
export type AuditRow = { actor_id: string | null; actor_email: string | null; action: string; target?: string | null; payload?: unknown; result?: unknown; ok: boolean };

export interface AdminStore extends PushStore {
  recipients(): Promise<Recipient[]>;
  /** audit rows by this actor with ok=true for these actions since the time */
  recentCount(actorId: string, actions: string[], sinceIso: string): Promise<number>;
  audit(row: AuditRow): Promise<void>;
  history(limit: number): Promise<Record<string, unknown>[]>;
}

export type AdminDeps = Omit<Deps, "store"> & {
  store: AdminStore;
  /** verify an access token; null when missing, malformed, badly signed, expired, or not a user */
  verify(jwt: string): Promise<Actor | null>;
};

type Res = { status: number; body: Record<string, unknown> };
const res = (status: number, body: Record<string, unknown>): Res => ({ status, body });

export const adminEmails = (raw: string | null | undefined): string[] => {
  const list = String(raw ?? "").split(/[,\s]+/).map((s) => s.trim().toLowerCase()).filter((s) => /.+@.+\..+/.test(s));
  return list.length ? list : DEFAULT_ADMINS;
};

// control characters (a notification is one paragraph) and zero-width / bidi tricks go; the rest is kept
// built from code points so the source stays plain ASCII: C0 controls, DEL, zero-width marks, line/paragraph
// separators, bidi embeddings and overrides, invisible operators, BOM
const STRIP_RANGES: [number, number][] = [[0x00, 0x1f], [0x7f, 0x7f], [0x200b, 0x200f], [0x2028, 0x202e], [0x2060, 0x2064], [0xfeff, 0xfeff]];
const STRIP = new RegExp(`[${STRIP_RANGES.map(([a, b]) => `${String.fromCharCode(a)}-${String.fromCharCode(b)}`).join("")}]`, "g");
const clean = (v: unknown) => String(v ?? "").replace(STRIP, " ").replace(/\s+/g, " ").trim();
const chars = (s: string) => [...s].length;

export type Draft = { title: string; body: string; link: string | null };
export function validateDraft(input: { title?: unknown; body?: unknown; link?: unknown }): { ok: true; draft: Draft } | { ok: false; errors: Record<string, string> } {
  const title = clean(input.title), body = clean(input.body);
  const rawLink = input.link == null ? "" : String(input.link).trim();
  const errors: Record<string, string> = {};
  if (!title) errors.title = "Title is required.";
  else if (chars(title) > TITLE_MAX) errors.title = `Title is ${chars(title)} characters; the limit is ${TITLE_MAX}.`;
  if (!body) errors.body = "Body is required.";
  else if (chars(body) > BODY_MAX) errors.body = `Body is ${chars(body)} characters; the limit is ${BODY_MAX}.`;
  if (rawLink && !/^\/(home|news|ask|settings|brief\/latest|brief\/\d{4}-\d{2}-\d{2}\/(morning|midday|close|assessment|weekend|kr_open|kr_close))$/.test(rawLink)) {
    errors.link = "Link must be an in-app route: /home, /news, /ask, /settings, /brief/latest or /brief/YYYY-MM-DD/<edition>.";
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, draft: { title, body, link: rawLink || null } };
}

export const adminMessage = (d: Draft, kind: string): Message => ({
  title: d.title, body: d.body, link: d.link, threadId: "assetly-notes", priority: 10, data: { kind },
});

const ACTIONS = ["whoami", "recipients", "preview", "send", "test", "broadcast", "history"] as const;
type Action = typeof ACTIONS[number];

export async function handleAdmin(deps: AdminDeps, jwt: string, input: Record<string, unknown>): Promise<Res> {
  const action = String(input.action ?? "") as Action;
  const dry = input.dry_run === true;
  const actor = await deps.verify(jwt).catch(() => null);
  const audit = (ok: boolean, result: unknown, target: string | null = null) => deps.store.audit({
    actor_id: actor?.id ?? null, actor_email: actor?.email ?? null, action: action + (dry ? ":dry" : ""), target,
    payload: { title: input.title ?? null, body: input.body ?? null, link: input.link ?? null, user_id: input.user_id ?? null, confirm_count: input.confirm_count ?? null },
    result, ok,
  }).catch(() => {});
  if (!actor) { await audit(false, { error: "unauthenticated" }); return res(401, { ok: false, error: "Sign in again." }); }
  const allow = adminEmails(deps.env("ADMIN_EMAILS") || (await deps.store.secret("admin_emails").catch(() => "")));
  if (!actor.confirmed || !allow.includes(actor.email.toLowerCase())) {
    await audit(false, { error: "forbidden" });
    return res(403, { ok: false, error: "forbidden" });
  }
  if (!ACTIONS.includes(action)) { await audit(false, { error: "unknown action" }); return res(400, { ok: false, error: "unknown action" }); }

  if (action === "whoami") return res(200, { ok: true, admin: true, email: actor.email });
  if (action === "recipients") {
    const list = await deps.store.recipients();
    return res(200, { ok: true, recipients: list, count: list.length });
  }
  if (action === "history") {
    const n = Math.min(Math.max(Number(input.limit) || 50, 1), 200);
    return res(200, { ok: true, history: await deps.store.history(n) });
  }

  const v = validateDraft(input);
  if (!v.ok) { await audit(false, { errors: v.errors }); return res(400, { ok: false, error: "invalid", errors: v.errors }); }
  const draft = v.draft;
  if (action === "preview") return res(200, { ok: true, draft, payload: buildPayload(adminMessage(draft, "admin_preview")) });

  const now = deps.now?.() ?? Date.now();
  const cfg = await apnsConfig(deps.store, deps.env);
  if (!cfg && !dry) { await audit(false, { error: "not configured" }); return res(503, { ok: false, error: "APNs is not configured yet." }); }

  if (action === "send" || action === "test") {
    const target = action === "test" ? actor.id : String(input.user_id ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(target)) { await audit(false, { error: "user_id required" }); return res(400, { ok: false, error: "Pick a recipient." }); }
    const devices = await deps.store.devices(target);
    if (dry) {
      const r = { ok: true, dry_run: true, devices: devices.length, payload: buildPayload(adminMessage(draft, `admin_${action}`)) };
      await audit(true, r, target);
      return res(200, r);
    }
    const used = await deps.store.recentCount(actor.id, ["send", "test"], new Date(now - 3600_000).toISOString());
    if (used >= SINGLE_PER_HOUR) { await audit(false, { error: "rate limited", used }, target); return res(429, { ok: false, error: `Limit reached: ${SINGLE_PER_HOUR} sends an hour.` }); }
    if (!devices.length) { await audit(false, { error: "no devices" }, target); return res(409, { ok: false, error: "That account has no device with notifications on." }); }
    const r = await deliver(deps, cfg!, target, adminMessage(draft, `admin_${action}`), { kind: action === "test" ? "admin_test" : "admin_single", actorId: actor.id });
    const ok = r.sent > 0;
    await audit(ok, r, target);
    return res(ok ? 200 : 502, { ok, ...r });
  }

  // broadcast: everyone with notifications on
  const recipients = (await deps.store.recipients()).filter((x) => x.devices > 0);
  if (Number(input.confirm_count) !== recipients.length) {
    const r = { error: "confirm_count mismatch", expected: recipients.length };
    await audit(false, r, "all");
    return res(409, { ok: false, error: `Type ${recipients.length} to confirm the recipient count.`, expected: recipients.length });
  }
  if (dry) {
    const r = { ok: true, dry_run: true, recipients: recipients.length, devices: recipients.reduce((s, x) => s + x.devices, 0), payload: buildPayload(adminMessage(draft, "admin_broadcast")) };
    await audit(true, r, "all");
    return res(200, r);
  }
  const recent = await deps.store.recentCount(actor.id, ["broadcast"], new Date(now - BROADCAST_EVERY_MS).toISOString());
  if (recent > 0) { await audit(false, { error: "rate limited" }, "all"); return res(429, { ok: false, error: "One broadcast every 10 minutes." }); }
  const m = adminMessage(draft, "admin_broadcast");
  let users = 0, sent = 0, dropped = 0, failed = 0;
  // a few at a time: fast enough for this audience, gentle on APNs and the 150s wall clock
  const queue = [...recipients];
  const worker = async () => {
    for (let x = queue.shift(); x; x = queue.shift()) {
      const r = await deliver(deps, cfg!, x.user_id, m, { kind: "admin_broadcast", actorId: actor.id }).catch(() => null);
      users++;
      if (r && r.sent > 0) sent += r.sent; else failed++;
      dropped += r?.dropped ?? 0;
    }
  };
  await Promise.all(Array.from({ length: Math.min(5, recipients.length) }, worker));
  const r = { ok: sent > 0 || recipients.length === 0, recipients: users, sent, dropped, failed };
  await audit(r.ok, r, "all");
  return res(200, r);
}

// ---------- Supabase wiring ----------

// deno-lint-ignore no-explicit-any
type Db = any;

export function supabaseAdminStore(admin: Db): AdminStore {
  const base = supabaseStore(admin);
  return {
    ...base,
    async recipients() {
      const { data: toks } = await admin.from("push_tokens").select("user_id, environment, last_seen_at").eq("platform", "ios");
      const by = new Map<string, { devices: number; envs: Set<string>; seen: string | null }>();
      for (const t of (toks ?? []) as { user_id: string; environment: string; last_seen_at: string }[]) {
        const e = by.get(t.user_id) ?? { devices: 0, envs: new Set<string>(), seen: null };
        e.devices++; e.envs.add(t.environment); if (!e.seen || t.last_seen_at > e.seen) e.seen = t.last_seen_at;
        by.set(t.user_id, e);
      }
      const ids = [...by.keys()];
      if (!ids.length) return [];
      const { data: profs } = await admin.from("profiles").select("id, display_name").in("id", ids);
      const names = new Map(((profs ?? []) as { id: string; display_name: string | null }[]).map((p) => [p.id, p.display_name]));
      const out: Recipient[] = [];
      for (const id of ids) {
        const [{ data: u }, { data: b }, { data: p }] = await Promise.all([
          admin.auth.admin.getUserById(id),
          admin.from("daily_briefs").select("generated_at").eq("user_id", id).order("generated_at", { ascending: false }).limit(1).maybeSingle(),
          admin.from("push_log").select("created_at").eq("user_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
        ]);
        const e = by.get(id)!;
        out.push({
          user_id: id, email: u?.user?.email ?? null, display_name: names.get(id) ?? null, devices: e.devices, environments: [...e.envs].sort(),
          last_seen_at: e.seen, last_brief_at: b?.generated_at ?? null, last_push_at: p?.created_at ?? null,
        });
      }
      return out.sort((a, b) => (a.email ?? "").localeCompare(b.email ?? ""));
    },
    async recentCount(actorId, actions, sinceIso) {
      const { count } = await admin.from("admin_audit").select("id", { count: "exact", head: true })
        .eq("actor_id", actorId).eq("ok", true).in("action", actions).gte("created_at", sinceIso);
      return count ?? 0;
    },
    async audit(row) { await admin.from("admin_audit").insert(row); },
    async history(limit) {
      const { data } = await admin.from("push_log").select("id, created_at, user_id, kind, title, body, link, status, devices, sent, dropped, apns_id, error, actor_id")
        .order("created_at", { ascending: false }).limit(limit);
      const rows = (data ?? []) as Record<string, unknown>[];
      const ids = [...new Set(rows.map((r) => r.user_id).filter(Boolean) as string[])];
      const emails = new Map<string, string | null>();
      await Promise.all(ids.map(async (id) => { const { data: u } = await admin.auth.admin.getUserById(id); emails.set(id, u?.user?.email ?? null); }));
      return rows.map((r) => ({ ...r, email: r.user_id ? emails.get(r.user_id as string) ?? null : null }));
    },
  };
}

/** Token → actor: signature and expiry checked locally (getClaims), then the account read back by id. */
export async function verifyActor(admin: Db, jwt: string): Promise<Actor | null> {
  if (!jwt || jwt.split(".").length !== 3) return null;
  let sub: string | null = null;
  try {
    const { data, error } = await admin.auth.getClaims(jwt);
    const c = data?.claims as { sub?: unknown; role?: unknown } | undefined;
    if (!error && c && typeof c.sub === "string" && c.role === "authenticated") sub = c.sub;
  } catch { sub = null; }
  if (!sub) return null;
  const { data: u } = await admin.auth.admin.getUserById(sub);
  const user = u?.user;
  if (!user?.email) return null;
  return { id: user.id, email: String(user.email).toLowerCase(), confirmed: !!user.email_confirmed_at };
}
