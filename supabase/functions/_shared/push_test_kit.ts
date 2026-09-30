// Test doubles for the push tests: an in-memory store with the same contract as supabaseStore / supabaseAdminStore,
// a scripted APNs, and a throwaway P-256 key in .p8 form.
import type { Device } from "./apns.ts";
import type { LogRow } from "./push_core.ts";
import type { Actor, AdminStore, AuditRow, Recipient } from "./admin_push.ts";

export async function testP8(): Promise<{ pem: string; pub: CryptoKey }> {
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const der = new Uint8Array(await crypto.subtle.exportKey("pkcs8", kp.privateKey));
  let s = ""; for (const b of der) s += String.fromCharCode(b);
  const b64 = btoa(s).replace(/(.{64})/g, "$1\n");
  return { pem: `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----\n`, pub: kp.publicKey };
}

export class MemStore implements AdminStore {
  secrets: Record<string, string> = {};
  tokens: { user_id: string; token: string; environment: string }[] = [];
  briefs: { user_id: string; edition: string; brief_date: string; generated_at: string }[] = [];
  log: (LogRow & { id: number; created_at: string })[] = [];
  auditRows: (AuditRow & { created_at: string })[] = [];
  jwt: { jwt: string; iat: number; key_id: string } | null = null;
  jwtSaves = 0;
  now = () => Date.now();
  emails: Record<string, string> = {};

  async secret(name: string) { return this.secrets[name] ?? ""; }
  async devices(userId: string): Promise<Device[]> {
    return this.tokens.filter((t) => t.user_id === userId).map((t) => ({ token: t.token, environment: t.environment }));
  }
  async latestBriefDate(userId: string, edition: string) {
    const b = this.briefs.filter((x) => x.user_id === userId && x.edition === edition).sort((a, b) => b.generated_at.localeCompare(a.generated_at))[0];
    return b?.brief_date ?? null;
  }
  async claim(row: LogRow) {
    if (row.dedupe_key) {
      const prior = this.log.find((l) => l.dedupe_key === row.dedupe_key);
      if (prior) {
        if (prior.status !== "failed") return null;
        Object.assign(prior, row);
        return prior.id;
      }
    }
    const id = this.log.length + 1;
    this.log.push({ ...row, id, created_at: new Date(this.now()).toISOString() });
    return id;
  }
  async finish(id: number, patch: Partial<LogRow>) { Object.assign(this.log.find((l) => l.id === id)!, patch); }
  async dropTokens(tokens: string[]) { this.tokens = this.tokens.filter((t) => !tokens.includes(t.token)); }
  async setEnvironment(token: string, environment: string) { for (const t of this.tokens) if (t.token === token) t.environment = environment; }
  async cachedJwt() { return this.jwt; }
  async saveJwt(v: { jwt: string; iat: number; key_id: string } | null) { this.jwt = v; this.jwtSaves++; }
  async recipients(): Promise<Recipient[]> {
    const ids = [...new Set(this.tokens.map((t) => t.user_id))];
    return ids.map((id) => ({
      user_id: id, email: this.emails[id] ?? null, display_name: null, devices: this.tokens.filter((t) => t.user_id === id).length,
      environments: [...new Set(this.tokens.filter((t) => t.user_id === id).map((t) => t.environment))], last_seen_at: null, last_brief_at: null, last_push_at: null,
    }));
  }
  async recentCount(actorId: string, actions: string[], sinceIso: string) {
    return this.auditRows.filter((a) => a.actor_id === actorId && a.ok && actions.includes(a.action) && a.created_at >= sinceIso).length;
  }
  async audit(row: AuditRow) { this.auditRows.push({ ...row, created_at: new Date(this.now()).toISOString() }); }
  async history(limit: number) { return this.log.slice(-limit).reverse() as unknown as Record<string, unknown>[]; }
}

/** A scripted APNs: answers by token (and host), records every request. */
export type Call = { url: string; host: "production" | "sandbox"; token: string; headers: Record<string, string>; body: Record<string, unknown> };
export function fakeApns(answer: (token: string, host: "production" | "sandbox", n: number) => { status: number; reason?: string }) {
  const calls: Call[] = [];
  const fetchFn = async (url: string, init: RequestInit): Promise<Response> => {
    const host = url.startsWith("https://api.sandbox.push.apple.com") ? "sandbox" : "production";
    const token = url.split("/3/device/")[1];
    calls.push({ url, host, token, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
    const a = answer(token, host, calls.length);
    const headers = new Headers({ "apns-id": `id-${calls.length}` });
    return new Response(a.status === 200 ? "" : JSON.stringify({ reason: a.reason ?? "" }), { status: a.status, headers });
  };
  return { calls, fetchFn };
}

export const U1 = "11111111-1111-4111-8111-111111111111";
export const U2 = "22222222-2222-4222-8222-222222222222";
export const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const tok = (c: string) => c.repeat(64).slice(0, 64);
export const actors: Record<string, Actor> = {
  "admin-jwt": { id: ADMIN, email: "minjae.m.lee@gmail.com", confirmed: true },
  "user-jwt": { id: U1, email: "someone@example.com", confirmed: true },
  "unconfirmed-admin-jwt": { id: ADMIN, email: "minjae.m.lee@gmail.com", confirmed: false },
};
