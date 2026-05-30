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
  # Export SECRETS_DIR as a regular variable (not just a prefix) so it persists
  # in this shell after `source` returns — bash prefix-env vars to `source` do
  # not survive the source command's return in the caller's scope.
  export SECRETS_DIR="$TMP"
  NOMAD_SOURCE_FOR_TEST=1 source "$NOMAD"
  # Re-assert test helpers after source (nomad defines its own ok() which would
  # shadow the counters above — restore them so assertions work correctly).
  ok()   { PASS=$((PASS+1)); printf '  ok   %s\n' "$1"; }
  bad()  { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$1"; }
  check(){ if [[ "$2" == "$3" ]]; then ok "$1 ($2)"; else bad "$1 — expected '$3', got '$2'"; fi; }
}

echo "== guard =="
load
check "MARKER_FILE under temp SECRETS_DIR" "$MARKER_FILE" "$TMP/.force-internal-models"

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

echo "== marker =="
load
_marker_present && bad "marker present on fresh dir" || ok "absent on fresh dir"
_marker_set
_marker_present && ok "present after set" || bad "absent after set"
[[ -f "$TMP/.force-internal-models" ]] && ok "set created the file" || bad "set did not create file"
_marker_clear
_marker_present && bad "present after clear" || ok "absent after clear"

echo
echo "results: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]
