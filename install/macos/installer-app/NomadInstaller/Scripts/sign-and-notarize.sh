#!/usr/bin/env bash
set -euo pipefail
# Sign, notarize, and staple NomadInstaller.app for distribution.
#
# Prerequisites (one-time):
#   1. A "Developer ID Application: …" cert in your keychain
#      (Xcode → Settings → Accounts → Manage Certificates → + → Developer ID Application).
#   2. A stored notarytool credential profile:
#        xcrun notarytool store-credentials "nomad-notary" \
#          --key AuthKey_XXXX.p8 --key-id <KEY_ID> --issuer <ISSUER_ID>
#
# Usage: sign-and-notarize.sh [path/to/NomadInstaller.app]
# Env overrides: SIGN_IDENTITY, NOTARY_PROFILE

HERE="$(cd "$(dirname "$0")/.." && pwd)"
APP="${1:-$HERE/NomadInstaller.app}"
IDENTITY="${SIGN_IDENTITY:-Developer ID Application}"
NOTARY_PROFILE="${NOTARY_PROFILE:-nomad-notary}"

[ -d "$APP" ] || { echo "error: no app at $APP — run make-app.sh first" >&2; exit 1; }

if ! security find-identity -v -p codesigning | grep -q "Developer ID Application"; then
    echo "error: no 'Developer ID Application' certificate in your keychain." >&2
    echo "  Create one: Xcode → Settings → Accounts → Manage Certificates → + → Developer ID Application." >&2
    exit 1
fi

# Sign inside-out: the nested resource bundle (data only) first, then the app
# with the hardened runtime that notarization requires.
BUNDLE="$(/usr/bin/find "$APP/Contents/Resources" -maxdepth 1 -name '*_NomadInstaller.bundle' -type d | head -1)"
if [ -n "$BUNDLE" ]; then
    echo "==> signing nested resource bundle"
    codesign --force --timestamp --sign "$IDENTITY" "$BUNDLE"
fi

echo "==> signing app (hardened runtime): $IDENTITY"
codesign --force --options runtime --timestamp --sign "$IDENTITY" "$APP"
codesign --verify --strict --verbose=2 "$APP"

ZIP="${APP%.app}.zip"
echo "==> zipping for notarization"
rm -f "$ZIP"
/usr/bin/ditto -c -k --keepParent "$APP" "$ZIP"

echo "==> submitting to the notary service (this waits for the result)"
xcrun notarytool submit "$ZIP" --keychain-profile "$NOTARY_PROFILE" --wait
rm -f "$ZIP"

echo "==> stapling the ticket"
xcrun stapler staple "$APP"

echo "==> Gatekeeper verdict"
spctl -a -vvv --type exec "$APP"
echo "done: $APP is signed, notarized, and stapled."
