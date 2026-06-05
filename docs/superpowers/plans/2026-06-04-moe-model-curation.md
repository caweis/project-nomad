---
type: implementation-plan
status: ready-to-execute (Phase 1); Phase 2 needs a scope decision
date: 2026-06-04
project: project-nomad (macOS/Apple-Silicon fork)
feature: Curate MoE / right-sized models for medium Macs (Qwen3-30B-A3B et al.)
decided_by: Chris (2026-06-04) — "plan for #1" (the MoE curation lever)
tags: [nomad, omlx, model-map, tiers, moe, qwen3, deepseek]
---

# MoE model curation for medium Apple-Silicon Macs

**Why:** On Apple Silicon, decode speed tracks *active*-parameter bytes. An MoE like **Qwen3-30B-A3B** (30.5B total, ~3.3B active) delivers 30B-class quality at ~3B speed — community-reported 50–130 tok/s — and fits ~17 GB (4-bit). It's the single biggest "XL capability on a medium Mac, fast" lever, and it rides the `model_map.json` / tier plumbing we already have. (AirLLM was the wrong axis; this is the right one.)

**Verified facts (2026-06-04 audit + web):**
- `model_map.json` = `install/macos/omlx-proxy/config/model_map.json` — Ollama-tag key → `mlx-community/...` repo. `qwen3:14b` already maps to `mlx-community/Qwen3-14B-4bit`.
- Tiers live in `install/macos/nomad` (`TIER_*` vars L331-345, `tier_size_gb()` L348-356, `auto_tier()` RAM thresholds L361-371). `nomad models pull <tier|model…>` accepts arbitrary model keys (else-branch `to_pull="$*"`).
- CLI/tier path resolves the exact key through the proxy → works immediately once mapped.
- **GUI limitation:** the admin catalog comes from the remote `api.projectnomad.us/api/v1/ollama/models` (upstream's, not ours). `qwen3:30b-a3b` is a *tag* in the `qwen3` family, and `resolveMlxPullName("qwen3", …)` returns the **smallest** family key (`qwen3:14b` < 30 < 32) — so the GUI `qwen3` card would pull 14B, never the MoE. Surfacing the MoE as its own GUI card needs Phase 2.
- Real tags/repos verified: Ollama `qwen3:30b-a3b` (19 GB, MoE); repos that exist — `mlx-community/Qwen3-30B-A3B-4bit-DWQ` (~17.2 GB), `mlx-community/Qwen3-30B-A3B-4bit`, `mlx-community/Qwen3-Coder-30B-A3B-Instruct-4bit`, `mlx-community/DeepSeek-V2-Lite-Chat-4bit-mlx`. (Map `_comment` standard = "verified on device" — Phase 1 includes that.)

---

## Tier-by-memory mapping (the curation intent)

| Mac RAM | auto tier | Headline chat model to add | Footprint |
|---|---|---|---|
| 16 GB | small | `deepseek-v2:16b` (16B/2.4B active, ~9 GB) + keep `llama3.1:8b` | fast, fits |
| 24–36 GB | medium | **`qwen3:30b-a3b`** (the star — 17 GB, MoE) | fits with headroom |
| 40–72 GB | large | `qwen3:30b-a3b` + existing large set | comfortable |
| ≥72 GB | xl/dreamy | existing dense 70B set (unchanged) | — |

(Qwen3-14B dense is already mapped; it stays the 16 GB fallback. A 3-bit-DWQ Qwen3-30B-A3B (~13 GB) for 16 GB Macs is a possible follow-up — verify the exact repo first.)

---

## Phase 1 — CLI + tier curation (host-only, ready to build)

This delivers the MoE to the **primary** path: first-install auto-tier + `nomad models pull`.

### Task 1.1 — model_map.json entries
**File:** `install/macos/omlx-proxy/config/model_map.json`
- [ ] Add (keys = Ollama tags, values = verified mlx-community repos):
  ```json
  "qwen3:30b-a3b": "mlx-community/Qwen3-30B-A3B-4bit-DWQ",
  "qwen3-coder:30b-a3b": "mlx-community/Qwen3-Coder-30B-A3B-Instruct-4bit",
  "deepseek-v2:16b": "mlx-community/DeepSeek-V2-Lite-Chat-4bit-mlx"
  ```
- [ ] Keep the JSON valid (trailing-comma check). `qwen3:14b` already present — no change.

### Task 1.2 — tier placement (memory-budgeted)
**File:** `install/macos/nomad` (L331-356)
- [ ] Add `qwen3:30b-a3b` to `TIER_MEDIUM`, `TIER_LARGE`, `TIER_MEDIUM_LEAN`, `TIER_LARGE_LEAN`.
- [ ] Add `deepseek-v2:16b` to `TIER_SMALL` / `TIER_SMALL_LEAN` (fast capable pick for 16 GB).
- [ ] Add `qwen3-coder:30b-a3b` to `TIER_LARGE`/`TIER_DREAMY` (coder MoE).
- [ ] Bump `tier_size_gb()` estimates for any tier whose total download grew (medium +~17, small +~9, large +~17/35). Keep estimates honest.

### Task 1.3 — proxy resolver test (symmetry stays green)
**File:** `install/macos/omlx-proxy/tests/test_nomad_pull_allowlist.py`
- [ ] Add a case asserting `_resolve_mlx_repo("qwen3:30b-a3b")` returns the mapped repo, and that its bare basename reverse-lookup works (mirrors the existing tag/basename tests).

### Task 1.4 — verify
- [ ] `python3 -c "import json,sys; json.load(open('install/macos/omlx-proxy/config/model_map.json'))"` (valid JSON).
- [ ] `bash -n install/macos/nomad`.
- [ ] Proxy resolver test green (stub harness as before).
- [ ] **On the mini (operator):** `nomad models pull qwen3:30b-a3b` → downloads as MLX + runs (real on-device verification of the repo name, per the map's "verified on device" rule); also pull `deepseek-v2:16b` + `qwen3-coder:30b-a3b`. Confirm chat works + note tok/s (should be fast — ~3B-active speed).

**Deploy:** host-only → ships via `nomad update`/`nomad upgrade`.

---

## Phase 2 — GUI exposure of the MoE (needs a scope decision)

**Problem:** the GUI shows one card per remote-catalog *family*, and our resolver collapses `qwen3` to its smallest tag — so the MoE never appears as a distinct, selectable card. Since the remote catalog is upstream's, we can't add a family there. Three approaches (a real decision for Chris):

- **2A — Augment the catalog in oMLX mode (recommended, generalizes).** In `ollama_service.getAvailableModels`, when `NOMAD_AI_BACKEND==='omlx'`, synthesize catalog cards from `model_map.json` for curated MLX models the remote catalog doesn't surface as distinct families (the MoE, and any future MLX-only pick). Each synthetic card carries its own name/description/size and installs its exact `model_map` key (bypassing the family resolver). This is the honest "oMLX shows the MLX models we can actually serve" fix — it's the in-repo slice of the deferred *full MLX catalog* feature. Medium admin effort (catalog synthesis + de-dup against remote + a per-tag install path). Admin-only → GHCR `:edge`.
- **2B — CLI-only, document it (zero code).** Ship Phase 1; the install-tier picker + `nomad models pull qwen3:30b-a3b` cover real usage; the help page tells power users to pull the MoE by name. The GUI `qwen3` card keeps pulling 14B. Lowest effort.
- **2C — Defer to the full MLX-catalog feature.** Roll GUI MoE exposure into the larger "browse/select MLX models" feature when that's built.

**Recommendation:** Phase 1 now (it serves most users via tiers/CLI); decide 2A vs 2B/2C separately. 2A is the right long-term answer and not large, but it's a distinct admin change worth its own go-ahead.

---

## Risks / notes
- **Repo verification:** the `-mlx`-suffixed DeepSeek-V2-Lite repo and the DWQ Qwen3 repo must be confirmed to download + run on oMLX before these are trusted (Task 1.4 mini-verify). If DWQ misbehaves, fall back to `mlx-community/Qwen3-30B-A3B-4bit` (plain 4-bit, ~same size).
- **No RAM gate today:** `nomad models list` annotates fit post-pull; the GUI doesn't warn pre-pull. Tier placement is the only memory-budgeting guard. (A pre-pull RAM-fit badge is a possible separate enhancement.)
- **Tier-size honesty:** keep `tier_size_gb()` accurate so the install picker doesn't understate the download.
