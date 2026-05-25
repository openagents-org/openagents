#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT="$ROOT/OpenAgentsGo.xcodeproj"
SCHEME="${SCHEME:-OpenAgentsGo_macOS}"
CONFIGURATION="${CONFIGURATION:-Release}"
DERIVED_DATA="${DERIVED_DATA:-$ROOT/build/dd-release}"
DIST_DIR="${DIST_DIR:-$ROOT/dist}"
STAGING_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$STAGING_DIR"
}
trap cleanup EXIT

TEAM_ID="${TEAM_ID:-}"
SIGN_IDENTITY="${SIGN_IDENTITY:-}"
NOTARY_PROFILE="${NOTARY_PROFILE:-}"
APPLE_ID="${APPLE_ID:-}"
APPLE_TEAM_ID="${APPLE_TEAM_ID:-$TEAM_ID}"
APPLE_APP_PASSWORD="${APPLE_APP_PASSWORD:-}"

if [[ -z "$TEAM_ID" ]]; then
  echo "TEAM_ID is required for Developer ID signing." >&2
  exit 2
fi

if [[ -z "$SIGN_IDENTITY" ]]; then
  SIGN_IDENTITY="$(security find-identity -v -p codesigning | awk -F '"' '/Developer ID Application/ { print $2; exit }')"
fi

if [[ -z "$SIGN_IDENTITY" ]]; then
  echo "No Developer ID Application signing identity found." >&2
  echo "Install a Developer ID Application certificate or set SIGN_IDENTITY explicitly." >&2
  exit 2
fi

if ! security find-identity -v -p codesigning | grep -Fq "$SIGN_IDENTITY"; then
  echo "Signing identity not found in keychain: $SIGN_IDENTITY" >&2
  exit 2
fi

if [[ -z "$NOTARY_PROFILE" && ( -z "$APPLE_ID" || -z "$APPLE_TEAM_ID" || -z "$APPLE_APP_PASSWORD" ) ]]; then
  echo "Notarization credentials are required." >&2
  echo "Set NOTARY_PROFILE for a notarytool keychain profile, or set APPLE_ID, TEAM_ID, and APPLE_APP_PASSWORD." >&2
  exit 2
fi

APP_VERSION="$(xcodebuild -project "$PROJECT" -scheme "$SCHEME" -configuration "$CONFIGURATION" -showBuildSettings 2>/dev/null \
  | awk -F '= ' '/MARKETING_VERSION/ { print $2; exit }')"
APP_VERSION="${APP_VERSION:-0.0.0}"
DMG_NAME="OpenAgents Go-${APP_VERSION}-arm64.dmg"
DMG_PATH="$DIST_DIR/$DMG_NAME"
APP_PATH="$DERIVED_DATA/Build/Products/$CONFIGURATION/OpenAgents Go.app"

mkdir -p "$DIST_DIR"

xcodebuild \
  -project "$PROJECT" \
  -scheme "$SCHEME" \
  -configuration "$CONFIGURATION" \
  -derivedDataPath "$DERIVED_DATA" \
  -destination "generic/platform=macOS" \
  CODE_SIGN_STYLE=Manual \
  CODE_SIGN_IDENTITY="$SIGN_IDENTITY" \
  CODE_SIGN_ENTITLEMENTS="OpenAgents/OpenAgents-macOS.entitlements" \
  CODE_SIGN_INJECT_BASE_ENTITLEMENTS=NO \
  DEVELOPMENT_TEAM="$TEAM_ID" \
  OTHER_CODE_SIGN_FLAGS="--timestamp" \
  build

codesign --verify --deep --strict --verbose=2 "$APP_PATH"

cp -R "$APP_PATH" "$STAGING_DIR/"
ln -s /Applications "$STAGING_DIR/Applications"

hdiutil create \
  -fs HFS+ \
  -srcfolder "$STAGING_DIR" \
  -volname "OpenAgents Go ${APP_VERSION}" \
  -format UDZO \
  -ov "$DMG_PATH"

codesign --force --timestamp --sign "$SIGN_IDENTITY" "$DMG_PATH"

if [[ -n "$NOTARY_PROFILE" ]]; then
  xcrun notarytool submit "$DMG_PATH" --keychain-profile "$NOTARY_PROFILE" --wait
else
  xcrun notarytool submit "$DMG_PATH" \
    --apple-id "$APPLE_ID" \
    --team-id "$APPLE_TEAM_ID" \
    --password "$APPLE_APP_PASSWORD" \
    --wait
fi

xcrun stapler staple "$DMG_PATH"
spctl --assess --type open --context context:primary-signature --verbose=4 "$DMG_PATH"

echo "$DMG_PATH"
