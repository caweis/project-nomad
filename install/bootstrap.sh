#!/usr/bin/env bash
# Project NOMAD — first-run bootstrap for macOS (Apple Silicon).
# Usage (one-liner):
#   curl -fsSL https://raw.githubusercontent.com/caweis/project-nomad/main/install/bootstrap.sh | bash
#
# Fetches the install bundle to ~/Applications/project-nomad (override with
# NOMAD_HOME) and hands off to `nomad install` — which asks where to store your
# CONTENT (usually an external drive). The bundle (code) and the data root
# (content) are deliberately separate.
#
# NOTE: stock tools only (curl/tar/uname) — git is NOT assumed; `nomad install`
# installs Homebrew/Xcode-CLT/Rosetta/OrbStack/Ollama itself.

NOMAD_BRANCH="${NOMAD_BRANCH:-main}"

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

# Download the branch tarball, extract just into $1, then hand off to the real
# installer. Stock curl/tar only. Leaves nothing half-placed on failure.
_bootstrap_fetch_and_install() {
  local dest="$1"
  command -v curl >/dev/null 2>&1 || { echo "curl not found — cannot bootstrap" >&2; exit 1; }

  echo "Fetching Project NOMAD ($NOMAD_BRANCH) → $dest"
  local tgz tmpd
  tgz="$(mktemp)"; tmpd="$(mktemp -d)"
  local url="https://codeload.github.com/caweis/project-nomad/tar.gz/refs/heads/$NOMAD_BRANCH"
  if ! curl -fsSL --max-time 180 "$url" -o "$tgz"; then
    rm -rf "$tgz" "$tmpd"; echo "Download failed: $url" >&2; exit 1
  fi
  # --strip-components=1 drops the codeload top dir; extract straight into tmpd.
  if ! tar -xzf "$tgz" --strip-components=1 -C "$tmpd" 2>/dev/null; then
    rm -rf "$tgz" "$tmpd"; echo "Extract failed" >&2; exit 1
  fi
  # Validate before placing.
  if [[ ! -f "$tmpd/install/macos/nomad" ]] || ! head -1 "$tmpd/install/macos/nomad" | grep -q '^#!.*bash'; then
    rm -rf "$tgz" "$tmpd"; echo "Fetched bundle is missing install/macos/nomad — aborting" >&2; exit 1
  fi
  mkdir -p "$(dirname "$dest")"
  rm -rf "$dest"
  mv "$tmpd" "$dest"
  rm -f "$tgz"
  chmod +x "$dest/install/macos/nomad"

  echo
  echo "Next, the installer will ask where to store your CONTENT (Wikipedia, AI"
  echo "models, maps) — usually an external drive. The app code lives in $dest."
  echo
  exec bash "$dest/install/macos/nomad" install
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
