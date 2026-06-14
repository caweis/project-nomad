#!/usr/bin/env bash
set -euo pipefail
# Assemble an (ad-hoc signed) NomadInstaller.app for local development.
# Real Developer ID signing + notarization happens in CI (P2).
HERE="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="${1:-0.0.0-dev}"

bash "$HERE/Scripts/stage-payload.sh"
swift build -c release --package-path "$HERE"

BIN_DIR="$HERE/.build/release"
APP="$HERE/NomadInstaller.app"

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
sed "s/__VERSION__/$VERSION/g" "$HERE/Info.plist" > "$APP/Contents/Info.plist"
cp "$BIN_DIR/NomadInstaller" "$APP/Contents/MacOS/NomadInstaller"

# The SwiftPM resource bundle (carries the install payload) lives next to the binary.
# Bundle.module resolves it from the app's Contents/Resources at run time.
for bundle in "$BIN_DIR"/*_NomadInstaller.bundle; do
    [ -d "$bundle" ] && cp -R "$bundle" "$APP/Contents/Resources/"
done

# App icon (Info.plist CFBundleIconFile=AppIcon). Regenerate it if missing.
[ -f "$HERE/AppIcon.icns" ] || bash "$HERE/Scripts/make-icon.sh" || true
[ -f "$HERE/AppIcon.icns" ] && cp "$HERE/AppIcon.icns" "$APP/Contents/Resources/AppIcon.icns"

# Ad-hoc signature so the dev build launches without a Developer ID cert.
codesign --force --deep --sign - "$APP" >/dev/null 2>&1 || true

echo "built: $APP (version $VERSION)"
