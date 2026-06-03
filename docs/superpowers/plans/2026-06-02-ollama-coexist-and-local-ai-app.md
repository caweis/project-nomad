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

---

## APPENDIX A — Task 1/2 per-site classification (in-depth audit, 2026-06-02)

Authoritative classification of every `:11434` site (re-verify line numbers via grep before editing — they drift). Rule: post-feature `:11434` is ALWAYS the general/native Ollama (user's models) in BOTH modes; only the oMLX **proxy** moves to `:11436`.

### Mechanical edit set — change `11434 → 11436` (24 lines, all proxy-specific):
`684, 685, 687, 821, 1925, 1945, 1946, 1947, 1951, 1953, 1967, 1994, 2007, 2008, 2010, 2012, 3678, 3857, 3859, 3879, 3887, 5053, 5064, 5076`
(line 821 + the comments are text/label changes; 1967 is THE uvicorn `--port`; 3857/3879/3887 are the omlx-mode pull path; 5053/5064/5076 are `_reset_omlx_stack`.)

### Everything else STAYS `:11434` (do NOT change):
native Ollama checks in `check_stack` ollama-branch (700/701) and `cmd_inventory` else-branch (845–867); `quick-chat.sh` heredoc (1273–1316); `step_ollama_native` (1533–1717, incl. bind 1634); `cmd_models list` (3820–3831) + `cmd_upgrade_models` (4235/4242); `_upgrade_native_ollama` (4046–4051); `cmd_reset_ollama` (5210–5261); benchmark container internal port (5386/5393); all Field Desk (5513–5658); `cmd_upgrade` docstring (3927); `cmd_backend` bootout comment (5100).

### CORRECTIONS to the main plan (apply before editing):
1. **Task 2 must be BACKEND-AWARE (plan bug).** `step_seed_native_ollama_state` (SQL @3537, comment @3516) currently seeds `:11434` unconditionally. Required: seed `http://host.docker.internal:11436` in **omlx** mode, `…:11434` in **ollama** mode. The idempotent UPDATE migration likewise only rewrites `…11434→…11436` **when `$BACKEND == omlx`** (never in ollama mode). Implement via an `if [[ "$BACKEND" == omlx ]]` shell branch around the value.
2. **Embedding pre-pull (2328/2361) — Task 4 addendum.** `step_pull_embedding_quick` checks/pulls on `:11434`. In omlx mode embeddings live on the embed-Ollama `:11435`. Verify and, in omlx mode, route the embedding check/pull to `:11435` (or skip, since `step_ollama_embed` already pulls `nomic-embed-text`). Read `step_pull_embedding_quick` + `step_ollama_embed` in context first.
3. **437 / 5120 — Task 5 addendum.** Add `11436` to `NOMAD_PORTS`. Make the `cmd_backend` success message (5120) backend-aware: "admin → :11436" when target=omlx, "→ :11434" when target=ollama (or drop the port).

### OPEN DECISION for Chris — user-facing "AI API" URL banners (2116, 2148, 3706, 3747):
These print a "your AI API is at http://…:11434" URL to the user (install prompt + completion banners + the hostname-rename docstring). In **omlx** mode there are now two relevant endpoints: the user's **general Ollama** (`:11434`, their models, for Ollama clients/Field Desk) and the **admin/oMLX proxy** (`:11436`). Decision: in omlx mode should these banners show (a) `:11434` only (the user's Ollama), (b) `:11436` only (the admin AI/proxy), or (c) both, labeled? Recommendation: **(c) both, labeled** — "Ollama (your models): :11434 · AI Assistant API (oMLX): :11436" — most accurate; backend-aware (ollama mode shows just `:11434`).

---

## APPENDIX B — Phase 1 status + banner decision (2026-06-02)

### DONE + pushed (statically verified: bash -n, test-reset-ollama 23/23, test-manpages, test-host-command-allowlist):
- Task 1 `17b6164` — proxy 11434→11436 (24 sites)
- Task 2 `76a07d2` — backend-aware admin URL (`_admin_ollama_url` + `dc()` injection + compose `${NOMAD_OLLAMA_URL:-…}` ×2 + self-guarding `ai.remoteOllamaUrl` seed/migration)
- Task 3 `64c55f5` — general Ollama runs alongside oMLX (bootout de-exclusion, mode-aware loopback bind + `~/.ollama/models`, started in install/reset/switch; `BACKEND=$target` before switch steps)
- Task 4 + ports `5860e75` — skip `:11434` embedding pre-pull in omlx mode; `NOMAD_PORTS` += `11435 11436 8000`

### REMAINING Phase 1 — cosmetic/docs only (functional core is complete):

**B1. Banner URLs — DECISION: "both, labeled".** In omlx mode show BOTH the user's Ollama (`:11434`, their models) AND the oMLX proxy (`:11436`, admin AI), labeled; in ollama mode show just `:11434`. Add a DRY helper and use it at all spots:
```bash
# Backend-aware AI-endpoint banner line(s). $1 = hostname for the .local URL.
_ai_endpoint_lines() {
  local h="${1:-localhost}"; _load_backend 2>/dev/null || true
  if [[ "${BACKEND:-ollama}" == "omlx" ]]; then
    printf '    http://localhost:11434   http://%s.local:11434  (Ollama — your models)\n' "$h"
    printf '    http://localhost:11436   http://%s.local:11436  (AI Assistant API — oMLX)\n' "$h"
  else
    printf '    http://localhost:11434   http://%s.local:11434  (AI API)\n' "$h"
  fi
}
```
Spots to update (re-verify lines via grep `'(AI API)'|'Ollama API'|'switched backend'`):
  - **~2145** docstring comment in `step_set_local_hostname` (`# http://nomad.local:11434  Ollama API`) — note both endpoints.
  - **~2177** interactive rename prompt (`http://${target}.local:11434  AI API`) — use the helper (via `$(_ai_endpoint_lines "$target")` in the heredoc).
  - **~3749** "Admin is up" banner — replace the hardcoded `(AI API)` line with `$(_ai_endpoint_lines "$_hostname")`.
  - **completion-summary banner** (the second `…localhost:11434 … ${_hostname}.local:11434` block, originally ~3747; grep to locate) — same helper.
  - **~5175** `cmd_backend` success msg `"…admin still talks to :11434…"` → backend-aware (`:11436` when target=omlx, `:11434` when ollama), or drop the port.

**B2. omlx inventory** (`cmd_inventory`, ~818–875): make the native-Ollama inventory block run in omlx mode too (so `nomad` system-check reports all four daemons: omlx :8000, embed :11435, proxy :11436, general Ollama :11434). The `:11436` comment at ~821 is already correct (Task 1).

**B3. Man-page CONTENT** (drift guard already passes — this is accuracy, not drift): `nomad-backend.1` (daemon list + ports — now proxy :11436 + general Ollama coexisting on :11434 in omlx), `nomad.1`, `nomad-reset-ollama.1`.

### Then PHASE 2 (main plan Tasks 7–10): host-command `ai-lan-expose` + allow-list, admin GUI section, broadened `mac-ai-assistant` help page. Build AFTER Phase 1 is live-verified on the mini (Task 6 checklist).

---

## APPENDIX C — Ollama runner-less on macOS 26 (Tahoe) → switch nomad to the official app (BLOCKER, found 2026-06-02)

**Diagnosis (proven live):** Homebrew's `ollama` **formula** 0.30.0 `arm64_tahoe` bottle is a **runner-less stub** (31 MB, only `mlx_metal_v3` in libexec, NO `llama-server`). The daemon serves `/api/tags` (so tags-only health checks pass) but every GGUF load 500s: `llama-server binary not found … Run 'cmake … build …' first`. This breaks **chat (:11434) AND RAG embeddings (:11435)** machine-wide. `brew reinstall` re-pours the same stub. The admin's *chat* still works only because it's oMLX/MLX (:8000), which doesn't use the Ollama runner.

**Fix proven:** the official Ollama app (cask `brew install --cask ollama`, binary `/Applications/Ollama.app/Contents/Resources/ollama`) bundles the complete Metal + llama.cpp runner. Standalone `serve` on a temp port generated `OK` with the user's `llama3.1:8b-instruct-q8_0` from `~/.ollama/models`. **So: use the official app, not the formula, on macOS.**

**Resolution sites in `install/macos/nomad` (re-verify via grep):**
- `ensure_ollama_path` ~514-516 + the early check loop ~1257 (candidate paths `/opt/homebrew/bin/ollama` `/usr/local/bin/ollama`)
- `brew install ollama` ~1296, 1302, 1549 (the formula)
- `ollama_bin="$(command -v ollama)"` ~1585 (step_ollama_native launcher) and ~1902 (step_ollama_embed); baked into the plists/launcher at write time.

**Fix design:**
1. **Install via the cask** (`brew install --cask ollama`) on macOS — the formula is runner-incomplete on Tahoe. (Keep a formula fallback only if it actually ships `llama-server`.)
2. **`_resolve_ollama_bin` helper** preferring the app binary (`/Applications/Ollama.app/Contents/Resources/ollama`, then `~/Applications/...`, then `command -v ollama`) AND requiring the runner present (`find` for `llama-server` near the binary). Use it at the resolution sites so the launchers bake the working binary.
3. **Runner verification** after install — `die`/`warn` loudly if no `llama-server` (this is the original hardening ask; it would have caught this at install).
4. **⚠ App auto-server wrinkle (needs live iteration on the mini):** the official app may register a login-item / menu-bar server on `:11434`. nomad must run the app's binary **headless via its own LaunchAgent** (as the proof did) and ensure the app's own auto-server does NOT also bind `:11434` (disable the login item, or `defaults`/`launchctl disable` the app's agent). Verify no double-bind.
5. Regenerate launchers (step_ollama_native/embed rewrite plists) on `nomad update`/`reset`; both the general (:11434) and embed (:11435) agents must use the app binary.

**Verify:** generation on :11434 returns text; embed on :11435 returns a vector; `nomad check` AI section green; no `:11434` double-bind; RAG ingestion clears.

**Manual stopgap (chat only, non-persistent):** `launchctl bootout gui/$(id -u)/com.projectnomad.ollama` then run `/Applications/Ollama.app/Contents/Resources/ollama serve` with `OLLAMA_HOST=127.0.0.1:11434 OLLAMA_MODELS=~/.ollama/models`. Dies on logout; nomad reset/update restores the broken formula agent until the code fix lands.

**Priority: this BLOCKS chat + RAG + Phase 2. Implement before Phase 2.**

**STATUS (2026-06-02) — detection/hardening slice (#3) LANDED.** The runner-verify + real-inference probe is in (statically verified: `bash -n` + all `test-*.sh` green, incl. new `test-ollama-runner-health.sh` 14/14):
- `dad83fb` — shared helpers: `_ollama_runner_present`/`_ollama_runner_dirs` (static `llama-server` check, brew Cellar + `lib/ollama`), `_classify_ollama_probe` (pure, tested), `_ollama_infer_probe` (real generate/embed), `_ollama_first_model`, `_ollama_runner_remediation`, `_ollama_runner_fix_hint`.
- `bcb808d` — install wiring: static pre-flight after `brew install` + post-bootstrap 1-token generate in `step_ollama_native`; `/api/embed` probe after the pull in `step_ollama_embed`. Non-fatal (loud `warn` + sticky `NOMAD_INSTALL_DEGRADED`) since these run before admin/compose.
- `c2ffda4` — `nomad check` (stack) + `inventory` now run real inference probes (🔴 when the daemon IS the backend, 🟡 for the coexisting general Ollama in oMLX mode) and an `inv_broken` runner line — not just `/api/tags`.
- man pages: `nomad-check.1` (probe behavior) + `nomad-reset-ollama.1` (TROUBLESHOOTING: runner-less formula → official app).
- **Remediation wording corrected to the live finding:** all hints now say `brew install --cask ollama` / official app, and explicitly note `brew reinstall` of the formula re-pours the same stub. The task's original "recommend brew reinstall" wording was superseded by this Appendix's proof.

**STILL OPEN (BLOCKER for chat/RAG — needs LIVE mini iteration):** items #1 (cask install in place of the formula), #2 (`_resolve_ollama_bin` to bake the app binary into the launchers), #4 (app auto-server `:11434` double-bind), #5 (regenerate launchers on update/reset). The hardening above will now *detect and loudly report* the broken state until that migration lands; it does not yet *fix* the install method.

---

## APPENDIX D — Testing regime (decisions, 2026-06-02)

**Why now:** the system is 4 daemons × 2 backends × (brew-formula | official-app). The gap that bit us (runner-less Ollama): health checks verified **liveness** (`/api/tags` answered) while **function** (generate/embed) was dead. **Guiding principle: test function, not liveness.**

**Decisions (Chris):**
- **Live host:** the **mini**, via a `nomad selftest` command. CI can't run the full stack (no Apple-Silicon/Metal/models on GitHub runners) → CI keeps the static/unit layer only.
- **Triggers:** **manual `nomad selftest` + a pre/post-deploy gate** (`nomad update`/`upgrade` runs selftest after deploying, flags 🔴 on functional failure — would have caught the runner-less Ollama). (Scheduled/cron not chosen; optional later.)
- **Build order:** **Ollama fix → Phase 2 → `selftest`.** Formalize the full regime last — BUT bake the functional runner-verify + generate/embed probe into the Ollama fix (that's the first slice).

**Three layers:**
1. **Static/CI** (extend `checks.yml`): `bash -n`, **shellcheck** on `nomad`, `tsc`, drift guards, **+ unit tests for the pure-logic helpers** (`_resolve_ollama_bin`, `_admin_ollama_url`, backend/port decisions — stubbed env, no daemons).
2. **Functional smoke — `nomad selftest`** (live, mini): per active backend — topology (4 daemons) · admin→correct port · **runner present** · **real generate→text** · **real embed→vector** · coexistence (`:11434`+`:11436`) · backend-switch round-trip (+ doesn't kill `:11434`) · a real KB ingest for e2e RAG.
3. **Regression anchors** (permanent cases): runner-present-after-install · generate-returns-text · embed-returns-vector · switch-doesn't-kill-`:11434` · admin-`OLLAMA_HOST`-matches-backend · seed-is-backend-aware.

---

## POST-COMPACT RESUME — START HERE (2026-06-02 EOD)

**State:** design fully converged; **Phase 1 SHIPPED + LIVE-VERIFIED** on the mini; **one blocker open** (broken brew Ollama). Repo `caweis/project-nomad`, develop on `main`. Deploy host = the Mac mini; the agent can't SSH it — Chris runs live checks + pastes output.

**Durable docs:**
- Spec: `docs/superpowers/specs/2026-06-02-ollama-coexist-with-omlx-design.md` (v3, decisions D1–D14).
- Plan: THIS file + Appendix A (per-site `:11434` classification), B (banner decision + Phase-1 cosmetics — DONE), C (**Ollama-on-Tahoe blocker + proven fix spec**), D (testing regime).

**Done + on origin/main** (Phase 1 = Ollama↔oMLX coexistence, omlx mode):
`17b6164` proxy 11434→11436 · `76a07d2` backend-aware admin URL · `64c55f5` general Ollama coexists · `5860e75` embed-skip+ports · `9b4337c` B1 banners · `b16b149` B2 check/inventory · `ba757ef` B3 man pages. Live: 5/6 checks green (topology, coexistence, ports, loopback bind, admin→`:11436`). Check 6 (generation) failed → root cause = broken brew Ollama, NOT Phase 1.

**Also shipped 2026-06-03 (follow-on session):**
`4ef68a2` **Content Explorer fix** — Kiwix moved its OPDS catalog off `browse.library.kiwix.org` (now 503) to `opds.library.kiwix.org`; one-line host swap in `admin/app/services/zim_service.ts` (live-confirmed on the mini). · `2a37c1e` graceful **"catalog unavailable" offline empty-state** (`classifyCatalogFetchError` + typed `catalog_unavailable` + calm card; unit tests, helper runtime-verified 11/11). · `de5c019` **Easy Setup wizard**: AI Model cards show "Installed" badges (parity with Wikipedia cards) + backend-aware (`aiBackend` prop; omlx note). · `a30d7bb` **C-bis DONE** — backend-aware "Update AI Assistant" (`nomad upgrade omlx` + `upgrade-omlx` host command + allow-list/run_cmd/drift test + `settings_controller` passes `aiBackend` + `update.tsx` dispatches per backend + man page). All statically verified (bash -n, 3 test scripts, tsc).

**NEXT ACTIONS, in order (Chris's chosen build order):**
1. **[BLOCKER — RAG FIXED 2026-06-03, `64c5a9a`] Ollama runner.** Brew ollama *formula* on macOS 26 is runner-less → all GGUF inference 500s ("llama-server binary not found"). LIVE-PROVEN fix: the official Ollama.app *binary* (`/Applications/Ollama.app/Contents/Resources/ollama`) carries a working runtime-fetched runner (embedded a vector in 0.3s; the formula 500'd). Shipped `_resolve_ollama_bin` (prefer the app binary, fall back to PATH; `NOMAD_OLLAMA_BIN` override) + routed `step_ollama_embed` (:11435) and `step_ollama_native` (:11434) through it + `_ollama_runner_present` reports present for the app binary. **VERIFIED on the mini:** `nomad upgrade`'s embed probe now prints "✓ embed Ollama inference OK (RAG embeddings working)"; embed agent runs the app binary; `:11435` and `:11434` both return real vectors. RAG is alive.
   - **REMAINING (the `:11434` ownership decision + reset hardening):** even after quitting the Ollama.app, `step_ollama_native`'s reset still ends with "could not free :11434" and the holder PID changes between runs → something (likely nomad's own `com.projectnomad.ollama` KeepAlive racing the kill — `bootout` is `|| true`, silent-fail) keeps respawning a *working* ollama on :11434. The daemon is healthy; the reset just can't cleanly tear-down-and-rebind an already-serving port, so `nomad upgrade` exits non-zero with a scary `die ":11434 must be free"`. FIX (per Chris's A/B pick): **A** nomad owns :11434 — robust bootout (disable KeepAlive before kill) + idempotent "already-healthy → leave it" + disable the app's login-item auto-server; **B** app owns :11434 — skip nomad's :11434 agent in omlx mode, just verify the app serves it. Either kills the `die`. Recommended **A** (also keeps Phase-2 `ai-lan-expose` coherent). Needs one live deploy-test loop on the mini. Also follow-up: auto-install the cask app on a fresh install when absent.
2. **Phase 2 — Layer 2 GUI** (main plan Tasks 7–10): admin "Use from other devices / Connect an app" section + `ai-lan-expose` host-command + allow-list + broadened `mac-ai-assistant` help page. After the Ollama fix (Phase 2 is moot until Ollama generates). NOTE: `ai-lan-expose` is security-sensitive (opt-in LAN exposure of the general Ollama) — do NOT build it autonomously without Chris's review of the bind/security model.
3. **Testing regime — `nomad selftest`** (Appendix D): mini-only; manual + pre/post-deploy gate.

**BACKLOG (deferred features, not yet scheduled):**
- **Full MLX model catalog for the omlx chat engine.** The admin has no MLX model catalog or MLX installed-model detection (it only queries Ollama via `/api/tags`). Easy Setup + AI Settings show Ollama models; on omlx they're labeled "optional coexisting Ollama models." A real MLX catalog (browse/select/download MLX weights + installed badges for the MLX *chat* engine) is its own larger feature: needs an MLX model source/manifest, installed-detection against the `mlx-models` store, and wizard/AI-settings UI. (Chris: "backlog this — a full MLX catalog would be its own larger feature," 2026-06-03.)

**Spawned task chips:** "Verify Ollama runner at install" (now superseded/expanded by Appendix C — the Ollama fix IS this) · "Fix AI Assistant version display" (earlier, separate — may already be merged; verify).

**Standing constraints:** develop on main; subagents ≥ sonnet; **in-depth code verification** (per-site classify + `bash -n`/`test-*.sh`/`tsc` + diff review, NOT blind sed — it caught the seed bug + the runner-less Ollama); Workflow multi-agent tool needs explicit opt-in; security posture (oMLX `:8000` + embed `:11435` loopback; `:11434`/`:11436` are `0.0.0.0` for admin reach; LAN-expose is opt-in).

---

## APPENDIX C-bis — System Update buttons + `nomad upgrade ollama` (part of the Ollama fix)

The admin **System Update** page (`/settings/update`, `inertia/pages/settings/update.tsx`) has three host-command-bridge buttons (all in the allow-list `admin/constants/host_commands.ts`):
- **Update Command Center** → `upgrade-admin` → `nomad upgrade admin` (admin image). OK as-is.
- **Update AI Assistant** → `upgrade-ollama` → `nomad upgrade ollama` → `_upgrade_native_ollama` → `brew upgrade ollama` (the **formula**). ⚠ On macOS 26 this upgrades the runner-less stub — so the button does NOT fix Ollama. **The Ollama fix (Appendix C) MUST also update the `upgrade-ollama` host path** to use the official app (`brew upgrade --cask ollama`, or re-run the official installer) + re-verify the runner, so this button actually repairs/updates Ollama.
- **Update Everything** → `upgrade-all` → `nomad upgrade` (full self-updating stack). Inherits the above once `_upgrade_native_ollama` is fixed.

**Testing-regime coverage:** `nomad selftest` (Appendix D) should include a bridge round-trip — dispatch a benign allow-listed host command (e.g. a dry-run `upgrade --check`) and confirm it executes + returns a result — so the System Update buttons (and the Phase-2 `ai-lan-expose` toggle, same mechanism) are verified, not just assumed. The bridge LaunchAgent being alive is a precondition to check.

**Quick manual verify (any time):** click **Update Command Center** (safe admin re-pull) and confirm it completes; or from a Terminal `nomad upgrade --check` (dry run). Confirm the host-command-bridge LaunchAgent is loaded if a button hangs.

### C-bis UPDATE — "Update AI Assistant" is BACKEND-DEPENDENT (same bug class as 129a416)

**STATUS: DONE — `a30d7bb` (2026-06-03).** All four fix-scope items shipped + statically verified (bash -n, test-host-command-allowlist 7-in-sync, test-manpages 32↔pages, tsc). One residual still tied to the Appendix-C Ollama blocker: `_upgrade_native_ollama` (the `upgrade-ollama` path) still uses `brew upgrade ollama` (the formula) — switching it to the official cask happens with the Ollama fix.

The System Update "Update AI Assistant" button → `upgrade-ollama` is wrong in **omlx mode**: there the AI Assistant *is* oMLX, so updating it should update the **oMLX stack**, not the Ollama formula (which is just embeddings + the coexisting general Ollama there). It must be backend-aware — exactly like the Apps-page button fixed in `129a416`, and the `ai-lan-expose` toggle.

Confirmed gaps (re-verify lines):
- `cmd_upgrade` has **no `omlx)` arm** (only `all`/`ollama|nomad_ollama`/`kiwix…`/`admin|mysql|redis|dozzle|updater`, ~4273-4308) — there is no `nomad upgrade omlx` to dispatch to yet.
- `update.tsx` (~234) receives `isNativeOllama` but **not** `aiBackend`; `settings_controller.update()` doesn't pass it.

Fix scope (folds into Phase 2 / the admin host-command work; do alongside the Appendix-C Ollama fix):
1. **nomad:** add an `omlx)` arm to `cmd_upgrade` → upgrade the oMLX stack (brew upgrade the `omlx` binary + `_reset_omlx_stack`).
2. **allow-list:** add `upgrade-omlx` to `admin/constants/host_commands.ts` + the `run_cmd` case in `nomad` + `test-host-command-allowlist.sh`.
3. **controller:** `settings_controller.update()` passes `aiBackend`.
4. **update.tsx:** "Update AI Assistant" dispatches `upgrade-omlx` (omlx) / `upgrade-ollama` (ollama), relabeled per engine ("Apple MLX" vs "Ollama"). (And `upgrade-ollama` itself switches to the cask per C-bis.)

Reaffirms the lesson: a control whose correct *action* varies by backend must be backend-aware, or it's a bug. (preferences/anti-patterns drawer 24f581c8.)
