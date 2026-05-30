#!/usr/bin/env bash
# Project NOMAD — first-run bootstrap for macOS (Apple Silicon).
# Usage (one-liner):
#   curl -fsSL https://raw.githubusercontent.com/caweis/project-nomad/feat/macos-distribution-layer/install/bootstrap.sh | bash
#
# Fetches the install bundle to ~/Applications/project-nomad (override with
# NOMAD_HOME) and hands off to `nomad install` — which asks where to store your
# CONTENT (usually an external drive). The bundle (code) and the data root
# (content) are deliberately separate.
#
# NOTE: stock tools only (curl/tar/uname) — git is NOT assumed; `nomad install`
# installs Homebrew/Xcode-CLT/Rosetta/OrbStack/Ollama itself.

NOMAD_BRANCH="${NOMAD_BRANCH:-feat/macos-distribution-layer}"

# macOS + Apple Silicon? (test-injectable via NOMAD_TEST_OS / NOMAD_TEST_ARCH)
_bootstrap_platform_ok() {
  local os="${NOMAD_TEST_OS:-$(uname -s)}" arch="${NOMAD_TEST_ARCH:-$(uname -m)}"
  [[ "$os" == "Darwin" && "$arch" == "arm64" ]]
}

# Canonical bundle location.
_bootstrap_location() {
  echo "${NOMAD_HOME:-$HOME/Applications/project-nomad}"
}

# Is a bundle already present at $1?
_bootstrap_already_installed() {
  [[ -f "$1/install/macos/nomad" ]]
}

_bootstrap_main() {
  set -euo pipefail

  if ! _bootstrap_platform_ok; then
    echo "Project NOMAD's macOS installer requires an Apple Silicon Mac (macOS, arm64)." >&2
    echo "Detected: $(uname -s) $(uname -m). Aborting." >&2
    exit 1
  fi

  local dest; dest="$(_bootstrap_location)"

  if _bootstrap_already_installed "$dest"; then
    echo "NOMAD is already installed at $dest."
    echo "  • To update:   nomad update"
    echo "  • To reinstall: remove $dest and re-run this command."
    exit 0
  fi

  if [[ -n "${NOMAD_BOOTSTRAP_DRY_RUN:-}" ]]; then
    echo "DRY RUN — would:"
    echo "  1. fetch branch '$NOMAD_BRANCH' to $dest"
    echo "  2. exec: bash $dest/install/macos/nomad install"
    exit 0
  fi

  _bootstrap_fetch_and_install "$dest"
}

# Run main unless sourced by the test harness.
if [[ -z "${NOMAD_BOOTSTRAP_SOURCE_FOR_TEST:-}" ]]; then
  _bootstrap_main "$@"
fi
