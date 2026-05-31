# Ollama vs oMLX — selectable AI backend — design

**Date:** 2026-05-31
**Branch:** `main`
**Components:** `install/macos/nomad` (backend selection, oMLX + proxy setup, MLX tiers, backend-aware commands), a vendored Ollama-compat proxy, `install/macos/compose.yaml` (unchanged for the admin), docs/man.
**Status:** Approved — implementation plan written (`docs/superpowers/plans/2026-05-31-omlx-selectable-backend.md`).

> **Reconciliation (post-approval, after inspecting upstream `eyalrot/ollama_openai`):**
> the plan supersedes this spec on four points — the proxy already implements
> `/api/show`, `/api/version`, and a 501 `/api/pull` (we *replace* the 501, not add);
> it has a built-in `MODEL_MAPPING_FILE` so the Ollama→mlx map is a single JSON
> source and the "parallel MLX tier table" is dropped (reuse `TIER_*`, DRY); oMLX
> serves a single `:8000`. See the plan's "Spec ↔ reality reconciliation" section.
>
> **Update (verified live on-device 2026-05-31, omlx 0.3.12):** the download API is
> `POST /admin/api/hf/download {"repo_id":...}` with progress via
> `GET /admin/api/hf/tasks` (needs `auth.skip_api_key_verification`); the proxy binds
> `0.0.0.0:11434`. Code corrected (`835cbc5`); see the §Security + §Components notes.

---

## Problem

NOMAD's AI runs on native Metal **Ollama** (LaunchAgent on :11434; the admin reaches
it via `OLLAMA_HOST=http://host.docker.internal:11434` and the Ollama Node SDK).
Some users want **oMLX** ([jundot/omlx](https://github.com/jundot/omlx), Apache-2.0) —
an Apple-MLX inference server with continuous batching, two-tier RAM+SSD KV
caching (big TTFT win on long RAG contexts), and native embeddings/rerank. The
admin is **Ollama-API-locked**, and oMLX speaks **OpenAI/Anthropic** APIs, so a
backend choice requires a translation layer.

## Decision (researched)

Offer an **install-time choice: Ollama or oMLX**, with **full parity** (the admin
behaves identically on either). Rather than fork the admin's AI layer, keep the
admin unchanged and put a **proxy on :11434** that translates Ollama API → oMLX's
OpenAI API. The proxy is adapted from [`eyalrot/ollama_openai`](https://github.com/eyalrot/ollama_openai)
(MIT) — it already implements `/api/chat`, `/api/generate`, `/api/tags` with
streaming; we add the Ollama-specific bits it lacks and route embeddings to a
native Ollama (see Embeddings below) rather than through oMLX.

**The recommended backend is hardware-detected**, the same way model tiers are
auto-picked from RAM. A `recommend_backend()` helper inspects the host and proposes
a default the user can accept or override:
- **Intel, or macOS < 15** → **Ollama** (oMLX needs Apple Silicon + Sequoia; not a
  choice on these Macs, it's forced).
- **Apple Silicon + macOS 15+** → **oMLX recommended** (its continuous batching +
  RAM/SSD KV cache are the better fit on capable hardware), with Ollama one
  keystroke away.

**Ship-gate (honest-engineering flag):** because this default routes most eligible
Macs through the newer proxy+oMLX path, the **on-device parity check (chat + RAG +
wizard-pull on a macOS 15 Apple-Silicon Mac) is a hard prerequisite** before the
oMLX-by-default recommendation goes live. If that verification slips, fall back to
recommending Ollama until it passes.

## Architecture

```
admin (Docker, Ollama SDK)
        │  OLLAMA_HOST=http://host.docker.internal:11434   (UNCHANGED)
        ▼
:11434  ┌─────────────────────────────────────────────┐
        │  backend = ollama  → native Ollama (today)    │
        │  backend = omlx    → ollama-compat proxy ─────┼──:8000──▶ oMLX (native MLX)
        └─────────────────────────────────────────────┘            OpenAI API + /api/hf/download
```

`:11434` has exactly one owner at a time, decided by `NOMAD_AI_BACKEND`:
- **ollama** → the `com.projectnomad.ollama` LaunchAgent (current behavior, untouched).
- **omlx** → the `com.projectnomad.ollama-proxy` LaunchAgent (proxy on :11434) +
  the `com.projectnomad.omlx` LaunchAgent (oMLX serving :8000) + a small
  `com.projectnomad.ollama-embed` LaunchAgent (native Ollama bound to
  `127.0.0.1:11435`, embed-only — see Embeddings below). The full native-Ollama
  `:11434` agent is unloaded; the proxy owns `:11434`.

The admin never knows which backend is live — it always talks to `:11434`.

## Components

### 1. Backend selection — `NOMAD_AI_BACKEND` (hardware-recommended)
- A `recommend_backend()` helper mirrors `auto_tier()`: it reads the chip
  (`machdep.cpu.brand_string` / Apple-Silicon detection already in the script) and
  macOS version (`sw_vers -productVersion`), and echoes the recommended backend:
  - Intel **or** macOS < 15 → `ollama` (oMLX ineligible).
  - Apple Silicon **and** macOS 15+ → `omlx`.
- `nomad install` shows the same **"Detected → Recommended, override allowed"** UX
  the tier picker uses, e.g.:
  > `Detected: Apple M4, 32 GB RAM, macOS 15.5 → Recommended backend: oMLX`
  > `[Enter] accept · type 'ollama' to use native Ollama instead`
  On an ineligible Mac it states plainly that only Ollama is available (no prompt).
- The choice is recorded as `NOMAD_AI_BACKEND=ollama|omlx` in
  `~/.config/project-nomad/.env`.
- Non-interactive override: `nomad install --backend omlx|ollama` (skips the prompt;
  still hard-stops if `omlx` is asked for on an ineligible Mac).
- Choosing oMLX on macOS < 15 → hard stop with a clear message (don't half-install).

### 2. oMLX setup (when `omlx`)
- Install: `brew tap jundot/omlx https://github.com/jundot/omlx && brew install omlx`
  (pin a version once verified). Requires Python 3.10+ (brew handles).
- Model dir on the data drive: `$NOMAD_DATA_ROOT/mlx-models` (parallel to
  `ollama-models`), so models live with the rest of the cold content and the
  drive stays unpluggable.
- LaunchAgent `com.projectnomad.omlx` runs `omlx serve --model-dir <…>/mlx-models
  --port 8000` (+ `--paged-ssd-cache-dir`, `--max-concurrent-requests` tuned to
  RAM like the Ollama env tuning). Loopback-bound (127.0.0.1:8000).

### 3. Ollama-compat proxy (vendored, adapted)
- Vendor `eyalrot/ollama_openai` (MIT) into `install/macos/omlx-proxy/` (pin
  commit; keep its LICENSE). Run via a `com.projectnomad.ollama-proxy`
  LaunchAgent: `uvicorn` on `127.0.0.1:11434`, `OPENAI_API_BASE_URL=http://127.0.0.1:8000/v1`.
- **What the proxy already covers:** `/api/tags` (← `/v1/models`), `/api/chat`,
  `/api/generate` (← `/v1/chat/completions`), streaming included — i.e. the admin's
  chat/generation needs.
- **Embeddings are routed, not translated** (hybrid decision): `/api/embeddings`
  is **passed through to the embed-only Ollama at `127.0.0.1:11435`** rather than to
  oMLX. This keeps embedding vectors **bit-identical to what is already indexed in
  Qdrant** (same `nomic-embed-text` weights), so switching backends never invalidates
  the index — no reindex in either direction. (On-device, confirm whether an
  MLX-converted `nomic-embed-text` yields equivalent vectors; if so, a later
  simplification can drop the embed-only Ollama and serve embeddings from oMLX.)
- **What we add** (the admin also calls these):
  - `POST /api/pull` → **route by model kind**: a chat/generation model maps to an
    mlx-community HF repo and drives oMLX's downloader; an embedding model
    (`nomic-embed-text`) is pulled on the embed-only Ollama. **Verified on-device
    contract (omlx 0.3.12):** the proxy `POST`s `{"repo_id": "<repo>"}` to
    `{oMLX}/admin/api/hf/download` (single `:8000` for admin + inference — no
    `:8080`), then polls `{oMLX}/admin/api/hf/tasks` and maps each task's
    `total_size`/`downloaded_size` to **real Ollama-style NDJSON**
    (`{status,total,completed}`) until `status==completed` → `success` (or `error`).
    The oMLX admin API requires `auth.skip_api_key_verification=true`, which the
    installer sets in `~/.omlx/settings.json` (oMLX binds loopback only).
  - `GET /api/version` → synthesize a static version response.
  - `POST /api/show` → synthesize from `/v1/models` metadata (the admin uses it
    for model details/params).
  - `GET /api/tags` → **deferred (parity gap, not built):** intended to union oMLX chat
    models (← `/v1/models`) with the embed-only Ollama's model. As shipped, upstream's
    `/api/tags` lists oMLX models only, as raw HF repo IDs. RAG is unaffected; the
    installed-models *view* differs. Tracked in `VERIFY_ON_DEVICE.md` §5 for an
    implement-or-accept decision on-device.

### 4. Ollama-tag → mlx-community name mapping
- A curated map for the tier models (e.g. `llama3.1:8b` →
  `mlx-community/Meta-Llama-3.1-8B-Instruct-4bit`, `nomic-embed-text` →
  an MLX embedding repo, etc.) plus a heuristic fallback (`<name>:<tag>` →
  search `mlx-community/<Name>-<size>-4bit`). Lives next to the tier map.

### 5. MLX model tiers
- A parallel tier→models table (mlx-community repos) mirroring `resolve_tier_models`,
  since oMLX uses MLX-format models, not Ollama GGUF tags. Pre-pulled at install
  via oMLX's download API so chat + RAG work out of the box.

### 6. Backend-aware `nomad` commands
- `nomad check` / status: report the active backend + the right service health
  (Ollama :11434 vs proxy :11434 + oMLX :8000).
- `nomad reset-ollama`: backend-aware — for `omlx`, reset the proxy + oMLX
  LaunchAgents (and keep the wedged-drive recovery logic, now applied to the
  mlx-models dir).
- `nomad backend [ollama|omlx]`: switch an existing install — flip
  `NOMAD_AI_BACKEND`, load the target LaunchAgents, unload the other, ensure the
  target's models, re-point nothing in the admin (still :11434).
- `nomad models`: backend-aware (Ollama tiers vs MLX tiers).

### Mutual exclusivity & data
- Only one thing binds :11434 (native Ollama in `ollama` mode; the proxy in `omlx`
  mode). The backend switch loads/unloads agents accordingly. In `omlx` mode the
  embed-only Ollama also runs, but on `127.0.0.1:11435`, so there is no `:11434`
  contention.
- oMLX (chat) models live at `$NOMAD_DATA_ROOT/mlx-models`; Ollama models stay at
  `$NOMAD_DATA_ROOT/ollama-models` — both coexist on disk so a switch back doesn't
  re-download. **Implementation refinement:** the embed-only Ollama keeps
  `nomic-embed-text` on the **internal disk** (`$SECRETS_DIR/embed-models`), not on
  the data drive, so RAG embeddings survive a data-drive unplug. Vectors are
  bit-identical to the Ollama-backend embeddings (same model weights, independent of
  disk), so the Qdrant index stays valid across a switch either way.

## Security (Maxim 8)
- **Binding (settled on-device):** the **proxy binds `0.0.0.0:11434`** — identical to
  the native Ollama agent the admin already reaches via `host.docker.internal`, so the
  network exposure equals today's Ollama backend (no worse). **oMLX (`:8000`) and the
  embed Ollama (`:11435`) bind `127.0.0.1` only** — they're reached solely by the proxy,
  host-local. (The earlier "everything loopback" goal was dropped for `:11434` because
  the container must reach it the same way it reaches Ollama.)
- **oMLX open admin:** the installer sets `auth.skip_api_key_verification=true` so the
  proxy can drive `/admin/api/hf/download` headlessly. Acceptable because oMLX binds
  loopback only — the open admin is reachable solely by host-local processes.
- No API key needed locally; if oMLX's `--api-key` is set, the proxy holds it
  host-side (never in the container/admin).
- The `/api/pull` bridge only accepts model names it can map to mlx-community
  repos (allow-listed prefixes) — no arbitrary URL/path passed to the downloader.

## Testing
- **Unit (sourceable helpers in `nomad`):** backend resolver (`NOMAD_AI_BACKEND`
  precedence), **`recommend_backend()` across the hardware matrix** (Intel→ollama,
  Apple-Silicon+macOS14→ollama, Apple-Silicon+macOS15→omlx — using the injectable
  `NOMAD_TEST_OS`/`NOMAD_TEST_ARCH` test seams), MLX tier resolver, Ollama-tag→MLX-repo
  mapper, macOS-15 gate.
- **Proxy:** a local test that, with oMLX running, hits the proxy's `/api/tags`,
  `/api/chat` (stream), `/api/embeddings`, and `/api/pull` and checks Ollama-shaped
  responses. (Runs on-device — needs oMLX.)
- **Parity check:** with `NOMAD_AI_BACKEND=omlx`, the admin's chat, Easy-Setup
  model pull, and RAG/Wikipedia query all work unchanged.
- **Regression:** the Ollama path (existing pre-oMLX behavior) unchanged on the Macs
  that still get it; existing suites green.
- **On-device (flagged for Chris):** full oMLX install on a macOS 15 Apple-Silicon
  Mac; chat + RAG + wizard-pull; `nomad backend ollama` round-trip.

## Files touched
- **Modify** `install/macos/nomad`: `recommend_backend()` helper + hardware-detected
  install prompt; backend selection + `.env` key; `step_omlx_native`
  + `step_omlx_proxy` + embed-only Ollama agent (`:11435`) (LaunchAgents); MLX tier
  map + name map; macOS-15 gate; backend-aware `check`/`reset-ollama`/`models`; new
  `cmd_backend`; help/usage.
- **Create** `install/macos/omlx-proxy/` (vendored proxy + our `/api/pull`,
  `/api/show`, `/api/version` additions + LICENSE + a pinned-version note).
- **Create** `install/macos/man/nomad-backend.1`; update `nomad.1` overview, README.
- **Unchanged:** `install/macos/compose.yaml` (admin still `:11434`).

## Resolved decisions (this review)
- **macOS floor:** oMLX eligibility gate is **macOS 15+ (Sequoia)** + Apple Silicon.
- **Recommended backend:** hardware-detected — oMLX whenever eligible, Ollama
  otherwise (see Decision + §1).
- **Embeddings:** **hybrid** — embeddings always run on native `nomic-embed-text`
  (embed-only Ollama on `:11435` under `omlx`), so the Qdrant index stays valid and
  no reindex is ever forced.
- **Download port + API (verified on-device 2026-05-31, omlx 0.3.12):** single
  `:8000` (admin + inference). Download = `POST /admin/api/hf/download {"repo_id":...}`;
  progress = `GET /admin/api/hf/tasks` (`total_size`/`downloaded_size`). Admin API
  requires `auth.skip_api_key_verification=true` (installer sets it; oMLX loopback-only).
  The earlier `:8080`-probe / `{"model_id"}` / `/v1/models`-poll assumptions were
  wrong and have been corrected in code (commit `835cbc5`).
- **Pull progress:** the bridge maps the oMLX task's real byte counts to Ollama NDJSON
  `total`/`completed`, so the Easy-Setup wizard bar advances with true progress.
- **Proxy bind:** `0.0.0.0:11434` (matches native Ollama for container reachability;
  same exposure as today's Ollama). oMLX + embed Ollama stay loopback.

## Still open (resolve in writing-plans / on-device)
- **MLX `nomic-embed-text` equivalence:** confirm whether an MLX-converted
  `nomic-embed-text` produces vectors equivalent to the GGUF one. If yes, a later
  simplification drops the embed-only Ollama and serves embeddings from oMLX (still
  no reindex). Until proven, the hybrid stands.
- **Proxy runtime:** vendor as a pinned git subtree/copy vs `pip install
  ollama-openai-proxy` + our patch — decide based on how cleanly we can add
  `/api/pull` (favor a small vendored copy we control).
- **`brew install omlx` footprint** + whether `brew services` or our own
  LaunchAgent is cleaner alongside the existing `com.projectnomad.*` pattern
  (lean to our LaunchAgent for consistency).
