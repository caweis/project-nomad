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

echo
echo "results: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]
