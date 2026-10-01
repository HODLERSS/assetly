// The compliance judge as a shared call (round 9 A in Ask; r10: card bullets too). A fast model reads numbered items
// against JUDGE_POLICY and returns the ones that give advice, name a product to buy, pass a verdict in the app's voice or
// forecast. Returns the flagged 0-based indices, or null when it did not answer usably (the caller decides how to fail).
import { JUDGE_POLICY } from "./intel.ts";
import { chat } from "./llm.ts";

export type JudgeResult = { flags: Set<number> | null; status: "ok" | "timeout" | "error" | "unparseable" | "skipped"; detail?: string };

export function parseJudge(txt: string, n: number): Set<number> | null {
  const all = [...String(txt ?? "").matchAll(/\{[^{}]*"flag"\s*:\s*\[[^\]]*\][^{}]*\}/g)];
  if (!all.length) return null;
  try {
    const o = JSON.parse(all[all.length - 1][0]);
    if (!Array.isArray(o.flag)) return null;
    return new Set((o.flag as unknown[]).map(Number).filter((k) => Number.isInteger(k) && k >= 1 && k <= n).map((k) => k - 1));
  } catch { return null; }
}

export async function callJudge(key: string, items: string[], ms: number, model = "gpt-oss-120b", opts: { forceFallback?: boolean } = {}): Promise<JudgeResult> {
  if (!items.length) return { flags: new Set(), status: "ok" };
  if (ms < 1200) return { flags: null, status: "skipped" };   // no MARA key: SambaNova alone still judges
  // shared client (10/1): MARA with SambaNova as the hedged fallback; the whole body is read under the timer
  const res = await chat({ model, temperature: 0, max_tokens: 2500, response_format: { type: "json_object" },
    messages: [{ role: "system", content: `Reasoning: low\n\n${JUDGE_POLICY}` }, { role: "user", content: `Items:\n${items.map((x, i) => `${i + 1}. ${x}`).join("\n")}\n\nReturn ONLY {"flag": [item numbers]}.` }] },
    { caller: "judge", maraKey: key, timeoutMs: ms, hedgeMs: Math.min(1500, ms / 2), acceptReasoning: true, forceFallback: opts.forceFallback });
  if (!res.ok) return { flags: null, status: res.reason === "timeout" ? "timeout" : "error", detail: `${res.reason} ${res.status ?? ""} ${res.detail}`.slice(0, 160) };
  const flags = parseJudge(res.content, items.length);
  return flags ? { flags, status: "ok" } : { flags: null, status: "unparseable" };
}
