#!/usr/bin/env bash
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NOMAD="$SCRIPT_DIR/../nomad"
PASS=0 FAIL=0
ok()    { PASS=$((PASS+1)); printf '  ok   %s\n' "$1"; }
bad()   { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$1"; }
check() { if [[ "$2" == "$3" ]]; then ok "$1 ($2)"; else bad "$1 — expected '$3', got '$2'"; fi; }
load() {
  TMP="$(mktemp -d -t nomad-omlx-test.XXXXXX)"
  export SECRETS_DIR="$TMP"
  NOMAD_SOURCE_FOR_TEST=1 source "$NOMAD"
  ok()    { PASS=$((PASS+1)); printf '  ok   %s\n' "$1"; }
  bad()   { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$1"; }
  check() { if [[ "$2" == "$3" ]]; then ok "$1 ($2)"; else bad "$1 — expected '$3', got '$2'"; fi; }
}

echo "== os/arch detection seams =="
load
check "os major from NOMAD_TEST_OS=15.5" "$(NOMAD_TEST_OS=15.5 _nomad_os_major)" "15"
check "os major from NOMAD_TEST_OS=14"   "$(NOMAD_TEST_OS=14   _nomad_os_major)" "14"
check "arch from NOMAD_TEST_ARCH"        "$(NOMAD_TEST_ARCH=arm64 _nomad_arch)"  "arm64"
check "arch x86 from NOMAD_TEST_ARCH"    "$(NOMAD_TEST_ARCH=x86_64 _nomad_arch)" "x86_64"

echo
echo "RESULTS: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]
