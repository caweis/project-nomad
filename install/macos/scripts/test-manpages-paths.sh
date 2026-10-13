#!/usr/bin/env bash
# Run the manpage drift guard from a workspace whose path contains spaces.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
TEST_ROOT="$(mktemp -d -t 'Project Nomad.XXXXXX')"
trap 'rm -rf "$TEST_ROOT"' EXIT

mkdir -p "$TEST_ROOT/install/macos/scripts"
cp "$ROOT/install/macos/nomad" "$TEST_ROOT/install/macos/nomad"
cp "$ROOT/install/macos/scripts/test-manpages.sh" "$TEST_ROOT/install/macos/scripts/"
cp -R "$ROOT/install/macos/man" "$TEST_ROOT/install/macos/man"

bash "$TEST_ROOT/install/macos/scripts/test-manpages.sh"
echo 'manpage path-with-spaces regression passed'
