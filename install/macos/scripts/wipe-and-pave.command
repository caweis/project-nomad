#!/usr/bin/env bash
# wipe-and-pave.command — blow away an existing NOMAD install on this Mac so a
# fresh `nomad install` pulls everything (especially the new caweis admin image)
# from scratch with no cached state masking the result.
#
# Designed to be double-clicked from the Desktop (note the .command extension).
# Drops a timestamped log next to itself so you can read what happened later.
#
# What it removes:
#   1. NOMAD compose stack (containers + named volumes) — via `nomad uninstall`
#   2. Ollama LaunchAgent + plist
#   3. Secrets (.env at ~/.config/project-nomad/.env)
#   4. ALL DATA on the configured external drive (mysql, redis, ollama-models,
#      storage including ZIMs) — yes, the full Wikipedia downloads. Re-pullable.
#   5. Background LaunchAgents (kiwix-self-heal, benchmark-patcher)
#   6. Cached compose images for the admin (proximasan, caweis, crosstalk) so
#      the next install pulls fresh and the new image is actually verified end-to-end
#   7. /tmp/nomad-*.log + the local self-heal action log
#
# What it preserves:
#   • Homebrew + OrbStack + Ollama binaries (user tools)
#   • The bundle directory (install/macos/) — the `nomad` CLI itself
#   • Anything outside ~/.config/project-nomad/ and the configured data root
#
# This is for the "I'm testing a new admin image and want zero state to mask
# the result" case. For incremental cleanup without re-pulling images, use
# `nomad clean --apply` instead.

set -euo pipefail

HERE="$( cd "$(dirname "$0")" && pwd -P )"
LOG="$HERE/wipe-and-pave-$(date +%Y%m%d-%H%M%S).log"

# Tee everything to the log
exec > >(tee -a "$LOG") 2>&1

cat <<EOF
═══════════════════════════════════════════════════════════
  Project NOMAD — full wipe & pave
  $(date)
  log: $LOG
═══════════════════════════════════════════════════════════
EOF

# ─── Locate the nomad CLI ─────────────────────────────────────────────────────
NOMAD_BIN=""
if command -v nomad >/dev/null 2>&1; then
  NOMAD_BIN="$(command -v nomad)"
elif [[ -x "$HERE/../nomad" ]]; then
  NOMAD_BIN="$HERE/../nomad"
elif [[ -x "$HOME/Developer/nomad-bundle-v2/nomad" ]]; then
  NOMAD_BIN="$HOME/Developer/nomad-bundle-v2/nomad"
fi

if [[ -z "$NOMAD_BIN" ]]; then
  echo "❌ Couldn't find the nomad CLI. Looked in PATH, ../nomad, and ~/Developer/nomad-bundle-v2/nomad."
  echo "   Install the bundle first, or run this script from the bundle's scripts/ dir."
  exit 1
fi
echo "→ nomad CLI: $NOMAD_BIN"
echo

# ─── Confirmation ─────────────────────────────────────────────────────────────
echo "This will DESTROY:"
echo "  • All NOMAD containers + named volumes"
echo "  • The Ollama native LaunchAgent + plist"
echo "  • Secrets (~/.config/project-nomad/.env)"
echo "  • EVERYTHING on the configured external drive (mysql, redis, ollama-models, ALL ZIMs)"
echo "  • Background LaunchAgents (kiwix self-heal, benchmark patcher)"
echo "  • Cached admin Docker images (proximasan, caweis, crosstalk) so next install pulls fresh"
echo
echo "PRESERVED: Homebrew, OrbStack, Ollama binary, the bundle directory, anything outside the data root."
echo
read -r -p "Type 'wipe' to proceed: " ans
if [[ "$ans" != "wipe" ]]; then
  echo "Aborted — nothing touched."
  exit 0
fi
echo

# ─── 1. nomad uninstall ───────────────────────────────────────────────────────
echo "── 1/3  nomad uninstall (auto-yes) ──"
"$NOMAD_BIN" uninstall --yes || {
  echo "⚠  nomad uninstall returned non-zero. Continuing to image cleanup anyway."
}
echo

# ─── 2. Drop cached admin images so next install verifies the new fork ───────
echo "── 2/3  Remove cached admin images ──"
if command -v docker >/dev/null 2>&1 && docker version >/dev/null 2>&1; then
  for img in \
    "ghcr.io/caweis/project-nomad-macos-arm64:edge" \
    "ghcr.io/caweis/project-nomad-macos-arm64:latest" \
    "ghcr.io/proximasan/project-nomad:latest" \
    "ghcr.io/crosstalk-solutions/project-nomad:latest" \
    "ghcr.io/caweis/project-nomad:latest" \
    "ghcr.io/proximasan/project-nomad-sidecar-updater:latest" \
    "ghcr.io/crosstalk-solutions/project-nomad-sidecar-updater:latest"; do
    if docker image inspect "$img" >/dev/null 2>&1; then
      echo "  rm $img"
      docker image rm "$img" >/dev/null 2>&1 || echo "    (still in use; will be reclaimed on next prune)"
    fi
  done
  # Sweep dangling layers
  docker image prune -f >/dev/null 2>&1 || true
else
  echo "  Docker not reachable — skipping image cleanup."
fi
echo

# ─── 3. /tmp + Library/Logs residue ───────────────────────────────────────────
echo "── 3/3  Clear residual logs ──"
rm -f /tmp/nomad-*.log 2>/dev/null || true
rm -f "$HOME/Library/Logs/nomad-kiwix-self-heal.action.log" 2>/dev/null || true
rm -f "$HOME/Library/Logs/nomad-benchmark-patcher.log" 2>/dev/null || true
echo "  cleared /tmp/nomad-*.log and ~/Library/Logs/nomad-*.log"
echo

# ─── Done ─────────────────────────────────────────────────────────────────────
cat <<EOF
═══════════════════════════════════════════════════════════
  Wipe complete.
  Run \`bash $NOMAD_BIN install\` to reinstall from scratch.
═══════════════════════════════════════════════════════════

Log preserved at: $LOG
EOF
