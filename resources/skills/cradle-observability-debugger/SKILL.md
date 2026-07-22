---
name: cradle-observability-debugger
description: Debug Cradle local observability data by querying SQLite events/incidents/timeline, runtime snapshots, metrics, and server logs.
---

# Observability Debugger

Use this skill when a chat turn behaves unexpectedly and you need concrete local evidence.

## Data sources

- `observability_events` — structured error/warn/info events
- `observability_incidents` — deduplicated grouped events; `TURN_STREAM_FAILED` aggregates by code unless a producer supplies a narrower dedupe key
- `backend_run_snapshots` — Cradle-owned runtime-neutral run envelope with millisecond lifecycle timestamps
- `backend_run_snapshot_events` — ordered snapshot event stream for stable harness phases such as model text/reasoning boundaries, tool input/output availability, usage, and finalization
- `GET /observability/runtime-snapshot` — live server/runtime resource view that includes server process health, active chat runs, replay buffers, provider runtime hosts, PTY resources, Chronicle daemon resources, latest desktop samples, renderer/browser drill-downs, and observability queue health
- OpenTelemetry metrics — low-cardinality gauges/counters derived from runtime samples; use only as trend/correlation evidence during debugging
- **Server logs** — pino-structured JSON written to `{CRADLE_DATA_DIR}/server.log` (or `$CRADLE_LOG_FILE`)

Observability and run snapshot rows are forensic records. Session/run/message foreign keys may be `NULL` after source rows are deleted; do not treat a null FK as malformed data. Snapshot retention is controlled by `CRADLE_CHAT_RUN_SNAPSHOT_RETENTION_DAYS` (default 30, `0` disables pruning).

Keep these snapshot types separate:

- Durable run snapshots (`backend_run_snapshots`, `backend_run_snapshot_events`) answer "what happened during this chat run?"
- Runtime snapshots (`/observability/runtime-snapshot`) answer "what resources and live runtime state exist right now?"
- Metrics answer "does the low-cardinality trend agree with the live/runtime evidence?"

## DB path resolution

The script tries in order:

1. `--db <path>`
2. `$CRADLE_DB_PATH`
3. `$CRADLE_DATA_DIR/cradle.db`
4. `~/Library/Application Support/Cradle/cradle.db` (macOS)
5. `~/.config/Cradle/cradle.db` (Linux)

## Log path resolution

The `logs` command tries:

1. `--log <path>`
2. `$CRADLE_LOG_FILE`
3. `$CRADLE_DATA_DIR/server.log`
4. `<db-dir>/server.log` (sibling of the resolved cradle.db)

## Script

Use:

    python3 resources/skills/cradle-observability-debugger/scripts/obs_debug.py --help

Use the generated Cradle CLI first when the server is running; it exercises the same HTTP API used by agents and preserves server-side redaction/export behavior:

    pnpm --filter @cradle/cli cradle observability --help
    pnpm --filter @cradle/cli cradle chat snapshot --help

Use the SQLite script when the server is down, the HTTP API is suspect, or you need to inspect local DB state without starting Cradle.

## Commands

### summary — snapshot health

    python3 resources/skills/cradle-observability-debugger/scripts/obs_debug.py summary --since-min 120

Prints counts by code/severity and top open incidents.
There is no generated CLI equivalent for this aggregate summary.

### events — query observability events

    pnpm --filter @cradle/cli cradle observability events --code CHAT_EMPTY_OUTPUT_COMPLETION --limit 50
    pnpm --filter @cradle/cli cradle observability events --chat-session-id <id> --limit 200

    python3 resources/skills/cradle-observability-debugger/scripts/obs_debug.py events --code CHAT_EMPTY_OUTPUT_COMPLETION --limit 50
    python3 resources/skills/cradle-observability-debugger/scripts/obs_debug.py events --chat-session-id <id> --limit 200

### incidents — query incidents

    pnpm --filter @cradle/cli cradle observability incidents --status open --limit 50
    pnpm --filter @cradle/cli cradle observability incidents --code TURN_STREAM_FAILED --limit 200

    python3 resources/skills/cradle-observability-debugger/scripts/obs_debug.py incidents --status open --limit 50
    python3 resources/skills/cradle-observability-debugger/scripts/obs_debug.py incidents --chat-session-id <id> --limit 200

### error-patterns — query grouped failure signatures

    pnpm --filter @cradle/cli cradle observability error-patterns --limit 50
    pnpm --filter @cradle/cli cradle observability error-patterns --run-id <runId>

### timeline — run snapshot history

    pnpm --filter @cradle/cli cradle chat snapshot run <runId>
    pnpm --filter @cradle/cli cradle chat snapshot session <sessionId>

    python3 resources/skills/cradle-observability-debugger/scripts/obs_debug.py timeline --run-id <runId> --limit 500
    python3 resources/skills/cradle-observability-debugger/scripts/obs_debug.py timeline --chat-session-id <id> --since-min 240

Timeline output is an array of `backend_run_snapshots`; each item includes parsed `summary_json` plus ordered `events` from `backend_run_snapshot_events`. Snapshot/event timestamps are milliseconds.

### runtime-snapshot — live runtime resources

    pnpm --filter @cradle/cli cradle observability runtime-snapshot --json
    pnpm --filter @cradle/cli cradle observability runtime-snapshot --json server,chatRuntime,providerRuntime,pty,observability

Use this when debugging leaks, stuck runs, replay buffer growth, lingering provider hosts, PTY descendants, Chronicle daemon resources, desktop renderer memory, or observability queue backpressure.

Important fields:

- `server.memory`, `server.cpu`, `server.node` — process RSS/heap, CPU window, active handles, and active requests
- `chatRuntime.activeRuns` — live run IDs, sessions, provider target kind/id, and model ID
- `chatRuntime.replayBuffers` — buffered chunk and delta counts per active run
- `providerRuntime.hosts` — runtime host ref counts, pin counts, resource ownership, and expiry
- `pty` — terminal resources, process descendants, RSS, and CPU by role
- `chronicle` — Chronicle daemon resource state
- `desktop.latestSamples` — raw Electron main/app metrics, windows, BrowserPanel diagnostics, and renderer diagnostics reported by desktop main
- `drilldowns.renderer` — top renderer windows, top chat sessions by estimated retained chars, and active streaming messages; use after Grafana shows renderer heap or chat payload pressure
- `drilldowns.browserPanel` — BrowserPanel owner/thread/tab/runtime to WebContents/process mappings; use when Tab working set grows without matching renderer JS heap growth
- `drilldowns.replay.topRuns` — active runs with the largest replay buffers, joined back to session/message/provider/model IDs
- `drilldowns.providerRuntime.topHosts` — provider hosts sorted by ref/pin/resource/idle pressure, with expiry and idle timing
- `observability` — event queue depth/drop/persistence health

This command is server-backed only; it has no SQLite fallback because it reports live process state.

Runtime snapshot drill-down sequence for memory and retention issues:

1. If `drilldowns.renderer.topChatSessions` is large and aligns with renderer heap growth, inspect that session's durable snapshots/messages.
2. If `drilldowns.renderer.rendererWindows` shows high Tab/renderer identity but chat sessions are small, inspect `drilldowns.browserPanel.liveTabs` and `drilldowns.browserPanel.runtimes` for retained WebContents/native BrowserPanel state.
3. If stream/replay metrics stay non-zero, inspect `drilldowns.replay.topRuns` and `drilldowns.renderer.activeStreamingMessages` before checking logs.
4. If provider host metrics stay non-zero after active runs fall, inspect `drilldowns.providerRuntime.topHosts` for ref count, pin count, expiry, and idle duration.
5. If metrics disagree with drill-downs, suspect sampler/exporter lag or stale Prometheus range data before blaming the resource owner.

### metrics — trend and exporter cross-check

Use metrics as secondary evidence after `runtime-snapshot`, not as the first source of truth. The useful debug question is whether the exported low-cardinality trend agrees with the live JSON snapshot and recent incidents/logs.

Debug sequence:

1. Capture `cradle observability runtime-snapshot --json` and identify the suspect resource family: server memory/handles, active runs, replay buffers, provider hosts, PTY resources, Chronicle resources, desktop samples, renderer/browser drill-downs, or observability queue health.
2. Check the metric backend for the matching `cradle_*` series over the same time window.
3. If JSON shows growth but metrics are flat or missing, suspect sampler/exporter/configuration drift rather than the resource owner.
4. If both JSON and metrics grow, continue with owner-specific evidence: `drilldowns.renderer.topChatSessions`, `drilldowns.browserPanel.liveTabs`, active run IDs, replay top runs, provider host IDs, PTY descendants, queue depth, or logs.
5. If metrics grow but JSON is currently clean, treat it as a historical spike and correlate with incidents, durable run snapshots, or server logs around the metric peak.

Do not spend time teaching telemetry setup from this skill. If metrics are unavailable, continue with `runtime-snapshot`, SQLite events/incidents/timeline, and logs.

### logs — server log

    python3 resources/skills/cradle-observability-debugger/scripts/obs_debug.py logs --tail --lines 50
    python3 resources/skills/cradle-observability-debugger/scripts/obs_debug.py logs --filter "mapper" --lines 200
    python3 resources/skills/cradle-observability-debugger/scripts/obs_debug.py logs --filter "error" --tail --lines 30

Logs are pino-structured JSON. Pipe through `python3 -m json.tool` to pretty-print individual lines.

### bundle — deterministic export

    pnpm --filter @cradle/cli cradle observability export \
      --chat-session-id <chatSessionId> \
      --since-unix <unixSeconds>

    python3 resources/skills/cradle-observability-debugger/scripts/obs_debug.py bundle \
      --chat-session-id <chatSessionId> \
      --since-min 240 \
      --out /tmp/cradle-obs-bundle.json

The bundle includes observability events, incidents, and run snapshot timelines with metadata.

## Typical debug flow

1. If the server is running, start with `cradle observability error-patterns --limit 50` or `cradle observability incidents --status open`.
2. Use `cradle observability events --code <CODE> --limit 50` to narrow to one session/run.
3. Use `cradle chat snapshot run <runId>` or `cradle chat snapshot session <sessionId>` to inspect durable harness phases.
4. Use `cradle observability runtime-snapshot --json` when the symptom looks live-resource related: memory growth, stuck active runs, retained replay buffers, provider host leaks, PTY process leaks, Chronicle daemons, desktop renderer pressure, BrowserPanel/WebContents retention, or observability queue backpressure.
5. Use metrics only as a trend/exporter cross-check; compare them with `runtime-snapshot` before blaming the resource owner.
6. Use `logs --filter "<chatSessionId>" --lines 100` when DB/API evidence is not enough.
7. Use `cradle observability export ...` for API-faithful sharing; use the script `bundle` when the server is unavailable.

## Guardrails

- Do not mutate DB state from this skill.
- Prefer filtering by `chatSessionId` or `runId` before broad scans, but remember old forensic rows may have null FKs.
- If neither `chatSessionId` nor `runId` is known, run `summary` then `events --code ...` first.
