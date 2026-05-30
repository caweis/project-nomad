# Full nomad man-page set — design

**Date:** 2026-05-30
**Branch:** `feat/macos-distribution-layer`
**Components:** `install/macos/man/` (new), `install/macos/nomad` (install/uninstall plumbing + help pointer), `install/macos/scripts/` (drift guard), `.github/workflows/checks.yml`, `install/macos/README.md`
**Status:** Approved design — ready for implementation plan

---

## Problem

`nomad` exposes 26 subcommands but documentation is one 380-line `nomad.1` whose
SUBCOMMANDS section is incomplete (missing `clean`, `upgrade`, `self-update`,
`install-bridge`, `refresh-compose`) and dense — hard to scan, no per-command
examples. Users can't `man nomad-<cmd>` the way they can with git. The in-CLI
`nomad help` (header comment block) and the README cheatsheet are separate
surfaces that drift from the man page.

## Goal

A git-style man-page set that makes every command easy to understand:
- A rewritten overview `nomad(1)` grouping commands by purpose with one-liners
  and cross-references.
- A `nomad-<cmd>(1)` page for **every** command, each with a plain-language
  description (what it does + when to use it), options, and examples, derived
  from the actual implementation.
- Install/uninstall wiring for the whole set, and a CI drift guard so the pages
  can't silently fall out of sync with the dispatcher.

## Non-goals

- Documenting `install-field-desk` / `uninstall-field-desk`. Those commands do
  not exist yet (restored in sub-project ②); ② adds their man pages in this
  same style when it restores the commands, keeping the drift guard green at
  every commit here.
- A full rewrite of the in-CLI `nomad help` body. We add a one-line "full
  reference: `man nomad`" pointer and keep the existing quick list. (YAGNI.)
- Auto-generating pages from the script. Hand-written mdoc gives the
  plain-language clarity that's the whole point; the drift guard covers
  completeness instead.

## Command set (26 — authoritative, from the dispatcher)

`install` · `check` · `up` · `down` · `restart` · `logs` · `models` ·
`upgrade` · `upgrade-models` · `downloads` · `zim` · `stl` · `services` ·
`system` · `api` · `benchmark` · `orbstack-tune` · `reset-ollama` · `fix-kiwix` ·
`clean` · `uninstall` · `reinstall` · `self-update` · `install-bridge` ·
`refresh-compose` · `help`

Each gets `install/macos/man/nomad-<cmd>.1`. `help` documents `help`/`--help`/`-h`.

## Design

### Layout — `install/macos/man/`

Move `install/macos/nomad.1` → `install/macos/man/nomad.1` and add
`install/macos/man/nomad-<cmd>.1` for each command (27 files total). A `man/`
subdir keeps the bundle root uncluttered.

### Format — mdoc (unchanged convention)

Keep mdoc (`.Sh`, `.It`, `.Nm`, `.Cm`, `.Fl`, `.Ar`, `.Pa`) — the existing
format, BSD/macOS native, lintable with `mandoc -Tlint`. Every page declares
`.Dt NOMAD-<CMD> 1` and `.Os` so `man` renders correctly.

### Overview `nomad(1)`

Sections: NAME · SYNOPSIS (the `nomad <command> [args]` form + a one-line list)
· DESCRIPTION · **COMMAND GROUPS** · ENVIRONMENT · FILES · EXAMPLES ·
COMMUNITY LINEAGE · AUTHOR · SEE ALSO.

COMMAND GROUPS replaces the flat SUBCOMMANDS list — commands grouped by purpose,
each a one-liner with an `.Xr nomad-<cmd> 1` cross-reference:
- **Setup & lifecycle:** install, reinstall, uninstall, up, down, restart, self-update
- **Status & logs:** check, logs, system
- **AI models:** models, upgrade-models, reset-ollama, benchmark, orbstack-tune
- **Offline content:** zim, downloads, stl
- **Services & API:** services, api
- **Maintenance:** upgrade, clean, fix-kiwix, install-bridge, refresh-compose, help

ENVIRONMENT and FILES are preserved/improved from the current page (real env
vars + paths — verified against the script, not invented). SEE ALSO lists every
`nomad-<cmd>(1)`.

### Per-command page template

```
.Dd <date>
.Dt NOMAD-RESET-OLLAMA 1
.Os
.Sh NAME
.Nm nomad-reset-ollama
.Nd <one-line what-it-does>
.Sh SYNOPSIS
.Nm nomad reset-ollama
.Op Fl -internal | Fl -drive
.Sh DESCRIPTION
<plain language: what it does AND when you'd reach for it>
.Sh OPTIONS        \" only if the command takes flags/subactions
.Bl -tag -width Ds
.It Fl -internal
...
.El
.Sh EXAMPLES
.Bl -tag -width Ds
.It Ic nomad reset-ollama
...
.El
.Sh SEE ALSO
.Xr nomad 1 , Xr nomad-models 1
```

**Accuracy rule:** each page's DESCRIPTION/OPTIONS/EXAMPLES are derived from the
actual `cmd_<name>` function + dispatcher in `install/macos/nomad` (and the
existing help text). No invented flags or behavior — these are public docs in a
public repo (Maxim 24).

### Install / uninstall plumbing — `install/macos/nomad`

The current install step (`~line 1634`) symlinks only `$HERE/nomad.1`. Change it
to glob `$HERE/man/nomad*.1` and symlink each into `$prefix/share/man/man1/`,
reporting the count (`man nomad`, `man nomad-zim`, … now work). The matching
uninstall path removes every `nomad*.1` symlink in `man1/` that points into the
bundle's `man/` dir. `$HERE` resolution is unchanged.

### Drift guard — `install/macos/scripts/test-manpages.sh` (new)

Portable bash test:
1. Extract the dispatcher command set (the `case "$CMD" in` labels, splitting
   `up | down`-style and `help|--help|-h` alternations, excluding the `*)`
   default and the self-update-gate pre-case).
2. List `install/macos/man/nomad-*.1` basenames → command names.
3. Assert the two sets are equal **both ways**: every command has a page, every
   page maps to a real command. Report missing/orphan with non-zero exit.
4. If `mandoc` is available, `mandoc -Tlint` every page and fail on ERROR-level
   diagnostics (warnings noted, not fatal).

Wired into `.github/workflows/checks.yml` as a new step (runs on `macos-latest`,
which has `mandoc`).

### Help / README alignment (light)

- `nomad help`: append one line — `Full reference: man nomad (per-command: man nomad-<command>)`.
- README cheatsheet: ensure its command list matches the 26 (add the missing
  `clean`/`upgrade`/`self-update`/`install-bridge`/`refresh-compose` if absent),
  pointing to `man nomad` for detail.

## Testing

- `test-manpages.sh`: command↔page bijection + `mandoc -Tlint` (the core test).
- `man -l install/macos/man/nomad.1` and a couple of `nomad-<cmd>.1` render
  without mandoc ERRORs (spot check).
- `bash -n install/macos/nomad` after the install/uninstall plumbing change.
- The ① recovery suite + ③ drift guard stay green (regression).

## Files touched

- **Move** `install/macos/nomad.1` → `install/macos/man/nomad.1` (rewritten overview)
- **Create** `install/macos/man/nomad-<cmd>.1` × 26
- **Create** `install/macos/scripts/test-manpages.sh`
- **Modify** `install/macos/nomad` (install glob + uninstall removal + `help` pointer)
- **Modify** `.github/workflows/checks.yml` (add the man-page guard step + `install/macos/man/**` path trigger is already covered by `install/macos/**`)
- **Modify** `install/macos/README.md` (cheatsheet command-list parity)

## Execution note

The 26 per-command pages are independent files → written by parallel subagents
(disjoint paths, no conflict), each instructed to read the relevant `cmd_<name>`
function before writing so content is accurate. The overview page, install
plumbing, drift guard, and CI wiring are assembled after, then verified.

## Open implementation questions (resolve in writing-plans)

- `.Dd` date macro: use a fixed ISO date string (the agent can't call `date`);
  pass `2026-05-30` literally in each page to keep mandoc happy and deterministic.
- Whether the uninstall removal should match by symlink target (points into the
  bundle `man/`) or by the `nomad*.1` glob — prefer target-match to avoid
  removing an unrelated `nomad*.1` a user installed by hand.
- Confirm `man -l` vs `mandoc` availability on the dev Mac for the spot-render
  step (fall back to `mandoc -Tascii | head`).
