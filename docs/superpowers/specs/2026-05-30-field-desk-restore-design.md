# Restore the NOMAD Field Desk coexistence install — design

**Date:** 2026-05-30
**Branch:** `feat/macos-distribution-layer`
**Components:** `install/macos/nomad` (two commands + dispatcher + header help), `install/macos/man/` (two new pages), `install/macos/README.md`
**Status:** Approved design — ready for implementation plan

---

## Problem

The `install-field-desk` / `uninstall-field-desk` subcommands were removed in
`a43111b` (2026-05-10, "doesn't fit this distribution's audience"). They let a
user run SysAdminDoc's NOMAD Field Desk (a separate preparedness desktop app)
side-by-side with the Crosstalk admin, sharing the one native Metal Ollama
daemon. We want them back for other users.

## Goal

Restore both commands and their docs, re-applied **by hand against current HEAD**
(a straight `git revert a43111b` will not apply — the script has grown ~1,900
lines since removal and the dispatcher/help formats changed), and bring their
documentation up to the man-page-set standard shipped in cycle ④.

## Verified facts (Maxim 24)

- Upstream `SysAdminDoc/project-nomad-desktop` latest release **`v7.32.0`** still
  publishes `NOMADFieldDesk-macOS` and `SHA256SUMS.txt` (confirmed via GitHub
  API 2026-05-30). The restored code's download + SHA-256-verify URLs resolve.
- No Field Desk code remains in the tree (only one incidental comment reference
  in `cmd_reset_ollama`). The dispatcher insertion point (after `install-bridge`,
  before `help`) is clean.

## Non-goals

- Pinning a specific Field Desk version. The original tracked
  `releases/latest/download/...`; keep that (the SHA-256 verify against the same
  release's `SHA256SUMS.txt` is the integrity control). YAGNI on version pinning.
- Any change to Field Desk's own behavior or to the shared Ollama daemon.
- Bundling Field Desk into `nomad install`. It stays an explicit opt-in command.

## Design

### Restore the two functions — `install/macos/nomad`

Re-add, verbatim from the `a43111b` removal (helper deps `section`/`log`/`ok`/
`warn`/`die`/`confirm` all still exist), placed near `cmd_fix_kiwix` /
`cmd_system` where they originally lived:

- **`cmd_install_field_desk`** — flags `--port N` (default `${NOMAD_FIELD_DESK_PORT:-8081}`),
  `--foreground`, `--force`, plus the `"") shift` case that absorbs the
  dispatcher's empty `EXTRA_ARGS` placeholder. Refuses a busy port unless it's a
  Field-Desk/Python listener; informational checks that admin (:8080) and Ollama
  (:11434) are up; downloads `NOMADFieldDesk-macOS` to `~/Applications/` if
  missing or `--force`; SHA-256-verifies against `SHA256SUMS.txt` (warns, not
  fatal, if the sums file can't be fetched); launches loopback-only on the chosen
  port, foreground or `nohup`-backgrounded.
- **`cmd_uninstall_field_desk`** — stops a running `NOMADFieldDesk-macOS`
  process, removes the binary, and *surfaces but never auto-removes* candidate
  data dirs (it explicitly does not touch `~/.config/project-nomad`). Leaves the
  shared Ollama daemon untouched.

### Dispatcher + header help — `install/macos/nomad`

- Add to the main `case "$CMD" in` (after the `install-bridge)` / `refresh-compose)`
  cases, before `help)`):
  ```bash
    install-field-desk)   cmd_install_field_desk "${EXTRA_ARGS[@]}" ;;
    uninstall-field-desk) cmd_uninstall_field_desk ;;
  ```
- Re-add the usage lines to the header comment block, e.g.:
  ```
  #   bash nomad install-field-desk [--port N] [--foreground] [--force]
  #                                            # SysAdminDoc Field Desk alongside
  #                                            # admin (default :8081, shares
  #                                            # Ollama on :11434, SHA-256 verified)
  ```
  If these push past the `help` dispatcher's `sed -n '2,45p'` window, widen the
  range so `nomad help` still prints the full block.

### Man pages — new style (cycle ④ standard)

Create `install/macos/man/nomad-install-field-desk.1` and
`nomad-uninstall-field-desk.1`, mdoc, derived from the restored functions
(`.Dd 2026-05-30`, NAME/SYNOPSIS/DESCRIPTION/OPTIONS/EXAMPLES/SEE ALSO). Add a
**Companion apps** `.Ss` subsection to `nomad.1`'s `.Sh COMMANDS` listing both
with `.Xr` refs, and add both to `nomad.1`'s SEE ALSO.

### Drift guard interaction (automatic)

Once the dispatcher gains the two commands, `test-manpages.sh` requires the two
pages by its command↔page bijection — the count goes **26 → 28**. The guard
therefore *enforces* this cycle's completeness; its passing output becomes
`ok  28 commands ↔ pages in sync; pages lint clean`. No change to the guard
script itself.

### README + lineage — `install/macos/README.md`

Restore the cheatsheet line and the sibling-project lineage note the removal took
out, in the current clear style (credit by contribution per Maxim 23 — Field Desk
is a separate product, not a fork; state what it is, not what nomad "lacks").

## Testing

- `bash -n install/macos/nomad` after the edits.
- `bash install/macos/scripts/test-manpages.sh` → `28 commands ↔ pages in sync`.
- Dispatch reaches the function: `bash install/macos/nomad install-field-desk --bogus`
  → the function's usage `die` fires (proves the case + arg parser are wired),
  without performing a download.
- Regressions stay green: `test-host-command-allowlist.sh`, `test-reset-ollama.sh`.
- mandoc lint clean on the two new pages + the updated overview.
- **On-device (flagged for Chris):** a real `nomad install-field-desk` downloads,
  SHA-256-verifies, and launches Field Desk on :8081 sharing Ollama; `nomad
  uninstall-field-desk` removes it; `man nomad-install-field-desk` renders after a
  re-install relinks the man set.

## Files touched

- **Modify** `install/macos/nomad` — restore 2 functions, 2 dispatcher cases, header help lines.
- **Create** `install/macos/man/nomad-install-field-desk.1`, `nomad-uninstall-field-desk.1`.
- **Modify** `install/macos/man/nomad.1` — Companion apps group + SEE ALSO.
- **Modify** `install/macos/README.md` — cheatsheet line + lineage note.

## Open implementation questions (resolve in writing-plans)

- Exact re-insertion line for the two functions (near `cmd_fix_kiwix` :4532 /
  `cmd_system` :4516) — confirm a clean spot that keeps related host-app commands
  together.
- Whether the header-help `sed` range needs widening (depends on how many lines
  the restored usage block adds) — verify `nomad help` output after the edit.
- Source of truth for the two man pages' content is the restored function bodies
  (read them after re-adding, before writing the pages — accuracy rule).
