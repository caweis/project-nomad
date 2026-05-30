# Restore Field Desk Coexistence Install — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore `install-field-desk` / `uninstall-field-desk` (removed in `a43111b`), re-applied by hand against current HEAD, with two man pages in the cycle-④ style and README/lineage entries.

**Architecture:** The two functions come verbatim from the removal commit's deletions (`git show a43111b`); they re-attach to `install/macos/nomad` near the other host-app commands, get dispatcher cases + header-help lines, two new mdoc man pages, and overview/README updates. The existing command↔page drift guard auto-enforces the new pages (26→28).

**Tech Stack:** bash, mdoc, GitHub release download + SHA-256 verify (existing code).

**Spec:** `docs/superpowers/specs/2026-05-30-field-desk-restore-design.md`

**Source of the removed code:** `git show a43111b -- install/macos/nomad` — the `-` (deleted) lines contain the complete `cmd_install_field_desk` and `cmd_uninstall_field_desk` functions. Re-add them as-is (strip the leading `-`). Verified deps (`section`/`log`/`ok`/`warn`/`die`/`confirm`) all still exist.

---

## Task 1: Restore the two functions

**Files:**
- Modify: `install/macos/nomad` (add functions after `cmd_fix_kiwix`'s closing brace, ~line 4600)

- [ ] **Step 1: Extract the removed functions**

Run: `git show a43111b -- install/macos/nomad | grep '^-' | sed 's/^-//' | sed -n '/cmd_uninstall_field_desk()/,/^}/p; /cmd_install_field_desk()/,/^}/p'`
This prints the two complete functions (plus the leading `# SysAdminDoc/...` comment block above `cmd_uninstall_field_desk`). Read the full removal diff (`git show a43111b`) to capture them with their comments intact.

- [ ] **Step 2: Re-add both functions**

Insert `cmd_install_field_desk()` and `cmd_uninstall_field_desk()` (with their original comment headers) into `install/macos/nomad` immediately after the closing `}` of `cmd_fix_kiwix` (~line 4600 — they were originally near the kiwix/system commands; keep host-app commands together). Paste them verbatim from the removal diff (the `"") shift` empty-arg-absorbing case in `cmd_install_field_desk` MUST be retained — it absorbs the dispatcher's `EXTRA_ARGS` placeholder).

- [ ] **Step 3: Verify syntax**

Run: `bash -n install/macos/nomad && echo "SYNTAX OK"`
Expected: `SYNTAX OK`.

- [ ] **Step 4: Commit**

```bash
git add install/macos/nomad
git commit -m "nomad: restore cmd_install_field_desk + cmd_uninstall_field_desk

Re-applies the two functions removed in a43111b, verbatim, against current
HEAD (a git revert would not apply — the script grew ~1900 lines since).
SysAdminDoc Field Desk coexistence: download + SHA-256 verify + launch on
:8081 sharing the native Ollama on :11434.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Dispatcher cases + header help

**Files:**
- Modify: `install/macos/nomad` (dispatcher ~line 4891; header block lines 2-45)

- [ ] **Step 1: Add dispatcher cases**

In the main `case "$CMD" in`, find the `install-bridge)` case and the
`refresh-compose)` case (~lines 4891–4901). Immediately after the
`refresh-compose)` case's `;;` and before `help|--help|-h)`, add:

```bash
  install-field-desk)   cmd_install_field_desk "${EXTRA_ARGS[@]}" ;;
  uninstall-field-desk) cmd_uninstall_field_desk ;;
```

- [ ] **Step 2: Re-add header-help usage lines**

In the header comment block (the lines `nomad help` prints), find the
`reset-ollama` / `fix-kiwix` usage lines area and add:

```
#   bash nomad install-field-desk [--port N] [--foreground] [--force]
#                                            # SysAdminDoc Field Desk alongside
#                                            # admin (default :8081, shares
#                                            # Ollama on :11434, SHA-256 verified)
#   bash nomad uninstall-field-desk          # remove Field Desk (Ollama untouched)
```

If these lines push content past the `help|--help|-h)` dispatcher's
`sed -n '2,45p'` window, widen the end number (e.g. `2,49p`) so `nomad help`
still prints the whole block including the new lines AND the existing
`Full reference: man nomad` echo after it.

- [ ] **Step 3: Verify dispatch + help**

Run:
```bash
bash -n install/macos/nomad && echo SYNTAX OK
bash install/macos/nomad install-field-desk --bogus 2>&1 | grep -q 'usage: nomad install-field-desk' && echo DISPATCH OK
bash install/macos/nomad help | grep -q 'install-field-desk' && echo HELP OK
```
Expected: `SYNTAX OK`, `DISPATCH OK` (the function's usage `die` fires — proves the case + arg parser wire up, no download happens), `HELP OK`.

- [ ] **Step 4: Commit**

```bash
git add install/macos/nomad
git commit -m "nomad: wire install-field-desk / uninstall-field-desk dispatch + help

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Man pages for the two commands

**Files:**
- Create: `install/macos/man/nomad-install-field-desk.1`, `install/macos/man/nomad-uninstall-field-desk.1`

- [ ] **Step 1: Write both pages from the restored function bodies**

Read `cmd_install_field_desk` / `cmd_uninstall_field_desk` (now in the script)
and write each page with the cycle-④ mdoc template:

```roff
.Dd 2026-05-30
.Dt NOMAD-INSTALL-FIELD-DESK 1
.Os
.Sh NAME
.Nm nomad-install-field-desk
.Nd install SysAdminDoc NOMAD Field Desk alongside the admin
.Sh SYNOPSIS
.Nm nomad install-field-desk
.Op Fl -port Ar N
.Op Fl -foreground
.Op Fl -force
.Sh DESCRIPTION
<plain language: a separate preparedness desktop app that runs side-by-side
 with the Crosstalk admin, sharing the one native Metal Ollama daemon on :11434.
 Downloads the macOS binary, SHA-256-verifies it, launches loopback-only.>
.Sh OPTIONS
.Bl -tag -width Ds
.It Fl -port Ar N
Port to serve Field Desk on (default 8081). Also via NOMAD_FIELD_DESK_PORT.
.It Fl -foreground
Run in the foreground (see stderr) instead of nohup-backgrounded.
.It Fl -force
Re-download the binary even if already present.
.El
.Sh EXAMPLES
.Bl -tag -width Ds
.It Ic nomad install-field-desk
Install and launch Field Desk on :8081.
.It Ic nomad install-field-desk --port 8090 --foreground
Run on :8090 in the foreground.
.El
.Sh SEE ALSO
.Xr nomad 1 ,
.Xr nomad-uninstall-field-desk 1 ,
.Xr nomad-reset-ollama 1
```

The `nomad-uninstall-field-desk.1` page: NAME/SYNOPSIS (`.Nm nomad uninstall-field-desk`,
no options) / DESCRIPTION (stops the process, removes the binary, surfaces but
does not auto-remove its data dirs, leaves Ollama untouched) / EXAMPLES / SEE ALSO
(`.Xr nomad 1`, `.Xr nomad-install-field-desk 1`). Document ONLY real behavior.

- [ ] **Step 2: Lint both**

Run: `for f in install/macos/man/nomad-{install,uninstall}-field-desk.1; do mandoc -Tlint "$f" 2>&1 | grep -i error; done; echo done`
Expected: `done`, no ERROR lines.

- [ ] **Step 3: Commit**

```bash
git add install/macos/man/nomad-install-field-desk.1 install/macos/man/nomad-uninstall-field-desk.1
git commit -m "docs(man): Field Desk install/uninstall command pages

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Overview + README updates

**Files:**
- Modify: `install/macos/man/nomad.1` (COMMANDS + SEE ALSO)
- Modify: `install/macos/README.md` (cheatsheet + lineage)

- [ ] **Step 1: Add a Companion apps group to nomad.1 COMMANDS**

In `install/macos/man/nomad.1`, after the last `.Ss` group in `.Sh COMMANDS`,
add:

```roff
.Ss Companion apps
.Bl -tag -width "refresh-compose"
.It Cm install-field-desk
Install SysAdminDoc Field Desk alongside the admin.
.Xr nomad-install-field-desk 1 .
.It Cm uninstall-field-desk
Remove Field Desk.
.Xr nomad-uninstall-field-desk 1 .
.El
```

Add `.Xr nomad-install-field-desk 1 ,` and `.Xr nomad-uninstall-field-desk 1 ,`
to the `.Sh SEE ALSO` list.

- [ ] **Step 2: README cheatsheet + lineage**

In `install/macos/README.md`, add to the cheatsheet block:
```
nomad install-field-desk [--port N] [--foreground] [--force]
                        Install SysAdminDoc Field Desk alongside admin
                        (default :8081, shares Ollama on :11434, SHA-256 verified)
nomad uninstall-field-desk
                        Remove Field Desk (native Ollama untouched)
```
And restore a brief sibling-project note (credit by contribution, Maxim 23 — a
separate product, not a fork):
```
**Sibling project (separate product, not part of the lineage):**
[SysAdminDoc/project-nomad-desktop](https://github.com/SysAdminDoc/project-nomad-desktop)
— NOMAD Field Desk, a Python+Electron preparedness command center. Runs
side-by-side via `nomad install-field-desk`, sharing the single Metal Ollama daemon.
```

- [ ] **Step 3: Lint the overview + commit**

Run: `mandoc -Tlint install/macos/man/nomad.1 2>&1 | grep -i error; echo done`
Expected: `done`, no ERROR lines.

```bash
git add install/macos/man/nomad.1 install/macos/README.md
git commit -m "docs: list Field Desk commands in nomad(1) overview + README

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Drift guard now expects 28**

Run: `bash install/macos/scripts/test-manpages.sh`
Expected: `ok  28 commands ↔ pages in sync; pages lint clean`. (The two new commands now have pages; the guard enforces it.)

- [ ] **Step 2: Dispatch + help + syntax**

Run:
```bash
bash -n install/macos/nomad && echo SYNTAX OK
bash install/macos/nomad install-field-desk --bogus 2>&1 | grep -q 'usage: nomad install-field-desk' && echo DISPATCH OK
bash install/macos/nomad help | grep -c 'field-desk'
```
Expected: `SYNTAX OK`, `DISPATCH OK`, and the help grep ≥ 2.

- [ ] **Step 3: Regressions green**

Run: `bash install/macos/scripts/test-host-command-allowlist.sh && bash install/macos/scripts/test-reset-ollama.sh 2>&1 | tail -1`
Expected: `ok  allow-list in sync (6 commands)` and `23 passed, 0 failed`.

- [ ] **Step 4: Render spot-check + final report**

Run: `mandoc -Tascii install/macos/man/nomad-install-field-desk.1 2>/dev/null | sed -n '1,10p'`
Expected: clean render. Final report: drift-guard count (28), dispatch/help/regression results, and flag the on-device checks (real download + launch + `man nomad-install-field-desk` after a re-install relink).

---

## Self-Review (completed during plan authoring)

**Spec coverage:** functions restored (Task 1); dispatcher + header help (Task 2); two man pages (Task 3); overview Companion-apps group + SEE ALSO + README/lineage (Task 4); drift-guard 26→28 + regressions (Task 5). ✓

**Placeholder scan:** the function bodies are sourced verbatim from `git show a43111b` (canonical), not pasted — correct for a restore. Man-page content derived from the restored functions (accuracy rule). All commands/edits literal.

**Type/name consistency:** command names `install-field-desk`/`uninstall-field-desk`, function names `cmd_install_field_desk`/`cmd_uninstall_field_desk`, page files `nomad-install-field-desk.1`/`nomad-uninstall-field-desk.1` consistent across all tasks, the dispatcher, and the drift guard's `nomad-<cmd>.1` convention.

**Open items (from spec):** function re-insertion point (after `cmd_fix_kiwix`); header-help `sed` range widening verified in Task 2 Step 3; man-page content from restored bodies (Task 3 Step 1).
