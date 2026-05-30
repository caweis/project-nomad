# Wedged-drive Ollama Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `nomad reset-ollama` self-healing against the mounted-but-wedged external-drive failure — detect the wedge, fall back to internal models, auto-pull the disk-gated tier set, and auto-restore to the drive once it's healthy.

**Architecture:** All changes live in the single bash CLI `install/macos/nomad` plus its generated `ollama-launcher.sh`. New pure helpers (`_run_timeboxed`, `_probe_wedged`, `_resolve_drive_models`, marker set/clear/present, `_select_pull_tier`) are unit-tested by sourcing the script under a `NOMAD_SOURCE_FOR_TEST` guard. The forced-internal state is a single marker file the generated launcher honors at step 0, so it survives KeepAlive respawns and reinstall regeneration. The wedge decision happens *before* `launchctl bootstrap`, so the existing wait-for-API loop never hangs.

**Tech Stack:** bash (zsh-host, bash-shebang script), launchd LaunchAgents, Ollama CLI, macOS `df`/`sysctl`, `shellcheck` for lint.

**Naming note (refines the spec):** the spec's single `_probe_readable` helper is implemented here as two functions — a generic timeout primitive `_run_timeboxed` (unit-tested with `sleep`) and `_probe_wedged` (composes it with `ls`, returns **0 = wedged**, 1 = not wedged). Behavior is identical to the spec's intent.

**Spec:** `docs/superpowers/specs/2026-05-30-wedged-drive-ollama-recovery-design.md`

---

## File Structure

- **Modify** `install/macos/nomad`
  - Globals (~line 226): add `MARKER_FILE`; make `SECRETS_DIR` honor a pre-set value for test isolation.
  - New helper functions (place them together, just **above** `cmd_reset_ollama` at ~line 4060): `_run_timeboxed`, `_probe_wedged`, `_resolve_drive_models`, `_marker_present`, `_marker_set`, `_marker_clear`, `_select_pull_tier`, `_autopull_tier_models`.
  - Launcher generator heredoc (~line 1440): add step 0 (marker honor).
  - `cmd_reset_ollama` (~line 4060): flag parsing + probe/marker state machine + post-restart auto-pull.
  - Dispatcher (~line 4640): pass `EXTRA_ARGS` to `cmd_reset_ollama`.
  - Header help block (line 41) + arg-parse tail (~line 4596): add a source-for-test guard.
- **Modify** `install/macos/README.md` (line 146): document the flags.
- **Modify** `install/macos/nomad.1` (lines 62, 169): document the flags.
- **Create** `install/macos/scripts/test-reset-ollama.sh`: unit tests for the pure helpers.

---

## Task 1: Test-source guard + globals

**Files:**
- Modify: `install/macos/nomad` (globals ~226; arg-parse tail ~4596)

- [ ] **Step 1: Make `SECRETS_DIR` overridable + add the marker global**

In `install/macos/nomad`, find (line ~220):

```bash
SECRETS_DIR="$HOME/.config/project-nomad"
ENV_FILE="$SECRETS_DIR/.env"
```

Replace with:

```bash
SECRETS_DIR="${SECRETS_DIR:-$HOME/.config/project-nomad}"
ENV_FILE="$SECRETS_DIR/.env"
# Forced-internal-models marker. Presence ⇒ Ollama uses ~/.ollama/models
# instead of the data-drive store. Set by `nomad reset-ollama --internal` or
# auto-fallback when the drive is wedged; cleared on restore. Honored by the
# generated ollama-launcher.sh at step 0 so KeepAlive respawns stay internal.
MARKER_FILE="$SECRETS_DIR/.force-internal-models"
```

- [ ] **Step 2: Add the source-for-test guard before arg parsing**

Find (line ~4595):

```bash
ORIGINAL_ARGS=("$@")
CMD="${1:-help}"
[[ $# -gt 0 ]] && shift
```

Insert immediately **above** `ORIGINAL_ARGS=("$@")`:

```bash
# When sourced by the unit-test harness, stop here: callers get every function
# definition above without running arg-parsing, the self-update gate, or dispatch.
if [[ -n "${NOMAD_SOURCE_FOR_TEST:-}" ]]; then
  return 0 2>/dev/null || true
fi
```

- [ ] **Step 3: Verify the script still parses and runs normally**

Run: `bash -n install/macos/nomad && bash install/macos/nomad help | head -3`
Expected: no syntax error; help text prints (first lines of the header block).

- [ ] **Step 4: Verify it is now sourceable without executing dispatch**

Run: `NOMAD_SOURCE_FOR_TEST=1 bash -c 'source install/macos/nomad; echo OK:$MARKER_FILE'`
Expected: prints `OK:/Users/.../.config/project-nomad/.force-internal-models` and nothing from dispatch (no "unknown command", no help dump).

- [ ] **Step 5: Commit**

```bash
git add install/macos/nomad
git commit -m "nomad: add source-for-test guard + MARKER_FILE global

Enables unit-testing the recovery helpers by sourcing the script under
NOMAD_SOURCE_FOR_TEST without triggering arg-parse/dispatch. SECRETS_DIR
now honors a pre-set value so tests can redirect it to a temp dir.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Test harness scaffold

**Files:**
- Create: `install/macos/scripts/test-reset-ollama.sh`

- [ ] **Step 1: Write the harness with the first (guard) assertion**

Create `install/macos/scripts/test-reset-ollama.sh`:

```bash
#!/usr/bin/env bash
# Unit tests for the wedged-drive recovery helpers in install/macos/nomad.
# Run:        bash install/macos/scripts/test-reset-ollama.sh
# Lint (opt): shellcheck install/macos/nomad
#
# Tests source the CLI under NOMAD_SOURCE_FOR_TEST=1 (so dispatch never runs)
# with SECRETS_DIR pointed at a temp dir for isolation.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NOMAD="$SCRIPT_DIR/../nomad"
PASS=0 FAIL=0

ok()   { PASS=$((PASS+1)); printf '  ok   %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$1"; }
check(){ if [[ "$2" == "$3" ]]; then ok "$1 ($2)"; else bad "$1 — expected '$3', got '$2'"; fi; }

# Fresh sourced environment with an isolated SECRETS_DIR.
load() {
  TMP="$(mktemp -d -t nomad-test.XXXXXX)"
  SECRETS_DIR="$TMP" NOMAD_SOURCE_FOR_TEST=1 source "$NOMAD"
}

echo "== guard =="
load
check "MARKER_FILE under temp SECRETS_DIR" "$MARKER_FILE" "$TMP/.force-internal-models"

echo
echo "results: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]
```

- [ ] **Step 2: Make it executable and run it**

Run: `chmod +x install/macos/scripts/test-reset-ollama.sh && bash install/macos/scripts/test-reset-ollama.sh`
Expected: `1 passed, 0 failed`, exit 0.

- [ ] **Step 3: Commit**

```bash
git add install/macos/scripts/test-reset-ollama.sh
git commit -m "test: scaffold unit-test harness for reset-ollama helpers

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Marker helpers

**Files:**
- Modify: `install/macos/nomad` (new functions above `cmd_reset_ollama`, ~4060)
- Test: `install/macos/scripts/test-reset-ollama.sh`

- [ ] **Step 1: Write the failing test**

In `test-reset-ollama.sh`, add before the final `echo "results…"`:

```bash
echo "== marker =="
load
_marker_present && bad "marker present on fresh dir" || ok "absent on fresh dir"
_marker_set
_marker_present && ok "present after set" || bad "absent after set"
[[ -f "$TMP/.force-internal-models" ]] && ok "set created the file" || bad "set did not create file"
_marker_clear
_marker_present && bad "present after clear" || ok "absent after clear"
```

- [ ] **Step 2: Run to verify it fails**

Run: `bash install/macos/scripts/test-reset-ollama.sh`
Expected: FAIL — `_marker_present: command not found` (functions don't exist yet).

- [ ] **Step 3: Implement the marker helpers**

In `install/macos/nomad`, immediately **above** `cmd_reset_ollama() {` (line ~4060), insert:

```bash
# ─── wedged-drive recovery helpers ────────────────────────────────────────────
# Forced-internal marker (see MARKER_FILE global). Presence ⇒ use internal models.
_marker_present() { [[ -f "$MARKER_FILE" ]]; }
_marker_set()     { mkdir -p "$SECRETS_DIR" && : > "$MARKER_FILE"; }
_marker_clear()   { rm -f "$MARKER_FILE"; }
```

- [ ] **Step 4: Run to verify it passes**

Run: `bash install/macos/scripts/test-reset-ollama.sh`
Expected: marker assertions pass; `5 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add install/macos/nomad install/macos/scripts/test-reset-ollama.sh
git commit -m "nomad: marker helpers for forced-internal Ollama models

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Timeout primitive + wedge probe

**Files:**
- Modify: `install/macos/nomad` (recovery-helpers block)
- Test: `install/macos/scripts/test-reset-ollama.sh`

- [ ] **Step 1: Write the failing test**

In `test-reset-ollama.sh`, add before the final `echo "results…"`:

```bash
echo "== timeout primitive =="
load
if _run_timeboxed 5 true;       then ok "fast cmd finishes (rc 0)"; else bad "fast cmd reported timeout"; fi
if _run_timeboxed 5 ls /tmp;    then ok "ls /tmp finishes";        else bad "ls /tmp reported timeout"; fi
if _run_timeboxed 1 sleep 5;    then bad "slow cmd not timed out"; else ok "slow cmd times out (rc 1)"; fi

echo "== wedge probe =="
load
# A normal, fast-returning directory is NOT wedged.
if _probe_wedged /tmp 5;        then bad "/tmp probed as wedged"; else ok "/tmp not wedged"; fi
# A non-existent path fast-fails (ENOENT) → NOT wedged.
if _probe_wedged "$TMP/nope" 5; then bad "missing path probed as wedged"; else ok "missing path not wedged"; fi
```

- [ ] **Step 2: Run to verify it fails**

Run: `bash install/macos/scripts/test-reset-ollama.sh`
Expected: FAIL — `_run_timeboxed: command not found`.

- [ ] **Step 3: Implement the primitive + probe**

In the recovery-helpers block (above `cmd_reset_ollama`), add after the marker helpers:

```bash
# Run a command, killing it if it exceeds $1 seconds. No coreutils `timeout`
# dependency (can't assume gtimeout on a fresh Mac). Returns 0 if the command
# returned within the window (ANY exit code), 1 if it had to be killed.
_run_timeboxed() {
  local t="$1"; shift
  ( "$@" >/dev/null 2>&1 ) &
  local pid=$!
  ( sleep "$t"; kill -9 "$pid" 2>/dev/null ) &
  local watcher=$!
  if wait "$pid" 2>/dev/null; then
    kill "$watcher" 2>/dev/null; wait "$watcher" 2>/dev/null
    return 0
  fi
  return 1
}

# Is the drive models path WEDGED? Probes a DEEP read (the manifests dir) because
# a mounted-but-hung APFS volume passes a top-level `ls` while a deep readdir
# hangs. Returns 0 = wedged (read did not return within the timeout),
# 1 = not wedged (returned fast, whether success or ENOENT).
_probe_wedged() {
  local path="$1" t="${2:-5}"
  if _run_timeboxed "$t" ls "$path"; then return 1; else return 0; fi
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bash install/macos/scripts/test-reset-ollama.sh`
Expected: timeout + wedge assertions pass; `10 passed, 0 failed`. (The `sleep 5` timeout case adds ~1s runtime.)

- [ ] **Step 5: Commit**

```bash
git add install/macos/nomad install/macos/scripts/test-reset-ollama.sh
git commit -m "nomad: timeout primitive + deep-path wedge probe

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Drive-models resolver

**Files:**
- Modify: `install/macos/nomad` (recovery-helpers block)
- Test: `install/macos/scripts/test-reset-ollama.sh`

- [ ] **Step 1: Write the failing test**

Add before the final `echo "results…"`:

```bash
echo "== resolve drive models =="
load
# No .env yet → empty.
check "no .env → empty" "$(_resolve_drive_models)" ""
# .env points at a dir that HAS ollama-models → returns that path.
mkdir -p "$TMP/data/ollama-models"
printf 'NOMAD_DATA_ROOT=%s\n' "$TMP/data" > "$ENV_FILE"
check "configured + present" "$(_resolve_drive_models)" "$TMP/data/ollama-models"
# .env points at a dir WITHOUT ollama-models, and no /Volumes match expected →
# empty (this assertion is skipped if a real NOMAD data drive is mounted).
printf 'NOMAD_DATA_ROOT=%s\n' "$TMP/empty" > "$ENV_FILE"
mkdir -p "$TMP/empty"
if compgen -G "/Volumes/*/project-nomad/ollama-models" >/dev/null; then
  ok "skip none-case — a real NOMAD drive is mounted"
else
  check "configured-absent + no volume → empty" "$(_resolve_drive_models)" ""
fi
```

- [ ] **Step 2: Run to verify it fails**

Run: `bash install/macos/scripts/test-reset-ollama.sh`
Expected: FAIL — `_resolve_drive_models: command not found`.

- [ ] **Step 3: Implement the resolver**

Add to the recovery-helpers block (mirror the launcher's own resolution — see the
keep-in-sync note):

```bash
# Resolve the drive-backed models dir the way ollama-launcher.sh does. Echoes
# the path, or "" if no drive store is found. KEEP IN SYNC with the launcher
# heredoc in step_ollama_native (the launcher is standalone — it cannot source
# this script — so this logic is intentionally duplicated in exactly two places).
_resolve_drive_models() {
  local configured=""
  [[ -f "$ENV_FILE" ]] && configured="$(grep '^NOMAD_DATA_ROOT=' "$ENV_FILE" | cut -d= -f2-)"
  if [[ -n "$configured" && -d "$configured/ollama-models" ]]; then
    echo "$configured/ollama-models"; return 0
  fi
  local v
  for v in /Volumes/*; do
    if [[ -d "$v/project-nomad/ollama-models" ]]; then
      echo "$v/project-nomad/ollama-models"; return 0
    fi
  done
  echo ""
}
```

Also add a one-line comment in the launcher heredoc (line ~1444, just above
`# 1. Try the configured data root`) so the duplication is signposted:

```bash
# (resolution logic mirrors _resolve_drive_models in nomad — keep in sync)
```

- [ ] **Step 4: Run to verify it passes**

Run: `bash install/macos/scripts/test-reset-ollama.sh`
Expected: resolver assertions pass; `13 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add install/macos/nomad install/macos/scripts/test-reset-ollama.sh
git commit -m "nomad: drive-models resolver (mirrors launcher resolution)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Disk-gate tier selector

**Files:**
- Modify: `install/macos/nomad` (recovery-helpers block)
- Test: `install/macos/scripts/test-reset-ollama.sh`

- [ ] **Step 1: Write the failing test**

Add before the final `echo "results…"`:

```bash
echo "== disk-gate tier selector =="
load   # tier_size_gb is defined near the top of nomad, available after source
check "dreamy + 200 → xl"      "$(_select_pull_tier dreamy 200)" "xl"
check "dreamy + 50  → medium"  "$(_select_pull_tier dreamy 50)"  "medium"
check "medium + 100 → medium"  "$(_select_pull_tier medium 100)" "medium"
check "medium + 5   → none"    "$(_select_pull_tier medium 5)"   "none"
check "tiny + 13    → tiny"    "$(_select_pull_tier tiny 13)"    "tiny"
check "tiny + 12    → minimal" "$(_select_pull_tier tiny 12)"    "minimal"
check "tiny + 11    → none"    "$(_select_pull_tier tiny 11)"    "none"
# downshift never exceeds the RAM target:
check "small + 999  → small"   "$(_select_pull_tier small 999)"  "small"
```

- [ ] **Step 2: Run to verify it fails**

Run: `bash install/macos/scripts/test-reset-ollama.sh`
Expected: FAIL — `_select_pull_tier: command not found`.

- [ ] **Step 3: Implement the selector**

Add to the recovery-helpers block:

```bash
# Pick the model tier to pull given a RAM-derived target and available GB on the
# boot volume. Walks DOWN from the target (never up — downshift is always
# RAM-safe), choosing the largest tier whose estimate + 10 GB headroom fits.
# Echoes a tier name, or "minimal" (chat+embed ~2 GB sub-floor), or "none".
_select_pull_tier() {
  local target="$1" avail="$2" headroom=10
  local ladder=(tiny small medium large xl dreamy)
  local ti=$(( ${#ladder[@]} - 1 )) k
  for k in "${!ladder[@]}"; do [[ "${ladder[$k]}" == "$target" ]] && ti=$k; done
  local i
  for (( i=ti; i>=0; i-- )); do
    local t="${ladder[$i]}" sz; sz="$(tier_size_gb "$t")"
    if (( sz + headroom <= avail )); then echo "$t"; return 0; fi
  done
  if (( 2 + headroom <= avail )); then echo "minimal"; return 0; fi
  echo "none"
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bash install/macos/scripts/test-reset-ollama.sh`
Expected: all selector assertions pass; `21 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add install/macos/nomad install/macos/scripts/test-reset-ollama.sh
git commit -m "nomad: disk-gated tier selector for recovery auto-pull

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Auto-pull driver

**Files:**
- Modify: `install/macos/nomad` (recovery-helpers block)

> No unit test: this function calls `df`, `ollama list`, and `pull_one_model`
> (network + daemon side effects). It is exercised by the on-device checklist
> (Task 12). Its only branching logic — the tier choice — is `_select_pull_tier`,
> already unit-tested in Task 6.

- [ ] **Step 1: Implement the driver**

Add to the recovery-helpers block:

```bash
# Auto-pull the tier-appropriate model set into the internal store when it is
# empty. IAW system performance: auto_tier() picks the tier from RAM; the pull
# is disk-gated (downshifts to fit the boot volume) and best-effort/offline-safe
# (a failed or partial pull never fails recovery — the daemon is already up).
_autopull_tier_models() {
  section "Auto-pull models (internal store is empty)"

  # Free GB on the volume holding ~/.ollama/models (nearest existing parent).
  local probe_dir="$HOME/.ollama"
  [[ -d "$probe_dir" ]] || probe_dir="$HOME"
  local avail_gb
  if avail_gb="$(df -g "$probe_dir" 2>/dev/null | awk 'NR==2 {print $4}')" && [[ -n "$avail_gb" ]]; then
    :
  else  # -g unavailable → parse 1K blocks
    avail_gb="$(( $(df -k "$probe_dir" | awk 'NR==2 {print $4}') / 1024 / 1024 ))"
  fi

  local target chosen models
  target="$(auto_tier)"
  chosen="$(_select_pull_tier "$target" "$avail_gb")"
  log "RAM tier '$target', ${avail_gb} GB free on boot volume → pulling '$chosen'"

  case "$chosen" in
    none)
      warn "boot drive critically low (${avail_gb} GB free) — skipping auto-pull"
      warn "free space, then:  ollama pull llama3.2:3b"
      return 0 ;;
    minimal) models="llama3.2:3b nomic-embed-text" ;;
    *)
      models="$(resolve_tier_models "$chosen")"
      [[ "$chosen" != "$target" ]] && warn "downshifted from '$target' for disk space" ;;
  esac

  local total pulled=0 failed=0 i=0 start; start="$(date +%s)"
  total="$(echo "$models" | wc -w | tr -d ' ')"
  local m
  for m in $models; do
    i=$((i+1))
    if pull_one_model "$m" "$i" "$total" "$start"; then
      pulled=$((pulled+1))
    else
      failed=$((failed+1))
      warn "pull failed for $m (network? offline?) — continuing"
    fi
  done

  if [[ $pulled -eq 0 ]]; then
    warn "no models pulled (likely offline). Daemon is up; pull when online:"
    warn "  ollama pull llama3.2:3b"
  elif [[ $failed -gt 0 ]]; then
    ok "pulled $pulled/$total models ($failed failed — retry with 'nomad upgrade-models')"
  else
    ok "pulled $pulled/$total models into internal store"
  fi
}
```

- [ ] **Step 2: Verify the script still parses + helpers still source clean**

Run: `bash -n install/macos/nomad && bash install/macos/scripts/test-reset-ollama.sh`
Expected: no syntax error; `21 passed, 0 failed` (unchanged — no new unit test).

- [ ] **Step 3: Commit**

```bash
git add install/macos/nomad
git commit -m "nomad: disk-gated, offline-safe model auto-pull for recovery

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Launcher step-0 (marker honor)

**Files:**
- Modify: `install/macos/nomad` (launcher heredoc, ~line 1440)

- [ ] **Step 1: Add step 0 to the generated launcher**

Find the launcher heredoc opening (line ~1440):

```bash
  cat > "$LAUNCHER" <<LAUNCH_EOF
#!/usr/bin/env bash
# Auto-generated by nomad install. Resolves NOMAD data drive at runtime.

# 1. Try the configured data root from .env
```

Replace those lines with (inserting the step-0 block before `# 1.`):

```bash
  cat > "$LAUNCHER" <<LAUNCH_EOF
#!/usr/bin/env bash
# Auto-generated by nomad install. Resolves NOMAD data drive at runtime.

# 0. Forced-internal override. Set by 'nomad reset-ollama --internal' or by the
#    auto-fallback when the data drive is wedged. Honored here (not just in
#    reset-ollama) so launchd KeepAlive respawns also stay internal until the
#    marker is cleared. Survives reinstall because this check is baked into the
#    generator.
if [[ -f "$MARKER_FILE" ]]; then
  export OLLAMA_MODELS="\$HOME/.ollama/models"
  echo "[ollama-launcher] forced-internal marker present — using \$OLLAMA_MODELS" >&2
  exec ${ollama_bin} serve
fi

# (resolution logic mirrors _resolve_drive_models in nomad — keep in sync)
# 1. Try the configured data root from .env
```

> Heredoc note: `$MARKER_FILE` and `${ollama_bin}` are **unescaped** → expanded
> at generation time (the absolute marker path and ollama binary path get baked
> into the generated script, exactly like `$ENV_FILE` already is). `\$HOME` and
> `\$OLLAMA_MODELS` are **escaped** → literal in the generated script, resolved
> at launchd runtime (matching the existing step-3 fallback style).

- [ ] **Step 2: Verify the generated launcher is well-formed**

Run:
```bash
bash -n install/macos/nomad && \
MARKER_FILE=/tmp/marker ENV_FILE=/tmp/x.env ollama_bin=/usr/local/bin/ollama \
  bash -c 'SECRETS_DIR=/tmp; ENV_FILE=/tmp/x.env; LAUNCHER=/tmp/test-launcher.sh; ollama_bin=/usr/local/bin/ollama; MARKER_FILE=/tmp/marker
  cat > "$LAUNCHER" <<LAUNCH_EOF
#!/usr/bin/env bash
if [[ -f "$MARKER_FILE" ]]; then export OLLAMA_MODELS="\$HOME/.ollama/models"; exec ${ollama_bin} serve; fi
LAUNCH_EOF
  bash -n "$LAUNCHER" && echo LAUNCHER_OK'
```
Expected: prints `LAUNCHER_OK` (the generated step-0 fragment is valid bash). This is a smoke check of the heredoc escaping; the real launcher is regenerated by `nomad install`.

- [ ] **Step 3: Commit**

```bash
git add install/macos/nomad
git commit -m "nomad: ollama-launcher honors forced-internal marker at step 0

Generated launcher checks the marker before any drive resolution, so a
KeepAlive respawn (or a reinstall-regenerated launcher) stays on internal
models until reset-ollama clears the marker.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: `cmd_reset_ollama` state machine

**Files:**
- Modify: `install/macos/nomad` (`cmd_reset_ollama` ~4060; dispatcher ~4640)

- [ ] **Step 1: Add flag parsing + the pre-bootstrap source decision**

In `cmd_reset_ollama` (line ~4060), find the opening:

```bash
cmd_reset_ollama() {
  section "Reset Ollama LaunchAgent"

  # 1. Bootout (must happen BEFORE killing process so KeepAlive can't respawn)
```

Replace with (insert flag-parse + decision block between `section` and `# 1.`):

```bash
cmd_reset_ollama() {
  # Flags: --internal forces internal models; --drive forces restore to the
  # data drive (refused if still wedged). No flag = auto-detect. The dispatcher
  # passes EXTRA_ARGS, whose defensive expansion injects one empty placeholder
  # when no flag was given — absorb it (same pattern the old field-desk cmd used).
  local mode="auto"
  while [[ $# -gt 0 ]]; do
    case "$1" in
      "")          shift ;;
      --internal)  mode="internal"; shift ;;
      --drive)     mode="drive";    shift ;;
      *) die "usage: nomad reset-ollama [--internal | --drive]" ;;
    esac
  done

  section "Reset Ollama LaunchAgent"

  # ── Decide the model source BEFORE touching launchd, so the launcher resolves
  #    the right store on its first spawn and the wait-for-API loop never hangs.
  local drive; drive="$(_resolve_drive_models)"
  case "$mode" in
    internal)
      _marker_set
      ok "forcing internal models (~/.ollama/models)"
      ;;
    drive)
      [[ -z "$drive" ]] && die "--drive refused: no data drive / ollama-models found to restore to.
Mount the drive (or run 'nomad install'), then retry."
      if _probe_wedged "$drive/manifests"; then
        die "--drive refused: data drive still wedged at $drive.
Physically unplug/replug the drive, then retry: nomad reset-ollama --drive"
      fi
      _marker_clear
      ok "restoring drive-backed models at $drive"
      ;;
    auto)
      if [[ -n "$drive" ]] && _probe_wedged "$drive/manifests"; then
        _marker_set
        warn "data drive WEDGED at $drive — fell back to internal models"
        warn "physical unplug/replug required; the next 'nomad reset-ollama' auto-restores once healthy"
      elif [[ -n "$drive" ]]; then
        if _marker_present; then
          _marker_clear
          ok "data drive healthy — restored to drive-backed models at $drive"
        fi
      else
        log "no data drive resolved — launcher will use its fallback chain"
      fi
      ;;
  esac

  # 1. Bootout (must happen BEFORE killing process so KeepAlive can't respawn)
```

- [ ] **Step 2: Add the post-restart auto-pull at the end of the function**

In `cmd_reset_ollama`, find the tail (line ~4130):

```bash
  # 6. Wait for API to come back up
  log "waiting for Ollama API on :11434..."
  local deadline=$(( $(date +%s) + 30 ))
  while [[ $(date +%s) -lt $deadline ]]; do
    if curl -fsS http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
      ok "Ollama API responding"
      return 0
    fi
    sleep 1
  done
  warn "API not yet responding — tail ~/Library/Logs/nomad-ollama.err.log for hints"
}
```

Replace with:

```bash
  # 6. Wait for API to come back up
  log "waiting for Ollama API on :11434..."
  local deadline=$(( $(date +%s) + 30 ))
  local api_up=0
  while [[ $(date +%s) -lt $deadline ]]; do
    if curl -fsS http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
      ok "Ollama API responding"
      api_up=1
      break
    fi
    sleep 1
  done
  [[ $api_up -eq 1 ]] || { warn "API not yet responding — tail ~/Library/Logs/nomad-ollama.err.log for hints"; return 0; }

  # 7. If we're running internal (marker present) and the internal store is
  #    empty, auto-pull the tier-appropriate set so chat works immediately.
  if _marker_present; then
    local model_count
    model_count="$(curl -fsS http://127.0.0.1:11434/api/tags 2>/dev/null | jq -r '.models | length' 2>/dev/null || echo 0)"
    if [[ "${model_count:-0}" -eq 0 ]]; then
      _autopull_tier_models
    else
      ok "internal store already has ${model_count} model(s) — no pull needed"
    fi
  fi
  return 0
}
```

- [ ] **Step 3: Pass EXTRA_ARGS in the dispatcher**

Find (line ~4640):

```bash
  reset-ollama)    cmd_reset_ollama ;;
```

Replace with:

```bash
  reset-ollama)    cmd_reset_ollama "${EXTRA_ARGS[@]}" ;;
```

- [ ] **Step 4: Verify parse + flag rejection + help still work**

Run:
```bash
bash -n install/macos/nomad && \
bash install/macos/nomad reset-ollama --bogus 2>&1 | grep -q 'usage: nomad reset-ollama' && echo USAGE_OK && \
bash install/macos/scripts/test-reset-ollama.sh
```
Expected: `USAGE_OK` then `21 passed, 0 failed`. (`--bogus` hits the usage `die` before any launchd action.)

- [ ] **Step 5: Commit**

```bash
git add install/macos/nomad
git commit -m "nomad: reset-ollama auto-detects wedged drive + auto-restores

reset-ollama [--internal|--drive] decides the model source before launchctl
bootstrap (so the wait-for-API loop can't hang on a wedged path): auto-mode
probes the drive, falls back to internal on a wedge (marker set), and
auto-restores to the drive once it probes healthy. --drive refuses onto a
still-wedged drive. After a successful internal restart with an empty store,
auto-pulls the disk-gated tier set.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 10: Help / usage text

**Files:**
- Modify: `install/macos/nomad` (header help block, line 41)

- [ ] **Step 1: Update the header usage line**

Find (line 41):

```bash
#   bash nomad reset-ollama                  # recover from stuck LaunchAgent state
```

Replace with:

```bash
#   bash nomad reset-ollama [--internal|--drive]
#                                            # recover Ollama; auto-detects a
#                                            # wedged data drive and falls back to
#                                            # internal models (auto-pulls a
#                                            # disk-gated, RAM-sized model set).
#                                            # --internal: force internal models.
#                                            # --drive: restore to the data drive
#                                            # (refused if still wedged).
```

- [ ] **Step 2: Verify help prints the new lines**

Run: `bash install/macos/nomad help | grep -A6 'reset-ollama'`
Expected: shows the new `--internal|--drive` usage with the wedged-drive description.

- [ ] **Step 3: Commit**

```bash
git add install/macos/nomad
git commit -m "nomad: document reset-ollama --internal/--drive in help

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 11: README + manpage docs

**Files:**
- Modify: `install/macos/README.md` (line 146)
- Modify: `install/macos/nomad.1` (lines 62, 169)

- [ ] **Step 1: Update the README cheatsheet line**

Find (line 146):

```
nomad reset-ollama      Recover from stuck LaunchAgent state
```

Replace with:

```
nomad reset-ollama [--internal|--drive]
                        Recover Ollama. Auto-detects a wedged external data
                        drive, falls back to internal models, and auto-pulls a
                        disk-gated, RAM-sized model set. --internal forces
                        internal; --drive restores to the drive (refused if
                        still wedged).
```

- [ ] **Step 2: Update the manpage SYNOPSIS**

In `install/macos/nomad.1`, find (line ~62):

```
.Nm
.Cm reset-ollama
.Nm
```

Replace with:

```
.Nm
.Cm reset-ollama
.Op Fl -internal | Fl -drive
.Nm
```

- [ ] **Step 3: Update the manpage SUBCOMMANDS entry**

Find (line ~169):

```
.It Cm reset-ollama
Recover from stuck LaunchAgent state ("bootstrap failed: 5: Input/output
error"). Bootouts existing agent, kills orphan ollama serves, re-bootstraps.
```

Replace with:

```
.It Cm reset-ollama Op Fl -internal | Fl -drive
Recover from stuck LaunchAgent state ("bootstrap failed: 5: Input/output
error"). Bootouts existing agent, kills orphan ollama serves, re-bootstraps.
With no flag, auto-detects a mounted-but-wedged external data drive (a deep
read that hangs) and falls back to internal models
.Pa ~/.ollama/models ,
then auto-pulls a disk-gated, RAM-sized model set so chat works immediately.
.Fl -internal
forces internal models;
.Fl -drive
restores to the data drive (refused while the drive is still wedged \(em
physically unplug/replug it first).
```

- [ ] **Step 4: Verify the manpage renders without errors**

Run: `mandoc -Tlint install/macos/nomad.1 2>&1 | head; man -l install/macos/nomad.1 2>/dev/null | grep -A4 'reset-ollama' | head`
Expected: no `mandoc` ERROR lines for the edited region; the rendered page shows the new flags. (If `mandoc` is absent, `man -l` alone is sufficient.)

- [ ] **Step 5: Commit**

```bash
git add install/macos/README.md install/macos/nomad.1
git commit -m "docs: reset-ollama --internal/--drive in README + manpage

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 12: Lint, full test run, on-device checklist

**Files:**
- Create: `docs/superpowers/plans/2026-05-30-wedged-drive-ollama-recovery-ondevice-checklist.md`

- [ ] **Step 1: shellcheck the script (best-effort)**

Run: `command -v shellcheck >/dev/null && shellcheck -S warning install/macos/nomad || echo "shellcheck not installed — skipping (note in report)"`
Expected: no new errors in the recovery-helpers block / `cmd_reset_ollama` / launcher generator. Pre-existing warnings elsewhere are out of scope (do not fix unrelated lines). If shellcheck is absent, note it in the final report.

- [ ] **Step 2: Run the full unit suite**

Run: `bash install/macos/scripts/test-reset-ollama.sh`
Expected: `21 passed, 0 failed`, exit 0.

- [ ] **Step 3: Write the on-device verification checklist**

Create `docs/superpowers/plans/2026-05-30-wedged-drive-ollama-recovery-ondevice-checklist.md`:

```markdown
# Wedged-drive recovery — on-device checklist (Mac mini M4 / external APFS drive)

A real APFS wedge can't be faked in CI. Verify on hardware:

- [ ] **Healthy baseline:** drive mounted + healthy → `nomad reset-ollama` →
      no marker file, daemon serves drive models. Confirm:
      `ls ~/.config/project-nomad/.force-internal-models` → not found;
      `curl -fsS localhost:11434/api/tags | jq '.models|length'` > 0.
- [ ] **Wedge fallback:** induce/observe the wedge (deep read of
      `$DRIVE/ollama-models/manifests/...` hangs) → `nomad reset-ollama` →
      returns in seconds (not 30s+), marker file created, API responds.
      If internal store was empty, auto-pull ran and downshifted if the boot
      drive was tight (watch the "RAM tier … → pulling …" log line).
- [ ] **Restore refused while wedged:** `nomad reset-ollama --drive` while still
      wedged → refused with the "physically unplug/replug" message; marker
      unchanged; daemon stays on internal.
- [ ] **Auto-restore after replug:** physically unplug → wait 10s → replug →
      confirm deep read returns instantly → `nomad reset-ollama` → marker
      cleared, daemon back on drive models, "restored to drive-backed models".
- [ ] **Explicit internal:** `nomad reset-ollama --internal` on a healthy drive
      → marker set, daemon on internal (forces internal regardless of probe).
- [ ] **KeepAlive durability:** with the marker set, `pkill -9 -f 'ollama serve'`
      → launchd respawns via the launcher → still internal (launcher honored the
      marker, no manual reset needed).
- [ ] **Field Desk coexistence:** with Field Desk running (once restored in ②),
      run a recovery → Field Desk AI Chat still reaches :11434 afterward.
```

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-05-30-wedged-drive-ollama-recovery-ondevice-checklist.md
git commit -m "docs: on-device verification checklist for wedged-drive recovery

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 5: Final report**

Summarize: unit suite result, shellcheck status (or skipped), what's verified
in-session vs. what requires the on-device checklist (the actual APFS wedge,
launchd respawn durability, and a live auto-pull). Flag the on-device checklist
for Chris.

---

## Self-Review (completed during plan authoring)

**Spec coverage:**
- Command surface `[--internal|--drive]` + auto → Task 9. ✓
- Marker mechanism + launcher step-0 → Tasks 3, 8. ✓
- Wedge probe (timeout-bounded, deep path, no coreutils) → Task 4. ✓
- Decision-before-bootstrap (no hang) → Task 9 Step 1. ✓
- Auto-restore + `--drive` refusal + physical-replug messaging → Task 9. ✓
- Auto-pull IAW system performance, disk-gated, offline-safe → Tasks 6, 7, 9 Step 2. ✓
- `_resolve_drive_models` single helper + launcher keep-in-sync note → Task 5. ✓
- Field Desk compatibility (no dispatcher/allow-list change; on-device check) → Task 12. ✓
- Testing: sourceable pure helpers + harness + shellcheck + on-device checklist → Tasks 1, 2–6, 12. ✓
- Non-goal (no interactive picker) honored: `_autopull_tier_models` uses `auto_tier` directly, no prompt. ✓

**Placeholder scan:** none — every code/doc step has literal content and exact commands.

**Type/name consistency:** `MARKER_FILE`, `_marker_present/_set/_clear`, `_run_timeboxed`, `_probe_wedged` (0=wedged), `_resolve_drive_models`, `_select_pull_tier` (returns tier|`minimal`|`none`), `_autopull_tier_models` used consistently across Tasks 1–9 and the launcher heredoc.

**Open items deferred to execution (from spec):** `df -g` portability has an explicit `-k` fallback in Task 7; foreground-pull choice resolved to foreground (parity with install), documented in Task 7.
