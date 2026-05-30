# `nomad update` Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `nomad update [--branch NAME]` — one command that finds the active bundle (recorded in `.env`), refreshes it (git pull if a clean checkout, else codeload tarball fetch+validate+atomic-swap), and re-runs the idempotent in-place install — replacing the manual `cd→pull→reinstall` chain with no data loss.

**Architecture:** New pure helpers (`_resolve_bundle_dir`, `_bundle_is_git`, `_git_tree_dirty`, `_validate_bundle_subtree`) unit-tested by sourcing `nomad` under `NOMAD_SOURCE_FOR_TEST`. `cmd_update` orchestrates them and ends by re-exec'ing the freshly-updated `"$bundle/nomad" install` with self-update suppressed. Install records `NOMAD_BUNDLE_DIR` in `.env` so the active bundle is unambiguous.

**Tech Stack:** bash, git, codeload.github.com tarball, mdoc, GitHub Actions (existing checks.yml).

**Spec:** `docs/superpowers/specs/2026-05-30-nomad-update-command-design.md`

---

## File Structure

- **Modify** `install/macos/nomad`:
  - Recovery-helpers neighborhood (near the other `_…` helpers, above `cmd_reset_ollama`): add `_resolve_bundle_dir`, `_bundle_is_git`, `_git_tree_dirty`, `_validate_bundle_subtree`, and `cmd_update`.
  - `.env` install step (~line 1793 heredoc) + idempotent upsert: write `NOMAD_BUNDLE_DIR`.
  - Dispatcher (~line 5035): `update)` case.
  - Header help block: `nomad update` usage line.
  - `self_update_nomad`/`self_update_compose` raw URLs (lines 140, 202): repo-name fix.
- **Create** `install/macos/scripts/test-update.sh` — unit tests for the pure helpers.
- **Create** `install/macos/man/nomad-update.1`.
- **Modify** `install/macos/man/nomad.1` (Maintenance group + SEE ALSO), `install/macos/README.md` (cheatsheet).

---

## Task 1: Record NOMAD_BUNDLE_DIR + bundle-dir resolver

**Files:**
- Modify: `install/macos/nomad` (`.env` heredoc ~1793; new helper near other `_…` helpers ~4080)
- Test: `install/macos/scripts/test-update.sh`

- [ ] **Step 1: Write the failing test**

Create `install/macos/scripts/test-update.sh`:

```bash
#!/usr/bin/env bash
# Unit tests for `nomad update` helpers. Sources nomad under NOMAD_SOURCE_FOR_TEST=1
# with SECRETS_DIR pointed at a temp dir.
# Run: bash install/macos/scripts/test-update.sh
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NOMAD="$SCRIPT_DIR/../nomad"
PASS=0 FAIL=0
ok()   { PASS=$((PASS+1)); printf '  ok   %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$1"; }
check(){ if [[ "$2" == "$3" ]]; then ok "$1 ($2)"; else bad "$1 — expected '$3', got '$2'"; fi; }
load() {
  TMP="$(mktemp -d -t nomad-upd.XXXXXX)"
  export SECRETS_DIR="$TMP"
  NOMAD_SOURCE_FOR_TEST=1 source "$NOMAD"
  ok()   { PASS=$((PASS+1)); printf '  ok   %s\n' "$1"; }
  bad()  { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$1"; }
  check(){ if [[ "$2" == "$3" ]]; then ok "$1 ($2)"; else bad "$1 — expected '$3', got '$2'"; fi; }
}

echo "== bundle-dir resolver =="
load
# No .env key → falls back to $HERE (the nomad script's own dir).
check "fallback to HERE when no .env key" "$(_resolve_bundle_dir)" "$HERE"
# .env key present → wins.
printf 'NOMAD_BUNDLE_DIR=%s\n' "/some/bundle/path" > "$ENV_FILE"
check ".env key wins" "$(_resolve_bundle_dir)" "/some/bundle/path"

echo
echo "results: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]
```

- [ ] **Step 2: Run to verify it fails**

Run: `chmod +x install/macos/scripts/test-update.sh && bash install/macos/scripts/test-update.sh`
Expected: FAIL — `_resolve_bundle_dir: command not found`.

- [ ] **Step 3: Add the resolver helper**

In `install/macos/nomad`, near the other `_…` recovery helpers (above
`cmd_reset_ollama`), add:

```bash
# Resolve the active install bundle dir. Precedence: NOMAD_BUNDLE_DIR in .env
# (recorded at install) > $HERE (this script's own symlink-resolved dir). $HERE
# is the right fallback because the brew symlink resolves to the real bundle.
_resolve_bundle_dir() {
  local recorded=""
  [[ -f "$ENV_FILE" ]] && recorded="$(grep '^NOMAD_BUNDLE_DIR=' "$ENV_FILE" | cut -d= -f2-)"
  if [[ -n "$recorded" ]]; then echo "$recorded"; else echo "$HERE"; fi
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bash install/macos/scripts/test-update.sh`
Expected: PASS — `2 passed, 0 failed`.

- [ ] **Step 5: Record NOMAD_BUNDLE_DIR at install**

In the `.env` heredoc (~line 1793), add the line after `HOST_PLATFORM=darwin`:

```
NOMAD_BUNDLE_DIR=${HERE}
```

So the heredoc becomes:
```bash
    cat > "$ENV_FILE" <<EOF
NOMAD_DATA_ROOT=${DATA_ROOT_RESOLVED}
NOMAD_STATE_ROOT=${NOMAD_STATE_ROOT_DEFAULT}
APP_KEY=$(openssl rand -hex 32)
MYSQL_ROOT_PASSWORD=$(openssl rand -hex 24)
DB_PASSWORD=$(openssl rand -hex 24)
URL=http://localhost:8080
APPLE_CHIP_MODEL=${apple_chip}
APPLE_GPU_MODEL=${apple_gpu}
HOST_PLATFORM=darwin
NOMAD_BUNDLE_DIR=${HERE}
EOF
```

Then, immediately AFTER the whole `if/else` .env block ends (after the
`echo "$ENV_FILE" > "$HERE/.env-pointer"` line ~1808), add an idempotent upsert
so existing installs (whose `.env` predates this key, taking the append/else
branch) also get it:

```bash
  # Idempotent: ensure NOMAD_BUNDLE_DIR reflects the current bundle on every
  # install/repair (handles pre-existing .env files + a relocated bundle).
  if [[ -f "$ENV_FILE" ]]; then
    if grep -q '^NOMAD_BUNDLE_DIR=' "$ENV_FILE"; then
      /usr/bin/sed -i '' "s|^NOMAD_BUNDLE_DIR=.*|NOMAD_BUNDLE_DIR=$HERE|" "$ENV_FILE"
    else
      printf 'NOMAD_BUNDLE_DIR=%s\n' "$HERE" >> "$ENV_FILE"
    fi
  fi
```

- [ ] **Step 6: Verify syntax + tests**

Run: `bash -n install/macos/nomad && bash install/macos/scripts/test-update.sh`
Expected: no syntax error; `2 passed, 0 failed`.

- [ ] **Step 7: Commit**

```bash
git add install/macos/nomad install/macos/scripts/test-update.sh
git commit -m "nomad: record NOMAD_BUNDLE_DIR in .env + bundle-dir resolver

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: git detection + dirty-tree check

**Files:**
- Modify: `install/macos/nomad` (helpers)
- Test: `install/macos/scripts/test-update.sh`

- [ ] **Step 1: Write the failing test**

Add before the final `echo "results…"` in `test-update.sh`:

```bash
echo "== git helpers =="
load
# Non-git dir → not a git bundle.
mkdir -p "$TMP/plain"
if _bundle_is_git "$TMP/plain"; then bad "plain dir seen as git"; else ok "plain dir not git"; fi
# Real git repo: clean then dirty.
git init -q "$TMP/repo"; ( cd "$TMP/repo"; git config user.email t@t; git config user.name t; echo a > f; git add f; git commit -qm init )
if _bundle_is_git "$TMP/repo"; then ok "git repo detected"; else bad "git repo not detected"; fi
if _git_tree_dirty "$TMP/repo"; then bad "clean tree seen as dirty"; else ok "clean tree not dirty"; fi
echo change >> "$TMP/repo/f"
if _git_tree_dirty "$TMP/repo"; then ok "dirty tree detected"; else bad "dirty tree not detected"; fi
```

- [ ] **Step 2: Run to verify it fails**

Run: `bash install/macos/scripts/test-update.sh`
Expected: FAIL — `_bundle_is_git: command not found`.

- [ ] **Step 3: Implement the helpers**

Add near `_resolve_bundle_dir`:

```bash
# Is $1 inside a git working tree? (bundle dir itself or its parent has .git)
_bundle_is_git() {
  local d="$1"
  [[ -d "$d/.git" || -d "$d/../.git" ]] || git -C "$d" rev-parse --is-inside-work-tree >/dev/null 2>&1
}

# Does the git working tree at $1 have uncommitted changes?
_git_tree_dirty() {
  local d="$1"
  [[ -n "$(git -C "$d" status --porcelain 2>/dev/null)" ]]
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bash install/macos/scripts/test-update.sh`
Expected: PASS — `6 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add install/macos/nomad install/macos/scripts/test-update.sh
git commit -m "nomad: git-checkout + dirty-tree detection for update

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: tarball-subtree validation gate

**Files:**
- Modify: `install/macos/nomad` (helper)
- Test: `install/macos/scripts/test-update.sh`

- [ ] **Step 1: Write the failing test**

Add before the final `echo "results…"`:

```bash
echo "== bundle validation gate =="
load
# Missing everything → invalid.
mkdir -p "$TMP/cand"
if _validate_bundle_subtree "$TMP/cand"; then bad "empty dir validated"; else ok "empty dir rejected"; fi
# A nomad that isn't bash → invalid.
printf 'not a script\n' > "$TMP/cand/nomad"; mkdir -p "$TMP/cand/man"; : > "$TMP/cand/man/nomad.1"
if _validate_bundle_subtree "$TMP/cand"; then bad "non-bash nomad validated"; else ok "non-bash nomad rejected"; fi
# Valid: bash shebang + parses + man/nomad.1 present.
printf '#!/usr/bin/env bash\necho hi\n' > "$TMP/cand/nomad"
if _validate_bundle_subtree "$TMP/cand"; then ok "valid subtree accepted"; else bad "valid subtree rejected"; fi
# Missing man/ → invalid.
rm -rf "$TMP/cand/man"
if _validate_bundle_subtree "$TMP/cand"; then bad "missing man/ validated"; else ok "missing man/ rejected"; fi
```

- [ ] **Step 2: Run to verify it fails**

Run: `bash install/macos/scripts/test-update.sh`
Expected: FAIL — `_validate_bundle_subtree: command not found`.

- [ ] **Step 3: Implement the validator**

Add near the other helpers:

```bash
# Validate a freshly-fetched install/macos subtree before swapping it in:
# must contain a bash-shebang nomad that passes syntax check + a man/nomad.1.
# Returns 0 if safe to install, 1 otherwise.
_validate_bundle_subtree() {
  local d="$1"
  [[ -f "$d/nomad" ]] || return 1
  /usr/bin/head -1 "$d/nomad" | /usr/bin/grep -q '^#!.*bash' || return 1
  /bin/bash -n "$d/nomad" 2>/dev/null || return 1
  [[ -f "$d/man/nomad.1" ]] || return 1
  return 0
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bash install/macos/scripts/test-update.sh`
Expected: PASS — `10 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add install/macos/nomad install/macos/scripts/test-update.sh
git commit -m "nomad: bundle-subtree validation gate for tarball updates

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: cmd_update orchestrator + dispatcher

**Files:**
- Modify: `install/macos/nomad` (`cmd_update` + dispatcher ~5035)

> No new unit test: `cmd_update` performs network/git/re-exec side effects. Its
> branching logic is the four helpers (all unit-tested). Dispatch wiring +
> usage-rejection are checked in Step 3; live behavior is on-device.

- [ ] **Step 1: Implement cmd_update**

Add after `_validate_bundle_subtree`:

```bash
cmd_update() {
  # Flags: --branch NAME. (Dispatcher passes EXTRA_ARGS, whose defensive
  # expansion injects one empty placeholder when no flag was given — absorb it.)
  local branch="${NOMAD_BRANCH:-feat/macos-distribution-layer}"
  while [[ $# -gt 0 ]]; do
    case "$1" in
      "")        shift ;;
      --branch)  branch="$2"; shift 2 ;;
      *) die "usage: nomad update [--branch NAME]" ;;
    esac
  done

  section "Update NOMAD"
  local bundle; bundle="$(_resolve_bundle_dir)"
  [[ -d "$bundle" ]] || die "bundle dir not found: $bundle
Set NOMAD_BUNDLE_DIR in $ENV_FILE or reinstall."
  ok "active bundle: $bundle"

  if _bundle_is_git "$bundle"; then
    # ── git checkout: pull (unless dirty) ──
    local repo; repo="$(git -C "$bundle" rev-parse --show-toplevel 2>/dev/null || echo "$bundle")"
    if _git_tree_dirty "$repo"; then
      warn "git working tree at $repo has uncommitted changes — skipping pull"
      warn "commit/stash and re-run 'nomad update' to fetch the latest"
    else
      log "git pull origin $branch"
      git -C "$repo" fetch origin "$branch" 2>/dev/null || warn "fetch failed — using current checkout"
      git -C "$repo" checkout "$branch" >/dev/null 2>&1 || true
      if git -C "$repo" pull --ff-only origin "$branch" 2>/tmp/nomad-update-pull.log; then
        ok "pulled $branch → $(git -C "$repo" rev-parse --short HEAD)"
      else
        warn "pull not fast-forward — using current checkout ($(cat /tmp/nomad-update-pull.log | tail -1))"
      fi
    fi
  else
    # ── tarball install: fetch whole-repo tarball, extract, validate, swap ──
    if ! /usr/bin/curl -fsS --max-time 5 https://api.github.com >/dev/null 2>&1; then
      die "offline — cannot fetch update. Bundle left untouched."
    fi
    local tgz tmpd
    tgz="$(/usr/bin/mktemp)"; tmpd="$(/usr/bin/mktemp -d)"
    local url="https://codeload.github.com/caweis/project-nomad/tar.gz/refs/heads/$branch"
    log "downloading bundle tarball ($branch)"
    if ! /usr/bin/curl -fsSL --max-time 120 "$url" -o "$tgz"; then
      /bin/rm -rf "$tgz" "$tmpd"; die "download failed: $url — bundle left untouched"
    fi
    /usr/bin/tar -xzf "$tgz" -C "$tmpd" 2>/dev/null \
      || { /bin/rm -rf "$tgz" "$tmpd"; die "extract failed — bundle left untouched"; }
    # codeload extracts to a single top dir: project-nomad-<branch-with-dashes>/
    local sub; sub="$(/usr/bin/find "$tmpd" -type d -path '*/install/macos' -maxdepth 4 | head -1)"
    if [[ -z "$sub" ]] || ! _validate_bundle_subtree "$sub"; then
      /bin/rm -rf "$tgz" "$tmpd"; die "fetched bundle failed validation — current bundle left untouched"
    fi
    log "swapping in validated bundle"
    # rsync the validated subtree over the bundle (preserves the brew symlink,
    # which points at $bundle/nomad). --delete keeps the bundle in sync with the
    # release, but protect runtime drop-ins the bundle accrues.
    if command -v rsync >/dev/null 2>&1; then
      rsync -a --delete --exclude '.env-pointer' "$sub"/ "$bundle"/ \
        || { /bin/rm -rf "$tgz" "$tmpd"; die "swap failed — bundle may be partial; reinstall"; }
    else
      /bin/cp -R "$sub"/. "$bundle"/ \
        || { /bin/rm -rf "$tgz" "$tmpd"; die "swap failed — bundle may be partial; reinstall"; }
    fi
    /bin/chmod +x "$bundle/nomad"
    /bin/rm -rf "$tgz" "$tmpd"
    ok "bundle refreshed from $branch"
  fi

  # ── in-place install via the freshly-updated script (no nuke, no self-update
  #    loop — we just refreshed the bundle ourselves). ──
  log "running in-place install to relink script + man pages and refresh the stack"
  NOMAD_NO_SELF_UPDATE=1 exec /bin/bash "$bundle/nomad" install
}
```

- [ ] **Step 2: Add the dispatcher case**

In the main `case "$CMD" in` (NOT the self-update gate above it), after the
`upgrade-models)` line (~5044), add:

```bash
  update)          cmd_update "${EXTRA_ARGS[@]}" ;;
```

- [ ] **Step 3: Verify syntax + dispatch rejection**

Run:
```bash
bash -n install/macos/nomad && echo SYNTAX OK
bash install/macos/nomad update --bogus 2>&1 | grep -q 'usage: nomad update' && echo USAGE OK
```
Expected: `SYNTAX OK`, `USAGE OK` (the usage `die` fires before any network/git work).

- [ ] **Step 4: Commit**

```bash
git add install/macos/nomad
git commit -m "nomad: add 'update' command (detect-both refresh + in-place install)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Fix stale self-update repo URLs (Maxim 22)

**Files:**
- Modify: `install/macos/nomad` (lines 140, 202)

- [ ] **Step 1: Fix both URLs**

Run:
```bash
cd /Users/chrisweis/Developer/project-nomad-macos-arm64
/usr/bin/sed -i '' 's|raw.githubusercontent.com/caweis/project-nomad-macos-arm64|raw.githubusercontent.com/caweis/project-nomad|g' install/macos/nomad
grep -n 'raw.githubusercontent.com/caweis/project-nomad' install/macos/nomad
```
Expected: both lines now read `…/caweis/project-nomad/$branch/…` (no `-macos-arm64`).

- [ ] **Step 2: Verify syntax**

Run: `bash -n install/macos/nomad && echo SYNTAX OK`
Expected: `SYNTAX OK`.

- [ ] **Step 3: Commit**

```bash
git add install/macos/nomad
git commit -m "nomad: point self-update URLs at renamed repo (caweis/project-nomad)

The repo was renamed from project-nomad-macos-arm64; the old raw URLs only
worked via GitHub redirect. Corrects self_update_nomad + self_update_compose.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Man page + overview + help + README

**Files:**
- Create: `install/macos/man/nomad-update.1`
- Modify: `install/macos/man/nomad.1`, `install/macos/nomad` (header help), `install/macos/README.md`

- [ ] **Step 1: Create the man page**

Create `install/macos/man/nomad-update.1`:

```roff
.Dd 2026-05-30
.Dt NOMAD-UPDATE 1
.Os
.Sh NAME
.Nm nomad-update
.Nd fetch the latest bundle and reinstall in place
.Sh SYNOPSIS
.Nm nomad update
.Op Fl -branch Ar NAME
.Sh DESCRIPTION
Updates an installed NOMAD to the latest code in one step, replacing the manual
.Ic git pull
plus
.Ic nomad reinstall
dance.
.Pp
It locates the active bundle via
.Ev NOMAD_BUNDLE_DIR
in
.Pa ~/.config/project-nomad/.env
(falling back to the directory the running
.Nm nomad
resolves to). If that bundle is a git checkout, it pulls the branch
fast-forward only \(em and skips the pull if the working tree has uncommitted
changes, so local work is never discarded. Otherwise it downloads the whole-repo
tarball, validates the fetched
.Nm nomad
and man pages, and atomically swaps the validated files into the bundle.
.Pp
It then runs the idempotent in-place install: the script and all man pages are
re-linked, compose is refreshed, and the stack and LaunchAgents are ensured. It
does
.Em not
wipe data, re-pull models, or tear down the stack \(em for a clean-slate wipe use
.Xr nomad-reinstall 1 .
.Sh OPTIONS
.Bl -tag -width Ds
.It Fl -branch Ar NAME
Track a branch other than the default
.Pq Ev NOMAD_BRANCH , No or feat/macos-distribution-layer .
.El
.Sh EXAMPLES
.Bl -tag -width Ds
.It Ic nomad update
Pull/fetch the latest bundle and reinstall in place.
.El
.Sh ENVIRONMENT
.Bl -tag -width "NOMAD_BUNDLE_DIR"
.It Ev NOMAD_BUNDLE_DIR
Path to the active install bundle, recorded in .env at install time.
.It Ev NOMAD_BRANCH
Default branch to track.
.El
.Sh SEE ALSO
.Xr nomad 1 ,
.Xr nomad-reinstall 1 ,
.Xr nomad-install 1
```

- [ ] **Step 2: Add to the overview Maintenance group + SEE ALSO**

In `install/macos/man/nomad.1`, inside the `.Ss Maintenance` block (after the
`.It Cm upgrade` entry), add:

```roff
.It Cm update
Fetch the latest bundle and reinstall in place.
.Xr nomad-update 1 .
```

And add `.Xr nomad-update 1 ,` to the `.Sh SEE ALSO` list (near the other
maintenance pages).

- [ ] **Step 3: Add header-help line**

In `install/macos/nomad`, in the header comment block, add near the other
maintenance commands:

```
#   bash nomad update                        # fetch latest bundle + reinstall
#                                            # in place (no data loss; see
#                                            # 'man nomad-update')
```

If this pushes past the `help` dispatcher's `sed -n` window, widen the range.

- [ ] **Step 4: Add to README cheatsheet**

In `install/macos/README.md`, add to the cheatsheet block:
```
nomad update            Fetch latest bundle + reinstall in place (no data loss)
```

- [ ] **Step 5: Lint + verify**

Run:
```bash
mandoc -Tlint install/macos/man/nomad-update.1 2>&1 | grep -i error
mandoc -Tlint install/macos/man/nomad.1 2>&1 | grep -i error
bash -n install/macos/nomad && echo OK
echo "lint done"
```
Expected: no ERROR lines; `OK`; `lint done`.

- [ ] **Step 6: Commit**

```bash
git add install/macos/man/nomad-update.1 install/macos/man/nomad.1 install/macos/nomad install/macos/README.md
git commit -m "docs: nomad-update man page + overview/help/README entries

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Unit suite**

Run: `bash install/macos/scripts/test-update.sh`
Expected: `10 passed, 0 failed`.

- [ ] **Step 2: Drift guard now expects 29**

Run: `bash install/macos/scripts/test-manpages.sh`
Expected: `ok  29 commands ↔ pages in sync; pages lint clean` (the new `update` command + its page).

- [ ] **Step 3: Dispatch + syntax + regressions**

Run:
```bash
bash -n install/macos/nomad && echo SYNTAX OK
bash install/macos/nomad update --bogus 2>&1 | grep -q 'usage: nomad update' && echo USAGE OK
bash install/macos/scripts/test-host-command-allowlist.sh
bash install/macos/scripts/test-reset-ollama.sh 2>&1 | tail -1
```
Expected: `SYNTAX OK`, `USAGE OK`, allow-list in sync, `23 passed, 0 failed`.

- [ ] **Step 4: Confirm self-update URLs fixed**

Run: `grep -c 'project-nomad-macos-arm64' install/macos/nomad`
Expected: `0` (no stale repo-name references remain in the script).

- [ ] **Step 5: Final report**

Summarize: unit suite (10), drift guard (29), dispatch/usage/regression results,
URL-fix confirmation. Flag on-device checks: a real `nomad update` on a git
install (pull+relink) and on a tarball install (fetch+swap+relink), confirming
the stack survives and man pages/script update. Note that `update` re-execs
`nomad install`, so the user sees the normal install output after the refresh.

---

## Self-Review (completed during plan authoring)

**Spec coverage:** command surface + `--branch` (T4); NOMAD_BUNDLE_DIR record + resolver (T1); detect-both git/tarball refresh with dirty-skip + validate + atomic swap (T2,T3,T4); idempotent in-place install via re-exec with self-update suppressed (T4); Maxim-22 URL fix (T5); man page + overview + help + README + drift-guard 28→29 (T6,T7); unit tests + regressions (T1-3,T7). ✓

**Placeholder scan:** all code/commands literal. `cmd_update`'s network/git/re-exec body is shown in full; only its live execution is deferred to on-device (its decision logic is the four unit-tested helpers).

**Type/name consistency:** `_resolve_bundle_dir`, `_bundle_is_git`, `_git_tree_dirty`, `_validate_bundle_subtree`, `cmd_update`, `NOMAD_BUNDLE_DIR`, dispatcher `update)`, page `nomad-update.1` consistent across all tasks, the drift guard's `nomad-<cmd>.1` convention, and the spec.

**Open items (from spec):** re-exec chosen over in-process (T4, with `NOMAD_NO_SELF_UPDATE=1` to avoid the self-update gate double-running); rsync-with-cp-fallback swap (T4); `--branch` is one-shot (not persisted); `NOMAD_BUNDLE_DIR` single insertion point = heredoc + idempotent upsert (T1) so re-runs don't duplicate.
