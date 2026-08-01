#!/bin/sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
IOS_ROOT="$(dirname "$SCRIPT_DIR")"
REPOSITORY_ROOT="$(dirname "$(dirname "$IOS_ROOT")")"
SOURCE_ICON="$REPOSITORY_ROOT/resources/icon.png"
APP_ICON_DIR="$IOS_ROOT/CradleMobile/Resources/Assets.xcassets/AppIcon.appiconset"

command -v ffmpeg >/dev/null 2>&1 || {
  echo "ffmpeg is required to generate the AppIcon asset." >&2
  exit 1
}

mkdir -p "$APP_ICON_DIR"
while read -r filename pixels; do
  ffmpeg \
    -hide_banner \
    -loglevel error \
    -y \
    -i "$SOURCE_ICON" \
    -vf "scale=${pixels}:${pixels}:flags=lanczos,format=rgb24" \
    -frames:v 1 \
    -update 1 \
    "$APP_ICON_DIR/$filename"
done <<'SIZES'
icon-20.png 20
icon-20@2x.png 40
icon-20@3x.png 60
icon-29.png 29
icon-29@2x.png 58
icon-29@3x.png 87
icon-40.png 40
icon-40@2x.png 80
icon-40@3x.png 120
icon-60@2x.png 120
icon-60@3x.png 180
icon-76.png 76
icon-76@2x.png 152
icon-83.5@2x.png 167
icon-1024.png 1024
SIZES

echo "Generated AppIcon images from $SOURCE_ICON"
