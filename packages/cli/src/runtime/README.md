<!-- Once this directory changes, update this README.md -->

# CLI Runtime

Stable runtime helpers used by generated command modules.

## Files

- **context.ts**: Per-invocation context and workspace resolution
- **http-client.ts**: Minimal JSON HTTP client for generated operations, including Cradle runtime session header projection and Issue mutation provenance guards for Cradle runtime shells
- **http-client.test.ts**: HTTP transport regression tests for runtime context headers and Issue mutation provenance guards
- **manual-command.ts**: Local `man` command for inspecting generated command help
- **operation-command.ts**: Commander registration for generated operation specs
- **operation-command.test.ts**: Generated command registration tests for boolean flag projection and strict parsing
- **output.ts**: Automatic human-readable output, explicit JSON, bordered tables, NDJSON, and compact agent-readable search result rendering
- **types.ts**: Shared runtime and generator-facing types
