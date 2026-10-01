# LLM providers: MARA Cloud primary, SambaNova Cloud fallback

As of 2026-10-01 every edge function that calls a model goes through `supabase/functions/_shared/llm.ts`. The callers are ask, daily-brief, narrate (compose), insights-sync, warmup and `_shared/judge.ts`.

## SambaNova Cloud facts that matter here

These are from docs.sambanova.ai, read on 10/1.

- **API shape.** It is OpenAI-compatible at `https://api.sambanova.ai/v1/chat/completions`. It serves the same model ids we use: `MiniMax-M3` (listed as a *Preview* model) and `gpt-oss-120b` (*Production*). It also serves DeepSeek-V3.1/3.2, gemma-4-31B-it and Llama-3.3-70B.
- **Rate limits.** On the Developer tier (payment method linked) the limit is **60 RPM and 12,000 RPD per model**. Llama-3.3-70B gets 240 RPM. There is also a **20M tokens/day** cap across all models. The Free tier allows 20 requests per day per model, which is unusable as a fallback.
  - The docs say every response carries `x-ratelimit-*` headers. Our 10/1 test calls did not show them, so don't rely on them.
  - Preview models (M3) "have limited capacity and may be removed at short notice".
- **Errors.** Error bodies use the OpenAI format plus a `request_id`.
  - 400: bad parameter, `context_length_exceeded` or `model_not_found`. JSON mode failing returns **400 "Model did not output valid JSON"**.
  - 401: `invalid_authentication`.
  - 408: `request_timeout` (server load).
  - 410: `model_deprecated`.
  - 429: either `insufficient_quota` (tier limit) or `queue_full` (too many in flight, retry after a short delay).
  - 500: `internal_server_error`.
  - 503: `maintenance`.
- **JSON mode.** `response_format: {type: "json_object"}` is supported. `json_schema` is also supported (`strict` is accepted, best-effort).
- **Reasoning.** gpt-oss returns its reasoning in `message.reasoning`. Its `content` can be null when `max_tokens` is small, so the judge accepts reasoning-only answers. "Reasoning: low" in the system prompt keeps it short.
- **Streaming.** `stream: true` is supported, and chunks can carry several tokens. We don't stream: every caller needs the whole JSON.
- **Unsupported parameters.** A few OpenAI parameters are ignored. `logit_bias` and `seed` are refused on some models.

## How the client behaves

| Situation | What happens |
| - | - |
| MARA healthy | MARA answers. SambaNova is only touched when a hedge timer fires. |
| Network error, timeout, 408, 429, any 5xx, unreadable body, empty content | Fail over to SambaNova with the same request and model, inside the caller's budget. |
| 400 / 401 / 403 / 404 / 410 / 422 | **No failover.** Our request is wrong, so the call is logged as `LLM REQUEST ERROR`. |
| 400 "did not output valid JSON" | Reason `model_json`, no failover. The caller's own M3 to gpt-oss fallback handles it. |
| Body stalls after the headers | Bounded. The whole body is read under the attempt timer. This was the 10/1 Ask outage. |
| 3 failovers in a row (per isolate) | Breaker opens. MARA is skipped for 60s, then one half-open probe. |

**Hedging** is set per caller from latencies measured on 10/1 on the Ask prompt. MARA M3: p50 5.4s, p95 about 9.5s. SambaNova M3: 8.5-17s. MARA gpt-oss: about 4.5s. SambaNova gpt-oss: 4-7s.

| Caller | Hedge | Why |
| - | - | - |
| `ask.primary` (M3) | none | SambaNova M3 is slower than Ask's own gpt-oss lane, which is the real hedge. |
| `ask.fast` (gpt-oss) | 0s, both providers at once | The lane starts only when M3 is late or MARA is out, so the router is already suspect. The start adapts per isolate: p80 of M3's Ask latency minus the gpt-oss lane's p50, clamped to 2.5-4s, 3s until 5 samples (it was a fixed 4s, 7s before that). |
| `ask.judge` | 2s, or 0s once the router is suspect | MARA's gpt-oss judge takes 0.9-2s. The cap is 4.5s with one retry (it was 6s, which was the healthy-case p95 tail). |

Batch callers (brief, insights, narrate, warmup) don't hedge; they fail over in sequence, so a healthy MARA costs nothing extra.

**Rate limits and the other model.** A SambaNova 429 (`insufficient_quota` or `queue_full`) never fails over to SambaNova again. With `altModel` set, the call is retried once on that model (gpt-oss) on both providers, inside the same budget. Without it the 429 comes back fast and the caller's own fallback answers.
- Ask: an M3 lane that gets a 429 starts the gpt-oss lane at once; if that 429s too, the code-built answer ships.
- daily-brief: M3 calls carry `altModel: gpt-oss-120b` and `snRpm: 10`. That is a per-isolate token bucket per model (burst 4) in front of SambaNova. The sweep fans out to at most 6 users per run, so 6 isolates x 10 RPM stays inside 60 RPM per model. A call that can't get a token within 8s is a local 429 and takes the same path.

**Budget vs timeout (batch callers).** `timeoutMs` caps MARA's attempt; `budgetMs` is the whole call. insights-sync's gpt-oss calls give MARA 45s of a 75s budget, and its 9s fact-check has an 18s budget. Before, budget equalled timeout, so a MARA timeout left SambaNova no time.

**Hard deadline.** Ask ships the code-built answer it already has, never the apology, whenever the book was read before the deadline.

**Logs.** Each call writes one JSON line to the function logs, with no content and no keys:
`{"llm": caller, "model", "provider", "ms", "ok", "failover"?, "reason"?, "status"?, "hedged"?, "breaker"?}`

**Configuration.**
- `SAMBANOVA_API_KEY` and `SAMBANOVA_BASE_URL` are function secrets. The MARA key comes from the vault or env as before.
- A local `MARA_BASE_URL` override (fixtures) turns SambaNova off unless `SAMBANOVA_BASE_URL` is also set.
- Locally, read the SambaNova key from `~/.private_keys/sambanova.txt`. A stale `SAMBANOVA_API_KEY` in the shell env returns 401.

**Testing the fallback on prod.**
- Ask: send the header `x-llm-fallback: force` together with a valid `x-internal-token`. User requests can't set it.
- daily-brief: send `llm_force_fallback: true` in the body, also with the internal token.

## Watch

- **Rate limits during a long MARA outage.** The breaker routes every call to SambaNova. The daily-brief bucket is per isolate, not global: overlapping crons (the */30 backfill, brief-retry) can still add up past 60 RPM. A 429 then moves to gpt-oss, and a gpt-oss 429 falls to the brief's compact or code-built text.
- **The adaptive lane start needs a warm isolate.** On 10/1 every measured Ask ran with the 3s default: prod spreads requests over isolates that each served fewer than 5 Asks.
- **M3 is a SambaNova Preview model.** If it is withdrawn (410), M3 calls lose their fallback. gpt-oss is Production.
