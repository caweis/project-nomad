# Design Spec — Native Ollama co-existing with oMLX

- **Status:** Draft for review
- **Date:** 2026-06-02
- **Scope:** macOS/Apple-Silicon distribution layer — `install/macos/**`, `admin/**`
- **Mode affected:** `NOMAD_AI_BACKEND=omlx` only (the `ollama` backend already runs native Ollama on `:11434` and is unaffected)

## 1. Goal

Run a full **general-purpose native Ollama** (CLI + any UI), using the user's **already-downloaded models**, **alongside** nomad's oMLX stack — each independently usable. The native Ollama owns the standard port `:11434` (zero-config tooling); nomad's oMLX-compat proxy and the admin move to `:11436`.

## 2. User intent (from brainstorming)

- "Both, fully independent" — native Ollama and oMLX coexisting, each usable on its own.
- Native Ollama must use already-downloaded models with **no re-download**. Confirmed: the user's models live in the standard **`~/.ollama/models`** (contains `llama3.1`); nomad's data-root `ollama-models` directory is empty.
- UI: **BYO** (Ollama.app, Enchanted, Open WebUI) — documented, not bundled.

## 3. Current state (the constraints that shape the design)

- nomad has **two mutually-exclusive AI backends** selected by `NOMAD_AI_BACKEND`. Only one backend's daemons run at a time; both compete for `:11434`.
- A **full general-purpose Ollama already exists**: `step_ollama_native` / LaunchAgent `com.projectnomad.ollama`, binds `0.0.0.0:11434`, `OLLAMA_MODELS` resolved by `ollama-launcher.sh` to `$NOMAD_DATA_ROOT/ollama-models` (fallback `~/.ollama/models`). In `omlx` mode it is **deliberately unloaded** and the proxy squats `:11434`.
- In `omlx` mode the running daemons are: `com.projectnomad.omlx` (`127.0.0.1:8000`), `com.projectnomad.ollama-proxy` (`uvicorn … --host 0.0.0.0 --port 11434`, translates Ollama API → OpenAI, upstream `OPENAI_API_BASE_URL=127.0.0.1:8000/v1`, `NOMAD_EMBED_URL=127.0.0.1:11435`), and `com.projectnomad.ollama-embed` (`127.0.0.1:11435`, `OLLAMA_MODELS=$SECRETS_DIR/embed-models`, RAG only).
- The **admin only understands one `OLLAMA_HOST`** (`http://host.docker.internal:11434`, hardcoded in `compose.yaml` for both admin and worker, plus the `ai.remoteOllamaUrl` kv_store seed). It has no concept of two backends — it chats/embeds/benchmarks against whatever speaks the Ollama API at `OLLAMA_HOST`.

## 4. Decisions & rationale

| # | Decision | Rationale | Rejected alternative |
|---|----------|-----------|----------------------|
| D1 | Native Ollama owns standard `:11434`; proxy moves to `:11436` (**Approach ①**) | The CLI and all UIs expect `localhost:11434`. The component that already adapts via an env var (the internal proxy, reached only by the admin) should yield the standard port — no ongoing `OLLAMA_HOST` friction for the user. | ② nomad keeps `:11434`, Ollama on a side port (ongoing `OLLAMA_HOST` friction). |
| D2 | Admin `OLLAMA_HOST` → `:11436` (follows the proxy) — **Option A** | The admin must keep chatting with **oMLX**, which is what `NOMAD_AI_BACKEND=omlx` means. | **Option B** (admin stays on `:11434`) would silently make the admin chat with native Ollama, contradicting the backend label — defeats the oMLX project. |
| D3 | Coexisting Ollama `OLLAMA_MODELS=~/.ollama/models`, configurable via `.env` | That's where the user's `llama3.1` already is — zero re-download, zero move. Standard Ollama location, so future CLI pulls land there too. | data-root `ollama-models` (empty; would not show existing models). |
| D4 | Bind default `127.0.0.1:11434` (loopback) **in omlx mode** | Least exposure; a native UI (Ollama.app/Enchanted) works on loopback. ⚠️ The *same* agent must keep `0.0.0.0` in `ollama` backend mode (the admin reaches it via `host.docker.internal` there) — so the bind is **mode-aware**: `0.0.0.0` in ollama mode (status quo, admin reach), loopback default in omlx mode (admin uses the proxy, not this agent). | `0.0.0.0` default in omlx mode (unnecessary exposure). Documented opt-in toggle to `0.0.0.0` for a Docker UI (Open WebUI) that needs `host.docker.internal`. |
| D5 | Reuse `com.projectnomad.ollama`; make it **coexist** (not mutually exclusive) in omlx mode | It is already a general Ollama with rename-safe model resolution. | A new parallel agent (duplication). |
| D6 | UI: **BYO**, documented; no bundle | Approach ① makes any Ollama UI zero-config; keeps the build small and avoids extra RAM/Metal contention on the mini. | Approach ③ (bundle Open WebUI as an admin app). |

## 5. Target architecture (omlx mode)

```
you (ollama CLI / native UI)  ──►  127.0.0.1:11434   com.projectnomad.ollama
                                                       (general chat Ollama, OLLAMA_MODELS=~/.ollama/models)

admin (Docker) ──OLLAMA_HOST=host.docker.internal:11436──►  :11436  com.projectnomad.ollama-proxy
                                                                       ├──► 127.0.0.1:8000   com.projectnomad.omlx
                                                                       └──► 127.0.0.1:11435  com.projectnomad.ollama-embed (RAG)
```

Four daemons coexisting. The admin's chat/RAG/benchmark path on oMLX is **behaviorally unchanged** — only the proxy's port number moves.

## 6. Change surface (grouped; line numbers per the 2026-06-02 audit, re-verify at edit time)

**A. Move the proxy `11434 → 11436`**
- `install/macos/nomad:1967` — proxy LaunchAgent `--port 11434` → `11436`. (Optional dev parity: `omlx-proxy/vendor/src/config.py:29` default; non-load-bearing in prod.)
- Repoint every **omlx-mode** proxy probe/health/wait that assumed `:11434`: `nomad` lines ~684/687 (`check_stack`), ~1946/2007/2008 (proxy bootstrap wait + pre-check `lsof`), ~5053/5076 (`_reset_omlx_stack` text + final poll).

**B. Repoint the admin to the proxy's new port (Option A)**
- `install/macos/compose.yaml:97` (admin) and `:161` (worker) — `OLLAMA_HOST=http://host.docker.internal:11436`.
- `install/macos/nomad:3537` — `ai.remoteOllamaUrl` seed → `:11436`. ⚠️ The seed is guarded `IF(value IS NULL OR '')` (`:3539`), so an existing install **will not** auto-update — add a one-time idempotent `UPDATE` to migrate any existing `…:11434` value to `…:11436`.
- `admin/.env.example:24-25` and `admin/start/env.ts:70` doc comment — update the documented value.
- No admin **code** change: `docker_service.ts` uses `OLLAMA_HOST` verbatim (no port parsing); `isNativeOllama()` still true.

**C. Run the general Ollama in omlx mode (coexist, don't exclude)**
- Add `com.projectnomad.ollama` to the omlx install path (~`nomad:3675-3678`), `cmd_backend` omlx branch (~`:5114`), and `_reset_omlx_stack`.
- **Remove** the general-Ollama bootout from the omlx switch paths: `cmd_backend` (~`:5103-5108`) and `_reset_omlx_stack` (~`:5060-5066`) — otherwise it is killed on every `nomad backend omlx` (symptom: the user's CLI Ollama dies on backend switch).
- Set its `OLLAMA_MODELS` to the configured value (D3) and bind to the configured address (D4). Keep its existing `:11434` free-the-port logic (`~:1533-1547`); ensure the proxy's old `:11434` instance is booted out **first** during migration so the user never sees the `confirm` "kill process on :11434?" prompt (`~:1539`).

**D. Pull-routing (critical)**
- `nomad models pull` in omlx mode must POST to the proxy on **`:11436`**, not `:11434` (now native Ollama): `nomad:3857/3859/3887` (`/api/pull`) and the probe at `:3820`. Audit omlx-guarded model probes `:2328/2361/3831`.

**E. Housekeeping**
- `nomad:437` `NOMAD_PORTS` — add `11436` (and finally `11435 8000`, currently missing from the collision check).
- `nomad:819-825` — the "native-Ollama intentionally unloaded / proxy owns :11434" inventory comment + logic: in omlx mode `:11434` is now the general Ollama and the proxy is `:11436`; the native-Ollama inventory block (`~:826-872`) should run in omlx mode too.
- Man pages: `nomad-backend.1` (daemon list `:52-79`, `:130` proxy port), `nomad.1:244`, `nomad-reset-ollama.1:15`. Add the coexistence topology.
- BYO-UI docs (a new short section / Mac doc): point a UI at `localhost:11434`; how to flip the bind to `0.0.0.0` for a Docker UI.
- `quick-chat.sh` / Field Desk (`NOMAD_OLLAMA_PORT=11434`, `nomad:5656/5658`): leave on `:11434` — they should use the general Ollama.

## 7. Risks & mitigations

- **Pull-routing miss** → in omlx mode a `pull` hitting `:11434` would land in native Ollama, never reaching oMLX. *Mitigation:* §6.D audit; verify a `nomad models pull` lands an MLX model via the proxy.
- **kv_store drift** → `ai.remoteOllamaUrl` won't auto-update on existing installs. *Mitigation:* idempotent `UPDATE` migration (§6.B).
- **Bootout loops** kill the general Ollama on backend switch. *Mitigation:* §6.C de-exclusion; verify `nomad backend omlx` leaves `:11434` Ollama running.
- **Two Ollama daemons** (general `:11434` + embed `:11435`) — keep **separate** `OLLAMA_MODELS` (`~/.ollama/models` vs `$SECRETS_DIR/embed-models`); never share one dir between running daemons (blob-write race on pulls).
- **`host.docker.internal` reachability** — only the proxy (`:11436`) needs the container-reachable `0.0.0.0` bind; the general Ollama can stay loopback (admin doesn't talk to it).
- **NOMAD_PORTS blind spot** — adding `:11436` without `:11435/:8000` perpetuates a gap; add all three.
- **Migration sequencing** — bootout the old `:11434` proxy before starting the general Ollama there, to avoid the scary kill prompt.

## 8. Verification plan

- `bash -n install/macos/nomad`; `cd admin && npm run typecheck`; `bash install/macos/scripts/test-manpages.sh` (drift guard).
- Live, omlx mode: (1) `ollama run llama3.1` against `:11434` works with existing model; (2) admin chat still streams from **oMLX** (proxy on `:11436`); (3) KB ingestion / RAG still green (embed `:11435`); (4) benchmark runs; (5) `nomad backend omlx` does **not** kill the `:11434` Ollama; (6) `nomad models pull <mlx>` reaches oMLX via `:11436`; (7) `nomad` system-check shows all four daemons; (8) a native UI pointed at `localhost:11434` lists `llama3.1`.
- Regression: `ollama`-backend mode unchanged.

## 9. Out of scope

- `NOMAD_AI_BACKEND=ollama` mode (already native Ollama on `:11434`).
- Bundling/managing a UI (Approach ③).
- Changes to oMLX or embed-Ollama internals beyond port/wiring.

## 10. Open questions

- None blocking. Default coexisting `OLLAMA_MODELS=~/.ollama/models`; expose `NOMAD_OLLAMA_MODELS` (or equivalent) in `.env` for users who keep models elsewhere (final env-var name to be fixed in the implementation plan).
