#!/usr/bin/env bash
set -euo pipefail
# Build a distributable DMG containing NomadInstaller.app + an Applications
# symlink, then sign, notarize, and staple the DMG itself.
#
# Run order: make-app.sh  →  sign-and-notarize.sh  →  make-dmg.sh
# (the app inside the DMG must already be signed + notarized + stapled).
#
# Usage: make-dmg.sh [path/to/NomadInstaller.app] [version]
# Env overrides: SIGN_IDENTITY, NOTARY_PROFILE

HERE="$(cd "$(dirname "$0")/.." && pwd)"
APP="${1:-$HERE/NomadInstaller.app}"
VERSION="${2:-0.0.0-dev}"
IDENTITY="${SIGN_IDENTITY:-Developer ID Application}"
NOTARY_PROFILE="${NOTARY_PROFILE:-nomad-notary}"
VOLNAME="NOMAD Installer"
DMG="$HERE/NomadInstaller-$VERSION.dmg"

[ -d "$APP" ] || { echo "error: no app at $APP — run make-app.sh first" >&2; exit 1; }

STAGE="$(mktemp -d)"
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"

echo "==> building DMG"
rm -f "$DMG"
hdiutil create -volname "$VOLNAME" -srcfolder "$STAGE" -ov -format UDZO "$DMG" >/dev/null
rm -rf "$STAGE"

echo "==> signing DMG: $IDENTITY"
codesign --force --timestamp --sign "$IDENTITY" "$DMG"

echo "==> notarizing DMG (waits for the result)"
xcrun notarytool submit "$DMG" --keychain-profile "$NOTARY_PROFILE" --wait

echo "==> stapling the DMG"
xcrun stapler staple "$DMG"

echo "built: $DMG"
echo "(A desert-themed background can be added later with create-dmg; this is a"
echo " clean functional DMG with no extra dependencies.)"
