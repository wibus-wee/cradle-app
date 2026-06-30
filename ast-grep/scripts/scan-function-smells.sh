#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

cd "$ROOT_DIR"

print_usage() {
  cat <<'USAGE'
Usage:
  ast-grep/scripts/scan-function-smells.sh [default|audit|broad|all] [--count] [--json] [--path PATH] [-- <extra ast-grep args>]

Modes:
  default  Run the default cleanup rules from sgconfig.yml.
  audit    Run the narrower facade audit rules from ast-grep/audit-sgconfig.yml.
  broad    Run broad single-return function facade rules from ast-grep/broad-audit-sgconfig.yml.
  all      Run default, audit, and broad in that order.

Options:
  --count  Print only the number of reported rows per selected mode.
  --json   Use ast-grep JSON stream output instead of short text output.
  --path   Scan one or more explicit paths instead of apps, packages, and plugins.

Examples:
  ast-grep/scripts/scan-function-smells.sh broad
  ast-grep/scripts/scan-function-smells.sh broad --count
  ast-grep/scripts/scan-function-smells.sh broad --path apps/web/src/navigation/active-surface.ts
  ast-grep/scripts/scan-function-smells.sh all -- --globs '!**/*.test.ts'
USAGE
}

mode="all"
count_only=false
json_output=false
extra_args=()
path_args=()

while (($# > 0)); do
  case "$1" in
    default|audit|broad|all)
      mode="$1"
      shift
      ;;
    --count)
      count_only=true
      shift
      ;;
    --json)
      json_output=true
      shift
      ;;
    --path)
      if (($# < 2)); then
        echo "--path requires a path argument" >&2
        exit 2
      fi
      path_args+=("$2")
      shift 2
      ;;
    --path=*)
      path_args+=("${1#--path=}")
      shift
      ;;
    --help|-h)
      print_usage
      exit 0
      ;;
    --)
      shift
      extra_args=("$@")
      break
      ;;
    *)
      echo "Unknown argument: $1" >&2
      print_usage >&2
      exit 2
      ;;
  esac
done

if ((${#path_args[@]} > 0)); then
  targets=("${path_args[@]}")
else
  targets=(apps packages plugins)
fi
exclude_args=(
  --globs '!apps/web/src/api-gen/**'
  --globs '!apps/server/src/modules/chat-runtime-providers/codex/app-server-protocol/**'
  --globs '!**/node_modules/**'
  --globs '!**/dist/**'
  --globs '!apps/desktop/release/**'
)

selected_modes=()
case "$mode" in
  all)
    selected_modes=(default audit broad)
    ;;
  *)
    selected_modes=("$mode")
    ;;
esac

config_for_mode() {
  case "$1" in
    default) printf '%s\n' 'sgconfig.yml' ;;
    audit) printf '%s\n' 'ast-grep/audit-sgconfig.yml' ;;
    broad) printf '%s\n' 'ast-grep/broad-audit-sgconfig.yml' ;;
  esac
}

scan_mode() {
  local scan_mode_name="$1"
  local config_file
  config_file="$(config_for_mode "$scan_mode_name")"

  local output_args=(--report-style short)
  if [[ "$json_output" == true ]]; then
    output_args=(--json=stream)
  fi

  if [[ "$count_only" == true ]]; then
    local count
    local scan_args=(
      ast-grep scan
      -c "$config_file"
      "${targets[@]}"
      "${exclude_args[@]}"
      "${output_args[@]}"
    )
    if ((${#extra_args[@]} > 0)); then
      scan_args+=("${extra_args[@]}")
    fi
    count="$(
      "${scan_args[@]}" \
        | wc -l \
        | tr -d ' '
    )"
    printf '%s\t%s\n' "$scan_mode_name" "$count"
    return
  fi

  if ((${#selected_modes[@]} > 1)); then
    printf '\n## %s\n' "$scan_mode_name"
  fi

  local scan_args=(
    ast-grep scan
    -c "$config_file"
    "${targets[@]}"
    "${exclude_args[@]}"
    "${output_args[@]}"
  )
  if ((${#extra_args[@]} > 0)); then
    scan_args+=("${extra_args[@]}")
  fi

  "${scan_args[@]}"
}

for selected_mode in "${selected_modes[@]}"; do
  scan_mode "$selected_mode"
done
