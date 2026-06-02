# Design Spec — Native Ollama co-existence + local AI clients (chat GUI + coding agent)

- **Status:** Draft for review — **v2** (expanded from coexistence-only to two layers)
- **Date:** 2026-06-02
- **Scope:** macOS/Apple-Silicon distribution layer — `install/macos/**`, `admin/**`
- **Mode affected:** `NOMAD_AI_BACKEND=omlx` primarily (`ollama` mode largely unaffected)

## 1. Goal

Two complementary layers:

- **Layer 1 — backend co-existence:** run a full general-purpose native Ollama (CLI + your existing models) *alongside* nomad's oMLX stack. Native Ollama owns the standard `:11434`; the oMLX-compat proxy and the admin's `OLLAMA_HOST` move to `:11436`.
- **Layer 2 — local AI clients:** make it trivial to run a **ChatGPT-style chat GUI** (Open WebUI) **and** a **Claude-Code-like coding agent** (OpenCode/Aider) over your local models. nomad **configures** (reachable endpoints + ready-to-paste client configs + a RAM-advised, **user-defined** model menu + docs); **you install the clients**.

## 2. User intent (from brainstorming)

- "Both, fully independent" backends (native Ollama + oMLX).
- A chat GUI (GPT-like) **and** a coding agent (Claude-Code-like agentic file/command ops) over local models — "both."
- Use **already-downloaded models** where possible: `llama3.1` lives in `~/.ollama/models`; nomad's data-root `ollama-models` dir is empty.
- Scope: **configure, not bundle** — nomad wires it up + recommends; the user installs the clients.
- RAM is **detected at install** → drives the model advice (no fixed number).
- The coding model is **user-defined** — nomad advises by RAM + capability; the **user chooses**; nomad never silently forces or swaps a model.
- UI: BYO, documented (no bundling).

## 3. Current state (constraints)

- Two **mutually-exclusive** AI backends selected by `NOMAD_AI_BACKEND`; both compete for `:11434`.
- A **general-purpose Ollama already exists** (`step_ollama_native` / `com.projectnomad.ollama`, `0.0.0.0:11434`, `OLLAMA_MODELS` → `$NOMAD_DATA_ROOT/ollama-models`, fallback `~/.ollama/models`). In omlx mode it is **deliberately unloaded** and the proxy squats `:11434`.
- omlx-mode daemons: `omlx` (`127.0.0.1:8000`), `ollama-proxy` (`0.0.0.0:11434`, Ollama→OpenAI translation, upstream `:8000/v1` + `NOMAD_EMBED_URL=:11435`), `ollama-embed` (`127.0.0.1:11435`, `OLLAMA_MODELS=$SECRETS_DIR/embed-models`, RAG only).
- The **admin understands only one `OLLAMA_HOST`** (`http://host.docker.internal:11434`, hardcoded in `compose.yaml` ×2 + the `ai.remoteOllamaUrl` kv_store seed). It chats/embeds/benchmarks against whatever speaks the Ollama API there.

## 4. Decisions

### Layer 1 — backend (unchanged from v1)

| # | Decision | Rationale | Rejected |
|---|----------|-----------|----------|
| D1 | Native Ollama owns `:11434`; proxy → `:11436` (Approach ①) | CLI/UIs expect `localhost:11434`; the env-configured internal proxy yields the standard port. | ② Ollama on a side port (ongoing `OLLAMA_HOST` friction). |
| D2 | Admin `OLLAMA_HOST` → `:11436` (follows proxy) — **Option A** | Admin keeps chatting with **oMLX**, which is what `NOMAD_AI_BACKEND=omlx` means. | **B** (admin on `:11434` → silently chats native Ollama; defeats oMLX). |
| D3 | Coexisting Ollama `OLLAMA_MODELS=~/.ollama/models`, configurable | Where `llama3.1` already is — zero re-download/move; standard location. | data-root dir (empty). |
| D4 | Bind default loopback **in omlx mode**; **mode-aware** | Least exposure; the *same* agent stays `0.0.0.0` in ollama mode (admin reach). Toggle to `0.0.0.0` when a Docker client needs it (see D10). | `0.0.0.0` default in omlx mode (needless exposure). |
| D5 | Reuse `com.projectnomad.ollama`; make it **coexist** (not mutually exclusive) in omlx mode | Already a general Ollama with rename-safe model resolution. | New parallel agent (dup). |
| D6 | UI/clients: **BYO**, documented; no bundle | Keeps build small; the ecosystem is rich (see Layer 2). | Bundling (Approach ③). |

### Layer 2 — local AI clients

| # | Decision | Rationale | Rejected |
|---|----------|-----------|----------|
| D7 | Scope = **configure, not bundle** | User's choice; smaller, flexible build. nomad delivers endpoints + configs + model menu + docs, not running clients. | Fully-managed (bundle Open WebUI + agent + auto-pull). |
| D8 | Clients can target **both** engines; nomad ships configs for each. Recommended pairing: chat GUI → existing models on Ollama `:11434`; coding agent → oMLX `:8000` (continuous batching; purpose-built for OpenCode/Codex). | Honors "use already-downloaded models" for chat while giving the agent the better engine; user can mix freely. | Forcing a single engine. |
| D9 | Coding model is **USER-DEFINED**. nomad uses install-detected RAM to present a *menu* of viable options per tier with honest capability notes (`llama3.1:8b` weak for agentic coding; Qwen2.5-Coder / Devstral as coding-tuned options), but the **user selects**; nomad wires configs to the chosen model and optionally pulls it. **No forced/auto model.** | Per Chris — user-defined. | nomad auto-picking/auto-pulling a model. |
| D10 | Docker-client reachability: Open WebUI in Docker reaches host engines via `host.docker.internal`, requiring the target to bind reachably. The configure step handles/documents the bind (expose oMLX, or flip the general Ollama to `0.0.0.0` per D4) **only when a Docker client is used**. Host-side agents use loopback. | Correctness for a Dockerized chat GUI without needless default exposure. | Always `0.0.0.0`. |
| D11 | Client presets: chat GUI = **Open WebUI**; coding agent = **OpenCode** (primary; oMLX one-click-configures it) or **Aider** (alt). Configs adaptable to Cline/Continue. | Best-fit, documented. | Picking one and excluding alternatives. |
| D12 | Delivery: a **`nomad ai-clients`** helper (working name) that prints the RAM-advised model menu + ready-to-paste configs + the Docker-bind note; plus a Mac doc + man entry. | Single discoverable entry point; configure-scope. | Scattering setup across docs only. |

## 5. Target architecture (omlx mode)

```
Layer 1 (backend):
  you (ollama CLI / native UI) ──► 127.0.0.1:11434  com.projectnomad.ollama   (your models, OLLAMA_MODELS=~/.ollama/models)
  admin (Docker) ──:11436──►       :11436            com.projectnomad.ollama-proxy ──► :8000 oMLX ──► :11435 embed (RAG)

Layer 2 (clients — you install, nomad configures):
  Open WebUI (Docker)  ──host.docker.internal:11434──►  native Ollama (chat over your existing models)
  OpenCode / Aider (host CLI) ──127.0.0.1:8000──►       oMLX (your USER-CHOSEN coding model)
        (both targets configurable; nomad ships configs for each engine)
```

## 6. Change surface

**Layer 1** (line numbers per the 2026-06-02 audit; re-verify at edit time):
- Proxy `11434→11436`: plist `nomad:1967`; omlx-mode probes/waits `~684/687/1946/2007/2008/5053/5076`.
- Admin repoint: `compose.yaml:97,161` → `:11436`; `nomad:3537` seed + a one-time idempotent `UPDATE` (seed is `IF NULL/''`-guarded at `:3539`, won't auto-update); `admin/.env.example:24-25`, `admin/start/env.ts:70` docs. No admin code change.
- Run general Ollama in omlx mode: add to omlx install (`~3675-3678`), `cmd_backend` omlx branch (`~5114`), `_reset_omlx_stack`; **remove** it from omlx bootout loops (`~5103-5108`, `~5060-5066`); set its `OLLAMA_MODELS` (D3) + mode-aware bind (D4); boot the old proxy off `:11434` first.
- Pull-routing: omlx-mode `nomad models pull` → `:11436` (`nomad:3857/3859/3887`, probe `:3820`; audit `2328/2361/3831`).
- Housekeeping: `NOMAD_PORTS` (`:437`) add `11436` (+ `11435 8000`); inventory comments/logic (`~819-872`); man pages (`nomad-backend.1`, `nomad.1:244`, `nomad-reset-ollama.1`).

**Layer 2:**
- New `nomad ai-clients` subcommand: reuse the install-time RAM probe → print the model menu (tiers + honesty); accept `--model` / `--engine {omlx|ollama}` / `--pull`; emit ready-to-paste Open WebUI + OpenCode/Aider configs templated to the chosen model+engine; print the Docker-bind note.
- Docker Open WebUI reachability: the D4/D10 bind toggle (expose oMLX `:8000` or flip the general Ollama to `0.0.0.0`) when the user opts for a Docker chat GUI.
- Mac doc page + `nomad help`/man entry. **No admin code changes** (clients are external).

## 7. Risks & mitigations

- **Pull-routing miss** (omlx-mode pull hitting `:11434` lands in native Ollama, not oMLX) → §6 audit + verify an MLX pull via `:11436`.
- **kv_store seed drift** → idempotent `UPDATE` for `ai.remoteOllamaUrl`.
- **Bootout loops** kill the general Ollama on switch → de-exclude (§6); verify `nomad backend omlx` leaves `:11434` Ollama running.
- **Two Ollama daemons** (general `:11434` + embed `:11435`) → keep **separate** `OLLAMA_MODELS`; never share a dir between running daemons.
- **Model-quality expectation** → honest RAM-advised menu (D9) + user-defined choice; docs are explicit that an 8B model ≠ Claude Code.
- **RAM contention** → oMLX + chosen coding model + (Docker) Open WebUI + embed + native Ollama is heavy; the RAM-advised menu caps realistic model size; doc warns about concurrent load.
- **Docker bind exposure** → flip to `0.0.0.0` only when a Docker client needs it (D10); default stays least-exposure.

## 8. Verification

- `bash -n install/macos/nomad`; `cd admin && npm run typecheck`; `bash install/macos/scripts/test-manpages.sh`.
- **Layer 1 (live, omlx mode):** (1) `ollama run llama3.1` on `:11434` uses the existing model; (2) admin chat still streams from **oMLX** (proxy `:11436`); (3) KB/RAG green; (4) benchmark runs; (5) `nomad backend omlx` does **not** kill `:11434` Ollama; (6) `nomad models pull <mlx>` reaches oMLX via `:11436`; (7) system-check shows all four daemons. Regression: `ollama` mode unchanged.
- **Layer 2:** `nomad ai-clients` prints a correct RAM-fit menu + valid configs; `--pull` pulls the **user-chosen** model on the chosen engine; a manually-installed Open WebUI reaches the engine and lists the model; OpenCode/Aider edits a file via the chosen local model.

## 9. Out of scope

- Bundling/running the clients (Open WebUI container, agent install) — the rejected fully-managed scope (D7).
- Building a custom UI.
- **Auto-forcing/auto-pulling a model without user choice** (D9).
- `ollama`-backend mode behavior changes beyond Layer 1.

## 10. Open questions

- Final helper name (`nomad ai-clients` working).
- Exact per-RAM-tier menu contents (finalized in the implementation plan; kept current with what's pullable). Model **selection** is the user's; the menu is advisory only.
