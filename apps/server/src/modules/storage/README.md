# Storage

Owns the user-facing inventory and cleanup orchestration for Cradle-owned disk
usage. A Background Activity measures top-level data-directory categories and
estimates reclaimable bytes per session without adding a second storage index
or database schema. It runs at server startup, every 15 minutes, and on manual
refresh; the HTTP endpoint reads the latest in-memory snapshot instead of
starting a scan when the user opens Storage.

Storage follows owner boundaries. Session deletion delegates to Session,
transcript deletion delegates to Chat Runtime, attachment collection delegates
to Blob Store, and provider-native deletion delegates to the runtime contract.
Provider data outside Cradle-owned paths is never scanned or removed.

Kimi runtime bytes are measured per session through the
[Kimi session-storage contract](../chat-runtime-providers/kimi/README.md#session-storage).
A startup and hourly Maintenance task removes native artifacts whose provider
session has no surviving database binding. The task is visible and manually
runnable through Background Activity. It skips running provider targets and
preserves every bound session even when its native state is damaged.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/storage/overview` | Read the latest category and per-session measurement. |
| `POST` | `/storage/sessions/purge-transcripts` | Keep session metadata, delete local transcript data, and start a fresh provider session next turn. |
| `POST` | `/storage/sessions/delete` | Delete complete sessions through owner lifecycle hooks. |

SQLite compaction runs after a mutation when no chat run is active. If another
session is running, rows are deleted immediately and compaction is reported as
skipped until a later storage mutation or maintenance pass can compact it.
