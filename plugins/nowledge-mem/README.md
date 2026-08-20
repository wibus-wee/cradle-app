# Nowledge Mem for Cradle

This first-party Cradle plugin registers Nowledge Mem as a streamable HTTP MCP server. Agent runtimes use the MCP tools exposed by Nowledge Mem directly; the plugin does not proxy memory, context, or thread operations through Cradle HTTP routes.

| Component | Entry point | Responsibility |
| --- | --- | --- |
| Server plugin | [`src/server.ts`](./src/server.ts) | Registers the MCP server, configuration routes, agent guidance, and uninstall cleanup. |
| Configuration | [`src/config.ts`](./src/config.ts) | Resolves the MCP endpoint and API key while keeping secrets out of plugin storage and responses. |
| Settings panel | [`src/web/tabs/config-tab-view.tsx`](./src/web/tabs/config-tab-view.tsx) | Edits the endpoint, encrypted API key, and enabled state through a fixture-friendly View. |
| Agent guidance | [`SKILL.md`](./SKILL.md) | Teaches runtimes when to use Nowledge Mem MCP tools and which writes require explicit intent. |

## Runtime Flow

On activation, the plugin reads its configuration and registers one `nowledge-mem` streamable HTTP MCP server with Cradle. Every registration includes `APP: Cradle`; remote API keys are added as an `Authorization: Bearer ...` header at runtime.

Cradle then projects the registered MCP server into compatible agent runtimes. Connectivity is established when a runtime invokes a tool, so the settings panel reports registration state rather than claiming that the remote endpoint is reachable.

The only plugin HTTP surface is its Cradle-owned configuration channel:

```text
GET /api/plugins/nowledge-mem/config
PUT /api/plugins/nowledge-mem/config
```

These routes configure the adapter itself. They never proxy Nowledge Mem operations.

## Configuration

| Setting | Default | Storage and precedence |
| --- | --- | --- |
| MCP endpoint | `http://127.0.0.1:14242/mcp/` | Plugin storage, then `NMEM_MCP_URL` shared config or environment. |
| API key | None | Encrypted plugin secret, then `NMEM_API_KEY` shared config or environment. |
| Enabled | `true` | Plugin storage. When disabled, no MCP server is registered. |

The settings panel can store or replace the API key in Cradle's encrypted plugin secret store. Public configuration responses expose only `hasApiKey` and whether the active key comes from the plugin secret or environment. Removing a plugin-owned key reveals an environment-provided fallback when one exists.

The endpoint must be an absolute `http://` or `https://` URL. Use the exact streamable HTTP MCP endpoint exposed by the target Nowledge Mem instance.

## Ownership And Uninstall

Cradle owns the endpoint setting, enabled state, and encrypted API key used by this adapter. Nowledge Mem owns all memories, threads, spaces, graph data, and server-side credentials.

Confirmed uninstall removes only the Cradle-owned plugin configuration and encrypted key. It does not modify the Nowledge Mem data directory or call Nowledge APIs.

## Agent Behavior

The bundled `cradle-plugin-nowledge-mem` skill guides agents toward the registered MCP tools. It distinguishes durable memories from full conversation threads and requires explicit user or workflow intent before memory writes, updates, or thread capture.

The plugin does not provide automatic pre-turn recall, session capture, pre-compaction capture, or transcript export. Those behaviors require Cradle lifecycle integration beyond MCP registration.

## Development

Build the production entries and bundled skill:

```bash
pnpm --filter @cradle/nowledge-mem build
```

Run the focused checks:

```bash
pnpm --filter @cradle/nowledge-mem typecheck
pnpm --filter @cradle/nowledge-mem test
pnpm exec eslint plugins/nowledge-mem/src plugins/nowledge-mem/vite.config.ts
```

The build produces `dist/server.mjs`, `dist/web.mjs`, and `dist/SKILL.md`.
