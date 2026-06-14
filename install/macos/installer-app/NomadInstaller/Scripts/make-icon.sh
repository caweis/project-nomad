#!/usr/bin/env bash
set -euo pipefail
# Generate AppIcon.icns from the NOMAD square mark (the hexagonal "N").
# Source defaults to the admin favicon; pass a 1024px PNG as $1 for a crisper icon.
HERE="$(cd "$(dirname "$0")/.." && pwd)"          # .../installer-app/NomadInstaller
REPO="$(cd "$HERE/../../../.." && pwd)"           # repo root
SRC="${1:-$REPO/admin/public/favicon-512x512.png}"

[ -f "$SRC" ] || { echo "error: icon source not found: $SRC" >&2; exit 1; }

ICONSET="$(mktemp -d)/AppIcon.iconset"
mkdir -p "$ICONSET"
gen() { sips -z "$2" "$2" "$SRC" --out "$ICONSET/icon_$1.png" >/dev/null; }
gen 16x16 16
gen 16x16@2x 32
gen 32x32 32
gen 32x32@2x 64
gen 128x128 128
gen 128x128@2x 256
gen 256x256 256
gen 256x256@2x 512
gen 512x512 512
gen 512x512@2x 1024

iconutil -c icns "$ICONSET" -o "$HERE/AppIcon.icns"
echo "wrote $HERE/AppIcon.icns (from $SRC)"
