#!/bin/sh
# Safari: turn the extension into a macOS app project with Apple's converter, then build it to prove it compiles.
#   sh tools/safari.sh          -> dist/safari-project/Apply Job Assistant/  (+ an unsigned Debug build)
# Needs Xcode (xcrun safari-web-extension-converter). To run it in Safari: open the project in Xcode, pick your
# team under Signing & Capabilities, Run, then Safari → Settings → Extensions → enable "Apply Job Assistant"
# (for an unsigned local build: Safari → Develop → Allow Unsigned Extensions). App Store release needs an
# Apple Developer Program membership.
set -e
cd "$(dirname "$0")/.."
command -v xcrun >/dev/null || { echo "Xcode is required"; exit 2; }
EXT="$(python3 tools/package.py --unpack safari)"
OUT="dist/safari-project"
xcrun safari-web-extension-converter "$EXT" --project-location "$OUT" --app-name "Apply Job Assistant" \
  --bundle-identifier io.github.samberchmans-games.Apply-Job-Assistant --swift --macos-only --copy-resources --no-open --no-prompt --force
PROJ="$(find "$OUT" -name '*.xcodeproj' -maxdepth 3 | head -1)"
echo "Project: $PROJ"
if [ "${BUILD:-1}" = 1 ]; then
  xcodebuild -project "$PROJ" -scheme "Apply Job Assistant" -configuration Debug -derivedDataPath "$OUT/build" \
    CODE_SIGNING_ALLOWED=NO CODE_SIGN_IDENTITY="" build -quiet && echo "Safari build: OK (unsigned Debug)"
fi
