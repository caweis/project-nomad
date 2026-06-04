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

The actual stuck job (`ab8648f2f475fdbe`) was `{"modelName":"gemma4:latest"}`. gemma4 is a **real, recent** model (ollama.com/library/gemma4) — it is simply **not in the proxy's curated `model_map.json` and not in oMLX's `/api/tags` catalog**, so the proxy refuses it. This **confirms the bug with a valid model**: the admin's remote catalog is current (includes gemma4, qwen3.5, gpt-oss) and far exceeds what the proxy/oMLX can serve. The scoped fix makes the oMLX menu **honest** — offer only the oMLX-pullable set — so brand-new models like gemma4 won't appear until either (a) added to `model_map.json` (if an mlx-community conversion exists), or (b) the deferred **full MLX-catalog** feature lands (dynamic mlx-community resolution). Added scope: the admin swallows the proxy's real error (`refusing to pull unmapped model …`) into a generic "Failed to download model." — surface the actual stream error so the UI explains *why* (Task 2). (Correction: an earlier note here wrongly called gemma4 nonexistent — a fact-check miss; gemma4 is real.)

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

## Task 2 — Admin: show full catalog, disable the non-MLX-available (oMLX mode)

**Decision (Chris, 2026-06-03):** keep the full live catalog visible in oMLX mode; grey out / annotate models that aren't available as MLX ("not available as MLX yet"). This needs the admin to know which catalog models the proxy can serve — single source of truth is the proxy's `model_map.json`, exposed via a new endpoint (Task 2a).

### Task 2a — Proxy: expose the pullable set  ✅ DONE (this session)
- `GET /api/nomad/pullable` in `nomad_pull.py` returns `{"models": [<model_map keys>]}` (the Ollama-style names the proxy can resolve to MLX). Single source = `model_map.json`. The admin uses this to compute MLX-availability.

### Refinement (Chris, 2026-06-04) — resolve a pull-name, not a boolean

Audit found the plan's family-match **boolean** breaks the plan's own symmetry
goal: a model can match a pullable family yet have no pullable key at its
recommended size (e.g. `deepseek-r1` — catalog shows `:1.5b`, but the only MLX
builds are `:32b`/`:70b`; `qwen2.5-coder` — small Ollama tags, mapped only at
7b+). Family-match would show such models "available," then the download would
refuse. Chris chose **Option B**: annotate each catalog model with
`mlxPullName` — the *exact* smallest pullable `model_map` key for its family —
so **availability ⟺ pullability**, and the UI sends `mlxPullName` (never the
catalog name/tag). A selectable model always resolves at the proxy.

### Task 2b — Admin: availability flag + render  ✅ DONE (`70b818d`)
**Files:**
- Modify: `admin/app/services/ollama_service.ts` (`getAvailableModels`, ~213) — in oMLX mode (`env.get('NOMAD_AI_BACKEND')==='omlx'`), fetch `GET <OLLAMA_HOST>/api/nomad/pullable`, then annotate each catalog `NomadOllamaModel` with `mlxAvailable: boolean` = its family (base name) appears among the pullable keys' families (split key on `:`). Keep the full catalog; do NOT drop entries. Ollama backend path unchanged.
- Modify: `admin/types/ollama.ts` — add optional `mlxAvailable?: boolean` to `NomadOllamaModel`.
- Modify: `admin/inertia/pages/easy-setup/index.tsx` + `admin/inertia/pages/settings/models.tsx` — when `mlxAvailable === false`, render the card disabled (non-selectable) with a "Not available as MLX yet" annotation.
- Modify (error propagation): `admin/app/services/ollama_service.ts` `downloadModel` catch (~88–94) — surface the actual error (the stream `error` frame / thrown message) instead of generic "Failed to download model."; thread through `DownloadModelJob` `failedReason` so the UI explains *why*.
- Verify: `cd admin && npm run typecheck` clean; logic of the availability annotation via `npx tsx`; render check on the mini.

- [x] **pull-name derivation** — pure `resolveMlxPullName`/`withMlxPullNames` in `admin/util/mlx.ts` (smallest pullable key whose family == model.name); fetched once per `getAvailableModels` via `fetchMlxPullableKeys` (oMLX-gated, fails open on a proxy blip)
- [x] `mlxPullName?: string` type addition (`admin/types/ollama.ts`) — supersedes the planned `mlxAvailable` boolean (presence = availability)
- [x] disable + annotate unavailable cards (both pages) + show the MLX target on enabled cards
- [x] error propagation — `downloadModel` returns the real error message → `DownloadModelJob` `failedReason` (was swallowed into a generic string)
- [x] typecheck clean; resolver unit-tested (`tests/unit/mlx.spec.ts` for CI; standalone Node check 15/15 locally, since the Japa app-boot needs DB/Redis)

## Task 3 — Easy-Setup sends the exact name, not the base  ✅ DONE (`70b818d`)

**Files:**
- Modified: `admin/inertia/pages/easy-setup/index.tsx` (download dispatch + `toggleAiModel`).

- [x] Selection stays keyed by the display name; a new `resolveDownloadTarget` maps it at dispatch — oMLX → `mlxPullName`, Ollama → `tags[0].name` (not the size-ambiguous base name; matches Settings).
- [x] `npm run typecheck` clean.
- [x] committed (`70b818d`, same commit as Task 2b — one coherent admin-side change).

## Task 4 — Verify end-to-end

- [ ] `bash -n install/macos/nomad` (untouched, but confirm).
- [ ] proxy pytest green; `cd admin && npm run typecheck` clean.
- [ ] **On the mini (operator):** Easy-Setup → pick a model → it downloads (MLX, progress shows); Settings → AI → pick a model → downloads; `docker logs nomad_admin_worker` shows success, not "Failed to download model."; the proxy reverse-lookup resolves the sent name. Then it's clean for the `0.2.0-macos` bump + show-and-tell.

## Notes / risks

- **Deploy chain:** Task 1 is the proxy (host bundle — reaches the mini via `nomad upgrade`/`update` bundle refresh). Tasks 2–3 are admin (GHCR image — reach the mini via the `:edge` rebuild on push + `nomad upgrade admin`). Both must land for the menu to work end-to-end.
- This is the **honest subset** of the deferred full MLX-catalog feature; that larger feature (browse/select/installed-badges for MLX) still stands.
- Keep `model_map.json` as the single source of pullable truth; do not duplicate the list in the admin — derive it via the proxy.
