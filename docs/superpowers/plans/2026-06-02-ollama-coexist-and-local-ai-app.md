# Ollama Co-existence + Unified Local-AI App — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a full general-purpose native Ollama (the user's own models) co-exist with nomad's oMLX stack in `omlx` mode, and let users connect a unified local-AI app (chat + agentic coding) over their models — local, LAN, or tunnel — set up entirely from the admin web GUI.

**Architecture:** Two phases. **Phase 1 (Layer 1, backend, omlx-mode only):** native Ollama takes the standard `:11434`; the oMLX-compat proxy and the admin's `OLLAMA_HOST` move to `:11436`; the general Ollama is de-excluded from the omlx bootout so it runs alongside oMLX. **Phase 2 (Layer 2, clients):** an admin GUI section ("Use from other devices / Connect an app") with a model picker, a one-tap LAN-expose toggle (driven by the existing host-command bridge), live connection URLs, and app download links + configs; plus a broadened AI help page. Layer 2 is **backend-aware** (works for `ollama` and `omlx` installs).

**Tech Stack:** Bash (`install/macos/nomad`, ~5300 lines), FastAPI proxy (`install/macos/omlx-proxy/vendor`), AdonisJS 6 + Inertia/React + Markdoc admin (`admin/`), macOS LaunchAgents, Docker Compose, MySQL kv_store.

**Reference spec:** `docs/superpowers/specs/2026-06-02-ollama-coexist-with-omlx-design.md`

**Test harness reality (read before starting):** there is **no unit-test framework** for the bash CLI or the admin. Verification uses what exists: `bash -n install/macos/nomad` (syntax), the `install/macos/scripts/test-*.sh` scripts (`test-host-command-allowlist.sh`, `test-reset-ollama.sh`, `test-manpages.sh`), `cd admin && npm run typecheck` (`tsc --noEmit`), and **live checks on the Mac mini** (the implementer cannot SSH the mini — live steps are handed to the human operator). Treat "re-verify line numbers via grep" as mandatory: the `:NNNN` anchors below are from the 2026-06-02 audit and drift.

**Deploy reminder:** `nomad`/proxy changes ship via `nomad update`; `admin/**` changes need the `:edge` image rebuilt then `nomad upgrade`. Develop on `main`. Commit after every step; push in batches.

---

## File map

**Phase 1 (Layer 1):**
- Modify `install/macos/nomad` — proxy port, omlx-mode probes/waits, general-Ollama-in-omlx-mode (install/reset/switch + de-exclude bootout), mode-aware bind + `OLLAMA_MODELS`, pull-routing, `NOMAD_PORTS`, inventory comments, kv_store seed + UPDATE migration.
- Modify `install/macos/compose.yaml` — admin + worker `OLLAMA_HOST` → `:11436`.
- Modify `admin/.env.example`, `admin/start/env.ts` (doc comments only).
- Modify `install/macos/man/nomad-backend.1`, `nomad.1`, `nomad-reset-ollama.1`.
- Modify `install/macos/scripts/test-*.sh` as needed (allow-list test gains the new command in Phase 2).

**Phase 2 (Layer 2):**
- Modify `install/macos/nomad` — new host-side `ai-lan-expose on|off` handler (bind flip + restart) invoked by the bridge.
- Modify `admin/constants/host_commands.ts` — add `ai-lan-expose` to the single-source allow-list.
- Modify the host-command-bridge handler (host side, in `nomad` or its bridge script — locate in step) — dispatch `ai-lan-expose`.
- Create/modify admin GUI: a "Use from other devices / Connect an app" section (likely `admin/inertia/pages/settings/models.tsx` or a new `settings/ai-apps.tsx`) + controller method in `admin/app/controllers/settings_controller.ts` + any service helper.
- Modify `admin/docs/mac-ai-assistant.md` (broaden content) + `admin/app/services/docs_service.ts` (`TITLE_OVERRIDES`).
- Modify `install/macos/scripts/test-host-command-allowlist.sh` — expect the new command.

---

# PHASE 1 — Layer 1: backend co-existence (omlx mode)

> Phase 1 is shippable and verifiable on its own. `ollama`-mode installs are untouched by Phase 1 (a native Ollama already owns `:11434` there).

### Task 1: Move the oMLX-compat proxy `11434 → 11436`

**Files:**
- Modify: `install/macos/nomad` (proxy LaunchAgent writer + omlx-mode probes)

- [ ] **Step 1: Locate every proxy-port reference**

Run:
```bash
cd /Users/chrisweis/Developer/project-nomad-macos-arm64
grep -nE '11434' install/macos/nomad
```
Expected: the proxy plist `--port 11434` (audit `:1967`), plus omlx-guarded probes/waits (audit `~684,687,1946,2007,2008,5053,5076`) and the native-Ollama/Field-Desk uses of `:11434` (audit `~1634,1286,5656,5658,3537`). **Do NOT change** the native-Ollama bind (`:1634`), the CLI export (`:1286`), Field Desk (`:5656/5658`), or the kv_store seed yet (Task 2) — only the **proxy** and **omlx-mode proxy probes**.

- [ ] **Step 2: Change the proxy listen port in the LaunchAgent writer**

In the `step_omlx_proxy` plist writer (audit `:1966-1967`), change the uvicorn arg `--port 11434` → `--port 11436`. Leave `--host 0.0.0.0` (the admin reaches it via `host.docker.internal`).

- [ ] **Step 3: Repoint omlx-mode proxy health/wait probes**

For each omlx-guarded probe that checks the proxy on `:11434` (audit `:684,687` check_stack; `:1946` pre-check `lsof`; `:2007,2008` wait-loop; `:5053,5076` `_reset_omlx_stack`), change `11434` → `11436`. Verify each is inside an `omlx`/proxy context (not the native-Ollama path) before editing — `grep -n -B3 11434 install/macos/nomad` to read context.

- [ ] **Step 4: Syntax check**

Run: `bash -n install/macos/nomad`
Expected: no output (clean parse).

- [ ] **Step 5: Confirm no stray omlx-mode `:11434` proxy refs remain**

Run: `grep -nE '11434' install/macos/nomad`
Expected: only the native-Ollama bind (`OLLAMA_HOST 0.0.0.0:11434`), the CLI export (`OLLAMA_HOST="127.0.0.1:11434"`), Field Desk (`NOMAD_OLLAMA_PORT=11434`), and the kv_store seed (handled in Task 2) — NO proxy/omlx-probe references.

- [ ] **Step 6: Commit**

```bash
git add install/macos/nomad
git commit -m "feat(omlx): move oMLX-compat proxy 11434->11436 to free the standard port for native Ollama"
```

---

### Task 2: Repoint the admin to `:11436` + kv_store migration

**Files:**
- Modify: `install/macos/compose.yaml` (admin + worker `OLLAMA_HOST`)
- Modify: `install/macos/nomad` (kv_store seed + UPDATE migration)
- Modify: `admin/.env.example`, `admin/start/env.ts` (doc comments)

- [ ] **Step 1: Repoint compose `OLLAMA_HOST`**

In `install/macos/compose.yaml`, change both occurrences (audit `:97` admin, `:161` worker): `OLLAMA_HOST=http://host.docker.internal:11434` → `...:11436`. Confirm exactly two:
Run: `grep -nE 'OLLAMA_HOST=.*11434' install/macos/compose.yaml`
Expected before: 2 lines; after the edit: 0 lines.

- [ ] **Step 2: Update the kv_store seed + add an idempotent UPDATE migration**

In `install/macos/nomad`, find the `ai.remoteOllamaUrl` seed (audit `:3537`, guarded `IF(value IS NULL OR '')` at `:3539`). Change the seeded value to `http://host.docker.internal:11436`. Then, because the guard means existing installs won't re-seed, add an idempotent migration **right after** the seed that rewrites a stale value:

```sql
UPDATE kv_store
   SET value = 'http://host.docker.internal:11436'
 WHERE key = 'ai.remoteOllamaUrl'
   AND value = 'http://host.docker.internal:11434';
```
Wrap it the same way the surrounding SQL is invoked (find the existing `mysql`/exec helper used for the seed and reuse it verbatim — do not introduce a new invocation style). Gate it to omlx mode if the seed is mode-gated; otherwise leave unconditional (it only touches the exact stale value).

- [ ] **Step 3: Update env docs (no behavior change)**

In `admin/.env.example` (audit `:24-25`) and the `OLLAMA_HOST` doc comment in `admin/start/env.ts` (audit `:70`), update the documented example URL `…:11434` → `…:11436` and add a one-line note: "oMLX-mode proxy port; native-Ollama-mode uses :11434."

- [ ] **Step 4: Typecheck admin (env.ts is TS)**

Run: `cd admin && npm run typecheck`
Expected: no output (passes). `cd ..` after.

- [ ] **Step 5: Commit**

```bash
git add install/macos/compose.yaml install/macos/nomad admin/.env.example admin/start/env.ts
git commit -m "feat(omlx): repoint admin OLLAMA_HOST to :11436 + idempotent ai.remoteOllamaUrl migration"
```

---

### Task 3: Run the general Ollama in omlx mode (coexist, mode-aware bind)

**Files:**
- Modify: `install/macos/nomad` (omlx install path, `cmd_backend` omlx branch, `_reset_omlx_stack`, bootout loops, the general-Ollama plist writer)

- [ ] **Step 1: Read the reference paths**

Read these in `install/macos/nomad` so the edits mirror existing structure:
- `step_ollama_native` and its plist writer (audit `~1513-1640`) — how the general Ollama (`com.projectnomad.ollama`) is installed/launched, including `OLLAMA_HOST 0.0.0.0:11434` (`:1634`), `OLLAMA_MODELS` resolution (`:1594`), and the `:11434` free-the-port/`confirm` logic (`:1533-1547`).
- `cmd_backend` (audit `~5100-5120`) and `_reset_omlx_stack` (audit `~5053-5076`) — the omlx switch/reset paths and the bootout loops (`:5103-5108`, `:5060-5066`) that currently unload `com.projectnomad.ollama` when entering omlx mode.

- [ ] **Step 2: De-exclude the general Ollama from the omlx bootout loops**

In `cmd_backend`'s omlx branch (audit `:5103-5108`) and `_reset_omlx_stack` (audit `:5060-5066`), **remove `com.projectnomad.ollama` (`$LA_LABEL`/the general-Ollama label) from the bootout list** so switching to / resetting omlx no longer kills it. Leave the proxy/oMLX/embed agents in those loops.

- [ ] **Step 3: Start the general Ollama in the omlx install + reset + switch paths**

In the omlx install path (audit `~3675-3678`), the `cmd_backend` omlx branch (audit `~5114`), and `_reset_omlx_stack`, ensure `step_ollama_native` (or its bootstrap) runs so `com.projectnomad.ollama` is up in omlx mode. Sequence it **after** the proxy has been booted off `:11434` (Task 1 moved it to `:11436`) so the general Ollama claims `:11434` cleanly and the `confirm` kill-prompt at `:1539` never fires.

- [ ] **Step 4: Mode-aware bind + models dir**

In the general-Ollama plist writer, make the bind mode-aware:
- `ollama` mode: keep `OLLAMA_HOST 0.0.0.0:11434` (admin reach — unchanged).
- `omlx` mode: default `OLLAMA_HOST 127.0.0.1:11434` (loopback, least exposure), unless a persisted expose flag is set (read an env/config key, default off — the Phase-2 toggle writes it; for now just honor it if present, default loopback).
- Set `OLLAMA_MODELS` to the user's existing dir. The user's models live in `~/.ollama/models` (confirmed: contains `llama3.1`; the data-root `ollama-models` is empty). Default the omlx-mode general Ollama's `OLLAMA_MODELS` to `~/.ollama/models`, overridable by an env/config key.

Use the existing launcher pattern (`ollama-launcher.sh`, audit `:1572-1619`) — extend its env resolution rather than duplicating it.

- [ ] **Step 5: Syntax check**

Run: `bash -n install/macos/nomad`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add install/macos/nomad
git commit -m "feat(omlx): run native Ollama alongside oMLX (de-exclude from bootout, mode-aware loopback bind, ~/.ollama/models)"
```

---

### Task 4: Fix omlx-mode pull-routing → `:11436`

**Files:**
- Modify: `install/macos/nomad` (`nomad models pull` omlx path + omlx-guarded model probes)

- [ ] **Step 1: Find the pull/probe sites**

Run: `grep -nE '/api/pull|/api/tags|11434' install/macos/nomad | grep -nE '3820|3831|3857|3859|3887|2328|2361'`
Read each (audit: `:3857,3859,3887` POST `/api/pull`; probe `:3820`; model probes `:2328,2361,3831`).

- [ ] **Step 2: Repoint omlx-mode pulls/probes to the proxy**

For each site **inside an `omlx` (`$BACKEND == omlx`) branch** that posts/queries `…:11434` to reach the model engine, change `:11434` → `:11436` (the proxy's new port). A pull in omlx mode must hit the proxy (which MLX-translates), NOT the native Ollama now on `:11434`. Leave any `ollama`-mode pull paths on `:11434`.

- [ ] **Step 3: Syntax check + grep audit**

Run: `bash -n install/macos/nomad && grep -nE 'api/(pull|tags).*11434' install/macos/nomad`
Expected: clean parse; remaining `:11434` pull/tags refs only in `ollama`-mode branches.

- [ ] **Step 4: Commit**

```bash
git add install/macos/nomad
git commit -m "fix(omlx): route omlx-mode model pulls to the proxy on :11436 (native Ollama now owns :11434)"
```

---

### Task 5: Housekeeping — ports, inventory, man pages, drift tests

**Files:**
- Modify: `install/macos/nomad` (`NOMAD_PORTS`, inventory comments)
- Modify: `install/macos/man/nomad-backend.1`, `nomad.1`, `nomad-reset-ollama.1`

- [ ] **Step 1: NOMAD_PORTS**

In `install/macos/nomad` (audit `:437`), change `NOMAD_PORTS="8080 9999 11434"` → `NOMAD_PORTS="8080 9999 11434 11435 11436 8000"` (adds the proxy's new port and the previously-missing embed/oMLX ports to the collision check).

- [ ] **Step 2: Fix the "native Ollama intentionally unloaded" inventory comment/logic**

In the omlx branch of the system inventory (audit `:819-872`), update the comment that says the native-Ollama agent is unloaded and the proxy owns `:11434` — now the **general Ollama owns `:11434`** and the **proxy is on `:11436`**. Ensure the native-Ollama inventory block runs in omlx mode too (so `nomad` system-check reports all four daemons: omlx `:8000`, embed `:11435`, proxy `:11436`, general Ollama `:11434`).

- [ ] **Step 3: Man pages**

Update `nomad-backend.1` (daemon list audit `:52-79`; proxy port `:130`), `nomad.1` (audit `:244`), and `nomad-reset-ollama.1` (`:15`) to describe the new topology (proxy `:11436`, native Ollama coexisting on `:11434` in omlx mode). Match the existing mdoc style.

- [ ] **Step 4: Run the drift/lint tests**

Run:
```bash
bash -n install/macos/nomad
bash install/macos/scripts/test-manpages.sh
bash install/macos/scripts/test-reset-ollama.sh
```
Expected: parse clean; man-page drift guard passes; reset-ollama unit tests pass (fix any failures caused by the topology change before continuing).

- [ ] **Step 5: Commit**

```bash
git add install/macos/nomad install/macos/man/
git commit -m "chore(omlx): ports + inventory + man pages for native-Ollama/oMLX coexistence"
```

---

### Task 6: Phase 1 live verification (human operator on the mini)

> No code. Hand these to the operator after `nomad update` (proxy/script) — the admin image is unchanged in Phase 1.

- [ ] **Step 1:** `ollama run llama3.1` against `:11434` returns a response using the existing model.
- [ ] **Step 2:** admin chat still streams from **oMLX** (proxy now `:11436`); KB/RAG still green; benchmark runs.
- [ ] **Step 3:** `nomad backend omlx` (or reset) does **NOT** kill the `:11434` Ollama (it stays up).
- [ ] **Step 4:** `nomad models pull <small-mlx-model>` reaches oMLX via `:11436` (model appears in the admin AI Assistant list).
- [ ] **Step 5:** `nomad` system-check shows all four daemons (omlx `:8000`, embed `:11435`, proxy `:11436`, general Ollama `:11434`).
- [ ] **Step 6:** Regression — on a separate `ollama`-mode test (or reasoning from the diff), confirm `ollama` mode is unchanged (native Ollama still `0.0.0.0:11434`, no proxy).

**STOP: Phase 1 must be green before Phase 2.**

---

# PHASE 2 — Layer 2: unified local-AI app via the admin GUI

> Backend-aware. Adds real admin code + one host-command. Ships in the admin image (`nomad upgrade`).

### Task 7: Host-command — `ai-lan-expose on|off` (allow-list + host handler)

**Files:**
- Modify: `admin/constants/host_commands.ts` (single-source allow-list)
- Modify: `install/macos/nomad` (host-side handler) and the bridge dispatcher
- Modify: `install/macos/scripts/test-host-command-allowlist.sh`

- [ ] **Step 1: Read the reference command end-to-end**

Read how `upgrade-ollama` / `reset-ollama` are wired: `admin/constants/host_commands.ts` (the allow-list shape), the bridge dispatcher in `install/macos/nomad` (grep `upgrade-ollama` and `reset-ollama`), and the `HostCommandButton` usage in `admin/inertia/pages/settings/apps.tsx` (audit `:275-282`). The new command mirrors these exactly.

- [ ] **Step 2: Add `ai-lan-expose` to the allow-list**

In `admin/constants/host_commands.ts`, add an entry for `ai-lan-expose` mirroring the existing entries. It takes a single constrained argument `on` or `off` (validate against an explicit enum — never pass free-form input to the host). Match the existing entry shape verbatim.

- [ ] **Step 3: Add the host-side handler in `nomad`**

Mirror the `upgrade-ollama`/`reset-ollama` case in the bridge dispatcher. The handler runs `nomad _ai-lan-expose <on|off>` (or inline equivalent) which:
- validates the arg is exactly `on` or `off` (reject otherwise);
- sets the persisted expose flag (the env/config key Task 3 Step 4 reads — write it to the same `.env`/config the install reads);
- rewrites the general-Ollama plist `OLLAMA_HOST` to `0.0.0.0:11434` (on) or `127.0.0.1:11434` (off);
- boots out + bootstraps `com.projectnomad.ollama` to apply the bind (reuse the existing clean-bootout helper, not a raw `launchctl bootout`);
- prints a result line the bridge writes for the admin to poll (match the result format the existing commands use).

- [ ] **Step 4: Update the allow-list drift test**

In `install/macos/scripts/test-host-command-allowlist.sh`, add `ai-lan-expose` to the expected set so the drift guard passes (it currently asserts "allow-list in sync (N commands)").

- [ ] **Step 5: Verify**

Run:
```bash
bash -n install/macos/nomad
bash install/macos/scripts/test-host-command-allowlist.sh
cd admin && npm run typecheck && cd ..
```
Expected: parse clean; allow-list test passes with the new count; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add admin/constants/host_commands.ts install/macos/nomad install/macos/scripts/test-host-command-allowlist.sh
git commit -m "feat(ai-apps): host-command ai-lan-expose on|off (bind flip via the bridge, allow-listed)"
```

---

### Task 8: Admin GUI — "Use from other devices / Connect an app" section

**Files:**
- Modify: `admin/app/controllers/settings_controller.ts` (pass the data the section needs)
- Modify: `admin/inertia/pages/settings/models.tsx` (add the section) — or create `admin/inertia/pages/settings/ai-apps.tsx` + a route if the models page is already large; decide after reading it.
- Reuse: `admin/app/services/ollama_service.ts` (models + pull), `admin/app/services/system_service.ts` (`getSystemInfo` → RAM), the existing `HostCommandButton` component.

- [ ] **Step 1: Read the host page + reusable pieces**

Read `admin/inertia/pages/settings/models.tsx` (size + where a section fits), `admin/inertia/pages/settings/apps.tsx:266-307` (the `HostCommandButton` usage + the backend-aware `aiBackend` prop pattern from commit `129a416`), `settings_controller.ts` `models()`/`apps()` (how `aiBackend`, `isNativeOllama`, models, and system info are passed), and `system_service.getSystemInfo()` (RAM field name).

- [ ] **Step 2: Controller — provide the section's data**

In `settings_controller.ts`, add to the AI settings render props: `aiBackend` (already available), `lanExposed` (read the persisted expose flag), `ramGb` (from `getSystemInfo`), and the host's mDNS name (`nomad.local`) + ports for building connection URLs. Backend-aware: in `ollama` mode the only engine URL is `:11434`; in `omlx` mode provide both oMLX `:8000` (OpenAI/Anthropic) and Ollama `:11434`.

- [ ] **Step 3: GUI section — connection URLs + app links + model picker**

Add a "Use from other devices / Connect an app" section that renders:
- the **connection URLs** (localhost + `nomad.local`), backend-aware, with copy buttons;
- **recommended-app links** (Agent! — note macOS 26.4.1+ — / Zed / Claude-Code-on-local) with their official download URLs and a paste-able config snippet per app (OpenAI base URL for oMLX, Ollama host for `:11434`, Anthropic base URL for Claude Code);
- a **RAM-advised model menu** (reuse the existing models list + pull control; show which sizes fit `ramGb` with the honest "8B ≠ Claude Code" note). Model selection is the **user's** — no auto-pull.

- [ ] **Step 4: GUI — the LAN-expose toggle**

Add a toggle "Use from other devices on my network" wired to a `HostCommandButton`-style control that POSTs `ai-lan-expose on|off` through the bridge (exactly like the `upgrade-ollama` button). Show the warning inline: "Other devices on your network will be able to use (and pull/delete) your local models — only enable on a trusted network." Reflect `lanExposed` state; on success show the `nomad.local:11434` URL. For an untrusted network, show the tunnel guidance (SSH `-L` / Tailscale) instead of toggling.

- [ ] **Step 5: Typecheck**

Run: `cd admin && npm run typecheck && cd ..`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add admin/app/controllers/settings_controller.ts admin/inertia/pages/settings/
git commit -m "feat(ai-apps): admin GUI section — connection URLs, app links, model menu, LAN-expose toggle"
```

---

### Task 9: Broaden the AI help page + install pointer

**Files:**
- Modify: `admin/app/services/docs_service.ts` (`TITLE_OVERRIDES`)
- Modify: `admin/docs/mac-ai-assistant.md` (broaden title H1 + content)
- Modify: `install/macos/nomad` (one-line install pointer)

- [ ] **Step 1: Broaden the nav title**

In `admin/app/services/docs_service.ts`, add to `TITLE_OVERRIDES` (audit `:101-103`, currently only `faq`): `'mac-ai-assistant': 'AI & Local Models'` (or Chris's chosen title — confirm before finalizing). This also fixes the current auto-title "Mac Ai Assistant".

- [ ] **Step 2: Broaden the page content**

Rewrite `admin/docs/mac-ai-assistant.md`: change the H1 beyond "AI Assistant" to match the override, and expand (Markdoc; `{% callout %}` for the security warning) to cover: the built-in assistant, using your own local models (oMLX/Ollama coexistence), the unified app (Agent!/Zed/Claude-Code-local), pointing to the in-admin "Use from other devices" section, local-vs-LAN-vs-tunnel, the user-defined model menu, and the honest model-quality note. (This page is stale; this is its rewrite.)

- [ ] **Step 3: Install pointer**

In `install/macos/nomad`, at the end of a successful install/upgrade summary, add one skippable line: "Set up a local AI app over your models in the admin → Settings → AI." Keep it to a single line; do not run app setup in the script.

- [ ] **Step 4: Verify**

Run:
```bash
cd admin && npm run typecheck && cd ..
bash -n install/macos/nomad
bash install/macos/scripts/test-manpages.sh
```
Expected: typecheck clean; parse clean; man-page guard passes.

- [ ] **Step 5: Commit**

```bash
git add admin/app/services/docs_service.ts admin/docs/mac-ai-assistant.md install/macos/nomad
git commit -m "docs(ai-apps): broaden the AI help page beyond 'AI Assistant' + install pointer to the admin GUI"
```

---

### Task 10: Phase 2 live verification (human operator on the mini)

> After CI builds the `:edge` admin image for the Phase-2 HEAD and the operator runs `nomad upgrade`.

- [ ] **Step 1:** Admin → Settings → AI shows the "Use from other devices / Connect an app" section with backend-correct connection URLs.
- [ ] **Step 2:** Toggle "Use from other devices" **ON** → the general Ollama rebinds to `0.0.0.0:11434` (verify from another LAN device: `curl http://nomad.local:11434/api/tags` succeeds); toggle **OFF** → that curl fails from the other device but `localhost` still works on the mini.
- [ ] **Step 3:** The toggle flips the bind **without** any manual `.env`/`launchctl` editing (bridge-driven); the change survives an agent restart (flag persisted).
- [ ] **Step 4:** A unified app (Agent!/Zed/Open WebUI) on the mini, and one on another LAN device (toggle ON), both reach the models and coexist with the admin + each other.
- [ ] **Step 5:** Bridge security — confirm the allow-list rejects anything but `ai-lan-expose on|off` (the drift test already asserts the set; spot-check that a bogus arg is refused).
- [ ] **Step 6:** Help page at `nomad.local:8080/docs/mac-ai-assistant` shows the broadened title + content and links to the GUI section.
- [ ] **Step 7 (ollama-mode regression):** on an `ollama`-mode install, the same GUI section targets only `:11434`, the toggle is a no-op-or-hidden where the engine is already `0.0.0.0`, and nothing references oMLX/`:11436`.

---

## Self-Review (against the spec)

**Spec coverage:**
- D1 proxy→:11436 → Task 1. D2 admin→:11436 → Task 2. D3 `~/.ollama/models` → Task 3 Step 4. D4 mode-aware + configurable bind → Task 3 Step 4 (read) + Task 7 (flip). D5 reuse `com.projectnomad.ollama` → Task 3. D6 BYO clients → Phase 2 (no bundle). D7 configure-not-bundle → Task 8 (links/configs, no binary). D8 backend-aware → Task 8 Step 2 + Task 10 Step 7. D9 user-defined RAM-advised model → Task 8 Step 3. D10 endpoint/security (loopback default, LAN opt-in, tunnel for untrusted, :11434 already 0.0.0.0) → Tasks 3/7/8 + verification. D11 recommended apps → Task 8 Step 3. D12 GUI delivery → Task 8. D13 install pointer → Task 9 Step 3. D14 bridge + allow-list → Task 7. Pull-routing → Task 4. kv_store migration → Task 2 Step 2. Bootout de-exclusion → Task 3 Step 2. NOMAD_PORTS/inventory/man → Task 5. Broadened help page → Task 9.
- **Gap check:** the pre-existing unauthenticated `:11434` LAN exposure is flagged out-of-scope in the spec (Risks) — correctly NOT a task here; it remains a separate hardening follow-up.

**Placeholder scan:** brownfield "read reference X (path:lines), then mirror it" steps reference concrete existing code (the `upgrade-ollama` command, the `HostCommandButton`, the `ollama-launcher.sh`) — these are real anchors, not TODOs. Code is given verbatim where it is novel (kv_store SQL, `TITLE_OVERRIDES` entry, `NOMAD_PORTS`, bind values). Line anchors carry an explicit "re-verify via grep" instruction.

**Type/name consistency:** `ai-lan-expose on|off` (allow-list, host handler, GUI, drift test) consistent across Tasks 7/8/10. `com.projectnomad.ollama` is the general-Ollama label throughout. Proxy `:11436`, native Ollama `:11434`, oMLX `:8000`, embed `:11435` consistent across all tasks.

**Open items to confirm with Chris during execution:** the broadened help-page title (Task 9 Step 1 placeholder "AI & Local Models"); whether the GUI section lives on `models.tsx` or a new `ai-apps.tsx` (decide after reading the file's size, Task 8 Step 1).
