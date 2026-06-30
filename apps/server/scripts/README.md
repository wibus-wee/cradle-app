# scripts

- `export-openapi.ts`: builds a local `openapi.json` snapshot without starting the server, used by web client generation; normalizes nullable `anyOf` schemas so generated clients keep precise nullable types.
- `tab_working_set_collector.py`: timed diagnostic sampler and Python data model for `GET /observability/runtime-snapshot`; writes Tab working set NDJSON captures plus analysis/model-context/Markdown artifacts under the Cradle data directory by default.
- `prepare-desktop-runtime.mjs`: creates `dist/desktop-runtime` through `pnpm deploy --prod`, so the packaged desktop server artifact follows the server package dependency graph instead of a hand-maintained dependency list.
- `rebuild-electron-runtime.mjs`: force-rebuilds the server desktop runtime native dependencies in `dist/desktop-runtime/node_modules` from source against the Electron Node ABI used by Cradle desktop.
