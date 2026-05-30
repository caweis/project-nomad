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

echo
echo "results: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]
