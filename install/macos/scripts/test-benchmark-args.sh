#!/usr/bin/env bash
# Check that benchmark model names are passed to the container as one argument.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NOMAD="$SCRIPT_DIR/../nomad"
TEST_DIR="$(mktemp -d -t nomad-benchmark-test.XXXXXX)"
trap 'rm -rf "$TEST_DIR"' EXIT
export SECRETS_DIR="$TEST_DIR/secrets"

NOMAD_SOURCE_FOR_TEST=1 source "$NOMAD"

ensure_docker_path() { :; }
ensure_ollama_path() { :; }
ollama() {
  case "$1" in
    list) printf 'NAME\n' ;;
    run) printf 'eval rate 12.5 tokens/s\ntotal duration 1s\n' ;;
    pull) : ;;
  esac
}
docker() {
  if [[ "${1:-}" == exec && "${2:-}" == -i ]]; then
    printf '%s\0' "$@" > "$TEST_DIR/docker-args"
    cat >/dev/null
    printf 'eval rate 10.0 tokens/s\ntotal duration 2s\n'
  fi
}

model='example:latest;false'
if ! cmd_benchmark run "$model" > "$TEST_DIR/output" 2>&1; then
  cat "$TEST_DIR/output" >&2
  exit 1
fi

python3 - "$TEST_DIR/docker-args" "$model" <<'PY'
import sys

actual = open(sys.argv[1], 'rb').read().rstrip(b'\0').decode().split('\0')
expected = ['exec', '-i', 'nomad_bench_ollama', 'ollama', 'run', '--verbose', sys.argv[2]]
if actual != expected:
    raise SystemExit(f'container benchmark arguments differ: {actual!r}')
print('1 passed: model is one argument and no container shell is used')
PY
