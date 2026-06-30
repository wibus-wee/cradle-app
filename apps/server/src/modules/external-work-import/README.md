# External Work Import Module

Cradle-owned import boundary for external AI application chat sessions.
The module may read supported Claude / Codex session files and Electron-uploaded snapshots, but it only writes Cradle-owned session, message, and import-record rows.
Session deduplication first checks prior import records, then asks Provider Runtime for durable Claude / Codex provider bindings so sessions already persisted by Cradle are excluded from preview and treated as duplicates at import time without creating import records.

## Files

- **index.ts**: Elysia `/external-work-import` routes for server-side preview, Electron upload preview, import execution, and import record listing.
- **model.ts**: TypeBox schemas for session preview items, upload payloads, import results, and persisted import records.
- **service.ts**: Detection, session parsing, import-record and Cradle runtime-session deduplication, and Cradle session/message persistence for external work import.
