# First-run bootstrap installer — design

**Date:** 2026-05-30
**Branch:** `feat/macos-distribution-layer`
**Component:** `install/bootstrap.sh` (new) + README one-liners + recovery-hint alignment + legacy-script retirement
**Status:** Approved design — ready for implementation plan
**Decomposition:** Sub-project Ⓐ of "make install easier" (Ⓑ `nomad update` shipped; Ⓐ first-run bootstrap). Reuses Ⓑ's `NOMAD_BUNDLE_DIR` convention.

---

## Problem

A brand-new user on a fresh Mac has no clean first-run path. Today's documented
one-liner (root `README.md`) is a long `curl … tar xz && bash <long-extract-dir>/…`
that points at the **stale repo name** (`project-nomad-macos-arm64`, redirect-
dependent — same bug class fixed in Ⓑ) and is public prose under the maintainer's
name (Maxim 24). Two **legacy installers** (`install/install_nomad.sh` — upstream
Crosstalk Linux; `install/install_nomad_macos.sh` — snfettig's pre-CLI macOS
script) sit alongside the canonical `install/macos/nomad install` and muddy the
"how do I start" answer.

## Goal

One short, memorable command that takes a fresh Apple Silicon Mac to a running
install — fetching the bundle to a canonical location and handing off to the real
installer with its prompts intact.

## Two locations — keep them distinct (core principle)

- **Bundle (code):** `~/Applications/project-nomad` — small, internal; holds
  `nomad`, `man/`, `compose.yaml`. This is what the bootstrap fetches and what
  `nomad install` records as `NOMAD_BUNDLE_DIR`.
- **Data root (content):** an **external HDD** (usually) — ZIMs, `ollama-models`,
  storage. Large. Chosen by `nomad install`'s interactive picker
  (`choose_data_root`: `[0] Internal … [N] /Volumes/<drive> …`).

The bootstrap decides only where the *code* lands. It hands off to `nomad install`
**without `--data-root`**, so the data-location picker fires exactly as today —
the external-drive option stays front-and-center.

## Non-goals

- A double-click `.command` / `.dmg` (a later cycle if wanted; the one-liner is
  the deliverable now).
- Release/tag tracking — bootstrap follows a branch like the rest of the layer.
- Reimplementing prerequisite setup. `nomad install` already installs Homebrew,
  Xcode CLT, Rosetta, OrbStack, Ollama inline; the bootstrap must NOT duplicate
  any of that — it only fetches the bundle and delegates.

## Design

### The one-liner

```bash
curl -fsSL https://raw.githubusercontent.com/caweis/project-nomad/feat/macos-distribution-layer/install/bootstrap.sh | bash
```

The repo is the host (raw URL); no separate infrastructure. Branch-pinned to
match the distribution layer (overridable via `NOMAD_BRANCH`).

### `install/bootstrap.sh` (new)

Stock-tools only (`curl`, `tar`, `uname` — all present on a fresh macOS; git is
NOT assumed, since Xcode CLT/git is installed later by `nomad install`):

1. **Platform guard.** `[[ "$(uname -s)" == Darwin && "$(uname -m)" == arm64 ]]`
   — else print a clear message and exit non-zero (Intel/Linux not supported by
   this path).
2. **Resolve bundle location.** `NOMAD_HOME` env override, else
   `~/Applications/project-nomad`.
3. **Idempotency.** If the location already exists and contains
   `install/macos/nomad`, do **not** clobber — print "NOMAD is already installed
   at <path> — run `nomad update` to update, or remove the directory to
   reinstall" and exit 0.
4. **Fetch.** `mkdir -p` the parent; download
   `https://codeload.github.com/caweis/project-nomad/tar.gz/refs/heads/<branch>`
   to a temp file; extract; move the extracted top dir into place as the bundle
   location. Validate the extracted tree has `install/macos/nomad` with a bash
   shebang before proceeding (fail clean, leave nothing half-placed).
5. **Surface the data step.** Print a one-line heads-up:
   "Next, the installer will ask where to store your content — usually an
   external drive."
6. **Hand off.** `exec bash "<bundle>/install/macos/nomad" install` — **no
   `--data-root`**, so the picker runs; `nomad install` records
   `NOMAD_BUNDLE_DIR=<bundle>/install/macos` (Ⓑ) so `nomad update` works after.

`NOMAD_BOOTSTRAP_DRY_RUN=1` short-circuits steps 4–6: print the resolved
location, the platform verdict, and the idempotency decision, then exit — for
testing and safe inspection.

### Cleanup riding along

- **README one-liners (Maxim 24).** Replace the long stale-name `curl|tar|bash`
  in root `README.md` (the `## Install` block) and any equivalent in
  `install/macos/README.md` with the new short bootstrap command. Verify the URL
  resolves to the renamed repo (no redirect dependency).
- **Recovery-hint alignment.** The Ⓑ implementer set the two recovery hints
  (`install/macos/nomad` lines ~98, ~1628) to `~/Developer/project-nomad`. Change
  them to **`~/Applications/project-nomad`** to match the canonical bootstrap
  bundle location.
- **Retire the legacy macOS installer.** `install/install_nomad_macos.sh` is
  unreferenced (verified) and predates the `nomad` CLI. **Delete it**, crediting
  snfettig's prior work in the commit message (git history preserves it — Maxim
  23). Leave `install/install_nomad.sh` (clearly the upstream Linux installer,
  not a macOS first-run footgun).

## Testing

- **Unit (`install/scripts/test-bootstrap.sh` or alongside; sourced/dry-run):**
  - platform guard logic (mock `uname` via a function override or env);
  - location resolution: default `~/Applications/project-nomad` vs `NOMAD_HOME`;
  - idempotency: existing-bundle detection returns the "already installed" path.
  Driven through `NOMAD_BOOTSTRAP_DRY_RUN=1` so nothing is fetched or installed.
- `shellcheck install/bootstrap.sh` clean.
- Regressions: the man-page, allow-list, reset-ollama, and update suites stay
  green (bootstrap is additive; touches no existing script logic except the two
  recovery-hint strings).
- **On-device (flagged for Chris):** run the real one-liner on a clean Mac (or a
  fresh `NOMAD_HOME` path) → confirm it fetches to `~/Applications/project-nomad`,
  the data-root picker still appears, and the install completes.

## Files touched

- **Create** `install/bootstrap.sh`.
- **Create** a bootstrap unit test (path TBD in plan — likely `install/scripts/test-bootstrap.sh`).
- **Modify** `README.md` (Install one-liner), `install/macos/README.md` (if it carries a one-liner).
- **Modify** `install/macos/nomad` (two recovery-hint strings → `~/Applications/project-nomad`).
- **Delete** `install/install_nomad_macos.sh`.

## Open implementation questions (resolve in writing-plans)

- Exact extract→place step: extract to a temp dir then `mv <tmp>/project-nomad-*/`
  → `~/Applications/project-nomad`, vs `tar --strip-components=1 -C <dest>`.
  Prefer `--strip-components=1` into a freshly-created dest (atomic-ish, no
  leftover top-dir name to guess).
- Where the bootstrap unit test lives + how it overrides `uname` for the guard
  test (function shadow vs a `NOMAD_BOOTSTRAP_FORCE_PLATFORM` test hook).
- Whether to also drop the bootstrap one-liner into `nomad help` / the man
  overview (probably not — bootstrap is pre-install, before `nomad` exists;
  README is the right home). Lean: README only.
