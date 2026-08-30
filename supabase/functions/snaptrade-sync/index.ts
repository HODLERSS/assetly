// SnapTrade import: pulls accounts, positions, and cash for connected users and
// mirrors them into holdings/lots (source='snaptrade', keyed by external_id).
// Callable by the signed-in user, by a sibling function (service role + user_id),
// or by cron (service role, no body -> all connected users).
import { createClient } from "jsr:@supabase/supabase-js@2";
import { normalizePosition, normalizeBalance, accountLabel } from "./map.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const API = "https://api.snaptrade.com/api/v1";

type TokenRow = { user_id: string; mode?: string | null; st_secret?: string | null; refresh_token: string | null; access_token: string | null; access_expires_at: string | null };

const canon = (o: unknown): string => {
  if (o === null || typeof o !== "object") return JSON.stringify(o);
  if (Array.isArray(o)) return "[" + o.map(canon).join(",") + "]";
  const r = o as Record<string, unknown>;
  return "{" + Object.keys(r).sort().map((k) => JSON.stringify(k) + ":" + canon(r[k])).join(",") + "}";
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const svcKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, svcKey);
  const bearer = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  const body = await req.json().catch(() => ({}));

  let cid = Deno.env.get("SNAPTRADE_CLIENT_ID") ?? "";
  if (!cid) { const { data } = await admin.rpc("get_secret", { secret_name: "snaptrade_client_id" }); cid = data ?? ""; }
  let sec = Deno.env.get("SNAPTRADE_CONSUMER_KEY") ?? "";
  if (!sec) { const { data } = await admin.rpc("get_secret", { secret_name: "snaptrade_consumer_key" }); sec = data ?? ""; }
  let ccid = Deno.env.get("SNAPTRADE_COMM_CLIENT_ID") ?? "";
  if (!ccid) { const { data } = await admin.rpc("get_secret", { secret_name: "snaptrade_comm_client_id" }); ccid = data ?? ""; }
  let ckey = Deno.env.get("SNAPTRADE_COMM_CONSUMER_KEY") ?? "";
  if (!ckey) { const { data } = await admin.rpc("get_secret", { secret_name: "snaptrade_comm_consumer_key" }); ckey = data ?? ""; }
  if (!cid && !ccid) return json({ ok: false, error: "not configured" }, 500);
  const signedGet = async (path: string, extraQuery: string): Promise<unknown> => {
    const ts = Math.floor(Date.now() / 1000);
    const q = `clientId=${ccid}&timestamp=${ts}` + (extraQuery ? `&${extraQuery}` : "");
    const payload = { content: null, path: `/api/v1${path}`, query: q };
    const rawKey = await crypto.subtle.importKey("raw", new TextEncoder().encode(ckey), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign("HMAC", rawKey, new TextEncoder().encode(canon(payload))))));
    const r = await fetch(`${API}${path}?${q}`, { headers: { Signature: sig, Accept: "application/json" } }).catch((e) => ({ __neterr: String(e) } as unknown as Response));
    if (!r || (r as unknown as { __neterr?: string }).__neterr) return { __err: "network", detail: (r as unknown as { __neterr?: string })?.__neterr };
    if (!r.ok) return { __err: r.status, detail: (await r.text().catch(() => "")).slice(0, 300) };
    return await r.json().catch(() => ({ __err: "badjson" }));
  };

  // resolve targets
  let targets: string[] = [];
  let itok = Deno.env.get("INTERNAL_TOKEN") ?? "";
  if (!itok) { const { data } = await admin.rpc("get_secret", { secret_name: "internal_token" }); itok = data ?? ""; }
  const isInternal = !!itok && (req.headers.get("x-internal-token") ?? "") === itok;
  const isService = isInternal || (() => { try { return JSON.parse(atob(bearer.split(".")[1] ?? "")).role === "service_role"; } catch { return false; } })();
  // FIXTURE mode (service/internal callers, @assetly.test users only): the SnapTrade payloads come from the body, so the
  // whole import path (mapper -> symbols -> prices -> holdings -> lots -> kick) can be exercised for any brokerage
  // shape without an account there. body.fixture = { accounts: [...], positions: {acctId: <positions/all payload>}, balances: {acctId: [...]} }
  const fixture = isService && body.fixture && typeof body.fixture === "object" ? body.fixture as { accounts: Record<string, unknown>[]; positions?: Record<string, unknown>; balances?: Record<string, unknown> } : null;
  if (isService) {
    if (typeof body.user_id === "string") targets = [body.user_id];
    else { const { data } = await admin.from("snaptrade_tokens").select("user_id"); targets = (data ?? []).map((r) => r.user_id); }
  } else {
    const { data: ud } = await admin.auth.getUser(bearer);
    if (ud?.user?.id) targets = [ud.user.id];
    else {
      // the platform (verify_jwt) accepted the credential but it maps to no user: the scheduler.
      // Allow an all-user sweep, rate-limited so the public key cannot be used to hammer SnapTrade.
      const { data: last } = await admin.from("snaptrade_tokens").select("last_sync_at").order("last_sync_at", { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
      if (last?.last_sync_at && Date.now() - +new Date(last.last_sync_at) < 20 * 60000) return json({ ok: true, skipped: "recent sweep" });
      const { data } = await admin.from("snaptrade_tokens").select("user_id");
      targets = (data ?? []).map((r) => r.user_id);
    }
  }

  const freshToken = async (row: TokenRow): Promise<string | null> => {
    if (row.access_token && row.access_expires_at && Date.now() < +new Date(row.access_expires_at) - 120000) return row.access_token;
    const r = await fetch("https://api.snaptrade.com/oauth/token/", {
      method: "POST",
      headers: { Authorization: "Basic " + btoa(`${cid}:${sec}`), "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: row.refresh_token ?? "" }),
    }).catch(() => null);
    if (!r || !r.ok) return null;
    const tk = await r.json().catch(() => null);
    if (!tk?.access_token) return null;
    await admin.from("snaptrade_tokens").update({
      access_token: tk.access_token, refresh_token: tk.refresh_token ?? row.refresh_token,
      access_expires_at: new Date(Date.now() + (Number(tk.expires_in) || 36000) * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("user_id", row.user_id);
    return tk.access_token;
  };
  const stGet = async (tok: string, path: string): Promise<unknown> => {
    const r = await fetch(API + path, { headers: { Authorization: `Bearer ${tok}`, Accept: "application/json" } }).catch(() => null);
    return r && r.ok ? await r.json().catch(() => null) : null;
  };

  const results: Record<string, unknown>[] = [];
  for (const uid of targets.slice(0, 25)) {
    const { data: got } = await admin.rpc("try_user_lock", { p_user: uid });
    if (got === false) { results.push({ uid: uid.slice(0, 8), skipped: "sync in progress" }); continue; }
    try {
      const { data: row } = await admin.from("snaptrade_tokens").select("user_id,mode,st_secret,refresh_token,access_token,access_expires_at").eq("user_id", uid).maybeSingle();
      let get: (path: string) => Promise<unknown>;
      if (fixture) {
        const { data: fu } = await admin.auth.admin.getUserById(uid);
        if (!fu?.user?.email?.endsWith("assetly.test")) { results.push({ uid: uid.slice(0, 8), error: "fixture only for test users" }); continue; }
        get = async (path: string) => {
          if (path === "/accounts") return fixture.accounts;
          const m = path.match(/^\/accounts\/([^/]+)\/(positions\/all|balances|positions|holdings)$/);
          if (!m) return null;
          if (m[2] === "positions/all") return (fixture.positions as Record<string, unknown> | undefined)?.[m[1]] ?? null;
          if (m[2] === "balances") return (fixture.balances as Record<string, unknown> | undefined)?.[m[1]] ?? [];
          return null;
        };
      } else if (!row) { results.push({ uid: uid.slice(0, 8), error: "not connected" }); continue; }
      else if ((row as TokenRow).mode === "commercial" || !!(row as TokenRow).st_secret) {
        const uq = `userId=${encodeURIComponent(uid)}&userSecret=${encodeURIComponent((row as TokenRow).st_secret ?? "")}`;
        get = (path: string) => signedGet(path, uq);
      } else {
        const tok = await freshToken(row as TokenRow);
        if (!tok) { results.push({ uid: uid.slice(0, 8), error: "token refresh failed" }); continue; }
        get = (path: string) => stGet(tok, path);
      }
      const rawSave = (kind: string, accountId: string | null, payload: unknown) =>
        admin.from("snaptrade_raw").insert({ user_id: uid, account_id: accountId, kind, payload: payload ?? null }).then(() => {}, () => {});
      const accounts = (await get("/accounts")) as Record<string, unknown>[] | null;
      if (Array.isArray(accounts) && accounts.length === 0) {
        // every connection is gone: DETACH imported rows (they become the user's own manual positions,
        // origin remembered) rather than delete. A user who chose "keep my positions" must never lose
        // them to a webhook that arrives before the keep-detach runs; explicit removal is a separate path.
        await admin.from("holdings").update({ source: "manual", external_id: null }).eq("user_id", uid).eq("source", "snaptrade");
        await admin.from("snaptrade_tokens").update({ institutions: [], last_sync_at: null }).eq("user_id", uid);
        await rawSave("accounts", null, accounts);
        results.push({ uid: uid.slice(0, 8), accounts: 0, positions: 0, cleared: true });
        continue;
      }
      if (!Array.isArray(accounts)) {
        await rawSave("accounts_error", null, accounts);
        results.push({ uid: uid.slice(0, 8), error: "accounts fetch failed", detail: accounts });
        continue;
      }
      await rawSave("accounts", null, accounts);
      const institutions = [...new Set(accounts.map((a) => String(a.institution_name ?? "")).filter(Boolean))];
      const { data: exRows } = await admin.from("snaptrade_exclusions").select("symbol").eq("user_id", uid);
      const excluded = new Set((exRows ?? []).map((r) => String(r.symbol)));
      const { data: preRows } = await admin.from("holdings").select("symbol, source, external_id").eq("user_id", uid);
      const preImported = new Set((preRows ?? []).filter((r) => r.source === "snaptrade").map((r) => String(r.symbol)));
      const manualSyms = new Set((preRows ?? []).filter((r) => r.source !== "snaptrade" && !String(r.symbol).startsWith("$")).map((r) => String(r.symbol)));
      const firstImport = preImported.size === 0;
      const added: string[] = [];
      const collisions: string[] = [];
      const addedBy: Record<string, string[]> = {};
      const skipped: Record<string, number> = {};   // option/future/cfd/cash/short/zero/unsupported/excluded: reported, never silent
      // reconnect hygiene: drop imported rows tied to SnapTrade accounts that no longer exist
      const liveAcctIds = new Set(accounts.map((a) => String(a.id ?? "")).filter(Boolean));
      for (const r of preRows ?? []) {
        if (r.source !== "snaptrade" || !r.external_id) continue;
        const m = String(r.external_id).match(/^st:([^:]+):/);
        if (m && !liveAcctIds.has(m[1])) await admin.from("holdings").delete().eq("user_id", uid).eq("external_id", r.external_id);
      }
      let positions = 0;
      const importAccounts = async (accts: Record<string, unknown>[]) => {
      for (const a of accts) {
        const acctId = String(a.id ?? "");
        if (!acctId) continue;
        const inst = String(a.institution_name ?? "Brokerage");
        const acctLabel = accountLabel(a);
        // Accounts created after May 2026 use the unified positions endpoint; older ones the legacy paths.
        const allPos = await get(`/accounts/${acctId}/positions/all`) as Record<string, unknown> | null;
        await rawSave("positions_all", acctId, allPos);
        let poss = allPos && Array.isArray((allPos as { results?: unknown }).results) ? (allPos as { results: Record<string, unknown>[] }).results : null;
        if (!poss) {
          const hold = await get(`/accounts/${acctId}/holdings`) as Record<string, unknown> | null;
          await rawSave("holdings", acctId, hold);
          poss = hold && Array.isArray(hold.positions) ? hold.positions as Record<string, unknown>[] : null;
        }
        if (!poss) { poss = await get(`/accounts/${acctId}/positions`) as Record<string, unknown>[] | null; await rawSave("positions", acctId, poss); }
        const bals = await get(`/accounts/${acctId}/balances`) as Record<string, unknown>[] | null;
        await rawSave("balances", acctId, bals);
        if (!Array.isArray(poss)) continue;   // never delete on a failed fetch
        const seen: string[] = [];
        const ensureHolding = async (sym: string, ext: string, nickname: string, qty: number, cost: number | null) => {
          const { data: h } = await admin.from("holdings").select("id, account_label").eq("user_id", uid).eq("external_id", ext).maybeSingle();
          let hid = h?.id as string | undefined;
          if (!hid) {
            // Re-adopt first: a kept/manual row for the same symbol+account+nickname (from "disconnect,
            // keep my positions", or a manual add) blocks a fresh insert on the user/symbol/account/nick
            // unique key. Reconnecting means that row becomes the synced one again, lots replaced by the
            // live import. Never a duplicate, never data loss.
            const { data: twin } = await admin.from("holdings").select("id").eq("user_id", uid).eq("symbol", sym).eq("account", "brokerage").eq("nickname", nickname).maybeSingle();
            if (twin?.id) {
              await admin.from("holdings").update({ source: "snaptrade", external_id: ext, account_label: acctLabel }).eq("id", twin.id);
              hid = twin.id as string;
            } else {
              const { data: ins } = await admin.from("holdings")
                .insert({ user_id: uid, symbol: sym, account: "brokerage", nickname, source: "snaptrade", external_id: ext, account_label: acctLabel }).select("id").maybeSingle();
              hid = ins?.id as string | undefined;
              if (!hid) {   // lost a concurrent race (the per-user lock makes this rare): read the winner
                const { data: again } = await admin.from("holdings").select("id").eq("user_id", uid).eq("external_id", ext).maybeSingle();
                hid = again?.id as string | undefined;
              }
            }
            if (hid && !sym.startsWith("$")) {
              added.push(sym);
              (addedBy[inst] = addedBy[inst] ?? []).push(sym);
              if (manualSyms.has(sym)) collisions.push(sym);
            }
          } else if (!h?.account_label) {
            await admin.from("holdings").update({ account_label: acctLabel }).eq("id", hid);
          }
          if (!hid) return;
          await admin.from("lots").delete().eq("holding_id", hid);
          await admin.from("lots").insert({ holding_id: hid, qty, cost_per_share: cost ?? 0, note: `Imported from ${nickname || inst}` });
          seen.push(ext);
        };
        for (const p of poss) {
          const m = normalizePosition(p, excluded);
          if ("skip" in m) { skipped[m.skip] = (skipped[m.skip] ?? 0) + 1; continue; }
          await admin.from("symbols").upsert({ symbol: m.sym, name: m.desc, exchange: m.exch, currency: m.ccy, kind: m.kind, ...(m.yahoo ? { yahoo: m.yahoo } : {}) }, { onConflict: "symbol", ignoreDuplicates: true });
          if (m.price !== null) {
            await admin.from("prices").upsert(
              { symbol: m.sym, price: m.price, currency: m.ccy, as_of: new Date().toISOString(), source: "snaptrade", updated_at: new Date().toISOString() },
              { onConflict: "symbol", ignoreDuplicates: true });   // price-sync owns existing rows
          }
          await ensureHolding(m.sym, `st:${acctId}:${m.sym}`, "", m.units, m.avg);
          positions++;
        }
        for (const b of Array.isArray(bals) ? bals : []) {
          const c = normalizeBalance(b);
          if (!c) continue;
          // cash / debt rows exist for the majors (migration 27); any other currency gets its symbol + pinned price on the fly
          await admin.from("symbols").upsert({ symbol: c.sym, name: `${c.debt ? "Debt" : "Cash"} (${c.ccy})`, exchange: c.debt ? "DEBT" : "CASH", currency: c.ccy, kind: c.debt ? "debt" : "cash" }, { onConflict: "symbol", ignoreDuplicates: true });
          await admin.from("prices").upsert({ symbol: c.sym, price: 1, prev_close: 1, change_pct: 0, currency: c.ccy, market_state: "regular", as_of: new Date().toISOString(), source: "pinned", updated_at: new Date().toISOString() }, { onConflict: "symbol", ignoreDuplicates: true });
          await ensureHolding(c.sym, `st:${acctId}:cash:${c.ccy}`, inst, c.amount, 1);
        }
        // remove positions that left this account
        const { data: mine } = await admin.from("holdings").select("id,external_id").eq("user_id", uid).eq("source", "snaptrade").like("external_id", `st:${acctId}:%`);
        const stale = (mine ?? []).filter((m) => !seen.includes(String(m.external_id)));
        for (const m of stale) await admin.from("holdings").delete().eq("id", m.id);
      }
      };
      await importAccounts(accounts);
      // SnapTrade's initial holdings pull from the brokerage is asynchronous: a connection made
      // moments ago can legitimately return zero positions. Retry briefly instead of trusting it.
      const { data: trow } = await admin.from("snaptrade_tokens").select("connected_at").eq("user_id", uid).maybeSingle();
      const freshConn = trow && Date.now() - +new Date(trow.connected_at) < 45 * 60000;
      let retries = 0;
      while (positions === 0 && freshConn && targets.length === 1 && retries < 4) {
        retries++;
        await new Promise((res) => setTimeout(res, 15000));
        const again = (await get("/accounts")) as Record<string, unknown>[] | null;
        if (Array.isArray(again)) { await rawSave("accounts", null, again); await importAccounts(again); }
      }
      if (!firstImport && (added.length > 0 || collisions.length > 0)) {
        await admin.from("snaptrade_events").insert({
          user_id: uid, kind: "import_delta",
          detail: { added, collisions, skipped, institution: institutions[0] ?? "your brokerage", by_institution: Object.entries(addedBy).map(([institution, symbols]) => ({ institution, symbols })) },
        }).then(() => {}, () => {});
      }
      await admin.from("snaptrade_tokens").update({ last_sync_at: new Date().toISOString(), institutions }).eq("user_id", uid);
      results.push({ uid: uid.slice(0, 8), accounts: accounts.length, positions, added: added.length, skipped, retries, institutions });
      // Late-arriving holdings (Daily-plan brokerages deliver the first positions by webhook minutes after the connect,
      // sometimes after the assessment already ran on an empty book): a sync that ADDED positions and was not started by
      // the orchestrator itself re-runs the book-changed chain, exactly like a run of manual adds.
      if (added.length > 0 && body.no_kick !== true && itok) {
        const kick = fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/brokerage-connected`, {
          method: "POST", headers: { "Content-Type": "application/json", apikey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, "x-internal-token": itok },
          body: JSON.stringify({ user_id: uid }),
        }).then((r) => r.text().catch(() => "")).catch(() => null);
        try { (globalThis as unknown as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime?.waitUntil?.(kick); } catch { /* ignore */ }
      }
    } catch (e) { results.push({ uid: uid.slice(0, 8), error: e instanceof Error ? e.message : String(e) }); }
    finally { await admin.rpc("release_user_lock", { p_user: uid }).then(() => {}, () => {}); }
  }
  return json({ ok: true, results });
});
