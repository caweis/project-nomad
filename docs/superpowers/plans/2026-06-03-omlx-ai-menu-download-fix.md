---
type: implementation-plan
status: ready-to-execute
date: 2026-06-03
project: project-nomad (macOS/Apple-Silicon fork)
feature: Fix AI-menu model download in oMLX mode (scoped correctness fix)
decided_by: Chris (2026-06-03) — chose "Scoped correctness fix now" over stopgap/defer
tags: [nomad, omlx, proxy, admin, model-download, bugfix]
---

# Fix: AI-menu model download in oMLX mode

> **For agentic workers:** execute task-by-task; verify each before moving on. Develop on `main`.

**Goal:** Make the admin web UI's model download work in oMLX mode, so a user can pick a model in Easy-Setup or Settings → AI and it actually downloads (as MLX, via the proxy).

## Root cause (confirmed from code, 2026-06-03)

The proxy's `_resolve_mlx_repo` (`install/macos/omlx-proxy/vendor/src/routers/nomad_pull.py:43`) only accepts (a) an **exact** key in `model_map.json`, or (b) a full `mlx-community/…` repo. But the admin sends names from a different namespace:
- **Easy-Setup** sends the base `model.name` (e.g. `llama3.1`) — `inertia/pages/easy-setup/index.tsx:412` (`selectedAiModels.map(api.downloadModel)`), populated by `toggleAiModel(model.name)` at `:865`. A base name can never equal a key like `llama3.1:8b`, and is size-ambiguous in oMLX. → always refused.
- The admin catalog's **tags are quant-suffixed** (fallback shows `llama3.1:8b-text-q4_1`, `llama3.2:1b-text-q2_K`, `deepseek-r1:1.5b` in `constants/ollama.ts:25`), none of which equal the clean `model_map` keys (`llama3.1:8b`, `llama3.2:1b`, `deepseek-r1:32b/70b`). → refused.

`model_map.json` keys (the only pullable names today): `llama3.1:8b · llama3.2:1b · llama3.2:3b · llama3.3:70b · qwen3:14b · qwen3:32b · qwen2.5:72b · qwen2.5-coder:7b/14b/32b · gemma3:1b/4b/12b/27b · mistral-small:24b · deepseek-r1:32b/70b · phi4:14b · nomic-embed-text · mxbai-embed-large`. The CLI works because `nomad models pull <tier>` sends these exact keys.

`/api/tags` advertises **oMLX basenames** (e.g. `Qwen3-32B-4bit`, `gemma-3-12b-it-4bit`) — the basenames of the `model_map` *values* (`mlx-community/Qwen3-32B-4bit`, …). So there is a clean, deterministic correspondence between what `/api/tags` lists and the curated map — no heuristic needed.

### Update 2026-06-03 (post-redis confirmation)

The actual stuck job (`ab8648f2f475fdbe`) was `{"modelName":"gemma4:latest"}` — a **nonexistent** model (there is no Gemma 4). That pull would fail on any backend; the proxy correctly refuses it. So the *immediate* failure Chris saw was a bad name, NOT proof the menu fails for valid models. However, the namespace bug above is still **code-proven** for valid models (Easy-Setup base names + quant-suffixed tags miss the clean map keys), so this fix stands. Added scope: the admin swallows the proxy's real error (`refusing to pull unmapped model …`) into a generic "Failed to download model." — surface the actual stream error so a typo like `gemma4` gives useful feedback (Task 2).

## Design — symmetry

Whatever `/api/tags` lists as available MUST be pullable via `/api/pull`. Achieve it with three coordinated changes:

1. **Proxy resolver reverse-lookup** — accept a bare oMLX basename by reverse-looking-up the `model_map` values. (`/api/tags` names become pullable.)
2. **Admin oMLX-aware catalog** — in oMLX mode, source the AI-menu's available-models list from the proxy's pullable set (via `/api/tags`), not the generic Ollama remote catalog, and send exact pullable names.
3. **Easy-Setup sends a specific name** — send the chosen tag/exact name, not the base `model.name` (also correct for the Ollama backend; matches Settings' existing `tag.name` behavior).

---

## Task 1 — Proxy: reverse-lookup bare oMLX basenames  ✅ DONE (34a0a2c, verified 8 cases)

**Files:**
- Modify: `install/macos/omlx-proxy/vendor/src/routers/nomad_pull.py` (`_resolve_mlx_repo`, ~line 43)
- Test: `install/macos/omlx-proxy/tests/test_nomad_pull_allowlist.py`

- [ ] **Step 1 — failing test:** add a case asserting `_resolve_mlx_repo("Qwen3-32B-4bit")` returns `"mlx-community/Qwen3-32B-4bit"` when `model_map` contains `"qwen3:32b": "mlx-community/Qwen3-32B-4bit"`, and that an unknown basename still returns `""`. (Mock `load_model_mappings` as the existing tests do.)
- [ ] **Step 2 — run, confirm it fails.**
- [ ] **Step 3 — implement** the reverse-lookup in `_resolve_mlx_repo`, AFTER the exact-key check and BEFORE the `mlx-community/` passthrough:

```python
    if name in mapping:
        return mapping[name]
    # Accept the bare repo basename that /api/tags advertises — symmetry:
    # anything we list as available must be pullable. Reverse-lookup the
    # curated map's values by basename (deterministic, no guessing).
    for repo in mapping.values():
        if isinstance(repo, str) and "/" in repo and repo.rsplit("/", 1)[-1] == name:
            return repo
    if name.startswith("mlx-community/"):
        ...  # existing validation unchanged
```

- [ ] **Step 4 — run pytest** (`install/macos/omlx-proxy/tests/`), confirm green (existing allow-list rejections still hold — `_comment` value has no `/` basename collision; unsafe names still rejected by the existing tests).
- [ ] **Step 5 — commit.**

## Task 2 — Admin: oMLX-aware available-models in the AI menu

**Files:**
- Modify: `admin/app/services/ollama_service.ts` (`getAvailableModels`, ~line 213) — in oMLX mode, return the proxy-pullable set (derive from `/api/tags` / the proxy's catalog) instead of the remote Ollama catalog. Map each to a `NomadOllamaModel` whose `tags[0].name` is the exact pullable name (the oMLX basename).
- Modify: `admin/app/controllers/easy_setup_controller.ts` + `settings_controller.ts` if they need to pass `aiBackend` to the picker (they already pass it per `de5c019`/`a30d7bb` — verify).
- Test: `admin` typecheck + a unit check of the oMLX branch via `npx tsx` (japa hangs locally).

- [ ] **Step 1** — read `getAvailableModels` (213–330) and the `/api/tags` shape (already known: `{models:[{name, ...}]}`). Decide the oMLX catalog shape (one `NomadOllamaModel` per pullable basename; `name`=basename, `tags:[{name: basename, size, …}]`).
- [ ] **Step 2** — implement the oMLX branch (guard on `env.get('NOMAD_AI_BACKEND')==='omlx'`), returning the pullable set; keep the Ollama path unchanged.
- [ ] **Step 3** — verify exact pullable names round-trip: the name the card sends == a name the proxy resolver now accepts (Task 1).
- [ ] **Step 4 — error propagation:** in `ollama_service.ts` `downloadModel` (catch ~88–94), surface the actual error (the proxy's stream `error` frame / the thrown message) instead of the generic "Failed to download model." So a nonexistent/unmapped name (e.g. `gemma4:latest`) yields "model not available" rather than an opaque failure. Thread it through `DownloadModelJob` `failedReason` so the UI can show it.
- [ ] **Step 5** — `cd admin && npm run typecheck` clean.
- [ ] **Step 6 — commit.**

## Task 3 — Easy-Setup sends the exact name, not the base

**Files:**
- Modify: `admin/inertia/pages/easy-setup/index.tsx` (~line 412 download dispatch, ~line 865 `toggleAiModel(model.name)`).

- [ ] **Step 1** — change the selection/dispatch to use the specific tag name (`model.tags[0].name`) rather than `model.name`, so the dispatched `modelName` is a pullable string in both backends. (Settings already uses `tag.name`.)
- [ ] **Step 2** — `cd admin && npm run typecheck` clean.
- [ ] **Step 3 — commit.**

## Task 4 — Verify end-to-end

- [ ] `bash -n install/macos/nomad` (untouched, but confirm).
- [ ] proxy pytest green; `cd admin && npm run typecheck` clean.
- [ ] **On the mini (operator):** Easy-Setup → pick a model → it downloads (MLX, progress shows); Settings → AI → pick a model → downloads; `docker logs nomad_admin_worker` shows success, not "Failed to download model."; the proxy reverse-lookup resolves the sent name. Then it's clean for the `0.2.0-macos` bump + show-and-tell.

## Notes / risks

- **Deploy chain:** Task 1 is the proxy (host bundle — reaches the mini via `nomad upgrade`/`update` bundle refresh). Tasks 2–3 are admin (GHCR image — reach the mini via the `:edge` rebuild on push + `nomad upgrade admin`). Both must land for the menu to work end-to-end.
- This is the **honest subset** of the deferred full MLX-catalog feature; that larger feature (browse/select/installed-badges for MLX) still stands.
- Keep `model_map.json` as the single source of pullable truth; do not duplicate the list in the admin — derive it via the proxy.
