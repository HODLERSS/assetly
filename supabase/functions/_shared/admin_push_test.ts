// Run: npx -y deno@2 test --allow-read supabase/functions/_shared/admin_push_test.ts
// admin-push: identity (401/403), allowlist, validation, rate limits, broadcast confirmation, dry runs, audit.
import { assert, assertEquals, assertFalse } from "jsr:@std/assert@1";
import { adminEmails, type AdminDeps, BODY_MAX, handleAdmin, TITLE_MAX, validateDraft } from "./admin_push.ts";
import { ADMIN, actors, fakeApns, MemStore, testP8, tok, U1, U2 } from "./push_test_kit.ts";

async function setup(opts: { admins?: string; configured?: boolean } = {}) {
  const { pem } = await testP8();
  const store = new MemStore();
  if (opts.configured !== false) store.secrets = { apns_key_id: "KEY1234567", apns_team_id: "5RCPL9J3UX", apns_private_key: pem };
  store.tokens.push(
    { user_id: ADMIN, token: tok("a"), environment: "sandbox" },
    { user_id: U1, token: tok("b"), environment: "production" },
    { user_id: U2, token: tok("c"), environment: "production" },
  );
  store.emails = { [ADMIN]: "minjae.m.lee@gmail.com", [U1]: "one@example.com", [U2]: "two@example.com" };
  let clock = Date.parse("2026-09-30T13:00:00Z");
  store.now = () => clock;
  const apns = fakeApns(() => ({ status: 200 }));
  const deps: AdminDeps = {
    store, fetchFn: apns.fetchFn, sleep: async () => {}, now: () => clock,
    env: (k) => (k === "ADMIN_EMAILS" ? opts.admins : undefined),
    verify: async (jwt) => actors[jwt] ?? null,
  };
  return { store, apns, deps, tick: (ms: number) => { clock += ms; } };
}
const draft = { title: "Market holiday Monday", body: "US markets are closed Monday. Your next brief is Tuesday morning.", link: "/home" };

Deno.test("no token or a bad token: 401, audited, nothing sent", async () => {
  const { store, apns, deps } = await setup();
  for (const jwt of ["", "garbage", "expired-jwt"]) {
    const r = await handleAdmin(deps, jwt, { action: "test", ...draft });
    assertEquals(r.status, 401);
  }
  assertEquals(apns.calls.length, 0);
  assertEquals(store.auditRows.length, 3);
  assert(store.auditRows.every((a) => !a.ok && a.actor_id === null));
});

Deno.test("a signed-in non-admin: 403 on every action, audited with who tried", async () => {
  const { store, apns, deps } = await setup();
  for (const action of ["whoami", "recipients", "history", "send", "test", "broadcast", "preview"]) {
    const r = await handleAdmin(deps, "user-jwt", { action, ...draft, user_id: U2, confirm_count: 3 });
    assertEquals(r.status, 403, action);
    assertEquals(r.body, { ok: false, error: "forbidden" });
  }
  assertEquals(apns.calls.length, 0);
  assert(store.auditRows.every((a) => a.actor_id === U1 && !a.ok));
});

Deno.test("the allowlist is the account's verified email, not a claim: an unverified admin email is refused", async () => {
  const { deps } = await setup();
  assertEquals((await handleAdmin(deps, "unconfirmed-admin-jwt", { action: "whoami" })).status, 403);
  assertEquals((await handleAdmin(deps, "admin-jwt", { action: "whoami" })).body, { ok: true, admin: true, email: "minjae.m.lee@gmail.com" });
});

Deno.test("ADMIN_EMAILS replaces the default; a garbage value falls back to the owner only", async () => {
  assertEquals(adminEmails(""), ["minjae.m.lee@gmail.com"]);
  assertEquals(adminEmails("not-an-email"), ["minjae.m.lee@gmail.com"]);
  assertEquals(adminEmails(" A@x.com, b@y.org "), ["a@x.com", "b@y.org"]);
  const { deps } = await setup({ admins: "someone@example.com" });
  assertEquals((await handleAdmin(deps, "user-jwt", { action: "whoami" })).status, 200);
  assertEquals((await handleAdmin(deps, "admin-jwt", { action: "whoami" })).status, 403);
});

Deno.test("validation: title <= 60, body <= 178 (characters, not bytes), links in-app only, control chars stripped", () => {
  assert(validateDraft({ title: "t".repeat(TITLE_MAX), body: "b".repeat(BODY_MAX) }).ok);
  const long = validateDraft({ title: "t".repeat(TITLE_MAX + 1), body: "b".repeat(BODY_MAX + 1) });
  assertFalse(long.ok);
  if (!long.ok) { assert(long.errors.title.includes("61")); assert(long.errors.body.includes("179")); }
  assert(validateDraft({ title: "한".repeat(60), body: "📈".repeat(178) }).ok);   // Korean and emoji count as one each
  assertFalse(validateDraft({ title: " ", body: "x" }).ok);
  assertFalse(validateDraft({ title: "x", body: "x", link: "https://evil.example" }).ok);
  assertFalse(validateDraft({ title: "x", body: "x", link: "/brief/../../etc" }).ok);
  const v = validateDraft({ title: "Hi‮\u0007 there", body: "a\n\nb" });
  assert(v.ok && v.draft.title === "Hi there" && v.draft.body === "a b");
});

Deno.test("invalid drafts: 400 with field errors, audited, nothing sent", async () => {
  const { store, apns, deps } = await setup();
  const r = await handleAdmin(deps, "admin-jwt", { action: "send", user_id: U1, title: "", body: "x".repeat(200) });
  assertEquals(r.status, 400);
  assert((r.body.errors as Record<string, string>).title && (r.body.errors as Record<string, string>).body);
  assertEquals(apns.calls.length, 0);
  assertFalse(store.auditRows.at(-1)!.ok);
});

Deno.test("preview returns the exact APNs payload", async () => {
  const { deps } = await setup();
  const r = await handleAdmin(deps, "admin-jwt", { action: "preview", ...draft });
  assertEquals(r.body.payload, { aps: { alert: { title: draft.title, body: draft.body }, sound: "default", "thread-id": "assetly-notes" }, kind: "admin_preview", link: "/home" });
});

Deno.test("test-to-me goes to the admin's own devices only and is logged as admin_test", async () => {
  const { store, apns, deps } = await setup();
  const r = await handleAdmin(deps, "admin-jwt", { action: "test", ...draft });
  assertEquals(r.status, 200);
  assertEquals(apns.calls.map((c) => [c.token, c.host]), [[tok("a"), "sandbox"]]);
  assertEquals(apns.calls[0].headers["apns-priority"], "10");
  assertEquals(store.log[0].kind, "admin_test");
  assertEquals(store.log[0].actor_id, ADMIN);
  assertEquals(store.log[0].status, "sent");
});

Deno.test("send to one user; a user with no device is a 409, not a silent success", async () => {
  const { store, apns, deps } = await setup();
  assertEquals((await handleAdmin(deps, "admin-jwt", { action: "send", user_id: U1, ...draft })).status, 200);
  assertEquals(apns.calls.map((c) => c.token), [tok("b")]);
  store.tokens = store.tokens.filter((t) => t.user_id !== U2);
  assertEquals((await handleAdmin(deps, "admin-jwt", { action: "send", user_id: U2, ...draft })).status, 409);
  assertEquals((await handleAdmin(deps, "admin-jwt", { action: "send", user_id: "nope", ...draft })).status, 400);
});

Deno.test("dry runs send nothing, need no APNs key, and don't use up the rate limit", async () => {
  const { store, apns, deps } = await setup({ configured: false });
  const one = await handleAdmin(deps, "admin-jwt", { action: "send", user_id: U1, dry_run: true, ...draft });
  assertEquals(one.body.dry_run, true);
  assertEquals(one.body.devices, 1);
  const all = await handleAdmin(deps, "admin-jwt", { action: "broadcast", confirm_count: 3, dry_run: true, ...draft });
  assertEquals(all.body.recipients, 3);
  assertEquals(apns.calls.length, 0);
  assertEquals(store.log.length, 0);
  assertEquals(store.auditRows.map((a) => a.action), ["send:dry", "broadcast:dry"]);
  // a real send without the key is refused, not faked
  assertEquals((await handleAdmin(deps, "admin-jwt", { action: "send", user_id: U1, ...draft })).status, 503);
});

Deno.test("rate limit: 50 single sends an hour, then 429; the window slides", async () => {
  const { apns, deps, tick } = await setup();
  for (let i = 0; i < 50; i++) assertEquals((await handleAdmin(deps, "admin-jwt", { action: i % 2 ? "test" : "send", user_id: U1, ...draft })).status, 200);
  const r = await handleAdmin(deps, "admin-jwt", { action: "send", user_id: U1, ...draft });
  assertEquals(r.status, 429);
  assertEquals(apns.calls.length, 50);
  tick(3600_000 + 1);
  assertEquals((await handleAdmin(deps, "admin-jwt", { action: "send", user_id: U1, ...draft })).status, 200);
});

Deno.test("broadcast: the typed count must match; then everyone once; a second within 10 minutes is 429", async () => {
  const { store, apns, deps, tick } = await setup();
  const wrong = await handleAdmin(deps, "admin-jwt", { action: "broadcast", confirm_count: 2, ...draft });
  assertEquals(wrong.status, 409);
  assertEquals(wrong.body.expected, 3);
  assertEquals((await handleAdmin(deps, "admin-jwt", { action: "broadcast", ...draft })).status, 409);   // no count at all
  assertEquals(apns.calls.length, 0);
  const ok = await handleAdmin(deps, "admin-jwt", { action: "broadcast", confirm_count: 3, ...draft });
  assertEquals(ok.status, 200);
  assertEquals(ok.body.sent, 3);
  assertEquals(new Set(apns.calls.map((c) => c.token)).size, 3);
  assertEquals(store.log.filter((l) => l.kind === "admin_broadcast").length, 3);
  tick(9 * 60_000);
  assertEquals((await handleAdmin(deps, "admin-jwt", { action: "broadcast", confirm_count: 3, ...draft })).status, 429);
  tick(2 * 60_000);
  assertEquals((await handleAdmin(deps, "admin-jwt", { action: "broadcast", confirm_count: 3, ...draft })).status, 200);
});

Deno.test("recipients and history are admin reads; unknown actions are refused", async () => {
  const { deps } = await setup();
  const r = await handleAdmin(deps, "admin-jwt", { action: "recipients" });
  assertEquals(r.body.count, 3);
  assertEquals((await handleAdmin(deps, "admin-jwt", { action: "history" })).status, 200);
  assertEquals((await handleAdmin(deps, "admin-jwt", { action: "drop_tables" })).status, 400);
});

Deno.test("every call is audited with the payload and the result", async () => {
  const { store, deps } = await setup();
  await handleAdmin(deps, "admin-jwt", { action: "send", user_id: U1, ...draft });
  const a = store.auditRows.at(-1)!;
  assertEquals(a.action, "send");
  assertEquals(a.target, U1);
  assertEquals((a.payload as Record<string, unknown>).title, draft.title);
  assertEquals((a.result as Record<string, unknown>).sent, 1);
  assert(a.ok);
});
