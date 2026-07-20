#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"
COMMAND_SOURCE="$SCRIPT_DIR/Install Cradle.command"
APP_INPUT="${CRADLE_APP_PATH:-}"
ICON_INPUT="${CRADLE_INSTALLER_ICON:-.github/Cradle.png}"
ICON_ENABLED=1
OUTPUT_PATH="$SCRIPT_DIR/dist/Cradle-Installer.dmg"
VOLUME_NAME="Install Cradle"
KEEP_STAGE=0
STAGE_DIR=""
MOUNT_DIR=""

usage() {
  cat <<'EOF'
Usage: installer/build-dmg.sh --app <path> [options]

Options:
  --app <path>          Cradle.app, a release .dmg, or a release .zip to bundle.
                        Defaults to CRADLE_APP_PATH when set.
  --icon <path>         PNG or ICNS used as the Finder icon for Install Cradle.command.
                        Defaults to .github/Cradle.png.
  --no-icon             Do not set a custom Finder icon on Install Cradle.command.
  --output <path>       Output DMG path. Defaults to installer/dist/Cradle-Installer.dmg.
  --volume-name <name>  Finder volume name. Defaults to "Install Cradle".
  --keep-stage          Keep the temporary staging directory for inspection.
  -h, --help            Show this help.

Examples:
  installer/build-dmg.sh --app apps/desktop/release/mac-arm64/Cradle.app
  installer/build-dmg.sh --app apps/desktop/release/Cradle-0.0.1-arm64.dmg
EOF
}

fail() {
  printf 'build-dmg: %s\n' "$*" >&2
  exit 1
}

cleanup() {
  if [[ -n "$MOUNT_DIR" && -d "$MOUNT_DIR" ]]; then
    /usr/bin/hdiutil detach "$MOUNT_DIR" -quiet >/dev/null 2>&1 || true
  fi

  if [[ "$KEEP_STAGE" != "1" && -n "$STAGE_DIR" && -d "$STAGE_DIR" ]]; then
    /bin/rm -rf "$STAGE_DIR"
  elif [[ "$KEEP_STAGE" == "1" && -n "$STAGE_DIR" ]]; then
    printf 'Kept staging directory: %s\n' "$STAGE_DIR"
  fi
}

trap cleanup EXIT

find_app_in_dir() {
  local root="$1"
  local match

  match="$(/usr/bin/find "$root" -maxdepth 5 -name 'Cradle.app' -type d -prune -print 2>/dev/null | /usr/bin/head -n 1)"
  if [[ -n "$match" ]]; then
    printf '%s\n' "$match"
    return 0
  fi

  match="$(/usr/bin/find "$root" -maxdepth 5 -name '*.app' -type d -prune -print 2>/dev/null | /usr/bin/head -n 1)"
  if [[ -n "$match" ]]; then
    printf '%s\n' "$match"
    return 0
  fi

  return 1
}

parse_args() {
  while [[ "$#" -gt 0 ]]; do
    case "$1" in
      --app)
        [[ "$#" -ge 2 ]] || fail "--app requires a value"
        APP_INPUT="$2"
        shift 2
        ;;
      --icon)
        [[ "$#" -ge 2 ]] || fail "--icon requires a value"
        ICON_INPUT="$2"
        ICON_ENABLED=1
        shift 2
        ;;
      --no-icon)
        ICON_ENABLED=0
        shift
        ;;
      --output)
        [[ "$#" -ge 2 ]] || fail "--output requires a value"
        OUTPUT_PATH="$2"
        shift 2
        ;;
      --volume-name)
        [[ "$#" -ge 2 ]] || fail "--volume-name requires a value"
        VOLUME_NAME="$2"
        shift 2
        ;;
      --keep-stage)
        KEEP_STAGE=1
        shift
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        fail "unknown option: $1"
        ;;
    esac
  done
}

resolve_path() {
  local input="$1"
  if [[ "$input" = /* ]]; then
    printf '%s\n' "$input"
  else
    printf '%s\n' "$REPO_ROOT/$input"
  fi
}

apply_command_icon() {
  local command_path="$1"
  local icon_path="$2"

  [[ -f "$icon_path" ]] || fail "installer icon not found: $icon_path"

  /usr/bin/osascript -l JavaScript - "$icon_path" "$command_path" <<'JXA'
ObjC.import('AppKit')

function run(argv) {
  const iconPath = argv[0]
  const commandPath = argv[1]
  const icon = $.NSImage.alloc.initWithContentsOfFile(iconPath)
  if (!icon) {
    throw new Error(`Cannot read installer icon: ${iconPath}`)
  }

  const ok = $.NSWorkspace.sharedWorkspace.setIconForFileOptions(icon, commandPath, 0)
  if (!ok) {
    throw new Error(`Cannot set Finder icon on ${commandPath}`)
  }
}
JXA
}

copy_app_payload() {
  local app_path="$1"
  local payload_app="$STAGE_DIR/.payload/Cradle.app"

  [[ -d "$app_path" ]] || fail "app bundle not found: $app_path"
  [[ -f "$app_path/Contents/Info.plist" ]] || fail "not a macOS app bundle: $app_path"

  /bin/mkdir -p "$STAGE_DIR/.payload"
  /usr/bin/ditto "$app_path" "$payload_app"
  /usr/bin/xattr -cr "$payload_app" >/dev/null 2>&1 || true
}

copy_app_from_zip() {
  local zip_path="$1"
  local extract_dir="$STAGE_DIR/extract"
  local app_path

  /bin/mkdir -p "$extract_dir"
  /usr/bin/ditto -x -k "$zip_path" "$extract_dir"
  app_path="$(find_app_in_dir "$extract_dir")" || fail "zip did not contain a macOS app bundle"
  copy_app_payload "$app_path"
}

copy_app_from_dmg() {
  local dmg_path="$1"
  local app_path

  MOUNT_DIR="$STAGE_DIR/mounted-dmg"
  /bin/mkdir -p "$MOUNT_DIR"
  /usr/bin/hdiutil attach "$dmg_path" -nobrowse -readonly -mountpoint "$MOUNT_DIR" -quiet
  app_path="$(find_app_in_dir "$MOUNT_DIR")" || fail "DMG did not contain a macOS app bundle"
  copy_app_payload "$app_path"
}

stage_payload() {
  local input_path="$1"
  local lower_name

  [[ -e "$input_path" ]] || fail "input does not exist: $input_path"

  lower_name="$(printf '%s' "$input_path" | /usr/bin/tr '[:upper:]' '[:lower:]')"
  if [[ -d "$input_path" && "$lower_name" == *.app ]]; then
    copy_app_payload "$input_path"
  elif [[ "$lower_name" == *.zip ]]; then
    copy_app_from_zip "$input_path"
  elif [[ "$lower_name" == *.dmg ]]; then
    copy_app_from_dmg "$input_path"
  else
    fail "--app must point to Cradle.app, a .dmg, or a .zip"
  fi
}

create_dmg() {
  local output_abs
  local format_used="UDZO"

  output_abs="$(resolve_path "$OUTPUT_PATH")"
  /bin/mkdir -p "$(dirname "$output_abs")"
  /bin/rm -f "$output_abs"

  # Prefer ULMO (LZMA) for smallest download size; fall back to max zlib UDZO.
  if /usr/bin/hdiutil create \
    -volname "$VOLUME_NAME" \
    -srcfolder "$STAGE_DIR" \
    -ov \
    -format ULMO \
    "$output_abs" >/dev/null 2>&1; then
    format_used="ULMO"
  else
    /bin/rm -f "$output_abs"
    /usr/bin/hdiutil create \
      -volname "$VOLUME_NAME" \
      -srcfolder "$STAGE_DIR" \
      -ov \
      -format UDZO \
      -imagekey zlib-level=9 \
      "$output_abs" >/dev/null
  fi

  printf 'Wrote %s (format=%s)\n' "$output_abs" "$format_used"
}

main() {
  parse_args "$@"

  [[ -n "$APP_INPUT" ]] || fail "--app <path> is required, or set CRADLE_APP_PATH"
  [[ -f "$COMMAND_SOURCE" ]] || fail "missing installer command: $COMMAND_SOURCE"

  STAGE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/cradle-installer-dmg.XXXXXX")"

  /bin/cp "$COMMAND_SOURCE" "$STAGE_DIR/Install Cradle.command"
  /bin/chmod 755 "$STAGE_DIR/Install Cradle.command"
  if [[ "$ICON_ENABLED" == "1" ]]; then
    apply_command_icon "$STAGE_DIR/Install Cradle.command" "$(resolve_path "$ICON_INPUT")"
  fi
  stage_payload "$(resolve_path "$APP_INPUT")"
  /usr/bin/chflags hidden "$STAGE_DIR/.payload" >/dev/null 2>&1 || true

  create_dmg
}

main "$@"
