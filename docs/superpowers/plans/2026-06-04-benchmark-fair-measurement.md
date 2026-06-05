---
type: implementation-plan
status: ready-to-execute
date: 2026-06-04
project: project-nomad (macOS/Apple-Silicon fork)
feature: Fair AI-benchmark measurement (oMLX vs Ollama apples-to-apples)
decided_by: Chris (2026-06-04) — "implement the fair-measurement fix"
tags: [nomad, benchmark, omlx, ollama, measurement, leaderboard]
---

# Fair AI-benchmark measurement

**Goal:** Make the AI benchmark measure the same physical quantity on every backend so oMLX (Apple MLX) is scored fairly against native Ollama.

## Root cause (confirmed from code — see investigation 2026-06-04)
The benchmark computes `tok/s = eval_count / eval_duration` and trusts the backend's reported durations (`admin/app/services/benchmark_service.ts:773-786`). But the two backends define those fields differently:
- **Native Ollama:** `eval_duration` is **decode-only** (load → `load_duration`, prefill → `prompt_eval_duration`).
- **oMLX proxy:** fabricates `eval_duration` from the **full upstream wall-clock** — load + prefill + decode (`omlx-proxy/vendor/src/translators/chat.py:661-663` sets `eval_duration = elapsed_ns`, `prompt_eval_duration = 0`).

So oMLX's denominator is inflated → tok/s deflated. Compounded by: (a) oMLX **cold-loads** the model per run (no keep-warm; Ollama runs `OLLAMA_KEEP_ALIVE=24h`) and the benchmark doesn't warm up, so model-load lands inside that already-wrong duration; (b) `prompt_eval_duration = 0` is falsy → oMLX TTFT falls into a `totalTime/2` estimate, double-penalizing it in the score (`ai_ttft` weight 0.10). Net: oMLX looks "way slower" when it isn't.

## Fix — client-side streaming measurement + warm-up
Proxy streaming is supported for `/api/generate` (`omlx-proxy/.../routers/chat.py:346` + `stream_response`/`StreamingResponse`), and native Ollama streams it too. So:

1. **Warm-up pass** — one untimed `/api/generate` (`num_predict: 1`) before timing, so model-load is excluded for BOTH backends.
2. **Timed run is streaming** (`stream: true`, axios `responseType: 'stream'`). Parse the NDJSON chunks and measure on the client:
   - **TTFT** = first content chunk arrival − request start (prefill only; load excluded by warm-up).
   - **tok/s** = tokenCount / (last chunk − first chunk), where tokenCount = the final chunk's `eval_count` if present, else the streamed content-chunk count.
   - **Ignore** the backends' self-reported `eval_duration`/`prompt_eval_duration` entirely.

This measures the same wall-clock physical quantity for every backend, bypassing the proxy's fabricated durations.

## Task — single file
**Modify:** `admin/app/services/benchmark_service.ts` — `_runAIBenchmark()` (~lines 754-798), the inference + measurement block. Keep the setup (service URL, `/api/tags` check, model download) and the outer `try/catch`.

- [ ] Replace the non-streaming `axios.post(stream:false)` + `eval_count/eval_duration` math with: warm-up pass → streaming `axios.post(stream:true, responseType:'stream')` → NDJSON chunk-timestamp measurement (TTFT + tok/s as above).
- [ ] Use plain `axios.post` (not `benchRequestWithRetry`) for the streaming call so the retry wrapper can't consume the stream body; connectivity is already validated by the `/api/tags` check + warm-up.
- [ ] Throw if no tokens streamed (so a dead backend still errors cleanly via the outer catch).
- [ ] **Verify:** `cd admin && npm run typecheck` clean.

## Verification
- `npm run typecheck` clean.
- **On the mini (operator):** run the benchmark on oMLX and on Ollama for the same model — the tok/s should now be in the same ballpark (oMLX ≥ Ollama on Apple Silicon), not "way slower". Confirm TTFT is a real small number on both.

## Notes / impact
- **Leaderboard comparability resets:** scores produced after this change measure differently than before, so historical leaderboard entries aren't directly comparable to new ones (especially old oMLX entries, which were unfairly low). This is intended — the new number is the honest one.
- Admin-only change → ships via the GHCR `:edge` rebuild on push → `nomad upgrade`.
- No proxy change needed (streaming already supported). A deeper proxy fix (report decode-only durations) is unnecessary once the client measures wall-clock directly.
