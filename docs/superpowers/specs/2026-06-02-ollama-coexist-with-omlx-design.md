# Design Spec — Native Ollama co-existence + a unified local-AI app (chat + agentic coding)

- **Status:** Draft for review — **v3** (Layer 2 reframed to a unified app + deployment-aware secure access)
- **Date:** 2026-06-02
- **Scope:** macOS/Apple-Silicon distribution layer — `install/macos/**`, `admin/**`. Ships in the **installer** (feature for all nomad users).
- **Mode affected:** Layer 1 is **omlx-only — a no-op in `ollama` mode** (a native Ollama already owns `:11434` with the user's models there, so there is nothing to "coexist"). Layer 2 is **backend-aware** and works for *both* install types.

## 1. Goal

Two complementary layers:

- **Layer 1 — backend co-existence:** run a full general-purpose native Ollama (CLI + existing models) *alongside* nomad's oMLX stack. Native Ollama owns `:11434`; the oMLX-compat proxy and the admin's `OLLAMA_HOST` move to `:11436`.
- **Layer 2 — a unified local-AI app:** make it easy to run **one app** (Claude-for-macOS-style: chat **and** agentic coding in one window) over the local models — runnable **on the mini** or **from another Mac** over a **secure tunnel**. nomad **configures** (reachable endpoints, secure remote access, a RAM-advised **user-defined** model menu, ready-to-paste app configs, install-flow offer, docs); the user installs the app.

## 2. User intent (from brainstorming)

- "Both, fully independent" backends (native Ollama + oMLX).
- One **unified app** (chat + agentic coding) "to use the models AND code" — Claude-for-macOS shape, not two separate tools.
- Use **already-downloaded models** where possible (`llama3.1` in `~/.ollama/models`; data-root `ollama-models` empty).
- Scope: **configure, not bundle** — nomad wires it up + recommends; user installs the app.
- Ships in the **installer** (all users), and the app **location varies** (mini *and/or* a separate Mac).
- Target Macs are on **macOS 26.4.1+** (clears Agent!'s requirement).
- Coding model is **user-defined**; nomad advises by install-detected RAM, never forces.

## 3. Current state (constraints)

- Two **mutually-exclusive** AI backends (`NOMAD_AI_BACKEND`); both compete for `:11434`.
- A **general-purpose Ollama already exists** (`com.projectnomad.ollama`, `0.0.0.0:11434`, `OLLAMA_MODELS`→`$NOMAD_DATA_ROOT/ollama-models`, fallback `~/.ollama/models`); in omlx mode it's **unloaded** and the proxy squats `:11434`.
- omlx-mode daemons: `omlx` (`127.0.0.1:8000`), `ollama-proxy` (`0.0.0.0:11434`→`:8000/v1` + embed `:11435`), `ollama-embed` (`127.0.0.1:11435`, RAG).
- **Security posture:** oMLX/embed bind **loopback**; `skip_api_key_verification` is safe *because* they're loopback-only. Admin reaches the proxy via `host.docker.internal`.
- Admin understands only one `OLLAMA_HOST` (hardcoded `:11434` in `compose.yaml` ×2 + the `ai.remoteOllamaUrl` seed).
- **Ollama 0.19+ uses the MLX backend on Apple Silicon, and Ollama speaks the Anthropic Messages API** (~0.14+) — so local engines can back Anthropic-API clients (incl. Claude Code) directly; oMLX is OpenAI+Anthropic compatible.

## 4. Decisions

### Layer 1 — backend (unchanged from v1/v2)

| # | Decision | Rationale | Rejected |
|---|----------|-----------|----------|
| D1 | Native Ollama owns `:11434`; proxy → `:11436` | CLI/UIs expect `localhost:11434`; the env-configured internal proxy yields the standard port. | Ollama on a side port (`OLLAMA_HOST` friction). |
| D2 | Admin `OLLAMA_HOST` → `:11436` (Option A) | Admin keeps chatting with **oMLX** (= what `omlx` mode means). | B (admin on `:11434` → silently chats native Ollama). |
| D3 | Coexisting Ollama `OLLAMA_MODELS=~/.ollama/models`, configurable | Where `llama3.1` already is; zero re-download. | data-root (empty). |
| D4 | Bind **mode-aware + configurable**: omlx mode defaults **loopback**, with an **opt-in `0.0.0.0` `.env` toggle** to expose the general Ollama on the LAN — e.g. to drive an Ollama/OpenAI GUI from **another device on the LAN** (laptop/iPad) at `http://nomad.local:11434` (see D10). `ollama` mode is `0.0.0.0` (admin reach; already LAN-exposed). | Least-exposure default **and** supports the remote-LAN-GUI use case as an explicit, warned opt-in. | `0.0.0.0` default in omlx mode (needless exposure for users who don't want it). |
| D5 | Reuse `com.projectnomad.ollama`; make it **coexist** in omlx mode | Already a general Ollama with rename-safe models. | New parallel agent. |
| D6 | Native engines, BYO clients; no bundle | Small build; rich ecosystem. | Bundling. |

### Layer 2 — unified local-AI app

| # | Decision | Rationale | Rejected |
|---|----------|-----------|----------|
| D7 | Scope = **configure, recommend; do not bundle** | Ships to all users — won't hard-couple to a third-party (esp. solo-maintainer) binary. nomad emits configs + recommends. | Fully-managed bundle. |
| D8 | **Backend-aware targeting.** The helper detects `NOMAD_AI_BACKEND`: in **`ollama`** mode the app/agent target native Ollama `:11434` (the *only* engine — the user's models; MLX-backed under Ollama 0.19+; Anthropic-API for Claude Code); in **`omlx`** mode, oMLX `:8000` (coding agent; OpenAI+Anthropic) + Ollama `:11434` (chat over existing models). Configs for whatever exists; user can mix. | Works for **both** install types — not just omlx; honors existing-models for chat. | Assuming oMLX always exists (it doesn't in ollama mode). |
| D9 | Coding model **USER-DEFINED**; nomad shows a RAM-advised menu (install-detected RAM) with honest capability notes (8B weak for agentic coding; Qwen2.5-Coder / Devstral as coding-tuned), user selects, optional `--pull`. **No forced model.** | Per Chris. | Auto-pick/auto-pull. |
| **D10** | **Deployment- + endpoint-aware (corrected to the real binds).** Confirmed: the **Ollama-API `:11434`** endpoint is **already `0.0.0.0`** in *both* modes (native Ollama @`nomad:1634`; oMLX proxy @`:1966` — to match native Ollama + let the Dockerized admin reach it via `host.docker.internal`), so it's **already LAN-reachable & unauthenticated** today (pre-existing). **oMLX `:8000`** and **embed `:11435`** are **loopback**. Therefore: an app on `:11434` connects over the LAN as-is (caveat: unauthenticated — see Risks); an app targeting **oMLX `:8000`** from another Mac uses a **secure tunnel** (SSH `-L` / Tailscale) or an explicit, warned opt-in expose; an app on the mini uses loopback for both. **Remote LAN GUI (common case):** oMLX is reachable as-is via the proxy (`:11436`, `0.0.0.0`); the user's *Ollama* models in omlx mode require the D4 expose toggle (trusted LAN, unauthenticated — same posture as stock Ollama). Untrusted/off-LAN → tunnel. | Accurate to the actual binds; a tunnel only where it's genuinely needed (`:8000`), opt-in expose for trusted-LAN GUIs. | Claiming `:11434` is loopback (it isn't) — would mis-state the security posture. |
| D11 | Recommended app = **Agent!** (`macos26/agent`: native, chat + agentic coding + Mac automation, local Ollama/LM Studio, signed, macOS 26.4.1+). Alternatives documented: **Zed** (AI editor; local agentic is finicky) and **Claude Code on local models** (Anthropic-API; CLI). | Closest "Claude for macOS" shape; gates met. ⚠️ solo-maintainer (bus-factor 1) — hence recommend-not-bundle (D7). | Hard-bundling one app. |
| D12 | Delivery: a **`nomad ai-clients`** helper (working name) + an **install-flow offer** + **broadening the existing AI help page** (`/docs/mac-ai-assistant`, retitled beyond "AI Assistant", URL kept) + man entry. The helper hands you a *recipe* (official download link + exact config + tunnel command), optionally runs an app's *own* official installer (Zed brew cask, Claude Code npm); it never re-hosts a third-party binary. | Discoverable, install-grade, configure-scope; license-clean (Agent! binary is author-reserved). | Docs only; nomad hosting/serving the binary. |
| D13 | Install integration: the installer **offers** (skippable, idempotent) to print/set up the unified-app config — RAM-advised model menu, app recommendation, local-or-tunnel connection details. | "It's for the install too." | Post-install only. |

## 5. Target architecture (omlx mode)

```
Layer 1 (backend, on the mini):
  ollama CLI / native UI ─► 127.0.0.1:11434  com.projectnomad.ollama  (existing models, ~/.ollama/models)
  admin (Docker) ─:11436─►  :11436  ollama-proxy ─► :8000 oMLX ─► :11435 embed (RAG)

Layer 2 (unified app — you install; nomad configures):
  App on the mini        ─► 127.0.0.1:{11434 chat | 8000 code}        (loopback)
  App on another Mac     ─► SSH -L / Tailscale ─► mini loopback:{11434 | 8000}   (secure tunnel; endpoints stay loopback)
  (raw 0.0.0.0 LAN exposure: explicit warned opt-in only)
```

## 6. Change surface

**Layer 1** (lines per the 2026-06-02 audit; re-verify at edit):
- Proxy `11434→11436`: plist `nomad:1967`; omlx-mode probes/waits `~684/687/1946/2007/2008/5053/5076`.
- Admin repoint: `compose.yaml:97,161`→`:11436`; `nomad:3537` seed + idempotent `UPDATE` (seed `IF NULL/''`-guarded at `:3539`); `admin/.env.example:24-25`, `admin/start/env.ts:70`. No admin code change.
- General Ollama in omlx mode: add to omlx install (`~3675-3678`), `cmd_backend` omlx (`~5114`), `_reset_omlx_stack`; **remove** from omlx bootout loops (`~5103-5108`, `~5060-5066`); set `OLLAMA_MODELS` (D3) + mode-aware bind (D4); boot old proxy off `:11434` first.
- Pull-routing: omlx-mode pull → `:11436` (`nomad:3857/3859/3887`, probe `3820`; audit `2328/2361/3831`).
- Housekeeping: `NOMAD_PORTS` (`:437`) +`11436` (+`11435 8000`); inventory comments (`~819-872`); man pages.

**Layer 2:**
- `nomad ai-clients` subcommand: read install-time RAM → model menu (tiers + honesty); `--model/--engine/--pull`; emit app configs (Agent! / Zed / Claude-Code) for local **and** tunnel connection; print the secure-access guidance.
- Secure remote access: helper + doc for SSH `-L` and Tailscale to the mini's loopback endpoints; raw-`0.0.0.0` opt-in path gated behind an explicit flag + warning.
- Install-flow offer (D13): skippable step that surfaces the above.
- **Broaden the existing AI help page** (`/docs/mac-ai-assistant` — URL/slug kept, no link breakage). Retitle it beyond "AI Assistant" to an AI hub: (a) add a `TITLE_OVERRIDES` entry for `mac-ai-assistant` in `admin/app/services/docs_service.ts` (one line — also fixes the current auto-title "Mac Ai Assistant"), and (b) rewrite/expand the in-page H1 + content of `admin/docs/mac-ai-assistant.md`. Final title TBD (Chris) — e.g. "AI & Local Models". Expanded scope: the built-in assistant **+** using your own local models (oMLX/Ollama coexistence) **+** the unified app (Agent!/Zed/Claude-Code-local) **+** the `nomad ai-clients` recipe **+** local-vs-secure-tunnel connection (D10) **+** the user-defined model menu (D9) **+** the honest model-quality note. (This page is also on the stale-mac-docs rewrite list — broaden + refresh together.)
- A `nomad help`/man entry for `nomad ai-clients`. Beyond the one-line `DOC_ORDER` edit, no admin code changes (the app itself is external).

## 7. Risks & mitigations

- **Security — remote exposure of oMLX `:8000`:** it's loopback; remote access via tunnel (D10), explicit/warned for any opt-in expose.
- **Pre-existing `:11434` LAN exposure (flagged, not silently changed):** the Ollama-API endpoint is `0.0.0.0`/**unauthenticated** in *both* modes today (to serve the Dockerized admin via `host.docker.internal`). This feature doesn't change that; the FAQ page should state it plainly. Adding auth or firewalling `:11434` to a trusted interface is a worthwhile **separate hardening follow-up — out of scope here** (it predates this feature and affects the admin path).
- **Pull-routing miss** → omlx-mode pull → `:11436` audit + verify.
- **kv_store seed drift** → idempotent `UPDATE`.
- **Bootout loops** kill general Ollama on switch → de-exclude; verify.
- **Two Ollama daemons** → separate `OLLAMA_MODELS`; never share a running dir.
- **Model-quality expectation** → honest RAM-advised menu (D9); docs explicit an 8B model ≠ Claude Code.
- **RAM contention** → menu caps realistic model size; doc warns about concurrent load.
- **Third-party app risk (Agent! solo-maintainer)** → recommend-not-bundle (D7); document alternatives (D11) so nomad never breaks if one app stalls.

## 8. Verification

- `bash -n install/macos/nomad`; `cd admin && npm run typecheck`; `bash install/macos/scripts/test-manpages.sh`.
- **Layer 1 (live, omlx):** (1) `ollama run llama3.1` on `:11434`; (2) admin chat still streams from **oMLX** (`:11436`); (3) KB/RAG green; (4) benchmark; (5) `nomad backend omlx` doesn't kill `:11434` Ollama; (6) `nomad models pull <mlx>` → `:11436`; (7) system-check shows four daemons. Regression: `ollama` mode unchanged.
- **Layer 2 (omlx mode):** `nomad ai-clients` prints a correct RAM menu + valid configs for oMLX `:8000` (agent) + Ollama `:11434` (chat); `--pull` pulls the **user-chosen** model; a unified app (mini-local) reaches both; a remote app reaches oMLX `:8000` over **SSH/Tailscale**; oMLX `:8000` is **not** on `0.0.0.0` unless the opt-in flag is set.
- **Layer 2 (ollama mode):** `nomad ai-clients` targets **only** Ollama `:11434` (no oMLX references); the app reaches it local or over the LAN; the helper behaves correctly with no oMLX/proxy present.
- **Remote-LAN GUI:** from another device on the LAN, an Ollama/OpenAI GUI reaches oMLX via `nomad.local:11436` as-is; reaches the user's Ollama models via `nomad.local:11434` **only when the D4 expose toggle is on** (off → general Ollama not LAN-reachable in omlx mode). All clients coexist with the admin + local clients.

## 9. Out of scope

- Bundling/running the app or shipping its binary (D7).
- Building a custom unified app.
- Auto-forcing/auto-pulling a model (D9).
- Defaulting to raw LAN exposure (D10).
- `ollama`-mode behavior changes beyond Layer 1.

## 10. Open questions

- Final helper name (`nomad ai-clients` working).
- Per-RAM-tier menu contents (finalized in the plan; advisory only — selection is the user's).
- Tailscale: recommend/document only, or offer to install in the flow? (Lean: document + detect-if-present; don't auto-install.)
