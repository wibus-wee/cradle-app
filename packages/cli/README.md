<!-- Once this directory changes, update this README.md -->

# CLI

Generated-first TypeScript CLI package for Cradle.

The stable runtime lives under `src/runtime`. Generated command modules live under
`src/commands/generated` and are refreshed by `pnpm gen:cli` from the server
OpenAPI document. `x-cradle-cli` only owns command placement; arguments and
flags are inferred from OpenAPI parameters and request body schemas.

Default command output uses compact search-result rendering for known search
shapes, and otherwise falls back to automatic human-readable rendering with
bordered terminal tables where possible. Use `--json` or
`--format json|pretty|table|ndjson|auto` when a stable machine-readable shape is
required. Use `--format agent` to force compact agent-readable rendering of
known search result shapes; unknown shapes fall back to pretty JSON.

Use `cradle man [command...]` or regular `--help` output for local command
manuals. System `man cradle` requires installed manpage files and is not part of
the generated command runtime.

## Files

- **src/index.ts**: CLI entry point and root command setup
- **src/runtime/**: HTTP client, command registration, output formatting, and workspace context helpers
- **src/commands/generated/**: Generated command modules, one file per CLI command
- **scripts/generate-cli.ts**: OpenAPI-to-command generator
