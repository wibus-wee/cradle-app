<p align="center">
  <img src="../../.github/Cradle.png" alt="Cradle Icon" width="128" />
  <img src="https://mem.nowledge.co/images/nowledge-mem-logo.webp" alt="Nowledge Icon" width="136" />
  <h1 align="center"><b>Nowledge Mem for Cradle</b></h1>
  <p align="center">
    Official Cradle plugin for connecting agents to Nowledge Mem.
    <br />
    <br />
  </p>
</p>


Nowledge Mem gives agents access to persistent memories, saved threads, Working Memory, and context bundles. This plugin exposes those capabilities through Cradle's plugin system without moving memory ownership into Cradle.

## What It Does

- Reads Nowledge Working Memory.
- Fetches Context Bundles with `source_app=cradle`.
- Searches durable memories.
- Creates explicit memories when requested.
- Searches, reads, creates, and appends Nowledge threads.
- Optionally registers Nowledge's streamable HTTP MCP endpoint when configured.
- Registers a `nowledge-mem` skill so agents know how to use the plugin routes.
- Keeps API keys out of plugin storage and public config responses.

## Current Scope

This is the M0 integration plus the M1.1 direct MCP registration path. Memory use is still explicit and route-driven unless an agent runtime chooses to call the registered MCP tools.

Supported today:

- Guided read/search/write operations through Cradle plugin routes.
- Optional default Nowledge space.
- Optional Nowledge API key via environment or shared plugin config.
- Optional streamable HTTP MCP registration via `NMEM_MCP_URL` or non-secret plugin config.
- Focused tests against mocked Nowledge API responses.

Not included yet:

- Automatic pre-turn recall.
- Automatic session capture.
- Pre-compaction capture.
- Provider-neutral tool exposure across runtimes.

Those features need additional Cradle plugin host lifecycle support.

## Installation

This plugin is bundled as a first-party Cradle workspace plugin:

    plugins/nowledge-mem

Build it from the repository root:

    pnpm --filter @cradle/nowledge-mem build

The build writes:

    dist/server.mjs
    dist/SKILL.md

## Configuration

By default, the plugin connects to:

    http://127.0.0.1:14242

You can configure the Nowledge endpoint and credentials with environment variables:

    NMEM_API_URL=http://127.0.0.1:14242
    NMEM_MCP_URL=http://127.0.0.1:14242/mcp
    NMEM_API_KEY=...

The plugin also accepts non-secret configuration through `PUT /config`:

- `apiUrl`
- `mcpUrl`
- `spaceId`
- `enabled`

API keys are never written to plugin storage. `GET /config` only returns `hasApiKey`.

When `mcpUrl` is configured and the plugin is enabled, activation registers a `nowledge-mem` streamable HTTP MCP server. If an API key is available, the runtime-only MCP config includes an `Authorization` header. That header is not written to plugin storage or returned by config routes.

## Web Panel

The plugin ships its own settings surface registered as the `panel.config` web-panel contribution. It opens from the sidebar and reads/writes the same `/config` route; there is no separate UI storage path.

The panel manages:

- `apiUrl`
- `mcpUrl`
- `spaceId`
- `enabled`

It also surfaces a read-only `hasApiKey` badge. The API key itself is never displayed, edited, or persisted from the UI; it continues to flow through `NMEM_API_KEY` in the environment or shared plugin config. Saving the form issues a single `PUT /config` with the four non-secret fields.

## HTTP Routes

Cradle mounts the plugin under:

    /api/plugins/nowledge-mem

### Status And Config

    GET /status
    GET /config
    PUT /config

`GET /status` returns public plugin config and a Nowledge health probe. `PUT /config` updates non-secret settings only.

### Context

    GET /working-memory
    GET /context-bundle

`GET /context-bundle` always sends `source_app=cradle` upstream. It accepts optional query parameters:

- `agent_id`
- `host_agent_id`
- `include_working_memory`
- `space_id`

### Memories

    GET /memories/search?q=<query>&limit=5
    POST /memories

Memory search uses `q`, not `query`.

`POST /memories` is an explicit write route. Use it only when the user or workflow asks to save durable information.

### Threads

    GET /threads/search?query=<query>&limit=5
    GET /threads/:threadId
    POST /threads
    POST /threads/:threadId/append

Thread search uses `query`, not `q`.

`POST /threads` defaults `source` to `cradle` when omitted.

## Skill

The plugin registers `SKILL.md` as the `nowledge-mem` skill during activation.

The skill teaches agents to:

- start with `/status` when setup or connectivity is unclear;
- use Working Memory for current briefing context;
- use memory search for durable facts, preferences, decisions, and procedures;
- use thread search when prior conversation provenance matters;
- write memories and append threads only as explicit operations.

## Development

Run tests:

    pnpm --filter @cradle/nowledge-mem exec vitest run src/nowledge-client.test.ts src/server.test.ts

Typecheck:

    pnpm --filter @cradle/nowledge-mem exec tsc --noEmit

Build:

    pnpm --filter @cradle/nowledge-mem build

Run host boundary checks:

    pnpm --filter @cradle/server exec vitest run src/plugins/manifest-boundary.test.ts src/plugins/context.test.ts

Lint the plugin:

    pnpm exec eslint plugins/nowledge-mem/src/config.ts plugins/nowledge-mem/src/nowledge-client.ts plugins/nowledge-mem/src/server.ts plugins/nowledge-mem/src/nowledge-client.test.ts plugins/nowledge-mem/src/server.test.ts plugins/nowledge-mem/vite.config.ts

## Ownership Model

Nowledge owns:

- memories
- threads
- spaces
- graph data
- remote credentials

Cradle owns:

- this plugin package
- plugin route and skill registration
- optional plugin-owned MCP registration
- plugin-local non-secret configuration

The plugin does not write into `~/.nowledge-mem`, Chronicle tables, `~/.agents/skills`, or any other external product namespace.

## Roadmap

The next milestone is host lifecycle support for native-feeling memory:

- plugin-safe pre-turn context injection
- after-assistant-final capture hooks
- transcript export for plugins
- provider-neutral tool exposure beyond runtimes that support streamable HTTP MCP directly
- provider-neutral compaction lifecycle
