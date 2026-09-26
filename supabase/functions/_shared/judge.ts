// The compliance judge as a shared call (round 9 A in Ask; r10: card bullets too). A fast model reads numbered items
// against JUDGE_POLICY and returns the ones that give advice, name a product to buy, pass a verdict in the app's voice or
// forecast. Returns the flagged 0-based indices, or null when it did not answer usably (the caller decides how to fail).
import { JUDGE_POLICY } from "./intel.ts";

export type JudgeResult = { flags: Set<number> | null; status: "ok" | "timeout" | "error" | "unparseable" | "skipped" };

export function parseJudge(txt: string, n: number): Set<number> | null {
  const all = [...String(txt ?? "").matchAll(/\{[^{}]*"flag"\s*:\s*\[[^\]]*\][^{}]*\}/g)];
  if (!all.length) return null;
  try {
    const o = JSON.parse(all[all.length - 1][0]);
    if (!Array.isArray(o.flag)) return null;
    return new Set((o.flag as unknown[]).map(Number).filter((k) => Number.isInteger(k) && k >= 1 && k <= n).map((k) => k - 1));
  } catch { return null; }
}

export async function callJudge(key: string, items: string[], ms: number, model = "gpt-oss-120b"): Promise<JudgeResult> {
  if (!items.length) return { flags: new Set(), status: "ok" };
  if (!key || ms < 1200) return { flags: null, status: "skipped" };
  const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), ms);
  let aborted = false;
  const r = await fetch(`${Deno.env.get("MARA_BASE_URL") ?? "https://api.cloud.mara.com"}/v1/chat/completions`, {
    signal: ac.signal, method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, temperature: 0, max_tokens: 600, response_format: { type: "json_object" },
      messages: [{ role: "system", content: `Reasoning: low\n\n${JUDGE_POLICY}` }, { role: "user", content: `Items:\n${items.map((x, i) => `${i + 1}. ${x}`).join("\n")}\n\nReturn ONLY {"flag": [item numbers]}.` }] }),
  }).catch((e) => { aborted = e instanceof DOMException && e.name === "AbortError"; return null; });
  if (!r || !r.ok) { clearTimeout(timer); return { flags: null, status: aborted ? "timeout" : "error" }; }
  const out = await r.json().catch(() => null);
  clearTimeout(timer);
  if (!out) return { flags: null, status: "timeout" };
  const msg = out?.choices?.[0]?.message ?? {};
  const flags = parseJudge(String(msg.content || msg.reasoning_content || msg.reasoning || ""), items.length);
  return flags ? { flags, status: "ok" } : { flags: null, status: "unparseable" };
}
