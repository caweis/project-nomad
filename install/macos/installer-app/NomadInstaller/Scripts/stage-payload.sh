#!/usr/bin/env bash
set -euo pipefail
# Copy the install/macos tree (excluding installer-app) into the bundled payload
# so the app ships a self-contained installer. Run before `swift build`.
HERE="$(cd "$(dirname "$0")/.." && pwd)"           # .../installer-app/NomadInstaller
SRC="$(cd "$HERE/../.." && pwd)"                    # .../install/macos
DEST="$HERE/Sources/NomadInstaller/Resources/payload"

rm -rf "$DEST"
mkdir -p "$DEST"
rsync -a \
  --exclude 'installer-app/' \
  --exclude '.git/' \
  "$SRC"/ "$DEST"/
touch "$DEST/.keep"
echo "staged payload: $(du -sh "$DEST" | cut -f1)"
