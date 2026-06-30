# Observability Module

Provides canonical observability event capture, incident projection, queue-backed persistence, error-pattern inspection, runtime snapshot inspection, and HTTP query/export surfaces.
Observability reads Chat Runtime-owned run snapshots to build diagnostics timelines and error pattern buckets, but it does not own provider runtime semantics or write provider namespaces.
Incident dedupe is intentionally signal-oriented rather than always run-scoped: chat stream failures aggregate by code so development-time interrupted runs do not create one incident per run, while producers may still pass an explicit dedupe key for cases that need narrower ownership.
Route metadata includes `x-cradle-cli` descriptors for generated CLI commands. `GET /observability/runtime-snapshot` is CLI-facing because it is useful for agents, leak harnesses, and local diagnostics. Internal producer or dangerous diagnostic endpoints such as `POST /observability/runtime-samples` and `POST /observability/diagnostics/heap-snapshot` are not exposed as generated CLI commands by default. Tab working set trend collection is script-owned by `scripts/tab_working_set_collector.py` so it can run as a timed sampler and write NDJSON/analysis artifacts under the Cradle data directory without adding another product API.

## Files

- `index.ts`: Elysia endpoints under `/observability/*`, including local event ingestion, event/incident/error-pattern query, runtime snapshot, flush, and export surfaces.
- `model.ts`: TypeBox schemas for event, incident, error-pattern, runtime snapshot, create-event, flush, query, and diagnostics bundle contracts.
- `service.ts`: Event capture, dedupe, incident projection, queue-backed persistence, run-snapshot timeline projection, queue health, error-pattern bucketing, query, and export orchestration.
- `runtime-snapshot.ts`: Reads server health, chat runtime active run summaries, provider runtime hosts, PTY resource snapshots, Chronicle daemon resources, desktop renderer/browser diagnostics, and observability queue health. It updates low-cardinality OpenTelemetry metrics while returning high-cardinality IDs only in JSON. The `drilldowns` projection keeps top-N renderer chat sessions, active streaming messages, BrowserPanel/WebContents mappings, replay-buffer runs, and provider hosts in the live JSON response instead of exporting them as Prometheus labels.
- `diagnostics.ts`: Guarded local memory diagnostics. Heap snapshots are disabled unless `CRADLE_DIAGNOSTICS_ENABLED=1`, only accept local requests, optionally require `CRADLE_DIAGNOSTICS_TOKEN`, and write artifacts under the Cradle data directory.
- `contract.ts`: canonical event and incident helpers.
- `rules.ts`: pure incident rule evaluation.
- `exporter.ts`: private-preview diagnostics bundle assembly with runtime metadata, redaction summary, event/incident rows, error-pattern buckets, run snapshot timeline, and server log tail.
- `sink.ts`: minimal producer-facing observability port.
