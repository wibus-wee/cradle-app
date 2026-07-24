# Custom MCP Servers

This module owns user-managed MCP server metadata, encrypted sensitive values, and projection into Cradle chat runtimes.

## Ownership

- Non-sensitive definitions live at `CRADLE_DATA_DIR/mcp-servers/servers.json`.
- Stdio environment values and streamable HTTP headers are stored as encrypted `mcp-server` secrets. Public responses expose only their key names.
- Enabled definitions are projected into the host MCP registry. Provider adapters read that registry and never write user or provider-owned MCP configuration.
- Names must be unique across custom, built-in, and plugin-registered MCP servers.

## Runtime Projection

- Codex, Claude Agent, OpenCode, Kimi, and HiJarvis support stdio and streamable HTTP servers.
- ACP Chat receives stdio servers through the ACP session contract; ACP has no remote MCP server shape.
- Existing sessions keep their native runtime state. New sessions and newly acquired provider hosts receive the current projection.

## Routes

- `GET /mcp-servers` lists definitions without secret values.
- `POST /mcp-servers` creates a definition and encrypts `secretValues`.
- `PUT /mcp-servers/:id` replaces metadata; omitted `secretValues` preserve the encrypted payload.
- `PATCH /mcp-servers/:id/enabled` enables or disables a definition.
- `DELETE /mcp-servers/:id` removes the definition and its owned secret.

Secret-bearing create and update routes intentionally have no generated CLI command so values are not encouraged into shell history.
