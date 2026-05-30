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
