# Changelog

Notable changes to the macOS distribution layer of this fork. Format follows
[Keep a Changelog](https://keepachangelog.com/); versions are tagged with SemVer.

## [Unreleased]

Work on `feat/macos-distribution-layer` (2026-05-30).

### Added
- **`nomad update`** — one command to update an existing install: it locates the
  active bundle (recorded as `NOMAD_BUNDLE_DIR` at install time), refreshes it
  (git pull for a clean checkout, otherwise a validated release tarball), and
  re-runs the install in place. No data loss, no model re-pull.
- **`install/bootstrap.sh`** — a one-line first-run installer for a fresh Apple
  Silicon Mac:
  `curl -fsSL https://raw.githubusercontent.com/caweis/project-nomad/feat/macos-distribution-layer/install/bootstrap.sh | bash`.
  It fetches the bundle to `~/Applications/project-nomad` (override with
  `NOMAD_HOME`) and hands off to `nomad install`, which still asks where to store
  content (typically an external drive).
- **Full man-page set** — a rewritten `nomad(1)` overview grouped by purpose,
  plus a `nomad-<command>(1)` page for every subcommand. `man nomad` and
  `man nomad-<command>` work after install.
- **`nomad reset-ollama --internal` / `--drive`** — `reset-ollama` now detects a
  mounted-but-wedged external data drive, falls back to internal models so the
  daemon stays responsive, auto-pulls a RAM-appropriate model set when the
  internal store is empty, and restores to the drive once it is healthy again.
- **`nomad install-field-desk` / `nomad uninstall-field-desk`** — optional
  coexistence install for [SysAdminDoc/project-nomad-desktop](https://github.com/SysAdminDoc/project-nomad-desktop)
  (NOMAD Field Desk), a separate preparedness app that shares the native Ollama
  daemon on port 11434.
- **Continuous integration** (`.github/workflows/checks.yml`) — runs the shell
  test suites and the command↔man-page and allow-list drift guards on macOS
  runners for changes to the install layer.

### Changed
- The host-command-bridge allow-list is now single-sourced from
  `admin/constants/host_commands.ts`, consumed by both the admin controller and
  the UI; the host-side `run_cmd` allow-list is verified against it in CI.
- `nomad install` records the bundle path (`NOMAD_BUNDLE_DIR`) in `.env` so
  `nomad update` always knows which bundle to refresh.
- The README install instructions now use the one-line bootstrap.

### Fixed
- Self-update and bootstrap URLs and the in-CLI recovery hints now reference the
  repository's current name (`caweis/project-nomad`); they previously relied on a
  GitHub redirect from the former name.

### Removed
- The pre-CLI standalone macOS installer (`install/install_nomad_macos.sh`),
  superseded by `nomad install`. The unified `nomad` command is the single
  first-run path; git history preserves the original.
