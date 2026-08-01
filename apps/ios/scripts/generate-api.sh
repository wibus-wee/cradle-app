#!/bin/sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
IOS_ROOT="$(dirname "$SCRIPT_DIR")"
API_ROOT="$IOS_ROOT/Packages/CradleAPI/Sources/CradleAPI"

swift run \
  --package-path "$IOS_ROOT/Tools/OpenAPIGenerator" \
  swift-openapi-generator generate \
  "$API_ROOT/openapi.json" \
  --config "$API_ROOT/openapi-generator-config.yaml" \
  --output-directory "$API_ROOT/Generated"
