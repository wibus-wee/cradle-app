#!/usr/bin/env bash
# Demo: lease N sandboxes in parallel, exec, release.
# Requires a running Cradle server and OrbStack/Docker.
set -euo pipefail

BASE_URL="${CRADLE_BASE_URL:-http://127.0.0.1:8787}"
PROFILE="${CRADLE_SANDBOX_PROFILE:-node22}"
COUNT="${CRADLE_SANDBOX_DEMO_COUNT:-8}"
WORKSPACE_ID="${CRADLE_SANDBOX_DEMO_WORKSPACE_ID:-}"
MOUNT_PATH="${CRADLE_SANDBOX_DEMO_MOUNT_PATH:-}"

if [[ -z "$WORKSPACE_ID" ]]; then
  echo "Set CRADLE_SANDBOX_DEMO_WORKSPACE_ID to a local workspace id." >&2
  exit 1
fi

echo "== pool before =="
curl -fsS "$BASE_URL/sandboxes/pool" | jq '{runtimeKind, engineAvailable, totals, config}'

lease_one() {
  local index="$1"
  local body
  body=$(jq -n \
    --arg profileId "$PROFILE" \
    --arg workspaceId "$WORKSPACE_ID" \
    --arg purpose "demo-$index" \
    --arg mountPath "$MOUNT_PATH" \
    '{
      profileId: $profileId,
      workspaceId: $workspaceId,
      purpose: $purpose
    } + (if $mountPath == "" then {} else {mountPath: $mountPath, mountWritable: false} end)')
  curl -fsS -X POST "$BASE_URL/sandboxes/leases" \
    -H 'content-type: application/json' \
    -d "$body"
}

echo "== leasing $COUNT sandboxes =="
START_NS=$(date +%s%N)
LEASE_IDS=()
for i in $(seq 1 "$COUNT"); do
  LEASE_JSON=$(lease_one "$i")
  LEASE_IDS+=("$(jq -r '.id' <<<"$LEASE_JSON")")
  echo "leased[$i]=${LEASE_IDS[$((i-1))]}"
done
END_NS=$(date +%s%N)
echo "lease_wall_ms=$(( (END_NS - START_NS) / 1000000 ))"

echo "== parallel exec =="
for id in "${LEASE_IDS[@]}"; do
  (
    curl -fsS -X POST "$BASE_URL/sandboxes/leases/$id/exec" \
      -H 'content-type: application/json' \
      -d '{"command":["uname","-a"]}' | jq -c '{leaseId, exitCode, timedOut}'
  ) &
done
wait

echo "== release =="
for id in "${LEASE_IDS[@]}"; do
  curl -fsS -X POST "$BASE_URL/sandboxes/leases/$id/release" >/dev/null
  echo "released=$id"
done

echo "== pool after =="
curl -fsS "$BASE_URL/sandboxes/pool" | jq '{runtimeKind, engineAvailable, totals}'
