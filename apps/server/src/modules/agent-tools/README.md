# Agent Tools

`agent-tools` owns Cradle's host-provided native tools for coding runtimes. A single builtin `cradle` MCP server exposes typed tools to MCP-capable providers, while each tool delegates product semantics to its owning server module.

## Structure

- `registry.ts`: duplicate-safe registration contract shared by all native Agent tools.
- `server.ts`: constructs the builtin `cradle` MCP server and registers the complete tool inventory.
- `runtime-registration.ts`: publishes the MCP process through the server MCP registry.
- `mcp-entry.ts`: stdio MCP process entry bundled with the server runtime.
- `tools/index.ts`: explicit inventory of builtin Agent tools.
- `tools/work/submit.ts`: required closed-loop Work finalization tool; delegates to `POST /works/:id/submit` (push + create/update Draft PR).

## Ownership

Agent Tools owns tool names, descriptions, schemas, MCP transport, and model-facing results. Product modules continue to own validation and writes. Work tools call Work APIs rather than writing Work tables or running Git/GitHub operations directly.

New native tools belong under `tools/<domain>/` and must be added to `tools/index.ts`. Do not register provider-specific copies of the same tool.
