# Full nomad Man-Page Set Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The 26 per-command pages are independent files and MAY be written by parallel subagents (disjoint paths — no conflict).

**Goal:** Replace the single dense `nomad.1` with a git-style man-page set — a grouped overview `nomad(1)` plus a `nomad-<cmd>(1)` for all 26 commands — installed/uninstalled as a set and protected by a command↔page drift guard in CI.

**Architecture:** mdoc man pages live in `install/macos/man/`. Each per-command page is hand-written from the actual `cmd_<name>` implementation (accuracy over generation). The install step symlinks the whole set into `man1/`; a portable bash test asserts every dispatcher command has a page and vice-versa, run on `macos-latest` CI.

**Tech Stack:** mdoc (man macros), bash, mandoc (lint), GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-05-30-nomad-manpages-rewrite-design.md`

---

## Accuracy rule (applies to EVERY page)

Before writing a page, **read the command's implementation** in `install/macos/nomad`
(function/line in the table below) plus its dispatcher line and any help text.
Document only flags, subactions, defaults, and behavior that actually exist.
No invented options. These are public docs in a public repo (Maxim 24).

## Page template (mdoc)

Every `nomad-<cmd>.1` follows this skeleton (literal — fill the `<…>` from source):

```roff
.Dd 2026-05-30
.Dt NOMAD-<CMD-UPPER> 1
.Os
.Sh NAME
.Nm nomad-<cmd>
.Nd <one-line what-it-does, lowercase, no trailing period>
.Sh SYNOPSIS
.Nm nomad <cmd>
<.Op/.Ar/.Cm lines for args, omit if none>
.Sh DESCRIPTION
<1-3 short paragraphs: what it does AND when you'd reach for it. Plain language.>
.Sh OPTIONS            \" OMIT this whole section if the command takes no flags/subactions
.Bl -tag -width Ds
.It <Fl flag | Cm subaction>
<what it does>
.El
.Sh EXAMPLES
.Bl -tag -width Ds
.It Ic nomad <cmd> <args>
<what this invocation does>
.El
.Sh SEE ALSO
.Xr nomad 1 <, .Xr nomad-<related> 1 ...>
```

`.Dd 2026-05-30` is a fixed literal date in every page (deterministic; agents
can't call `date`).

## Command → source pointer + intent (the 26)

| cmd | source in `install/macos/nomad` | one-line intent |
|---|---|---|
| install | `cmd_install` :3120 | Install/repair the full stack on a fresh or existing Mac. |
| check | `cmd_check` :867 | Pre-flight + health inventory (`system`/`stack`/`install`/`all`). |
| up | `cmd_up` :3237 | Start the container stack (`docker compose up -d`). |
| down | `cmd_down` :3238 | Stop the stack (safe before unplugging the data drive). |
| restart | `cmd_restart` :3239 | Restart one service (default `admin`). |
| logs | `cmd_logs` :3268 | Tail a service's logs (default `admin`). |
| models | `cmd_models` :3279 | List or pull Ollama models by tier or name. |
| upgrade | `cmd_upgrade` :3370 | Upgrade admin/ollama/everything (`--check` for dry-run). |
| upgrade-models | `cmd_upgrade_models` :3578 | Re-pull installed models at latest tags. |
| downloads | `cmd_downloads` :3640 | Inspect/cancel/remove admin's download job queue. |
| zim | `cmd_zim` :3680 | Wikipedia/ZIM content state (`list`/`wikipedia`/`remote`). |
| stl | `cmd_stl` :4605 | Workshop STL library (`list`/`scan`/`import`/`path`). |
| services | `cmd_services` :3714 | List/install/affect admin-managed services. |
| system | `cmd_system` :4516 | Host/stack diagnostics (`info`/`debug`/`internet`). |
| api | `cmd_api` :3619 | Raw admin API call — generic escape hatch. |
| benchmark | `cmd_benchmark` :4435 (+ `cmd_benchmark_patch_host` :4365) | Native-vs-Rosetta tok/s; patch real chip into leaderboard. |
| orbstack-tune | `cmd_orbstack_tune` :4015 | Bump OrbStack VM RAM (default 80% of host). |
| reset-ollama | `cmd_reset_ollama` :4222 | Recover Ollama; auto-detect wedged drive (`--internal`/`--drive`). |
| fix-kiwix | `cmd_fix_kiwix` :4532 | Manual kiwix self-heal pass (LaunchAgent runs it every 60s). |
| clean | `cmd_clean` :4700 | Safe cleanup of logs/dangling images/partial ZIMs (`--apply`). |
| uninstall | `cmd_uninstall` :3796 | Remove containers/agents/secrets (optionally data). |
| reinstall | `cmd_reinstall` :3740 | Nuclear: full wipe + reinstall in one shot. |
| self-update | `self_update_nomad` :120 (+ dispatch) | Fetch the latest `nomad` script. |
| install-bridge | dispatch `install-bridge` + `step_install_host_command_bridge` | Install just the host-command-bridge LaunchAgent (idempotent). |
| refresh-compose | dispatch `refresh-compose` + `self_update_compose` | Refresh `compose.yaml` from the bundle. |
| help | header block + dispatch `help` | Show usage; point to `man nomad`. |

`SEE ALSO` cross-refs (suggested): models↔upgrade-models↔reset-ollama; up↔down↔restart; install↔reinstall↔uninstall; zim↔downloads; install-bridge↔(reset-ollama, fix-kiwix). All pages list `.Xr nomad 1` first.

---

## Task 1: Scaffold the man/ dir and move the overview page

**Files:**
- Move: `install/macos/nomad.1` → `install/macos/man/nomad.1`

- [ ] **Step 1: git-move the existing page into man/**

```bash
cd /Users/chrisweis/Developer/project-nomad-macos-arm64
mkdir -p install/macos/man
git mv install/macos/nomad.1 install/macos/man/nomad.1
```

- [ ] **Step 2: Verify it still renders**

Run: `mandoc -Tlint install/macos/man/nomad.1 2>&1 | grep -i error | head; echo "lint-done"`
Expected: `lint-done` with no `ERROR` lines (pre-existing page is valid).

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "docs(man): move nomad.1 into install/macos/man/ for the page set

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Per-command pages — batch A (setup & lifecycle)

**Files (create):** `install/macos/man/nomad-install.1`, `nomad-reinstall.1`, `nomad-uninstall.1`, `nomad-up.1`, `nomad-down.1`, `nomad-restart.1`, `nomad-self-update.1`

- [ ] **Step 1: Read each command's implementation** (table above) and write each page using the template. Plain-language DESCRIPTION (what + when). Omit OPTIONS where the command has none (up/down). Include real examples.

- [ ] **Step 2: Lint the batch**

Run: `for f in install/macos/man/nomad-{install,reinstall,uninstall,up,down,restart,self-update}.1; do mandoc -Tlint "$f" 2>&1 | grep -i error; done; echo done`
Expected: `done`, no ERROR lines.

- [ ] **Step 3: Commit**

```bash
git add install/macos/man/nomad-{install,reinstall,uninstall,up,down,restart,self-update}.1
git commit -m "docs(man): setup & lifecycle command pages

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Per-command pages — batch B (status, AI, maintenance)

**Files (create):** `nomad-check.1`, `nomad-logs.1`, `nomad-system.1`, `nomad-models.1`, `nomad-upgrade-models.1`, `nomad-reset-ollama.1`, `nomad-benchmark.1`, `nomad-orbstack-tune.1`

- [ ] **Step 1: Write each page from source (template + accuracy rule).** `reset-ollama` documents `--internal`/`--drive` and the wedged-drive auto-heal (see `cmd_reset_ollama` and the recovery spec). `benchmark` covers `run` + `patch-host`.

- [ ] **Step 2: Lint the batch**

Run: `for f in install/macos/man/nomad-{check,logs,system,models,upgrade-models,reset-ollama,benchmark,orbstack-tune}.1; do mandoc -Tlint "$f" 2>&1 | grep -i error; done; echo done`
Expected: `done`, no ERROR lines.

- [ ] **Step 3: Commit**

```bash
git add install/macos/man/nomad-{check,logs,system,models,upgrade-models,reset-ollama,benchmark,orbstack-tune}.1
git commit -m "docs(man): status, AI, and tuning command pages

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Per-command pages — batch C (content, services, maintenance)

**Files (create):** `nomad-zim.1`, `nomad-downloads.1`, `nomad-stl.1`, `nomad-services.1`, `nomad-api.1`, `nomad-upgrade.1`, `nomad-clean.1`, `nomad-fix-kiwix.1`, `nomad-install-bridge.1`, `nomad-refresh-compose.1`, `nomad-help.1`

- [ ] **Step 1: Write each page from source (template + accuracy rule).** Document real subactions: `zim` (`list`/`wikipedia [state|select]`/`remote`), `stl` (`list`/`scan`/`import DIR [CAT]`/`path`), `downloads` (`list`/`cancel ID`/`remove ID`), `services` (`list`/`install NAME`/`affect ACTION NAME`), `upgrade` (`ollama`/`admin`/no-arg=all/`--check`), `clean` (`--apply`).

- [ ] **Step 2: Lint the batch**

Run: `for f in install/macos/man/nomad-{zim,downloads,stl,services,api,upgrade,clean,fix-kiwix,install-bridge,refresh-compose,help}.1; do mandoc -Tlint "$f" 2>&1 | grep -i error; done; echo done`
Expected: `done`, no ERROR lines.

- [ ] **Step 3: Commit**

```bash
git add install/macos/man/nomad-{zim,downloads,stl,services,api,upgrade,clean,fix-kiwix,install-bridge,refresh-compose,help}.1
git commit -m "docs(man): content, services, and maintenance command pages

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Rewrite the overview nomad.1

**Files:**
- Modify: `install/macos/man/nomad.1`

- [ ] **Step 1: Rewrite SYNOPSIS + replace SUBCOMMANDS with COMMAND GROUPS**

Keep the existing NAME, DESCRIPTION, ENVIRONMENT, FILES, EXAMPLES, COMMUNITY
LINEAGE, AUTHOR sections (they're accurate). Replace the flat `.Sh SUBCOMMANDS`
section with a grouped one — each command a one-liner ending in an `.Xr`:

```roff
.Sh COMMANDS
.Ss Setup & lifecycle
.Bl -tag -width "refresh-compose"
.It Cm install
Install or repair the full stack.
.Xr nomad-install 1 .
.It Cm reinstall
Full wipe then reinstall.
.Xr nomad-reinstall 1 .
.It Cm uninstall
Remove containers, agents, secrets (optionally data).
.Xr nomad-uninstall 1 .
.It Cm up | down | restart
Start, stop, or restart the stack.
.Xr nomad-up 1 ,
.Xr nomad-down 1 ,
.Xr nomad-restart 1 .
.It Cm self-update
Fetch the latest nomad script.
.Xr nomad-self-update 1 .
.El
.Ss Status & logs
.Bl -tag -width "refresh-compose"
.It Cm check
Pre-flight + health inventory.
.Xr nomad-check 1 .
.It Cm logs
Tail a service's logs.
.Xr nomad-logs 1 .
.It Cm system
Host/stack diagnostics.
.Xr nomad-system 1 .
.El
.Ss AI models
.Bl -tag -width "refresh-compose"
.It Cm models
List or pull Ollama models.
.Xr nomad-models 1 .
.It Cm upgrade-models
Re-pull installed models at latest tags.
.Xr nomad-upgrade-models 1 .
.It Cm reset-ollama
Recover Ollama; auto-detect a wedged data drive.
.Xr nomad-reset-ollama 1 .
.It Cm benchmark
Native-vs-Rosetta tokens/sec; patch the leaderboard.
.Xr nomad-benchmark 1 .
.It Cm orbstack-tune
Bump the OrbStack VM RAM.
.Xr nomad-orbstack-tune 1 .
.El
.Ss Offline content
.Bl -tag -width "refresh-compose"
.It Cm zim
Wikipedia/ZIM content state.
.Xr nomad-zim 1 .
.It Cm downloads
Inspect the admin download queue.
.Xr nomad-downloads 1 .
.It Cm stl
Workshop STL library.
.Xr nomad-stl 1 .
.El
.Ss Services & API
.Bl -tag -width "refresh-compose"
.It Cm services
List/install/affect admin services.
.Xr nomad-services 1 .
.It Cm api
Raw admin API call.
.Xr nomad-api 1 .
.El
.Ss Maintenance
.Bl -tag -width "refresh-compose"
.It Cm upgrade
Upgrade admin/ollama/everything.
.Xr nomad-upgrade 1 .
.It Cm clean
Safe cleanup of logs, dangling images, partial ZIMs.
.Xr nomad-clean 1 .
.It Cm fix-kiwix
Manual kiwix self-heal pass.
.Xr nomad-fix-kiwix 1 .
.It Cm install-bridge
Install the host-command-bridge LaunchAgent.
.Xr nomad-install-bridge 1 .
.It Cm refresh-compose
Refresh compose.yaml from the bundle.
.Xr nomad-refresh-compose 1 .
.It Cm help
Show usage.
.Xr nomad-help 1 .
.El
```

- [ ] **Step 2: Update SEE ALSO to list every page**

Replace the existing `.Sh SEE ALSO` body with `.Xr` entries for all 26
`nomad-<cmd> 1` pages (comma-separated, mdoc style).

- [ ] **Step 3: Lint**

Run: `mandoc -Tlint install/macos/man/nomad.1 2>&1 | grep -i error; echo done`
Expected: `done`, no ERROR lines.

- [ ] **Step 4: Commit**

```bash
git add install/macos/man/nomad.1
git commit -m "docs(man): rewrite nomad.1 overview with grouped COMMANDS + xrefs

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Install/uninstall plumbing for the page set

**Files:**
- Modify: `install/macos/nomad` (manpage install block ~1634; uninstall manpage removal)

- [ ] **Step 1: Update the install step to symlink the whole set**

Find (install block, ~line 1633):

```bash
  # Manpage — only if we have one in the bundle
  if [[ -f "$HERE/nomad.1" ]]; then
    manpath="$prefix/share/man/man1"
    manpage_target="$manpath/nomad.1"
    mkdir -p "$manpath" 2>/dev/null
    if [[ -d "$manpath" && -w "$manpath" ]]; then
      if [[ -L "$manpage_target" && "$(readlink "$manpage_target")" == "$HERE/nomad.1" ]]; then
        :
      elif ln -sf "$HERE/nomad.1" "$manpage_target" 2>/dev/null; then
        ok "manpage: $manpage_target  ('man nomad' now works)"
      fi
    fi
  fi
```

Replace with:

```bash
  # Manpages — symlink the whole set (overview + per-command) from the bundle.
  if [[ -d "$HERE/man" ]]; then
    manpath="$prefix/share/man/man1"
    mkdir -p "$manpath" 2>/dev/null
    if [[ -d "$manpath" && -w "$manpath" ]]; then
      local mp count=0
      for mp in "$HERE"/man/nomad*.1; do
        [[ -f "$mp" ]] || continue
        if ln -sf "$mp" "$manpath/$(basename "$mp")" 2>/dev/null; then
          count=$((count+1))
        fi
      done
      [[ $count -gt 0 ]] && ok "manpages: $count pages in $manpath  ('man nomad', 'man nomad-<command>' now work)"
    fi
  fi
```

- [ ] **Step 2: Update the uninstall step to remove the set**

Locate the uninstall manpage removal in `cmd_uninstall` (search for `nomad.1`
or `man1` within `cmd_uninstall` :3796). Replace the single-file removal with a
loop that removes every `man1/nomad*.1` symlink whose target points into the
bundle's `man/` dir:

```bash
  # Manpages: remove only symlinks that point into our bundle's man/ dir.
  local manpath; manpath="$(brew --prefix 2>/dev/null)/share/man/man1"
  if [[ -d "$manpath" ]]; then
    local mp
    for mp in "$manpath"/nomad*.1; do
      [[ -L "$mp" ]] || continue
      case "$(readlink "$mp")" in
        */man/nomad*.1) rm -f "$mp" ;;
      esac
    done
  fi
```

(If the existing uninstall has no manpage removal, add this block alongside the
other symlink cleanups; if it removes only `nomad.1`, replace that with this.)

- [ ] **Step 3: Verify syntax**

Run: `bash -n install/macos/nomad && echo "SYNTAX OK"`
Expected: `SYNTAX OK`.

- [ ] **Step 4: Commit**

```bash
git add install/macos/nomad
git commit -m "nomad: install/uninstall the full man-page set from man/

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Command↔page drift guard

**Files:**
- Create: `install/macos/scripts/test-manpages.sh`

- [ ] **Step 1: Write the drift-guard script**

Create `install/macos/scripts/test-manpages.sh`:

```bash
#!/usr/bin/env bash
# Drift guard: every nomad dispatcher command must have a man/nomad-<cmd>.1 page
# and vice-versa. Also mandoc-lints every page (ERROR-level is fatal).
# Run: bash install/macos/scripts/test-manpages.sh
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
NOMAD="$ROOT/install/macos/nomad"
MANDIR="$ROOT/install/macos/man"
FAIL=0

# 1. Commands from the dispatcher's SECOND `case "$CMD" in` (c==2 — the first is
#    the self-update gate). Match only label lines (token then `)`), split
#    alternations (up|down, help|--help|-h), drop *) default + flag-only tokens.
#    VERIFIED against the real file to yield exactly the 26 commands.
cmds="$(awk '/^case "\$CMD" in/{c++} c==2&&/^[[:space:]]*\*\)/{exit} c==2{print}' "$NOMAD" \
  | grep -oE '^[[:space:]]*[a-z][a-z0-9|.-]*\)' \
  | tr -d ' )' | tr '|' '\n' \
  | grep -vE '^(--help|-h)$' | grep -E '^[a-z]' | sort -u)"

# 2. Pages present (strip nomad- prefix and .1 suffix; ignore the overview).
pages="$(ls "$MANDIR"/nomad-*.1 2>/dev/null | xargs -n1 basename \
  | sed -E 's/^nomad-//; s/\.1$//' | sort -u)"

if [[ -z "$cmds" ]];  then echo "FAIL extracted 0 commands — dispatcher parse drift?" >&2; exit 1; fi
if [[ -z "$pages" ]]; then echo "FAIL no nomad-*.1 pages found in $MANDIR" >&2; exit 1; fi

missing="$(comm -23 <(echo "$cmds") <(echo "$pages"))"
orphan="$(comm -13 <(echo "$cmds") <(echo "$pages"))"
if [[ -n "$missing" ]]; then echo "FAIL commands with no man page:" >&2; echo "$missing" | sed 's/^/    /' >&2; FAIL=1; fi
if [[ -n "$orphan"  ]]; then echo "FAIL man pages with no command:" >&2; echo "$orphan"  | sed 's/^/    /' >&2; FAIL=1; fi

# 3. mandoc lint (ERROR-level only), if mandoc is present.
if command -v mandoc >/dev/null 2>&1; then
  local_err=0
  for mp in "$MANDIR"/nomad*.1; do
    if mandoc -Tlint "$mp" 2>&1 | grep -qi 'ERROR'; then
      echo "FAIL mandoc ERROR in $(basename "$mp"):" >&2
      mandoc -Tlint "$mp" 2>&1 | grep -i 'ERROR' | sed 's/^/    /' >&2
      local_err=1
    fi
  done
  [[ $local_err -eq 1 ]] && FAIL=1
else
  echo "note: mandoc not installed — skipped lint" >&2
fi

if [[ $FAIL -eq 0 ]]; then
  echo "ok  $(echo "$cmds" | grep -c .) commands ↔ pages in sync; pages lint clean"
  exit 0
fi
exit 1
```

- [ ] **Step 2: Make executable; verify it PASSES**

Run: `chmod +x install/macos/scripts/test-manpages.sh && bash install/macos/scripts/test-manpages.sh`
Expected: `ok  26 commands ↔ pages in sync; pages lint clean`, exit 0.

- [ ] **Step 3: Verify it FAILS on a missing page (throwaway)**

Run:
```bash
tmp=install/macos/man/nomad-clean.1; mv "$tmp" "$tmp.bak"
bash install/macos/scripts/test-manpages.sh; echo "rc=$?"
mv "$tmp.bak" "$tmp"
```
Expected: prints `commands with no man page: clean` and `rc=1`; then the page is restored.

- [ ] **Step 4: Commit**

```bash
git add install/macos/scripts/test-manpages.sh
git commit -m "test: command↔man-page drift guard + mandoc lint

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: CI wiring + help/README alignment

**Files:**
- Modify: `.github/workflows/checks.yml`
- Modify: `install/macos/nomad` (help pointer)
- Modify: `install/macos/README.md`

- [ ] **Step 1: Add the man-page guard to CI**

In `.github/workflows/checks.yml`, after the existing `Recovery helper unit tests`
step, add:

```yaml
      - name: Man-page drift guard + lint
        run: bash install/macos/scripts/test-manpages.sh
```

- [ ] **Step 2: Add a man pointer to `nomad help`**

In `install/macos/nomad`, find the `help|--help|-h)` dispatcher case:

```bash
  help|--help|-h)
    sed -n '2,45p' "$0" | sed 's/^# //; s/^#//'
    ;;
```

Replace with:

```bash
  help|--help|-h)
    sed -n '2,45p' "$0" | sed 's/^# //; s/^#//'
    echo
    echo "Full reference: man nomad   (per-command: man nomad-<command>, e.g. man nomad-zim)"
    ;;
```

- [ ] **Step 3: Align the README cheatsheet**

In `install/macos/README.md`, ensure the cheatsheet block lists the commands
missing today (`upgrade`, `clean`, `self-update`, `install-bridge`,
`refresh-compose`) and add a line at the top of the cheatsheet:
`# Full docs: man nomad  (per-command: man nomad-<command>)`. Match existing
formatting; do not reflow unrelated lines.

- [ ] **Step 4: Verify**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/checks.yml')); print('YAML OK')" 2>/dev/null || ruby -ryaml -e "YAML.load_file('.github/workflows/checks.yml'); puts 'YAML OK (ruby)'"; bash -n install/macos/nomad && echo SYNTAX OK; bash install/macos/nomad help | tail -3`
Expected: `YAML OK…`, `SYNTAX OK`, and the help output ends with the `Full reference: man nomad` line.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/checks.yml install/macos/nomad install/macos/README.md
git commit -m "ci+docs: man-page guard in CI; help + README point to man nomad

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Drift guard + lint**

Run: `bash install/macos/scripts/test-manpages.sh`
Expected: `ok  26 commands ↔ pages in sync; pages lint clean`.

- [ ] **Step 2: Spot-render three pages**

Run: `for c in nomad nomad-reset-ollama nomad-zim; do echo "== $c =="; mandoc -Tascii install/macos/man/$c.1 2>/dev/null | sed -n '1,12p'; done`
Expected: each renders a clean header + NAME/SYNOPSIS (no raw `.Sh` macros, no mandoc errors to stderr).

- [ ] **Step 3: Regression — other suites stay green**

Run: `bash install/macos/scripts/test-host-command-allowlist.sh && bash install/macos/scripts/test-reset-ollama.sh 2>&1 | tail -1`
Expected: `ok  allow-list in sync (6 commands)` and `23 passed, 0 failed`.

- [ ] **Step 4: Confirm SEE ALSO bijection by eye + final report**

Summarize: page count (27 = overview + 26), drift-guard result, lint result,
render spot-check, regressions green. Flag that `man nomad-<cmd>` works only
after a `nomad install` (or `nomad install-bridge`-style) re-link on a real
machine — note it for Chris's on-device check.

---

## Self-Review (completed during plan authoring)

**Spec coverage:**
- man/ layout + move nomad.1 → Task 1. ✓
- 26 per-command pages from source (template + accuracy rule + source table) → Tasks 2–4. ✓
- Overview rewrite with grouped COMMANDS + xrefs, preserved ENV/FILES/EXAMPLES → Task 5. ✓
- Install/uninstall plumbing for the set → Task 6. ✓
- Drift guard (bijection + mandoc lint) → Task 7; CI wiring → Task 8. ✓
- help pointer + README parity → Task 8. ✓
- Field Desk pages excluded (deferred to ②) — the drift guard checks the 26 current commands only; ② adds 2 commands + 2 pages together. ✓
- Testing: drift guard + lint + render + regression → Task 9. ✓

**Placeholder scan:** The per-command page *content* is intentionally derived from source (the template is literal; the table gives exact source pointers + intent) — this is correct for 26 hand-written docs, not a placeholder. All scripts/edits/CI are literal. The dispatcher-extraction awk uses `c==2` because the file has two `case "$CMD" in` blocks (the self-update gate at ~4618 is the first; the main dispatch at ~4622 is the second) — verify the `c==2` targets the main dispatch during Task 7 (adjust the counter if the gate uses a different `case` form).

**Type/name consistency:** page filenames `nomad-<cmd>.1`, command names, and the drift-guard extraction agree; `install/macos/man/` and `install/macos/scripts/test-manpages.sh` paths consistent across Tasks 1, 6, 7, 8, 9 and the spec.

**Open items deferred to execution (from spec):** `.Dd 2026-05-30` literal date (no `date` call); uninstall removal matches by symlink-target-into-bundle (not blind glob); mandoc-availability fallback handled in the guard + Task 9.
