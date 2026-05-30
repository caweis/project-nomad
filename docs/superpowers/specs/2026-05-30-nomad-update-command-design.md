# `nomad update` — one-step self-pull + in-place reinstall — design

**Date:** 2026-05-30
**Branch:** `feat/macos-distribution-layer`
**Component:** `install/macos/nomad` (new command + `.env` install step + man/overview/help/README) + `install/macos/man/`
**Status:** Approved design — ready for implementation plan
**Decomposition:** Sub-project Ⓑ of "make install easier" (Ⓑ `nomad update`, then Ⓐ first-run bootstrap). Ⓑ establishes the canonical-bundle-location + tarball-fetch machinery Ⓐ reuses.

---

## Problem

Updating an installed NOMAD to the latest code is a manual, error-prone chain
(lived this session): `cd <git-checkout> && git checkout <branch> && git pull &&
bash install/macos/nomad reinstall`. Worse:

- **Two-bundle confusion.** The brew symlink (`/opt/homebrew/bin/nomad`) pointed
  at a stale non-git tarball (`~/Developer/project-nomad-feat-macos-distribution-layer/`)
  while the actual work lived in a separate git checkout
  (`~/Developer/project-nomad-macos-arm64/`). Nothing records which directory is
  the active bundle.
- **Partial self-update.** `self_update_nomad` + `self_update_compose` fetch
  **only** `nomad` and `compose.yaml`. The 27 man pages, `scripts/`, `help/`,
  `userscripts/`, and `quick-chat.*` never refresh — they go stale on tarball
  installs.
- **Skips git checkouts entirely**, and still points at the **old repo name**
  (`caweis/project-nomad-macos-arm64`, now redirecting to `caweis/project-nomad`).
- **No `nomad update` command** exists.

## Goal

One command — `nomad update` — that finds the active bundle, refreshes the
**whole** bundle (git or tarball), and brings the new code live in place without
wiping data or re-pulling models.

## Non-goals

- First-run/fresh-Mac install (that's sub-project Ⓐ, a separate cycle).
- Relocating existing installs to a new fixed path (too disruptive; we record
  where the bundle is instead).
- Replacing `reinstall` (the deliberate nuke) — `update` is the safe in-place path.
- Release/tag tracking. `update` follows a branch (default `NOMAD_BRANCH`), like
  the existing self-update. (Tag tracking can come later; YAGNI now.)

## Design

### Command surface

`nomad update [--branch NAME]` — default branch is `${NOMAD_BRANCH:-feat/macos-distribution-layer}`
(matches the existing self-update default). New dispatcher case + man page + help.

### Locate the active bundle (the keystone)

A new global resolves the bundle dir, in precedence order:
1. `NOMAD_BUNDLE_DIR` from `~/.config/project-nomad/.env` (the explicit source of
   truth).
2. Fallback for older installs: `realpath` the running script
   (`$HERE` is already symlink-resolved at the top of the file) → that *is* the
   bundle dir.

**New install step:** write `NOMAD_BUNDLE_DIR=$HERE` into `.env` during the
secrets-generation step (the `.env` heredoc at ~line 1793, alongside
`NOMAD_DATA_ROOT`). `$HERE` is the symlink-resolved `…/install/macos` directory
where `nomad`, `man/`, and `compose.yaml` live. This records which directory is
the active bundle, ending the two-bundle ambiguity: `nomad update` always
refreshes the recorded bundle.

### Refresh the bundle — detect both

`cmd_update` resolves the bundle dir, then:

- **Git checkout** (`[[ -d "$bundle/.git" || -d "$bundle/../.git" ]]`):
  - If the working tree is **dirty** (`git -C "$repo" status --porcelain` non-empty):
    **warn and skip the pull** — never discard a developer's uncommitted work —
    then proceed to the in-place install with whatever is checked out.
  - Else `git -C "$repo" pull --ff-only` the current branch (or check out
    `--branch` if given). Report the new HEAD.
- **Tarball install** (no `.git`):
  - Download `https://codeload.github.com/caweis/project-nomad/tar.gz/refs/heads/<branch>`
    to a temp file (30s timeout; offline → warn + abort cleanly, bundle untouched).
  - Extract into a temp dir; locate its `install/macos/` subtree.
  - **Validate before swapping:** the extracted `nomad` has a `#!…bash` shebang
    and passes `bash -n`, and the extracted `man/` directory exists with
    `nomad.1`. Any failure → keep the current bundle, abort with a clear message
    (never leave a half-updated bundle).
  - **Atomic-ish swap:** `rsync`/`cp` the validated subtree over the bundle dir
    (or move-aside-then-replace), preserving `NOMAD_BUNDLE_DIR` semantics.

### Then: idempotent in-place install

Run the existing `nomad install` repair path (the same code `install` runs;
it's idempotent — "safe to re-run; that's also the repair path"). This re-links
the script + all man pages, refreshes compose, and ensures the stack +
LaunchAgents — **without** uninstalling, wiping data, or re-pulling models.
Implementation: `cmd_update` ends by invoking the install flow (e.g. `cmd_install`
with the no-models / repair posture, or re-exec `"$bundle/nomad" install` so the
freshly-updated script runs the install). The plan resolves the exact re-exec vs
in-process call (re-exec is safer — the new script installs itself).

### Maxim-22 neighborhood fix

While in the file, fix `self_update_nomad` and `self_update_compose` raw URLs
from `caweis/project-nomad-macos-arm64` → `caweis/project-nomad` (the repo was
renamed; the old name only works via GitHub redirect). No behavior change beyond
correctness.

### Surface plumbing (rides existing guardrails)

- New `install/macos/man/nomad-update.1` (cycle-④ mdoc style).
- `nomad(1)` overview: add `update` to the **Maintenance** group + SEE ALSO.
- Header help block: add a `nomad update` usage line.
- README cheatsheet: add `nomad update`.
- The command↔page **drift guard auto-enforces** the new page: count goes
  **28 → 29**, and `checks.yml` CI fails if the page is missing. (The rails from
  ③/④ catch this for free.)

## Testing

- **Unit (`install/macos/scripts/test-update.sh`,** sourced under
  `NOMAD_SOURCE_FOR_TEST`): bundle-dir resolution precedence (`.env` key wins;
  symlink/`$HERE` fallback when key absent); git-dirty detection returns
  "skip-pull"; tarball validation gate rejects a non-bash file / missing `man/`.
- `bash -n install/macos/nomad`.
- Drift guard → `29 commands ↔ pages in sync`.
- Dispatch reaches the function: `nomad update --bogus` → usage `die` (no fetch).
- Regressions: allow-list guard, reset-ollama suite, man-page guard stay green.
- **On-device (flagged for Chris):** a real `nomad update` on a git-checkout
  install (pull + relink) and on a tarball install (fetch + swap + relink);
  confirm man pages + script update and the stack survives without data loss.

## Files touched

- **Modify** `install/macos/nomad` — `cmd_update` + helpers (bundle-dir resolver,
  git-dirty check, tarball fetch/validate/swap), dispatcher case, header help,
  `NOMAD_BUNDLE_DIR` written in the `.env` install step, self_update_* URL fix.
- **Create** `install/macos/man/nomad-update.1`.
- **Modify** `install/macos/man/nomad.1` (Maintenance group + SEE ALSO).
- **Create** `install/macos/scripts/test-update.sh`.
- **Modify** `install/macos/README.md` (cheatsheet).

## Open implementation questions (resolve in writing-plans)

- In-place install: re-exec `"$bundle/nomad" install` (new script installs
  itself — safest) vs in-process `cmd_install`. Lean re-exec; confirm it doesn't
  double-run the self-update gate (guard with `NOMAD_NO_SELF_UPDATE=1` on the
  re-exec since `update` already refreshed the bundle).
- Swap method for the tarball path: `rsync -a --delete` the `install/macos/`
  subtree vs move-aside backup. Pick the one that's atomic enough and preserves
  the brew symlink target (the symlink points at `$bundle/nomad`, which stays).
- Whether `--branch` persists to `.env` (so future `update`s track it) or is
  one-shot. Lean one-shot; persisting branch is a separate concern.
- Confirm the `.env` heredoc vs append-helper (line ~2201) is the right single
  insertion point for `NOMAD_BUNDLE_DIR` so re-runs don't duplicate the key.
