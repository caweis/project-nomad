# Design Spec — Native Ollama co-existence + a unified local-AI app (chat + agentic coding)

- **Status:** Draft for review — **v3** (Layer 2 reframed to a unified app + deployment-aware secure access)
- **Date:** 2026-06-02
- **Scope:** macOS/Apple-Silicon distribution layer — `install/macos/**`, `admin/**`. Ships in the **installer** (feature for all nomad users).
- **Mode affected:** `NOMAD_AI_BACKEND=omlx` primarily (`ollama` mode largely unaffected)

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
| D4 | Bind **mode-aware**: loopback in omlx mode; `0.0.0.0` in ollama mode (admin reach) | Least exposure; preserves the loopback/no-auth posture (see D10). | `0.0.0.0` default in omlx mode. |
| D5 | Reuse `com.projectnomad.ollama`; make it **coexist** in omlx mode | Already a general Ollama with rename-safe models. | New parallel agent. |
| D6 | Native engines, BYO clients; no bundle | Small build; rich ecosystem. | Bundling. |

### Layer 2 — unified local-AI app

| # | Decision | Rationale | Rejected |
|---|----------|-----------|----------|
| D7 | Scope = **configure, recommend; do not bundle** | Ships to all users — won't hard-couple to a third-party (esp. solo-maintainer) binary. nomad emits configs + recommends. | Fully-managed bundle. |
| D8 | Engines: app can target **both**; configs for each. Suggested: chat → existing models on Ollama `:11434`; agentic coding → oMLX `:8000` (batching; OpenAI+Anthropic). | Honors existing-models for chat; better engine for the agent; user can mix. | Forcing one engine. |
| D9 | Coding model **USER-DEFINED**; nomad shows a RAM-advised menu (install-detected RAM) with honest capability notes (8B weak for agentic coding; Qwen2.5-Coder / Devstral as coding-tuned), user selects, optional `--pull`. **No forced model.** | Per Chris. | Auto-pick/auto-pull. |
| **D10** | **Deployment-aware, secure-by-default.** App on the **mini** → loopback. App on **another Mac** → reach the mini over a **secure tunnel** (SSH `-L` [no deps] or **Tailscale** [recommended UX]); endpoints stay **loopback-bound**. Raw `0.0.0.0` LAN exposure is an **explicit, warned opt-in** only (it breaks the loopback→`skip_api_key_verification` safety). | Maxim 8 — security by design / least exposure; preserves the no-auth-because-loopback posture for all users. | Defaulting to LAN exposure for remote access. |
| D11 | Recommended app = **Agent!** (`macos26/agent`: native, chat + agentic coding + Mac automation, local Ollama/LM Studio, signed, macOS 26.4.1+). Alternatives documented: **Zed** (AI editor; local agentic is finicky) and **Claude Code on local models** (Anthropic-API; CLI). | Closest "Claude for macOS" shape; gates met. ⚠️ solo-maintainer (bus-factor 1) — hence recommend-not-bundle (D7). | Hard-bundling one app. |
| D12 | Delivery: a **`nomad ai-clients`** helper (working name) + an **install-flow offer** + a **dedicated FAQ/help page** (`/docs/mac-ai-clients`) + man entry. The helper hands you a *recipe* (official download link + exact config + tunnel command), optionally runs an app's *own* official installer (Zed brew cask, Claude Code npm); it never re-hosts a third-party binary. | Discoverable, install-grade, configure-scope; license-clean (Agent! binary is author-reserved). | Docs only; nomad hosting/serving the binary. |
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
- **Dedicated FAQ/help page** at `/docs/mac-ai-clients`: new `admin/docs/mac-ai-clients.md` (Markdoc), auto-discovered by `DocsService`; add a `DOC_ORDER` slot (~17) + optional `TITLE_OVERRIDES` entry in `admin/app/services/docs_service.ts` (one line each) so it slots beside the other `mac-*` pages. Ships with the admin image. Covers: recommended apps, the `nomad ai-clients` recipe, local-vs-secure-tunnel connection (D10), the user-defined model menu (D9), and the honest model-quality note.
- A `nomad help`/man entry for `nomad ai-clients`. Beyond the one-line `DOC_ORDER` edit, no admin code changes (the app itself is external).

## 7. Risks & mitigations

- **Security — remote exposure** (the big one): raw `0.0.0.0` would expose unauthenticated models. *Mitigation:* loopback + secure tunnel default (D10); raw exposure is explicit/warned only.
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
- **Layer 2:** `nomad ai-clients` prints a correct RAM menu + valid configs; `--pull` pulls the **user-chosen** model; a unified app (mini-local) reaches the models; a remote app over **SSH/Tailscale** reaches the loopback endpoints; the model endpoints are **not** reachable on `0.0.0.0` unless the opt-in flag is set.

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
