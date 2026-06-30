#!/bin/bash

set -u

APP_NAME="Cradle"
APP_BUNDLE="Cradle.app"
DEFAULT_GITHUB_REPO="wibus-wee/Cradle"
INSTALL_DIR="${CRADLE_INSTALL_DIR:-/Applications}"
DEST_APP="${INSTALL_DIR}/${APP_BUNDLE}"
SCRIPT_PATH="${BASH_SOURCE[0]}"
SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_PATH")" && pwd -P)"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/cradle-installer.XXXXXX")"
MOUNT_DIR=""
SOURCE_APP=""

log() {
  printf '%s\n' "$*"
}

fail() {
  log ""
  log "Install failed: $*"
  return 1
}

cleanup() {
  if [[ -n "$MOUNT_DIR" && -d "$MOUNT_DIR" ]]; then
    /usr/bin/hdiutil detach "$MOUNT_DIR" -quiet >/dev/null 2>&1 || true
  fi
  /bin/rm -rf "$WORK_DIR"
}

pause_before_exit() {
  local exit_code="$1"
  if [[ "${CRADLE_INSTALLER_NO_PAUSE:-0}" != "1" && -t 0 ]]; then
    log ""
    read -r -p "Press Return to close this window. " _
  fi
  exit "$exit_code"
}

shell_quote() {
  printf '%q' "$1"
}

find_app_in_dir() {
  local root="$1"
  local match

  match="$(/usr/bin/find "$root" -maxdepth 5 -name "$APP_BUNDLE" -type d -prune -print 2>/dev/null | /usr/bin/head -n 1)"
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

validate_app_bundle() {
  local app_path="$1"

  if [[ ! -d "$app_path" ]]; then
    fail "app bundle does not exist: $app_path"
    return 1
  fi

  if [[ ! -f "$app_path/Contents/Info.plist" ]]; then
    fail "not a macOS app bundle: $app_path"
    return 1
  fi

  return 0
}

select_release_asset() {
  local release_json="$1"
  local machine_arch="$2"

  /usr/bin/osascript -l JavaScript - "$release_json" "$machine_arch" <<'JXA'
function run(argv) {
  ObjC.import('Foundation')

  const releasePath = argv[0]
  const machineArch = argv[1] || ''
  const data = $.NSData.dataWithContentsOfFile(releasePath)
  if (!data) {
    throw new Error(`Cannot read ${releasePath}`)
  }

  const text = ObjC.unwrap($.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding))
  const release = JSON.parse(text)
  const assets = release.assets || []
  const wantedArch = machineArch === 'arm64' ? 'arm64' : 'x64'

  function scoreAsset(asset) {
    const name = String(asset.name || '')
    const url = String(asset.browser_download_url || '')
    const lower = name.toLowerCase()

    if (!url) return -1
    if (lower.includes('blockmap') || lower.endsWith('.yml') || lower.endsWith('.yaml')) return -1

    const isDmg = lower.endsWith('.dmg')
    const isZip = lower.endsWith('.zip')
    if (!isDmg && !isZip) return -1

    if (
      lower.includes('windows') ||
      lower.includes('win32') ||
      lower.includes('.exe') ||
      lower.includes('linux') ||
      lower.includes('.appimage') ||
      lower.includes('.deb') ||
      lower.includes('.rpm')
    ) {
      return -1
    }

    let score = 0
    if (isDmg) score += 100
    if (isZip) score += 80
    if (lower.includes('cradle')) score += 10
    if (lower.includes('mac') || lower.includes('darwin') || lower.includes('osx')) score += 20
    if (lower.includes('universal')) score += 40
    if (wantedArch === 'arm64' && lower.includes('arm64')) score += 60
    if (wantedArch === 'x64' && (lower.includes('x64') || lower.includes('x86_64') || lower.includes('amd64'))) score += 60
    return score
  }

  const ranked = assets
    .map(asset => ({ asset, score: scoreAsset(asset) }))
    .filter(item => item.score >= 0)
    .sort((left, right) => right.score - left.score)

  if (ranked.length === 0) {
    throw new Error('No macOS .dmg or .zip asset found in the latest release.')
  }

  const selected = ranked[0].asset
  return `${selected.name}\t${selected.browser_download_url}`
}
JXA
}

download_file() {
  local url="$1"
  local output="$2"

  log "Downloading:"
  log "  $url"
  /usr/bin/curl --fail --location --progress-bar --output "$output" "$url"
}

extract_zip() {
  local archive_path="$1"
  local extract_dir="$WORK_DIR/extract"

  /bin/mkdir -p "$extract_dir"
  /usr/bin/ditto -x -k "$archive_path" "$extract_dir" || return 1

  SOURCE_APP="$(find_app_in_dir "$extract_dir")" || {
    fail "downloaded zip did not contain a macOS app bundle"
    return 1
  }
}

extract_dmg() {
  local archive_path="$1"

  MOUNT_DIR="$WORK_DIR/dmg"
  /bin/mkdir -p "$MOUNT_DIR"
  /usr/bin/hdiutil attach "$archive_path" -nobrowse -readonly -mountpoint "$MOUNT_DIR" -quiet || return 1

  SOURCE_APP="$(find_app_in_dir "$MOUNT_DIR")" || {
    fail "downloaded DMG did not contain a macOS app bundle"
    return 1
  }
}

extract_artifact() {
  local artifact_path="$1"
  local lower_name

  lower_name="$(printf '%s' "$artifact_path" | /usr/bin/tr '[:upper:]' '[:lower:]')"
  case "$lower_name" in
    *.zip)
      extract_zip "$artifact_path"
      ;;
    *.dmg)
      extract_dmg "$artifact_path"
      ;;
    *)
      fail "unsupported artifact type: $artifact_path"
      return 1
      ;;
  esac
}

download_and_extract() {
  local url="$1"
  local file_name="${2:-}"
  local artifact_path

  if [[ -z "$file_name" ]]; then
    file_name="$(/usr/bin/basename "${url%%\?*}")"
  fi
  if [[ -z "$file_name" || "$file_name" == "/" || "$file_name" == "." ]]; then
    file_name="Cradle-download"
  fi

  artifact_path="$WORK_DIR/$file_name"
  download_file "$url" "$artifact_path" || return 1
  extract_artifact "$artifact_path"
}

download_latest_release() {
  local repo="${CRADLE_GITHUB_REPO:-$DEFAULT_GITHUB_REPO}"
  local api_url="https://api.github.com/repos/${repo}/releases/latest"
  local release_json="$WORK_DIR/latest-release.json"
  local selection
  local asset_name
  local asset_url

  log "No bundled payload found. Checking GitHub latest release for ${repo}..."
  /usr/bin/curl --fail --location --silent --show-error \
    --header "Accept: application/vnd.github+json" \
    --output "$release_json" \
    "$api_url" || return 1

  selection="$(select_release_asset "$release_json" "$(/usr/bin/uname -m)")" || return 1
  asset_name="${selection%%	*}"
  asset_url="${selection#*	}"

  if [[ -z "$asset_url" || "$asset_url" == "$selection" ]]; then
    fail "could not select a downloadable macOS release asset"
    return 1
  fi

  log "Selected release asset: $asset_name"
  download_and_extract "$asset_url" "$asset_name"
}

resolve_source_app() {
  local bundled_payload="$SCRIPT_DIR/.payload/$APP_BUNDLE"

  if [[ -n "${CRADLE_APP_PATH:-}" ]]; then
    SOURCE_APP="$CRADLE_APP_PATH"
    validate_app_bundle "$SOURCE_APP"
    return $?
  fi

  if [[ -d "$bundled_payload" ]]; then
    SOURCE_APP="$bundled_payload"
    validate_app_bundle "$SOURCE_APP"
    return $?
  fi

  if [[ -n "${CRADLE_DOWNLOAD_URL:-}" ]]; then
    download_and_extract "$CRADLE_DOWNLOAD_URL"
    validate_app_bundle "$SOURCE_APP"
    return $?
  fi

  download_latest_release || return 1
  validate_app_bundle "$SOURCE_APP"
}

stop_running_cradle() {
  if [[ "${CRADLE_INSTALLER_SKIP_STOP:-0}" == "1" ]]; then
    log "Skipping running app shutdown."
    return 0
  fi

  log "Stopping running Cradle instances..."
  /usr/bin/osascript -e 'tell application "Cradle" to quit' >/dev/null 2>&1 || true
  /bin/sleep 2

  if /usr/bin/pgrep -x "$APP_NAME" >/dev/null 2>&1; then
    /usr/bin/pkill -x "$APP_NAME" >/dev/null 2>&1 || true
    /bin/sleep 1
  fi
}

copy_app_without_sudo() {
  local source="$1"

  /bin/mkdir -p "$INSTALL_DIR" 2>/dev/null || return 1
  if [[ -e "$DEST_APP" ]]; then
    /bin/rm -rf "$DEST_APP" 2>/dev/null || return 1
  fi

  /usr/bin/ditto "$source" "$DEST_APP" 2>/dev/null || {
    /bin/rm -rf "$DEST_APP" >/dev/null 2>&1 || true
    return 1
  }

  /usr/bin/xattr -cr "$DEST_APP" >/dev/null 2>&1 || true
  return 0
}

copy_app_with_sudo() {
  local source="$1"

  log "Administrator permission is required to write ${DEST_APP}."
  log "macOS may ask for your login password."

  /usr/bin/sudo /bin/mkdir -p "$INSTALL_DIR" || return 1
  /usr/bin/sudo /bin/rm -rf "$DEST_APP" || return 1
  /usr/bin/sudo /usr/bin/ditto "$source" "$DEST_APP" || return 1
  /usr/bin/sudo /usr/bin/xattr -cr "$DEST_APP" >/dev/null 2>&1 || true
  /usr/bin/sudo /usr/sbin/chown -R root:admin "$DEST_APP" >/dev/null 2>&1 || true
  /usr/bin/sudo /bin/chmod -R u+rwX,go+rX "$DEST_APP" >/dev/null 2>&1 || true
}

install_source_app() {
  local source="$1"

  log "Installing ${APP_NAME} to ${DEST_APP}..."
  /usr/bin/xattr -cr "$source" >/dev/null 2>&1 || true

  if copy_app_without_sudo "$source"; then
    return 0
  fi

  copy_app_with_sudo "$source"
}

open_installed_app() {
  if [[ "${CRADLE_INSTALLER_SKIP_OPEN:-0}" == "1" ]]; then
    log "Skipping app launch."
    return 0
  fi

  log "Opening ${APP_NAME}..."
  /usr/bin/open "$DEST_APP" >/dev/null 2>&1 || {
    log "Installed, but macOS did not open the app automatically."
    log "Open it manually from ${DEST_APP}."
    return 0
  }
}

main() {
  log "Cradle installer"
  log "==============="
  log ""

  resolve_source_app || return 1

  log "Using app bundle:"
  log "  $SOURCE_APP"
  log ""

  stop_running_cradle
  install_source_app "$SOURCE_APP" || return 1

  if [[ ! -d "$DEST_APP" ]]; then
    fail "installation did not create ${DEST_APP}"
    return 1
  fi

  /usr/bin/xattr -cr "$DEST_APP" >/dev/null 2>&1 || true
  open_installed_app

  log ""
  log "Cradle installed successfully."
  return 0
}

main
exit_code="$?"
cleanup
pause_before_exit "$exit_code"
