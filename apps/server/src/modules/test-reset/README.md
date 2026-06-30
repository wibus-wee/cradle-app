# Test Reset Module

Provides test-only database and isolated filesystem reset routes. This module is mounted only when `NODE_ENV` is `test`; it must never clean user-level paths unless those paths are inside the active test data root.

## Files

- `index.ts`: Elysia `/test/reset` route that aborts active runs, clears test database tables including provider model cache rows, removes isolated server-owned preferences, and removes isolated test HOME skills only when `HOME` is under `CRADLE_DATA_DIR`.
