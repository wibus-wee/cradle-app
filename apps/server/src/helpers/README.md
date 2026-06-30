# Server Helpers

Helpers in this directory are app-owned utilities used by multiple server modules. They should stay small and avoid owning business semantics.

## Files

- **agent-runtime-config.ts**: Reads and writes runtime launch config embedded in agent/session config JSON.
- **json-text.ts**: Defensive parsers for legacy JSON text metadata columns.
- **provider-config-schemas.ts**: Provider config schema helpers.
- **system-workflow.ts**: System workflow lookup helpers.
- **time.ts**: Shared Unix timestamp helper for persisted records.
