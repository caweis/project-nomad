# oMLX On-Device Verification — Ship-Gate Checklist

The installer recommends oMLX by default on eligible Macs (Apple Silicon + macOS 15).
This means the majority of eligible users are routed through the newer proxy + oMLX path
on first install, without ever seeing an Ollama prompt. Because the integration — brew tap,
launchd, the oMLX runtime, HuggingFace pulls, and RAG parity — can only be exercised on
real hardware, this checklist is a hard prerequisite before that default ships.

**If any item below fails, set the installer default back to Ollama
(`hw_recommended_backend()` returns `ollama` unconditionally) until the issue is resolved
and every box is checked.**

---

## 1. oMLX install + serve surface

- [ ] `brew tap jundot/omlx https://github.com/jundot/omlx && brew install omlx` completes
  without errors; the installed binary resolves as `omlx` and `command -v omlx` prints its
  path (typically `/opt/homebrew/bin/omlx`).

- [ ] Confirm that `omlx serve` accepts all three flags the LaunchAgent plist passes:
  `--model-dir`, `--paged-ssd-cache-dir`, and `--max-concurrent-requests`. Run
  `omlx serve --help` and verify every flag name matches exactly. If any name differs,
  fix `step_omlx_native` in `install/macos/nomad` before shipping.

- [ ] Confirm that oMLX listens on **:8000** for both inference (`GET /v1/models`,
  `POST /v1/chat/completions`) and the download API (`POST /api/hf/download`). The proxy
  probes `:8000` first then `:8080`; verify which port oMLX actually binds in practice
  and confirm the probe resolves against the right one. Update `NOMAD_OMLX_BASE` /
  `NOMAD_OMLX_BASE_FALLBACK` in `step_omlx_proxy` if the default differs.

---

## 2. Python / proxy environment

- [ ] `step_omlx_proxy` creates the venv with `/usr/bin/python3`. Run
  `/usr/bin/python3 --version` and confirm the system Python version is in the **3.9–3.12**
  range. The pins in `vendor/requirements.txt` (`fastapi==0.104.1`, `pydantic==2.5.0`,
  `uvicorn[standard]==0.24.0`, etc.) have no prebuilt wheels for Python 3.13+ and will fail
  to build. If the on-device system Python is 3.13 or later, either relax the pins to
  version ranges compatible with newer Python, or add an explicit version guard in
  `step_omlx_proxy` that `die`s with a clear message before pip is invoked.

- [ ] Confirm the proxy comes up under launchd after install: verify label
  `com.projectnomad.ollama-proxy` is loaded (`launchctl list | grep nomad`),
  uvicorn binds `127.0.0.1:11434` (`lsof -nP -iTCP:11434 -sTCP:LISTEN`), and
  `~/Library/Logs/nomad-omlx-proxy.err.log` shows a clean startup — no import errors,
  no port-binding failures, and no Python tracebacks.

---

## 3. The `/api/pull` bridge (download)

- [ ] Confirm the actual request body shape oMLX expects for `/api/hf/download`. The bridge
  sends `{"model_id": "<repo>"}` (see `nomad_pull.py` → `_hf_download`). Run a manual
  `curl -X POST http://127.0.0.1:8000/api/hf/download -H 'Content-Type: application/json'
  -d '{"model_id":"mlx-community/Llama-3.2-3B-Instruct-4bit"}'` and confirm oMLX accepts
  it. If oMLX expects a different field name (e.g. `repo`, `name`, `hf_repo`), fix the
  `json={"model_id": repo}` call in `_hf_download` in `nomad_pull.py`.

- [ ] Confirm whether `/api/hf/download` streams progress or is fire-and-forget. The bridge
  currently does not consume the response body — it fires the POST, checks the status code,
  then polls `/v1/models` every 3 s until the model appears. If oMLX returns progress as a
  streaming body, the bridge is compatible as-is (it ignores the stream). However, confirm
  the Easy-Setup wizard's progress bar actually advances during a pull: the bridge emits
  bare `{"status":"downloading","digest":"<repo>"}` NDJSON every 3 s. If the wizard bar
  stalls (it may expect Ollama's `{"status":"downloading","total":<bytes>,"completed":<bytes>}`
  fields), add approximate `total` / `completed` values to the polling NDJSON in
  `_pull_stream` — even a static `total` with an incrementing `completed` is enough to
  move a progress bar.

- [ ] Confirm the `_hf_download` success-code policy matches oMLX's real behavior. The
  bridge treats any `status_code < 400` or `status_code == 409` as success (409 = already
  downloading). Run at least one pull against an already-downloaded model and at least one
  against a fresh model; verify the codes actually returned by oMLX. If oMLX uses other
  codes (e.g. `200` with a body indicating failure, or a non-409 "already present" code),
  update the condition in `_hf_download`.

---

## 4. Model map accuracy (HuggingFace)

- [ ] For each `mlx-community/...` repo in `config/model_map.json`, verify the repo
  actually exists and resolves on HuggingFace. The following entries were filled in by
  naming convention and have **not** been pulled on-device — confirm each one or replace
  with the correct repo ID:
  - `qwen2.5-coder:7b` → `mlx-community/Qwen2.5-Coder-7B-Instruct-4bit`
  - `qwen2.5-coder:14b` → `mlx-community/Qwen2.5-Coder-14B-Instruct-4bit`
  - `qwen2.5-coder:32b` → `mlx-community/Qwen2.5-Coder-32B-Instruct-4bit`
  - `gemma3:4b` → `mlx-community/gemma-3-4b-it-4bit`
  - `gemma3:12b` → `mlx-community/gemma-3-12b-it-4bit`
  - `gemma3:27b` → `mlx-community/gemma-3-27b-it-4bit`
  - `mistral-small:24b` → `mlx-community/Mistral-Small-3.1-24B-Instruct-2503-4bit`
  - `qwen3:14b` → `mlx-community/Qwen3-14B-4bit`
  - `qwen3:32b` → `mlx-community/Qwen3-32B-4bit`
  - `qwen2.5:72b` → `mlx-community/Qwen2.5-72B-Instruct-4bit`
  - Note: `deepseek-r1:70b` → `mlx-community/DeepSeek-R1-Distill-Llama-70B-4bit` was
    already corrected; treat it as verified.

---

## 5. End-to-end parity (the core gate)

- [ ] Run a fresh `nomad install --backend omlx` on a macOS 15 Apple-Silicon Mac (clean
  state, no prior install). Confirm all three agents come up and `nomad check stack` is
  all-green: proxy on :11434, oMLX on :8000, embed-only Ollama on :11435.

- [ ] Confirm admin chat works end-to-end through the proxy path: send a prompt through the
  admin UI, verify a coherent response arrives, and confirm the request visibly flowed
  through `:11434` (check `nomad-omlx-proxy.out.log` for a logged inference request).

- [ ] Confirm RAG / Wikipedia queries return grounded answers: run a factual question that
  requires retrieval, verify the answer cites an article, and confirm the embedding request
  hit the embed-only Ollama on `:11435` (check `nomad-ollama-embed.out.log` or equivalent).

- [ ] Confirm the Easy-Setup wizard model pull completes successfully: trigger a pull for at
  least one small model (e.g. `llama3.2:3b` → `mlx-community/Llama-3.2-3B-Instruct-4bit`),
  watch the progress bar advance and reach 100 %, and verify the model appears in
  `curl http://127.0.0.1:8000/v1/models`.

- [ ] Confirm `nomad backend ollama` then `nomad backend omlx` round-trips cleanly: switch
  to Ollama, run a chat and a RAG query to confirm both work, then switch back to oMLX and
  repeat. Verify there is **no Qdrant reindex** on either switch and that the vector store
  answers correctly after each transition.

---

## 6. Embeddings simplification (optional — spec's "still open" item)

- [ ] Investigate whether an MLX-converted `nomic-embed-text` model produces vectors
  equivalent (cosine similarity ≥ 0.99 on a standard test corpus) to the GGUF version
  served by the embed-only Ollama on :11435. Document the method and result in this
  checklist. Only if equivalence is demonstrated should the embed-only Ollama be retired
  in favor of a pure-oMLX embedding path; until then the hybrid configuration
  (embed on internal-disk Ollama :11435, inference on oMLX :8000) stands.

---

## 7. Docs accuracy follow-up

- [ ] The man page `nomad-backend.1` states that oMLX "Delivers higher throughput on Apple
  Silicon." Run a concrete benchmark on-device: measure tokens-per-second for at least one
  shared model (e.g. Llama 3.2 3B) under both backends and record the result here. If oMLX
  is measurably faster, keep the wording and document the benchmark numbers. If the
  difference is within noise or untested on the target hardware, soften the claim to
  design-intent wording, e.g. "Designed for higher throughput on Apple Silicon via the MLX
  framework."

---

## Closing

Until every box above is checked, the safe configuration is **Ollama recommended by
default**. Flipping `hw_recommended_backend()` in `install/macos/nomad` to return `omlx`
on eligible hardware is gated on this checklist passing in full on a macOS 15 Apple-Silicon
Mac. No partial passes — every item must resolve before the default ships.
