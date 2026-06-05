---
type: implementation-plan
status: implemented (host+admin) — all static gates green; pending push + T9 mini-verify
date: 2026-06-04
project: project-nomad (macOS/Apple-Silicon fork)
feature: Cross-Mac drive portability — detect + offer-to-adopt + auto-reconcile
spec: docs/superpowers/specs/2026-06-04-cross-mac-drive-portability-design.md
decided_by: Chris (2026-06-04) — "spec is fine, let's go"
tags: [nomad, macos, drive-portability, launchd, reconcile, admin, host-command-bridge, man-pages]
---

# Cross-Mac drive portability — implementation plan

> **For agentic workers:** execute task-by-task in order; verify each before the next. Develop on `main`. Commit per task. The host file `install/macos/nomad` is large — edit by exact anchor, never blind-replace. Re-verify every anchor with grep before editing (line numbers drift).

**Goal:** Plug a `project-nomad` data drive into another NOMAD Mac → it detects the drive, shows an "Adopt this drive?" banner, and on Adopt re-points the data root, restarts the content stack, and reconciles the catalog so the full library (ZIM + STL + Maps + models) appears. Eject → auto-revert.

**Key findings that shape the build** (verified 2026-06-04):
- `_syncContainersWithDatabase()` (admin `system_service.ts`) auto-corrects `services.installed` from the live container list on every `getServices()`. **Reconcile must NOT set `installed` — just restart the stack; the sync handles the flag.**
- STL `StlScannerService.scan()` **prunes** rows for missing files (`removeOrphans`). It must run **only after** admin is fully up against the new data root, or it wipes the catalog. `scanPaths()` is add-only — not what we want.
- Admin↔host shared path: `${NOMAD_DATA_ROOT}/storage` ↔ container `/app/storage`. Marker → `${NOMAD_DATA_ROOT}/storage/.candidate-drive.json`, written by the host detector into the *currently-active* data root's storage (the one admin already mounts).
- launchd has no `StartOnMount`; use `WatchPaths` on `/Volumes` (+ `StartInterval=60` backstop, `RunAtLoad`).
- `nomad stl scan` → `api_post /api/workshop/scan` (HTTP to admin :8080). Reconcile reuses this.

**Anchors** (re-verify with grep before editing):
- `install/macos/nomad`: LaunchAgent label consts ~L269/288; `_env_upsert` ~L3046; `run_cmd()` case ~L3683; `step_install_*` sequence in `cmd_install` ~L4036; uninstall loops ~L4962; `_resolve_drive_models` ~L5293; `cmd_stl` ~L6121; dispatch `case "$CMD"` (2nd block, the one `test-manpages.sh` mirrors).
- `admin/constants/host_commands.ts` (HOST_COMMANDS array); `install/macos/scripts/test-host-command-allowlist.sh`; `install/macos/scripts/test-manpages.sh`.
- `admin/start/routes.ts` `/api/system` group ~L171; `admin/app/controllers/system_controller.ts`; `admin/app/services/system_service.ts`.
- `admin/inertia/components/Alert.tsx`; `admin/inertia/components/HostCommandButton.tsx`; `admin/inertia/layouts/AppLayout.tsx` (~L36); `admin/inertia/layouts/SettingsLayout.tsx`.

---

## Task 1 — Host: candidate detection + `drive-detect` LaunchAgent

**Files:** `install/macos/nomad`

- [ ] Add label/script/plist consts near the other LaunchAgent consts (~L288):
  `DRIVE_DETECT_LABEL="com.projectnomad.drive-detect"`, `DRIVE_DETECT_PLIST="$HOME/Library/LaunchAgents/${DRIVE_DETECT_LABEL}.plist"`, `DRIVE_DETECT_SCRIPT="$SECRETS_DIR/drive-detect.sh"`.
- [ ] Add `_resolve_candidate_drive()` (mirror `_resolve_drive_models` ~L5293): scan `/Volumes/*` for a dir containing `project-nomad/storage` whose `project-nomad` path != current `NOMAD_DATA_ROOT`; echo the `…/project-nomad` path or "". Skip models-only drives (require `storage/`, not just `ollama-models/`).
- [ ] Add `step_install_drive_detect()` that writes `$DRIVE_DETECT_SCRIPT` (heredoc) and the plist (mirror `step_install_host_command_bridge` ~L3747), then bootout-first + `launchctl bootstrap "$LA_TARGET"`. Plist keys: `WatchPaths` → `<array><string>/Volumes</string></array>`, `StartInterval` 60, `RunAtLoad` true, std out/err logs under `~/Library/Logs/nomad-drive-detect.*.log`.
- [ ] `drive-detect.sh` content (lock-guarded with a flock/mkdir lock): resolve candidate; if a non-active full-library drive is present → write `${NOMAD_DATA_ROOT}/storage/.candidate-drive.json` = `{"path":"…/project-nomad","label":"<volume name>","detected_at":"<iso>"}`; else `rm -f` the marker. ALSO handle eject-revert (Task 4 adds that branch).
- [ ] Wire `step_install_drive_detect` into the `cmd_install` LA sequence (~L4036, after `step_install_host_command_bridge`).
- [ ] Wire `$DRIVE_DETECT_LABEL` + `$DRIVE_DETECT_PLIST` into BOTH uninstall loops (~L4962).
- [ ] **Verify:** `bash -n install/macos/nomad`; eyeball plist via a dry render; confirm the marker write path matches the admin mount. **Commit.**

## Task 2 — Host: `nomad reconcile`

**Files:** `install/macos/nomad`

- [ ] Add `cmd_reconcile()` (lock-guarded): `ensure_docker_path`; `dc up -d` (content stack up against current `NOMAD_DATA_ROOT`); `api_check_up` (wait for admin); then `api_post /api/workshop/scan` (STL — only after admin is up, per R2); ensure Kiwix running (reuse the `fix-kiwix`/self-heal path). Do NOT touch `services.installed` (sync auto-corrects). Idempotent.
- [ ] Add `reconcile)` to the dispatch `case "$CMD"` block (the one `test-manpages.sh` mirrors).
- [ ] **Verify:** `bash -n`. **Commit.**

## Task 3 — Host: `nomad adopt-drive`

**Files:** `install/macos/nomad`

- [ ] Add `cmd_adopt_drive()` (lock-guarded): resolve the single candidate via `_resolve_candidate_drive`; if none → `die`. Save current root: `_env_upsert NOMAD_PREV_DATA_ROOT "<current NOMAD_DATA_ROOT>"`. `_env_upsert NOMAD_DATA_ROOT "<drive>"`. `dc up -d --force-recreate` (content services rebind to the drive's storage). `api_check_up`. `cmd_reconcile`. `rm -f` the candidate marker.
- [ ] Add `adopt-drive)` to the dispatch `case "$CMD"` block.
- [ ] **Verify:** `bash -n`. **Commit.**

## Task 4 — Host: eject → auto-revert (in `drive-detect.sh`)

**Files:** `install/macos/nomad` (the `step_install_drive_detect` heredoc)

- [ ] In `drive-detect.sh`, add: if the active `NOMAD_DATA_ROOT` drive is **gone** (path no longer exists) AND `NOMAD_PREV_DATA_ROOT` is set → `_env_upsert NOMAD_DATA_ROOT "<prev>"`, remove `NOMAD_PREV_DATA_ROOT`, `dc up -d --force-recreate`, then `cmd_reconcile` (so the catalog reflects the reverted root; STL prune cleans the drive's phantom rows). WatchPaths fires on unmount, so this runs promptly; 60s backstop covers misses.
- [ ] Guard against reverting when no prev set / drive still present.
- [ ] **Verify:** `bash -n`. **Commit.**

## Task 5 — Host-command bridge: `adopt-drive`

**Files:** `admin/constants/host_commands.ts`, `install/macos/nomad` (`run_cmd()`)

- [ ] Add `'adopt-drive'` to the `HOST_COMMANDS` array (`admin/constants/host_commands.ts`).
- [ ] Add `adopt-drive)  "$NOMAD_BIN" adopt-drive ;;` to `run_cmd()` (~L3683), before the `*)` default.
- [ ] **Verify:** `bash install/macos/scripts/test-host-command-allowlist.sh` → "ok allow-list in sync". **Commit.**

## Task 6 — Admin: `GET /api/system/candidate-drive`

**Files:** `admin/start/routes.ts`, `admin/app/controllers/system_controller.ts`, `admin/app/services/system_service.ts`

- [ ] Route in the `/api/system` group (~L171): `router.get('/candidate-drive', [SystemController, 'getCandidateDrive'])`.
- [ ] `SystemController.getCandidateDrive()` → `this.systemService.getCandidateDrive()`.
- [ ] `SystemService.getCandidateDrive()`: read `/app/storage/.candidate-drive.json` (path = `path.join(NOMAD storage, '.candidate-drive.json')` — use the same storage base other services use). Return `{ available: true, path, label, detectedAt }` if present + parseable, else `{ available: false }`. Defensive: ENOENT/parse error → `{ available: false }` (never throw).
- [ ] **Verify:** `cd admin && npm run typecheck`; logic check (stub the file read). **Commit.**

## Task 7 — Admin: `CandidateDriveBanner` (detect + Adopt)

**Files:** new `admin/inertia/components/CandidateDriveBanner.tsx`; `admin/inertia/layouts/AppLayout.tsx`; `admin/inertia/layouts/SettingsLayout.tsx`; uses `admin/inertia/components/Alert.tsx` + `HostCommandButton.tsx`

- [ ] New `CandidateDriveBanner`: React Query poll `GET /api/system/candidate-drive` (e.g. `refetchInterval: 15000`). When `available`, render `<Alert type="info" variant="bordered" dismissible title="A NOMAD drive is plugged in" message="Use '<label>' as this Mac's library?">` with an Adopt action. Adopt = `HostCommandButton cmd="adopt-drive"` (the union now includes it from Task 5) labeled "Adopt this drive". On success, poll/redirect so the reconciled library shows.
- [ ] Mount the banner in `AppLayout.tsx` (~L36, between the header `<hr>` and `{children}`) and in `SettingsLayout.tsx` (top of content) so it shows app-wide.
- [ ] **Verify:** `cd admin && npm run typecheck`; render check on the mini. **Commit.**

## Task 8 — Man pages + docs

**Files:** `install/macos/man/nomad-adopt-drive.1`, `install/macos/man/nomad-reconcile.1`; `install/macos/scripts/test-manpages.sh` (no edit — must stay balanced); `admin/docs/mac-drive-portability.md`

- [ ] Write `man/nomad-adopt-drive.1` + `man/nomad-reconcile.1` mirroring the existing man-page format (check a sibling like `man/nomad-up.1`).
- [ ] **Verify:** `bash install/macos/scripts/test-manpages.sh` → bijection balanced (dispatcher cases from Tasks 2/3 ↔ the two new man files).
- [ ] Revise `admin/docs/mac-drive-portability.md` "Destination Mac already has N.O.M.A.D." section to the Adopt-banner flow (supersedes the held `10fdc74` manual-`nomad stl scan` caveat — adoption now does the reconcile). Keep the "drive-wins while plugged" + eject-revert reality accurate.
- [ ] **Commit.**

## Task 9 — Verify end-to-end

- [ ] `bash -n install/macos/nomad`; `test-host-command-allowlist.sh` + `test-manpages.sh` green; `cd admin && npm run typecheck` clean.
- [ ] **On the mini (operator):** with NOMAD running on internal disk, plug a second `project-nomad` drive → banner appears → click Adopt → ZIM + STL + Maps + models all appear; eject → reverts to the internal library cleanly (no phantom STL rows). `docker logs` shows reconcile success.

## Deploy chain
- Host (Tasks 1–5 nomad/bridge, 8 man pages) ship via the host bundle (`nomad update`/`upgrade`).
- Admin (Tasks 5 const, 6, 7) ship via the GHCR `:edge` rebuild on push to `admin/**` → `nomad upgrade admin`.
- Both halves must land for the banner→adopt→reconcile loop to work end-to-end.

## Risks carried from the spec (resolved here)
- R2 (STL prune) → reconcile runs scan only after admin is up against the new root.
- R3 (services.installed) → reconcile does NOT set it; `_syncContainersWithDatabase` does.
- R5 (shared path) → `${NOMAD_DATA_ROOT}/storage/.candidate-drive.json`.
- Trigger → `WatchPaths /Volumes` + 60s backstop (no `StartOnMount`).
