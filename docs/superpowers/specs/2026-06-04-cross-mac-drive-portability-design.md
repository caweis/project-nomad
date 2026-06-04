---
type: design-spec
status: draft-for-review
date: 2026-06-04
project: project-nomad (macOS / Apple-Silicon fork)
feature: True cross-Mac drive portability — detect a plugged data drive, offer to adopt it, auto-reconcile the catalog
decided_by: Chris (2026-06-04) — scope = "Full auto pickup (the dream)"; adopt model = "Detect + offer to adopt"
tags: [nomad, macos, drive-portability, launchd, reconcile, admin, host-command-bridge]
---

# True cross-Mac drive portability

## Goal

Plug a `project-nomad` data drive into **any** NOMAD-equipped Mac and have that
Mac surface the drive's **entire** library — Information Library (ZIM), Workshop
(STL), Maps, AI models — not just the models. Today only models cross over,
because the model launcher scans `/Volumes/` at runtime while the content
containers bind-mount the *local* `NOMAD_DATA_ROOT`. This closes that gap.

## The two facts that shape the design

1. **One data root at a time.** The content containers (Kiwix, admin `storage`,
   Qdrant, maps) bind-mount `${NOMAD_DATA_ROOT}/storage` (compose.yaml). There is
   no clean way to merge two libraries into one running stack. So showing a
   plugged drive's content requires that drive to **become the active data
   root** — re-point `.env`, restart the content stack. (Models are the lone
   exception: their launcher scans `/Volumes/` independent of `.env`.)

2. **The catalog is on internal disk, not the drive.** `NOMAD_STATE_ROOT`
   (MySQL + Redis) stays internal even after adopting a drive. So the destination
   Mac's MySQL has *its own* catalog, which does not know about the drive's
   files. Re-pointing the data root is necessary but **not sufficient** — the
   catalog must also be reconciled to the drive's files (STL scan, ZIM/maps
   re-list, `services.installed` flags). RAG is fine: Qdrant storage is on the
   drive (`storage/qdrant/`), so after re-point the vectors come with it.

## Decisions (from Chris, 2026-06-04)

- **Scope:** full library pickup (ZIM + STL + Maps + models), including content
  for services the destination Mac never installed.
- **Adopt model:** **detect + offer**, not silent takeover. On plug-in, NOMAD
  detects a non-active `project-nomad` drive and surfaces a banner —
  "Use this drive's library? [Adopt]". Adopt is one deliberate click; ignore and
  the Mac keeps its own data root untouched.

## Architecture

Three coordinated pieces — detection (host), surfacing (admin), and the adopt +
reconcile action (host, triggered from admin via the bridge).

### 1. Detection (host) — `StartOnMount` LaunchAgent + poll backstop

- New LaunchAgent `com.projectnomad.drive-detect` with `StartOnMount=true` (fires
  on every volume mount) **and** `StartInterval=60` (backstop for missed mount
  events / boot). Runs `~/.config/project-nomad/drive-detect.sh`.
- The script (idempotent, lock-guarded):
  - Scans `/Volumes/*` for a directory containing `project-nomad/` (reuse the
    existing `_resolve_drive_models` pattern, generalized to `project-nomad/`).
  - Determines whether that drive is **already the active data root** (compare to
    `NOMAD_DATA_ROOT` in `.env`). If it is, or if no candidate drive is present,
    clears the candidate marker and exits.
  - If a **non-active** candidate drive is found, writes a small candidate marker
    the admin can read (e.g. `~/.config/project-nomad/state/candidate-drive.json`
    with `{ path, label, detected_at }`) — bind-mounted/readable by the admin.
- Skip rule: a **models-only** drive (has `project-nomad/ollama-models` but no
  `storage/`) is not a full library — do not offer to adopt it (models already
  cross over). Only offer when the drive carries `storage/`.

### 2. Surfacing (admin) — detected-drive banner

- New admin endpoint `GET /api/system/candidate-drive` reads the candidate
  marker and returns `{ available: bool, path, label, isActive }`.
- A banner component (Command Center / Settings) shows when `available && !isActive`:
  "A NOMAD drive '<label>' is plugged in. Use its library? [Adopt this drive]".
  Dismissible; reappears on next detection if still relevant.
- The banner's [Adopt] button calls the host-command bridge (below). While the
  adopt runs, show progress; on completion, reload.

### 3. Adopt + reconcile (host) — argument-free bridge command

The host-command bridge is **argument-free + allow-listed** (single source
`admin/constants/host_commands.ts` ↔ `run_cmd()` ↔ drift test). Adopting a
*specific* path would need an argument, breaking that invariant — so instead:

- New allow-listed command **`adopt-drive`** (no argument). Its host handler runs
  `nomad adopt-drive`, which itself **re-scans `/Volumes/`** for the single
  candidate drive (the same detection logic) and adopts *that*. Argument-free,
  no path injection, fits the existing bridge model. (If >1 candidate, adopt the
  most-recently-mounted and log the others; multi-candidate disambiguation is out
  of scope for v1.)
- `nomad adopt-drive` orchestration (idempotent, lock-guarded):
  1. Save the current `NOMAD_DATA_ROOT` as `NOMAD_PREV_DATA_ROOT` in `.env` (for
     revert-on-eject).
  2. Re-point `NOMAD_DATA_ROOT` to the drive's `project-nomad` path (`_env_upsert`).
  3. Restart the content stack (`dc up -d` / targeted restart of content
     services) so containers re-bind to the drive's `storage/`.
  4. **Reconcile the catalog** (`nomad reconcile`, see below).
- New command **`nomad reconcile`** — the catalog-sync orchestration, callable
  standalone and from `adopt-drive` / `nomad up`:
  - **STL:** trigger the admin-side `StlScannerService` scan (the existing
    `nomad stl scan` path).
  - **ZIM / Maps:** filesystem-scanned on request already — ensure Kiwix is
    running; (re)start/install Kiwix if the drive has ZIMs and Kiwix isn't up.
  - **services.installed:** set the flag for each content service whose files are
    present on the drive, so the UI shows them.
  - Idempotent and **prune-aware** — see Risk R2.

### 4. Eject handling — revert to the previous data root

- The `drive-detect` agent (also fired by unmount via the 60s backstop; launchd
  has no clean "on unmount" trigger) notices the active data root's drive is
  gone and, if `NOMAD_PREV_DATA_ROOT` is set, reverts: re-point `.env` back,
  restart the content stack, re-reconcile (so the catalog reflects the reverted
  root, not the now-absent drive's files).
- Until revert completes, behavior matches the existing "Unplugging the drive"
  doc section (services error until replug/revert).

## Host / admin split & integration points

- **Host (`install/macos/nomad` + LaunchAgents):** `drive-detect.sh` + agent,
  `nomad adopt-drive`, `nomad reconcile`, `.env` `NOMAD_PREV_DATA_ROOT`, candidate
  marker writer.
- **Admin:** `candidate-drive` status endpoint + reader of the marker, the banner
  component, the [Adopt] → bridge call.
- **Host-command bridge:** new `adopt-drive` entry in the single-source allow-list
  (`admin/constants/host_commands.ts`), paired `run_cmd()` case in `nomad`, and a
  matching line in `test-host-command-allowlist.sh` (drift test stays green).
- **Man pages:** new `nomad adopt-drive` + `nomad reconcile` man pages; the
  `test-manpages.sh` bijection (dispatcher ↔ `man/nomad-*.1`) must stay balanced.
- **Docs:** revise `admin/docs/mac-drive-portability.md` — once this ships, the
  "plug into another Mac" section becomes true via the Adopt banner; replace the
  manual-`nomad stl scan` caveat with the Adopt flow. (Holds the in-flight doc
  correction `10fdc74`, which honestly documents *today's* gap.)

## Safety & security

- **Concurrency:** every host action (`drive-detect`, `adopt-drive`, `reconcile`)
  takes a lockfile; a mount storm or overlapping 60s tick must not launch parallel
  restarts/scans.
- **Debounce:** detection debounces rapid mount/unmount.
- **No silent takeover:** adoption is always a user click (per the decision) — the
  background agent only ever *detects* and writes a marker; it never re-points the
  data root on its own.
- **No path injection:** the bridge command is argument-free; the host resolves
  the drive itself. The drive path is never passed from the web layer.
- **Privilege:** `adopt-drive`/`reconcile` restart/instantiate containers — same
  privilege as existing bridge commands (`upgrade-ollama`, etc.); no new escalation.

## Risks / open design points

- **R1 — restart blip:** adopting restarts the content stack (seconds of
  downtime). Acceptable for a deliberate user action; surface progress.
- **R2 — prune-on-reconcile:** does `StlScannerService.scan()` *remove* catalog
  rows for files no longer present (needed for a clean revert), or only add? If
  add-only, reverting leaves phantom STL entries. The plan must verify and, if
  needed, make the scan prune-aware (or scope reconcile to the active root only).
- **R3 — `services.installed` semantics:** flipping this flag to surface drive
  content must not confuse the installer's own state machine (which uses it to
  decide install/skip). Verify the flag's consumers before writing it from
  reconcile.
- **R4 — multi-candidate drives:** v1 adopts the most-recently-mounted; >1
  project-nomad drive plugged at once is logged, not disambiguated.
- **R5 — admin reads host state:** the candidate marker must be on a path the
  Dockerized admin can read (bind-mount under `NOMAD_STATE_ROOT` or an existing
  mounted config path). Confirm the mount.

## Out of scope (v1)

- Merging two libraries into one running stack (architecturally precluded — one
  data root at a time).
- Multi-candidate disambiguation UI.
- Auto-adopt without a click (explicitly rejected — detect+offer only).

## Verification (for the eventual plan)

- Host: `bash -n` on `nomad`; `test-host-command-allowlist.sh` + `test-manpages.sh`
  green; lockfile/concurrency exercised.
- Admin: `npm run typecheck`; endpoint + banner logic checked.
- On the mini (operator): adopt a second drive → ZIM + STL + maps + models all
  appear; eject → reverts to own library cleanly (no phantom catalog rows).
