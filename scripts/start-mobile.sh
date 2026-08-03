#!/usr/bin/env bash

set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mode=""
generate_client=false
clear_cache=false

usage() {
  cat <<'EOF'
Usage: scripts/start-mobile.sh [start|ios|android] [--generate] [--clear]

Starts the standalone Cradle Mobile Expo app.

Options:
  start       Start Expo and show the QR code
  ios         Start Expo and open the iOS simulator
  android     Start Expo and open the Android emulator
  --generate  Regenerate the mobile OpenAPI client before starting
  --clear     Clear the Metro bundler cache before starting
  -h, --help  Show this help
EOF
}

while (($# > 0)); do
  case "$1" in
    start | ios | android)
      mode="$1"
      ;;
    --generate)
      generate_client=true
      ;;
    --clear)
      clear_cache=true
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

if [[ -z "$mode" ]]; then
  if [[ "$(uname -s)" == "Darwin" ]]; then
    mode="ios"
  else
    mode="start"
  fi
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm is required. Install pnpm 11 and try again." >&2
  exit 1
fi

if [[ ! -d "$repo_root/node_modules" ]]; then
  echo "Dependencies are missing. Run 'pnpm install' from the repository root." >&2
  exit 1
fi

cd "$repo_root"

if [[ "$generate_client" == true || ! -f apps/mobile/src/api-gen/index.ts ]]; then
  pnpm generate:mobile
fi

mobile_args=("$mode")
if [[ "$clear_cache" == true ]]; then
  mobile_args+=(--clear)
fi
exec pnpm --filter @cradle/mobile "${mobile_args[@]}"
