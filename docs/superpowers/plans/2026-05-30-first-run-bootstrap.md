# First-run Bootstrap Installer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `install/bootstrap.sh` — a one-line `curl … | bash` first-run installer that fetches the bundle to `~/Applications/project-nomad` and hands off to `nomad install` (data-root picker intact) — plus README/recovery-hint corrections and retirement of the dead legacy macOS installer.

**Architecture:** `bootstrap.sh` is stock-tools-only (curl/tar/uname) with sourceable pure functions (`_bootstrap_platform_ok`, `_bootstrap_location`, `_bootstrap_already_installed`) unit-tested via a `NOMAD_BOOTSTRAP_SOURCE_FOR_TEST` guard + injectable `NOMAD_TEST_OS/ARCH`. `_bootstrap_main` guards platform, resolves location, is idempotent, fetches the branch tarball, and `exec`s `nomad install` with NO `--data-root`.

**Tech Stack:** bash, curl, tar, codeload.github.com, shellcheck.

**Spec:** `docs/superpowers/specs/2026-05-30-first-run-bootstrap-design.md`

---

## File Structure

- **Create** `install/bootstrap.sh` — the hosted one-liner target.
- **Create** `install/scripts/test-bootstrap.sh` — unit tests for the pure functions.
- **Modify** `README.md` — `## Install` one-liner.
- **Modify** `install/macos/nomad` — two recovery-hint strings (lines ~98, ~1628).
- **Delete** `install/install_nomad_macos.sh` — dead pre-CLI legacy installer.

---

## Task 1: bootstrap.sh — guard, location, dry-run

**Files:**
- Create: `install/bootstrap.sh`
- Test: `install/scripts/test-bootstrap.sh`

- [ ] **Step 1: Write the failing test**

Create `install/scripts/test-bootstrap.sh`:

```bash
#!/usr/bin/env bash
# Unit tests for install/bootstrap.sh pure helpers. Sources it under
# NOMAD_BOOTSTRAP_SOURCE_FOR_TEST=1 (main does not run) with injectable
# NOMAD_TEST_OS / NOMAD_TEST_ARCH / NOMAD_HOME.
# Run: bash install/scripts/test-bootstrap.sh
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BOOTSTRAP="$SCRIPT_DIR/../bootstrap.sh"
PASS=0 FAIL=0
ok()   { PASS=$((PASS+1)); printf '  ok   %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$1"; }
check(){ if [[ "$2" == "$3" ]]; then ok "$1 ($2)"; else bad "$1 — expected '$3', got '$2'"; fi; }

NOMAD_BOOTSTRAP_SOURCE_FOR_TEST=1 source "$BOOTSTRAP"

echo "== platform guard =="
NOMAD_TEST_OS=Darwin NOMAD_TEST_ARCH=arm64 _bootstrap_platform_ok && ok "macOS arm64 passes" || bad "macOS arm64 rejected"
NOMAD_TEST_OS=Darwin NOMAD_TEST_ARCH=x86_64 _bootstrap_platform_ok && bad "Intel passed" || ok "Intel rejected"
NOMAD_TEST_OS=Linux  NOMAD_TEST_ARCH=arm64  _bootstrap_platform_ok && bad "Linux passed" || ok "Linux rejected"

echo "== location resolution =="
check "default location" "$(NOMAD_HOME='' _bootstrap_location)" "$HOME/Applications/project-nomad"
check "NOMAD_HOME override" "$(NOMAD_HOME=/tmp/nx _bootstrap_location)" "/tmp/nx"

echo
echo "results: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]
```

- [ ] **Step 2: Run to verify it fails**

Run: `chmod +x install/scripts/test-bootstrap.sh && bash install/scripts/test-bootstrap.sh`
Expected: FAIL — `bootstrap.sh` does not exist / `_bootstrap_platform_ok: command not found`.

- [ ] **Step 3: Create bootstrap.sh (guard + location + dry-run skeleton)**

Create `install/bootstrap.sh`:

```bash
#!/usr/bin/env bash
# Project NOMAD — first-run bootstrap for macOS (Apple Silicon).
# Usage (one-liner):
#   curl -fsSL https://raw.githubusercontent.com/caweis/project-nomad/feat/macos-distribution-layer/install/bootstrap.sh | bash
#
# Fetches the install bundle to ~/Applications/project-nomad (override with
# NOMAD_HOME) and hands off to `nomad install` — which asks where to store your
# CONTENT (usually an external drive). The bundle (code) and the data root
# (content) are deliberately separate.
#
# NOTE: stock tools only (curl/tar/uname) — git is NOT assumed; `nomad install`
# installs Homebrew/Xcode-CLT/Rosetta/OrbStack/Ollama itself.

NOMAD_BRANCH="${NOMAD_BRANCH:-feat/macos-distribution-layer}"

# macOS + Apple Silicon? (test-injectable via NOMAD_TEST_OS / NOMAD_TEST_ARCH)
_bootstrap_platform_ok() {
  local os="${NOMAD_TEST_OS:-$(uname -s)}" arch="${NOMAD_TEST_ARCH:-$(uname -m)}"
  [[ "$os" == "Darwin" && "$arch" == "arm64" ]]
}

# Canonical bundle location.
_bootstrap_location() {
  echo "${NOMAD_HOME:-$HOME/Applications/project-nomad}"
}

# Is a bundle already present at $1?
_bootstrap_already_installed() {
  [[ -f "$1/install/macos/nomad" ]]
}

_bootstrap_main() {
  set -euo pipefail

  if ! _bootstrap_platform_ok; then
    echo "Project NOMAD's macOS installer requires an Apple Silicon Mac (macOS, arm64)." >&2
    echo "Detected: $(uname -s) $(uname -m). Aborting." >&2
    exit 1
  fi

  local dest; dest="$(_bootstrap_location)"

  if _bootstrap_already_installed "$dest"; then
    echo "NOMAD is already installed at $dest."
    echo "  • To update:   nomad update"
    echo "  • To reinstall: remove $dest and re-run this command."
    exit 0
  fi

  if [[ -n "${NOMAD_BOOTSTRAP_DRY_RUN:-}" ]]; then
    echo "DRY RUN — would:"
    echo "  1. fetch branch '$NOMAD_BRANCH' to $dest"
    echo "  2. exec: bash $dest/install/macos/nomad install"
    exit 0
  fi

  _bootstrap_fetch_and_install "$dest"
}

# Run main unless sourced by the test harness.
if [[ -z "${NOMAD_BOOTSTRAP_SOURCE_FOR_TEST:-}" ]]; then
  _bootstrap_main "$@"
fi
```

(`_bootstrap_fetch_and_install` is added in Task 2 — for now the dry-run/idempotency/guard paths are complete and testable; a non-dry-run real run would error on the missing function, which Task 2 fills.)

- [ ] **Step 4: Run to verify it passes**

Run: `bash install/scripts/test-bootstrap.sh`
Expected: PASS — `5 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add install/bootstrap.sh install/scripts/test-bootstrap.sh
git commit -m "bootstrap: platform guard + canonical location + dry-run

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: bootstrap.sh — idempotency test + fetch/handoff

**Files:**
- Modify: `install/bootstrap.sh`
- Test: `install/scripts/test-bootstrap.sh`

- [ ] **Step 1: Write the failing test (idempotency + dry-run wiring)**

Add to `test-bootstrap.sh` before the final `echo "results…"`:

```bash
echo "== idempotency detection =="
TMP="$(mktemp -d)"
_bootstrap_already_installed "$TMP" && bad "empty dir seen as installed" || ok "empty dir not installed"
mkdir -p "$TMP/install/macos"; printf '#!/usr/bin/env bash\n' > "$TMP/install/macos/nomad"
_bootstrap_already_installed "$TMP" && ok "bundle dir detected" || bad "bundle dir not detected"

echo "== dry-run main (already-installed path) =="
# An existing bundle short-circuits with the 'already installed' message + exit 0.
out="$(NOMAD_HOME="$TMP" NOMAD_TEST_OS=Darwin NOMAD_TEST_ARCH=arm64 bash "$BOOTSTRAP" 2>&1)"; rc=$?
[[ $rc -eq 0 && "$out" == *"already installed at $TMP"* ]] && ok "already-installed short-circuit" || bad "already-installed path wrong (rc=$rc)"

echo "== dry-run main (fresh path) =="
FRESH="$(mktemp -d)/nx"
out="$(NOMAD_HOME="$FRESH" NOMAD_TEST_OS=Darwin NOMAD_TEST_ARCH=arm64 NOMAD_BOOTSTRAP_DRY_RUN=1 bash "$BOOTSTRAP" 2>&1)"; rc=$?
[[ $rc -eq 0 && "$out" == *"would:"* && "$out" == *"$FRESH/install/macos/nomad install"* ]] && ok "dry-run prints planned actions" || bad "dry-run wrong (rc=$rc)"
```

- [ ] **Step 2: Run to verify it fails**

Run: `bash install/scripts/test-bootstrap.sh`
Expected: the idempotency assertions pass, but the fresh dry-run path may already pass too (it exits before `_bootstrap_fetch_and_install`). If all pass, this step still drives adding the real fetch in Step 3; if the non-dry-run real path is ever exercised it must not error — proceed to implement.

- [ ] **Step 3: Add the fetch + handoff function**

In `install/bootstrap.sh`, add `_bootstrap_fetch_and_install` immediately above
`_bootstrap_main`:

```bash
# Download the branch tarball, extract just into $1, then hand off to the real
# installer. Stock curl/tar only. Leaves nothing half-placed on failure.
_bootstrap_fetch_and_install() {
  local dest="$1"
  command -v curl >/dev/null 2>&1 || { echo "curl not found — cannot bootstrap" >&2; exit 1; }

  echo "Fetching Project NOMAD ($NOMAD_BRANCH) → $dest"
  local tgz tmpd
  tgz="$(mktemp)"; tmpd="$(mktemp -d)"
  local url="https://codeload.github.com/caweis/project-nomad/tar.gz/refs/heads/$NOMAD_BRANCH"
  if ! curl -fsSL --max-time 180 "$url" -o "$tgz"; then
    rm -rf "$tgz" "$tmpd"; echo "Download failed: $url" >&2; exit 1
  fi
  # --strip-components=1 drops the codeload top dir; extract straight into tmpd.
  if ! tar -xzf "$tgz" --strip-components=1 -C "$tmpd" 2>/dev/null; then
    rm -rf "$tgz" "$tmpd"; echo "Extract failed" >&2; exit 1
  fi
  # Validate before placing.
  if [[ ! -f "$tmpd/install/macos/nomad" ]] || ! head -1 "$tmpd/install/macos/nomad" | grep -q '^#!.*bash'; then
    rm -rf "$tgz" "$tmpd"; echo "Fetched bundle is missing install/macos/nomad — aborting" >&2; exit 1
  fi
  mkdir -p "$(dirname "$dest")"
  rm -rf "$dest"
  mv "$tmpd" "$dest"
  rm -f "$tgz"
  chmod +x "$dest/install/macos/nomad"

  echo
  echo "Next, the installer will ask where to store your CONTENT (Wikipedia, AI"
  echo "models, maps) — usually an external drive. The app code lives in $dest."
  echo
  exec bash "$dest/install/macos/nomad" install
}
```

- [ ] **Step 4: Run to verify tests pass**

Run: `bash install/scripts/test-bootstrap.sh`
Expected: `9 passed, 0 failed`. (`bash -n install/bootstrap.sh` should also pass — run it: `bash -n install/bootstrap.sh && echo OK`.)

- [ ] **Step 5: Commit**

```bash
git add install/bootstrap.sh install/scripts/test-bootstrap.sh
git commit -m "bootstrap: tarball fetch + validate + hand off to nomad install

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: README one-liner

**Files:**
- Modify: `README.md` (`## Install` block, lines ~14-24)

- [ ] **Step 1: Replace the stale-name one-liner**

In `README.md`, find:

```
## Install

On a fresh Apple Silicon Mac (M1 or later, macOS 14+):

```bash
mkdir -p ~/Developer && cd ~/Developer && \
  curl -fsSL https://github.com/caweis/project-nomad-macos-arm64/archive/refs/heads/feat/macos-distribution-layer.tar.gz | tar xz && \
  bash project-nomad-feat-macos-distribution-layer/install/macos/nomad install
```
```

Replace the fenced command with:

```bash
curl -fsSL https://raw.githubusercontent.com/caweis/project-nomad/feat/macos-distribution-layer/install/bootstrap.sh | bash
```

And ensure the sentence after it reads (keep/adjust to):

> This installs the NOMAD command to `~/Applications/project-nomad`, then asks
> where to store your data (an external drive is the usual answer) and which AI
> models to pull. Idempotent — re-running fixes anything that broke; to update
> later, run `nomad update`.

- [ ] **Step 2: Verify no stale repo-name one-liner remains in README**

Run: `grep -n 'project-nomad-macos-arm64' README.md`
Expected: no install-command line remains (lineage prose mentioning history is fine if present, but the install one-liner must be gone). If any install/clone command still shows the old name, fix it.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: README install one-liner → hosted bootstrap (renamed repo)

Replaces the long stale-name curl|tar|bash with the one-line bootstrap and
points at caweis/project-nomad (was project-nomad-macos-arm64, redirect-only).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Align recovery hints to the canonical location

**Files:**
- Modify: `install/macos/nomad` (lines ~98, ~1628)

- [ ] **Step 1: Update both recovery-hint strings**

Run:
```bash
cd /Users/chrisweis/Developer/project-nomad-macos-arm64
/usr/bin/sed -i '' 's|~/Developer/project-nomad|~/Applications/project-nomad|g' install/macos/nomad
grep -n 'Applications/project-nomad' install/macos/nomad
grep -c 'Developer/project-nomad' install/macos/nomad
```
Expected: the two hint lines now read `~/Applications/project-nomad…`; the
`Developer/project-nomad` count is `0`.

- [ ] **Step 2: Verify syntax + regressions**

Run: `bash -n install/macos/nomad && echo OK && bash install/macos/scripts/test-reset-ollama.sh 2>&1 | tail -1`
Expected: `OK`, `23 passed, 0 failed`.

- [ ] **Step 3: Commit**

```bash
git add install/macos/nomad
git commit -m "nomad: recovery hints point at canonical ~/Applications/project-nomad

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Retire the dead legacy macOS installer

**Files:**
- Delete: `install/install_nomad_macos.sh`

- [ ] **Step 1: Re-confirm it's unreferenced**

Run: `grep -rn 'install_nomad_macos' . 2>/dev/null | grep -v '\.git/' | grep -v node_modules`
Expected: no output (nothing references it). If anything does, STOP and report — do not delete.

- [ ] **Step 2: Delete it**

Run: `git rm install/install_nomad_macos.sh`

- [ ] **Step 3: Commit**

```bash
git commit -m "cleanup: remove dead pre-CLI macOS installer (install_nomad_macos.sh)

snfettig's standalone macOS installer predates the unified \`nomad\` CLI
(install/macos/nomad) and is unreferenced. The CLI's \`install\` command is the
single first-run path now; the bootstrap fetches it. Removing the dead script
clears the only competing 'how do I start' entry point. (Git history preserves
the original; credit to snfettig for the foundational macOS install work.)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Lint + full verification

**Files:** none (verification only)

- [ ] **Step 1: shellcheck the bootstrap**

Run: `command -v shellcheck >/dev/null && shellcheck -S warning install/bootstrap.sh || echo "shellcheck not installed — skip"`
Expected: no errors in `bootstrap.sh` (or skip note).

- [ ] **Step 2: Bootstrap unit suite**

Run: `bash install/scripts/test-bootstrap.sh`
Expected: `9 passed, 0 failed`.

- [ ] **Step 3: Dry-run the real entrypoint end to end (no fetch)**

Run: `NOMAD_HOME=/tmp/nomad-bootstrap-demo NOMAD_TEST_OS=Darwin NOMAD_TEST_ARCH=arm64 NOMAD_BOOTSTRAP_DRY_RUN=1 bash install/bootstrap.sh`
Expected: prints the DRY RUN plan referencing `/tmp/nomad-bootstrap-demo/install/macos/nomad install`, exits 0, fetches nothing.

- [ ] **Step 4: Regressions stay green**

Run:
```bash
bash install/macos/scripts/test-manpages.sh
bash install/macos/scripts/test-host-command-allowlist.sh
bash install/macos/scripts/test-update.sh 2>&1 | tail -1
bash install/macos/scripts/test-reset-ollama.sh 2>&1 | tail -1
```
Expected: `29 ↔ pages in sync`; `allow-list in sync`; `10 passed`; `23 passed`.

- [ ] **Step 5: Final report**

Summarize: bootstrap unit suite (9), shellcheck, dry-run output, regressions,
README + recovery-hint + legacy-deletion confirmations. Flag the on-device
check: run the real one-liner on a clean Mac / fresh `NOMAD_HOME` → confirm it
fetches to `~/Applications/project-nomad`, the data-root picker appears, install
completes, and `nomad update` works afterward (NOMAD_BUNDLE_DIR recorded there).

---

## Self-Review (completed during plan authoring)

**Spec coverage:** one-liner + bootstrap.sh guard/location/idempotency/fetch/handoff (T1,T2); README one-liner fix (T3); recovery-hint alignment to ~/Applications/project-nomad (T4); legacy script deletion (T5); data-root picker preserved (T2 hands off with NO --data-root — explicit); NOMAD_HOME override (T1); NOMAD_BOOTSTRAP_DRY_RUN + unit tests (T1,T2,T6); shellcheck + regressions (T6). ✓

**Placeholder scan:** all code/commands literal. `_bootstrap_fetch_and_install` is fully shown; only its live network run is deferred to on-device (its decisions — guard, location, idempotency — are unit-tested).

**Type/name consistency:** `_bootstrap_platform_ok`, `_bootstrap_location`, `_bootstrap_already_installed`, `_bootstrap_fetch_and_install`, `_bootstrap_main`, env hooks `NOMAD_HOME`/`NOMAD_BRANCH`/`NOMAD_BOOTSTRAP_DRY_RUN`/`NOMAD_BOOTSTRAP_SOURCE_FOR_TEST`/`NOMAD_TEST_OS`/`NOMAD_TEST_ARCH` consistent across bootstrap.sh and the test. Location `~/Applications/project-nomad` consistent across T1/T3/T4 and the spec.

**Open items (from spec):** `tar --strip-components=1` chosen over guess-the-top-dir (T2); test uses env hooks (`NOMAD_TEST_OS/ARCH`) not uname-shadowing (T1); README-only one-liner (no nomad help/man entry — bootstrap is pre-install).
