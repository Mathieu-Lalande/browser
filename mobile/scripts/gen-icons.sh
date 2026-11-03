#!/usr/bin/env bash
# Regenerates the app's icons and splash from the desktop logo (build/icon.png) with ImageMagick:
#   bash mobile/scripts/gen-icons.sh
# iOS icon: opaque 1024×1024 (no alpha, App Store requirement). Android adaptive icon: transparent
# foreground with the logo inside the 66 % safe zone, solid background, white monochrome silhouette
# (themed icons). Play Store: 512×512 icon and 1024×500 feature graphic.
set -euo pipefail
cd "$(dirname "$0")/../.."
LOGO=build/icon.png
BG="#141218"
OUT=mobile/assets
STORE=mobile/store/graphics
mkdir -p "$OUT" "$STORE"

logo() { convert "$LOGO" -filter Lanczos -resize "$1x$1" "$2"; }

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

logo 720 "$TMP/logo720.png"
convert -size 1024x1024 "xc:$BG" "$TMP/logo720.png" -gravity center -composite -alpha off "$OUT/icon.png"

logo 600 "$TMP/logo600.png"
convert -size 1024x1024 xc:none "$TMP/logo600.png" -gravity center -composite "$OUT/android-icon-foreground.png"
convert -size 1024x1024 xc:none "$TMP/logo600.png" -gravity center -composite -channel RGB -evaluate set 100% +channel "$OUT/android-icon-monochrome.png"
convert -size 1024x1024 "xc:$BG" "$OUT/android-icon-background.png"

logo 1024 "$OUT/splash-icon.png"
logo 48 "$OUT/favicon.png"

convert "$OUT/icon.png" -resize 512x512 "$STORE/play-icon-512.png"
logo 360 "$TMP/logo360.png"
convert -size 1024x500 "xc:$BG" "$TMP/logo360.png" -gravity west -geometry +90+0 -composite \
  -fill white -font DejaVu-Sans-Bold -pointsize 96 -gravity west -annotate +500-30 "Browser" \
  -fill "#b9b4c7" -font DejaVu-Sans -pointsize 38 -annotate +504+60 "Rapide, privé, à vous." \
  -alpha off "$STORE/play-feature-graphic.png"

for file in "$OUT"/*.png "$STORE"/*.png; do
  pngquant --quality 85-98 --strip --force --skip-if-larger --ext .png "$file" 2>/dev/null || true
done
