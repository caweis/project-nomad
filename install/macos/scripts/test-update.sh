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
