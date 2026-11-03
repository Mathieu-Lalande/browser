#!/usr/bin/env bash
# Store-size screenshots of the mobile app (mobile/store/README.md), from the repository's
# Playwright pipeline (tests/e2e/mobile-screenshots.spec.ts):
#   cd mobile && npm run store:screenshots                     # dark theme, every device
#   SCREENSHOT_THEME=light STORE_DEVICES="iphone-6.9" npm run store:screenshots
# Needs the root dependencies (npm ci at the root) and, on Linux without a display, xvfb-run.
set -euo pipefail
cd "$(dirname "$0")/../.."
DEVICES=${STORE_DEVICES:-"iphone-6.9 iphone-6.5 ipad-13 android-phone"}

WEB=$(mktemp -d)
trap 'rm -rf "$WEB"' EXIT
(cd mobile && npx expo export --platform web --output-dir "$WEB" >/dev/null)

run() {
  if [ -z "${DISPLAY:-}" ] && command -v xvfb-run >/dev/null; then
    xvfb-run -a -s "-screen 0 3000x3000x24" "$@"
  else
    "$@"
  fi
}

for device in $DEVICES; do
  echo "== $device"
  SCREENSHOTS=1 STORE_DEVICE="$device" MOBILE_WEB_DIR="$WEB" run npx playwright test mobile-screenshots
done
du -sh mobile/store/screenshots
