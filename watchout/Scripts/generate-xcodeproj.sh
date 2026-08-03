#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v xcodegen >/dev/null 2>&1; then
  echo "Installing XcodeGen via Homebrew…"
  brew install xcodegen
fi

xcodegen generate
echo "Generated WatchOut.xcodeproj — open it in Xcode 16+ on macOS 14+."
