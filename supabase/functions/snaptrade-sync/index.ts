// SnapTrade import: pulls accounts, positions, and cash for connected users and
// mirrors them into holdings/lots (source='snaptrade', keyed by external_id).
// Callable by the signed-in user, by a sibling function (service role + user_id),
// or by cron (service role, no body -> all connected users).
import { createClient } from "jsr:@supabase/supabase-js@2";

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
  const isService = (() => { try { return JSON.parse(atob(bearer.split(".")[1] ?? "")).role === "service_role"; } catch { return false; } })();
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
    try {
      const { data: row } = await admin.from("snaptrade_tokens").select("user_id,mode,st_secret,refresh_token,access_token,access_expires_at").eq("user_id", uid).maybeSingle();
      if (!row) { results.push({ uid: uid.slice(0, 8), error: "not connected" }); continue; }
      const commercial = (row as TokenRow).mode === "commercial" || !!(row as TokenRow).st_secret;
      let get: (path: string) => Promise<unknown>;
      if (commercial) {
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
      if (!Array.isArray(accounts)) {
        await rawSave("accounts_error", null, accounts);
        results.push({ uid: uid.slice(0, 8), error: "accounts fetch failed", detail: accounts });
        continue;
      }
      await rawSave("accounts", null, accounts);
      const institutions = [...new Set(accounts.map((a) => String(a.institution_name ?? "")).filter(Boolean))];
      let positions = 0;
      const importAccounts = async (accts: Record<string, unknown>[]) => {
      for (const a of accts) {
        const acctId = String(a.id ?? "");
        if (!acctId) continue;
        const inst = String(a.institution_name ?? "Brokerage");
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
          const { data: h } = await admin.from("holdings").select("id").eq("user_id", uid).eq("external_id", ext).maybeSingle();
          let hid = h?.id as string | undefined;
          if (!hid) {
            const { data: ins } = await admin.from("holdings")
              .insert({ user_id: uid, symbol: sym, account: "brokerage", nickname, source: "snaptrade", external_id: ext }).select("id").single();
            hid = ins?.id;
          }
          if (!hid) return;
          await admin.from("lots").delete().eq("holding_id", hid);
          await admin.from("lots").insert({ holding_id: hid, qty, cost_per_share: cost ?? 0, note: `Imported from ${nickname || inst}` });
          seen.push(ext);
        };
        for (const p of poss) {
          // unified shape: { instrument: {kind, symbol, description, currency, exchange}, units, price, cost_basis }
          // legacy shape:  { symbol: { symbol: {symbol, description, currency:{code}, exchange:{code}} }, units, price, average_purchase_price }
          const inst = p.instrument as Record<string, unknown> | undefined;
          const kindRaw = String(inst?.kind ?? "stock");
          if (["option", "future", "cfd"].includes(kindRaw)) continue;   // out of scope for the holdings book
          let sym = "", desc = "", ccy = "USD", exch = "US";
          if (inst) {
            sym = String(inst.symbol ?? inst.raw_symbol ?? "");
            desc = String(inst.description ?? sym);
            ccy = String((p.currency as string | undefined) ?? (inst.currency as string | undefined) ?? "USD");
            exch = String((inst.exchange as string | undefined) ?? "US");
          } else {
            const symObj = (p.symbol as Record<string, unknown> | undefined)?.symbol as Record<string, unknown> | string | undefined;
            sym = typeof symObj === "string" ? symObj : String((symObj as Record<string, unknown> | undefined)?.symbol ?? (symObj as Record<string, unknown> | undefined)?.raw_symbol ?? "");
            const meta = typeof symObj === "object" && symObj ? symObj as Record<string, unknown> : {};
            desc = String((meta as { description?: string }).description ?? sym);
            ccy = String(((meta as { currency?: { code?: string } }).currency?.code) ?? "USD");
            exch = String(((meta as { exchange?: { code?: string } }).exchange?.code) ?? "US");
          }
          const units = Number(p.units ?? p.fractional_units ?? 0);
          if (!sym || !(units > 0)) continue;
          const kind = kindRaw === "crypto" ? "crypto" : "equity";
          // class shares: SnapTrade "BRKB" -> Yahoo "BRK-B"
          const cls = sym.match(/^([A-Z]{2,})([AB])$/);
          const yahoo = cls && /class [ab]/i.test(desc) ? `${cls[1]}-${cls[2]}` : null;
          await admin.from("symbols").upsert({ symbol: sym, name: desc, exchange: exch, currency: ccy, kind, ...(yahoo ? { yahoo } : {}) }, { onConflict: "symbol", ignoreDuplicates: true });
          const price = p.price === null || p.price === undefined ? null : Number(p.price);
          if (price !== null && Number.isFinite(price)) {
            await admin.from("prices").upsert(
              { symbol: sym, price, currency: ccy, as_of: new Date().toISOString(), source: "snaptrade", updated_at: new Date().toISOString() },
              { onConflict: "symbol", ignoreDuplicates: true });   // price-sync owns existing rows
          }
          const avgRaw = p.cost_basis ?? p.average_purchase_price;
          const avg = avgRaw === null || avgRaw === undefined ? null : Number(avgRaw);
          await ensureHolding(sym, `st:${acctId}:${sym}`, "", units, avg);
          positions++;
        }
        for (const b of Array.isArray(bals) ? bals : []) {
          const code = String((b.currency as { code?: string } | undefined)?.code ?? "USD");
          const cash = Number(b.cash ?? 0);
          if (!Number.isFinite(cash) || cash === 0) continue;
          const sym = cash > 0 ? (code === "KRW" ? "$CASH.KRW" : "$CASH") : (code === "KRW" ? "$DEBT.KRW" : "$DEBT");
          await ensureHolding(sym, `st:${acctId}:cash:${code}`, inst, Math.abs(cash), 1);
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
      await admin.from("snaptrade_tokens").update({ last_sync_at: new Date().toISOString(), institutions }).eq("user_id", uid);
      results.push({ uid: uid.slice(0, 8), accounts: accounts.length, positions, retries, institutions });
    } catch (e) { results.push({ uid: uid.slice(0, 8), error: e instanceof Error ? e.message : String(e) }); }
  }
  return json({ ok: true, results });
});
