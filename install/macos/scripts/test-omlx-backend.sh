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

echo "== backend eligibility (Apple Silicon + macOS 15+) =="
load
NOMAD_TEST_ARCH=arm64  NOMAD_TEST_OS=15.5 backend_eligible && r=yes || r=no; check "arm64+15 eligible" "$r" "yes"
NOMAD_TEST_ARCH=arm64  NOMAD_TEST_OS=14.7 backend_eligible && r=yes || r=no; check "arm64+14 ineligible" "$r" "no"
NOMAD_TEST_ARCH=x86_64 NOMAD_TEST_OS=15.5 backend_eligible && r=yes || r=no; check "intel+15 ineligible" "$r" "no"

echo "== recommended backend =="
load
check "arm64+15 → omlx"   "$(NOMAD_TEST_ARCH=arm64  NOMAD_TEST_OS=15.5 recommend_backend)" "omlx"
check "arm64+14 → ollama" "$(NOMAD_TEST_ARCH=arm64  NOMAD_TEST_OS=14.7 recommend_backend)" "ollama"
check "intel+15 → ollama" "$(NOMAD_TEST_ARCH=x86_64 NOMAD_TEST_OS=15.5 recommend_backend)" "ollama"

echo "== backend persisted in .env, with fallback =="
load
ENV_FILE="$SECRETS_DIR/.env"
: > "$ENV_FILE"
_load_backend; check "missing key → ollama fallback" "$BACKEND" "ollama"
echo "NOMAD_AI_BACKEND=omlx" >> "$ENV_FILE"
_load_backend; check "reads omlx from .env" "$BACKEND" "omlx"
echo "NOMAD_AI_BACKEND=bogus" > "$ENV_FILE"
_load_backend; check "invalid value → ollama fallback" "$BACKEND" "ollama"

echo "== backend choice precedence =="
load
check "no flag, eligible → recommend omlx" \
  "$(BACKEND_ARG='' NOMAD_TEST_ARCH=arm64 NOMAD_TEST_OS=15.5 resolve_backend_choice)" "omlx"
check "flag ollama wins over recommend" \
  "$(BACKEND_ARG=ollama NOMAD_TEST_ARCH=arm64 NOMAD_TEST_OS=15.5 resolve_backend_choice)" "ollama"
check "no flag, ineligible → ollama" \
  "$(BACKEND_ARG='' NOMAD_TEST_ARCH=x86_64 NOMAD_TEST_OS=15.5 resolve_backend_choice)" "ollama"

echo "== nomad backend show =="
load
ENV_FILE="$SECRETS_DIR/.env"; echo "NOMAD_AI_BACKEND=omlx" > "$ENV_FILE"
check "show reads .env" "$(cmd_backend show 2>/dev/null | tr -d '\n' | grep -oE 'omlx|ollama' | head -1)" "omlx"

echo
echo "RESULTS: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]
