#!/bin/sh
# Electron with its OS sandbox (ADR-053 e2e): the extension service-worker preload only runs in
# sandboxed renderers. Playwright adds `--no-sandbox` on Linux: dropped here. Chromium refuses the
# sandbox to root: run as root (containers), the profile and the X display go to the unprivileged
# "nobody" user, which runs Electron. Test-only; `SANDBOXED_ELECTRON` is the real binary (fixtures.ts).
set -e
for arg do
  shift
  [ "$arg" = "--no-sandbox" ] || set -- "$@" "$arg"
done
if [ "$(id -u)" = "0" ]; then
  chown -R 65534:65534 "$BROWSER_PROFILE_DIR"
  if [ -n "$XAUTHORITY" ]; then
    chmod o+x "$(dirname "$XAUTHORITY")"
    chmod o+r "$XAUTHORITY"
  fi
  export HOME="$BROWSER_PROFILE_DIR"
  exec setpriv --reuid=65534 --regid=65534 --clear-groups -- "$SANDBOXED_ELECTRON" "$@"
fi
exec "$SANDBOXED_ELECTRON" "$@"
