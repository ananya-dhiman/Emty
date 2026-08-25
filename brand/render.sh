#!/usr/bin/env bash
# Regenerates every brand image from frontend/src/assets/cyan_on_black.png.
#
#   bash brand/render.sh
#
# Needs Chrome and node. build.js writes one HTML page per image, each sized to
# its exact output; Chrome rasterizes them and the intermediates are removed.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
CHROME="/c/Program Files/Google/Chrome/Application/chrome.exe"

node "$HERE/build.js"

shot () { # name  width  height
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars \
    --force-device-scale-factor=1 --window-size="$2,$3" \
    --virtual-time-budget=4000 \
    --screenshot="$(cygpath -w "$HERE/$1.png")" \
    "file:///$(cygpath -m "$HERE/$1.html")" >/dev/null 2>&1
  if [ -f "$HERE/$1.png" ]; then
    echo "  $1.png  $(stat -c%s "$HERE/$1.png") bytes"
  else
    echo "  $1.png  FAILED"
  fi
}

shot social-a-dark      1280 640
shot social-b-centered  1280 640
shot social-c-cyan      1280 640
shot avatar-dark        1024 1024
shot avatar-cyan        1024 1024
shot favicon             256  256

rm -f "$HERE"/*.html

# The landing page ships the chosen card as its OpenGraph image, plus a favicon
# that is actually the Emty mark.
cp "$HERE/social-a-dark.png" "$HERE/../landing-page/public/og-image.png"
cp "$HERE/favicon.png"       "$HERE/../landing-page/public/favicon.png"
echo "  -> landing-page/public/og-image.png, favicon.png"
