#!/usr/bin/env bash
# Unit tests for the Ollama llama.cpp runner-health helpers in `nomad`.
#
# Background: Homebrew's ollama 0.30.0 bottle shipped without the llama.cpp runner
# (llama-server). The daemon served /api/tags fine, but every model load 500'd
# with "llama-server binary not found" — silently breaking chat (:11434) and RAG
# embeddings (:11435). These tests lock in the detection logic that closes that
# gap: the static runner-presence check and the inference-response classifier.
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NOMAD="$SCRIPT_DIR/../nomad"
PASS=0 FAIL=0

# Source first: nomad defines its own ok()/warn()/etc., so our test helpers must
# be defined AFTER the source or they'd be clobbered (and PASS would never tick).
NOMAD_SOURCE_FOR_TEST=1 source "$NOMAD"
ok()    { PASS=$((PASS+1)); printf '  ok   %s\n' "$1"; }
bad()   { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$1"; }
check() { if [[ "$2" == "$3" ]]; then ok "$1 ($2)"; else bad "$1 — expected '$3', got '$2'"; fi; }

echo "== _classify_ollama_probe: runner-missing signatures =="
# The exact body the incomplete bottle returns (HTTP 500), plus variants.
check "500 'binary not found'" \
  "$(_classify_ollama_probe 500 'error starting llama-server: llama-server binary not found' generate)" "runner-missing"
check "500 runner terminated" \
  "$(_classify_ollama_probe 500 '{"error":"llama runner process has terminated: exit status 127"}' generate)" "runner-missing"
check "names llama/server path" \
  "$(_classify_ollama_probe 500 'cmake -S llama/server --preset cpu' generate)" "runner-missing"
# Match the signature even if the status code is something other than 500.
check "runner text wins over code" \
  "$(_classify_ollama_probe 503 'error starting llama-server' generate)" "runner-missing"

echo "== _classify_ollama_probe: healthy inference =="
check "generate ok"        "$(_classify_ollama_probe 200 '{"model":"x","response":"hi","done":true}' generate)" "ok"
check "embed ok (plural)"  "$(_classify_ollama_probe 200 '{"embeddings":[[0.1,0.2]]}' embed)" "ok"
check "embed ok (legacy)"  "$(_classify_ollama_probe 200 '{"embedding":[0.1,0.2]}' embed)" "ok"

echo "== _classify_ollama_probe: other failures are NOT misread as runner-missing =="
check "404 model not found" "$(_classify_ollama_probe 404 '{"error":"model \"x\" not found"}' generate)" "error:http=404:{\"error\":\"model \\\"x\\\" not found\"}"
# A generic 500 with no runner signature is an error, not runner-missing.
case "$(_classify_ollama_probe 500 '{"error":"out of memory"}' generate)" in
  runner-missing) bad "generic 500 misclassified as runner-missing" ;;
  error:*)        ok  "generic 500 → error:* (not runner-missing)" ;;
  *)              bad "generic 500 → unexpected verdict" ;;
esac
# A 200 that lacks the expected key is 'unexpected', not ok.
case "$(_classify_ollama_probe 200 '{"weird":true}' generate)" in
  ok) bad "200 without response key misread as ok" ;;
  *)  ok  "200 without response key → not ok" ;;
esac

echo "== _ollama_runner_present: static binary detection (NOMAD_TEST_RUNNER_DIRS seam) =="
T="$(mktemp -d -t nomad-runner-test.XXXXXX)"
export NOMAD_TEST_RUNNER_DIRS="$T"
_ollama_runner_present && r=present || r=absent
check "empty tree → absent" "$r" "absent"
# Runner can be nested (brew puts it under Cellar/ollama/<ver>/libexec/lib/ollama).
mkdir -p "$T/Cellar/ollama/0.30.0/libexec/lib/ollama"
: > "$T/Cellar/ollama/0.30.0/libexec/lib/ollama/llama-server"
_ollama_runner_present && r=present || r=absent
check "nested llama-server → present" "$r" "present"
# A directory named llama-server must NOT count (we require a file).
rm -f "$T/Cellar/ollama/0.30.0/libexec/lib/ollama/llama-server"
mkdir -p "$T/Cellar/ollama/0.30.0/libexec/lib/ollama/llama-server"
_ollama_runner_present && r=present || r=absent
check "dir named llama-server → absent" "$r" "absent"
# Multiple candidate dirs: present in any one → present.
rm -rf "$T"; mkdir -p "$T/a" "$T/b"; : > "$T/b/llama-server"
export NOMAD_TEST_RUNNER_DIRS=$'NONEXISTENT_DIR\n'"$T/a"$'\n'"$T/b"
_ollama_runner_present && r=present || r=absent
check "present in 2nd of 3 dirs → present" "$r" "present"
rm -rf "$T"; unset NOMAD_TEST_RUNNER_DIRS

echo
echo "RESULTS: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]
