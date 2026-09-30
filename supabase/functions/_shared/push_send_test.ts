// Run: npx -y deno@2 test --allow-read supabase/functions/_shared/push_send_test.ts
// The APNs layer and push-send's brief path: payload shape, headers, host routing, dead-token cleanup, idempotency,
// opt-out, provider-token reuse.
import { assert, assertEquals, assertFalse, assertMatch } from "jsr:@std/assert@1";
import { apnsHeaders, briefMessage, buildPayload, isInAppLink, jwtReusable, mintApnsJwt, pushCopy } from "./apns.ts";
import { briefPush, type Deps } from "./push_core.ts";
import { fakeApns, MemStore, testP8, tok, U1, U2 } from "./push_test_kit.ts";

const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));

async function setup(answer: Parameters<typeof fakeApns>[0] = () => ({ status: 200 })) {
  const { pem } = await testP8();
  const store = new MemStore();
  store.secrets = { apns_key_id: "KEY1234567", apns_team_id: "5RCPL9J3UX", apns_private_key: pem };
  const apns = fakeApns(answer);
  const deps: Deps = { store, env: () => undefined, fetchFn: apns.fetchFn, sleep: async () => {}, now: () => Date.parse("2026-09-30T13:00:00Z") };
  return { store, apns, deps };
}
const brief = { user_id: U1, edition: "morning", lede: "Your book is up 1.2% as chips rally. NVDA leads.", brief_date: "2026-09-30" };

Deno.test("ES256 provider token verifies against the key's public half, header names the key, claims carry team + iat", async () => {
  const { pem, pub } = await testP8();
  const jwt = await mintApnsJwt("KEY1234567", "5RCPL9J3UX", pem, 1_790_000_000);
  const [h, p, s] = jwt.split(".");
  assertEquals(JSON.parse(new TextDecoder().decode(fromB64url(h))), { alg: "ES256", kid: "KEY1234567" });
  assertEquals(JSON.parse(new TextDecoder().decode(fromB64url(p))), { iss: "5RCPL9J3UX", iat: 1_790_000_000 });
  assertEquals(fromB64url(s).length, 64);   // raw r||s, not DER
  assert(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, fromB64url(s), new TextEncoder().encode(`${h}.${p}`)));
});

Deno.test("a .p8 pasted with literal \\n escapes (how env secrets often arrive) still imports", async () => {
  const { pem } = await testP8();
  const jwt = await mintApnsJwt("K", "T", pem.replace(/\n/g, "\\n"), 1);
  assertEquals(jwt.split(".").length, 3);
});

Deno.test("brief payload: alert, sound, thread per edition, badge 1, deep link to the brief; collapse id per edition + day", () => {
  const m = briefMessage("close", "2026-09-30", "Closing up 0.4%.");
  assertEquals(buildPayload(m), {
    aps: { alert: { title: "Closing note", body: "Closing up 0.4%." }, sound: "default", "thread-id": "brief-close", badge: 1 },
    brief_date: "2026-09-30", edition: "close", link: "/brief/2026-09-30/close",
  });
  const h = apnsHeaders("JWT", "com.hodlerss.assetly", m);
  assertEquals(h["apns-collapse-id"], "brief-2026-09-30-close");
  assertEquals(h["apns-push-type"], "alert");
  assertEquals(h["apns-priority"], "5");
  assertEquals(h["apns-topic"], "com.hodlerss.assetly");
  assertEquals(h.authorization, "bearer JWT");
});

Deno.test("links: only in-app routes survive into the payload", () => {
  for (const ok of ["/home", "/news", "/ask", "/settings", "/brief/latest", "/brief/2026-09-30/kr_close"]) assert(isInAppLink(ok), ok);
  for (const bad of ["https://evil.example", "/brief/2026-9-30/close", "/brief/2026-09-30/other", "//evil.com", "/home?x=1", "javascript:alert(1)", ""]) assertFalse(isInAppLink(bad), bad);
  assertEquals(buildPayload({ title: "t", body: "b", link: "https://evil.example" }).link, undefined);
});

Deno.test("pushCopy: titles per edition, cut on a sentence, never mid-word, tags stripped", () => {
  assertEquals(pushCopy("kr_open", "x").title, "Korea open");
  assertEquals(pushCopy("unknown", "x").title, "Your brief");
  const long = "Your portfolio rose 1.4% today, led by chip names. " + "Semis carried the tape while rates eased and the dollar slipped further today.";
  assertEquals(pushCopy("morning", long).body, "Your portfolio rose 1.4% today, led by chip names.");
  const noStop = "word ".repeat(40);
  const b = pushCopy("morning", noStop).body;
  assert(b.endsWith("…") && b.length <= 111 && !/wor…$/.test(b));
  assertEquals(pushCopy("morning", "<b>Up</b> 2%").body, "Up 2%");
});

Deno.test("not configured: no key, no send, not an error", async () => {
  const { store, apns, deps } = await setup();
  store.secrets = {};
  store.tokens.push({ user_id: U1, token: tok("a"), environment: "production" });
  const r = await briefPush(deps, brief);
  assertEquals(r, { status: 200, body: { ok: true, sent: 0, reason: "not configured" } });
  assertEquals(apns.calls.length, 0);
});

Deno.test("opt-out: no tokens means no send and no log row", async () => {
  const { store, apns, deps } = await setup();
  store.tokens.push({ user_id: U2, token: tok("b"), environment: "production" });   // someone else's device
  const r = await briefPush(deps, brief);
  assertEquals(r.body.reason, "no devices");
  assertEquals(apns.calls.length, 0);
  assertEquals(store.log.length, 0);
});

Deno.test("sends to every device on its own host and logs one row with the apns-id", async () => {
  const { store, apns, deps } = await setup();
  store.tokens.push({ user_id: U1, token: tok("a"), environment: "production" }, { user_id: U1, token: tok("c"), environment: "sandbox" });
  const r = await briefPush(deps, brief);
  assertEquals(r.body.sent, 2);
  assertEquals(apns.calls.map((c) => c.host), ["production", "sandbox"]);
  assertEquals(apns.calls[0].body.link, "/brief/2026-09-30/morning");
  assertEquals(store.log.length, 1);
  assertEquals(store.log[0].status, "sent");
  assertEquals(store.log[0].apns_id, "id-1");
  assertEquals(store.log[0].dedupe_key, `brief:${U1}:2026-09-30:morning`);
  assertEquals(store.log[0].kind, "brief");
});

Deno.test("idempotent: the same edition twice sends once; a different edition sends again", async () => {
  const { store, apns, deps } = await setup();
  store.tokens.push({ user_id: U1, token: tok("a"), environment: "production" });
  await briefPush(deps, brief);
  const again = await briefPush(deps, brief);
  assertEquals(again.body.reason, "duplicate");
  assertEquals(apns.calls.length, 1);
  await briefPush(deps, { ...brief, edition: "midday" });
  assertEquals(apns.calls.length, 2);
});

Deno.test("a failed send can be retried; a sent one cannot", async () => {
  let down = true;
  const { store, apns, deps } = await setup(() => (down ? { status: 503, reason: "ServiceUnavailable" } : { status: 200 }));
  store.tokens.push({ user_id: U1, token: tok("a"), environment: "production" });
  const first = await briefPush(deps, brief);
  assertEquals(first.body.status, "failed");
  assertEquals(apns.calls.length, 2);   // one retry on a 5xx
  down = false;
  const second = await briefPush(deps, brief);
  assertEquals(second.body.status, "sent");
  assertEquals(store.log.length, 1);
  assertEquals(store.log[0].status, "sent");
});

Deno.test("brief_date missing: taken from the brief row just written, so the dedupe key is stable", async () => {
  const { store, deps } = await setup();
  store.tokens.push({ user_id: U1, token: tok("a"), environment: "production" });
  store.briefs.push({ user_id: U1, edition: "morning", brief_date: "2026-09-29", generated_at: "2026-09-29T12:40:00Z" });
  await briefPush(deps, { user_id: U1, edition: "morning", lede: "x" });
  assertEquals(store.log[0].dedupe_key, `brief:${U1}:2026-09-29:morning`);
  assertEquals(store.log[0].link, "/brief/2026-09-29/morning");
});

Deno.test("410 Unregistered and BadDeviceToken on both hosts delete the token; the good device still gets it", async () => {
  const { store, apns, deps } = await setup((t) => t === tok("d") ? { status: 410, reason: "Unregistered" } : t === tok("e") ? { status: 400, reason: "BadDeviceToken" } : { status: 200 });
  store.tokens.push(
    { user_id: U1, token: tok("a"), environment: "production" },
    { user_id: U1, token: tok("d"), environment: "production" },
    { user_id: U1, token: tok("e"), environment: "production" },
  );
  const r = await briefPush(deps, brief);
  assertEquals(r.body.sent, 1);
  assertEquals(r.body.dropped, 2);
  assertEquals(r.body.status, "partial");
  assertEquals(store.tokens.map((t) => t.token), [tok("a")]);
  // BadDeviceToken was tried on the other host once before being dropped
  assertEquals(apns.calls.filter((c) => c.token === tok("e")).map((c) => c.host), ["production", "sandbox"]);
});

Deno.test("a sandbox token filed as production is delivered on the sandbox and re-filed", async () => {
  const { store, deps } = await setup((_t, host) => host === "sandbox" ? { status: 200 } : { status: 400, reason: "BadDeviceToken" });
  store.tokens.push({ user_id: U1, token: tok("f"), environment: "production" });
  const r = await briefPush(deps, brief);
  assertEquals(r.body.sent, 1);
  assertEquals(store.tokens[0].environment, "sandbox");
});

Deno.test("403 bad provider token: nothing dropped, the cached token is forgotten", async () => {
  const { store, deps } = await setup(() => ({ status: 403, reason: "InvalidProviderToken" }));
  store.tokens.push({ user_id: U1, token: tok("a"), environment: "production" });
  const r = await briefPush(deps, brief);
  assertEquals(r.body.status, "failed");
  assertEquals(store.tokens.length, 1);
  assertEquals(store.jwt, null);
  assertMatch(String(store.log[0].error), /403 InvalidProviderToken/);
});

Deno.test("provider token reused under 40 minutes, re-minted after, and on a key change", () => {
  const c = { jwt: "x", iat: 1000, key_id: "K1" };
  assert(jwtReusable(c, "K1", 1000 + 39 * 60));
  assertFalse(jwtReusable(c, "K1", 1000 + 40 * 60));
  assertFalse(jwtReusable(c, "K2", 1001));
  assertFalse(jwtReusable(null, "K1", 1001));
});

Deno.test("two briefs in a row share one provider token (no TooManyProviderTokenUpdates)", async () => {
  const { store, apns, deps } = await setup();
  store.tokens.push({ user_id: U1, token: tok("a"), environment: "production" }, { user_id: U2, token: tok("b"), environment: "production" });
  await briefPush(deps, brief);
  await briefPush(deps, { ...brief, user_id: U2 });
  assertEquals(store.jwtSaves, 1);
  assertEquals(apns.calls[0].headers.authorization, apns.calls[1].headers.authorization);
});

Deno.test("bad requests: 400 without user_id, lede or a sane edition", async () => {
  const { deps } = await setup();
  assertEquals((await briefPush(deps, { user_id: "x", lede: "y", edition: "morning" })).status, 400);
  assertEquals((await briefPush(deps, { user_id: U1, lede: " ", edition: "morning" })).status, 400);
  assertEquals((await briefPush(deps, { user_id: U1, lede: "y", edition: "../../x" })).status, 400);
});
