# Cradle Plugin System — Developer Guide

This document provides everything you need to build a Cradle plugin from scratch.

---

## 1. Architecture Overview

The Cradle Plugin System runs across **3 runtime layers**:

| Layer | Runtime | Entry Point | Capabilities |
|-------|---------|-------------|-------------|
| **Server** | Node.js (Elysia) | `src/server.ts` | HTTP routes, MCP servers, skills, external provider sources, external issue sources, Chat/Jarvis runtimes, hooks, events, KV storage |
| **Web** | Browser (React) | `dist/web.mjs` | UI panels, commands, localStorage |
| **Desktop** | Electron main | `src/desktop.ts` | System-level access, CDP, IPC, shared config |

A single plugin can implement **any combination** of these layers. For example:
- `@cradle/system-info` → server + web (API route + sidebar panel)
- `@cradle/browser-use` → server + desktop (MCP server + CDP automation)

### Loading Flow

```
┌─────────────────────────────────────────────────────────────────┐
│ Desktop (Electron main)                                         │
│                                                                 │
│  activateDesktopPlugins()                                       │
│    └── discoverPlugins(pluginsDir)                              │
│    └── For each manifest with cradle.desktop:                   │
│          import(entryPath) → validate → activate(ctx)           │
│    └── getPluginEnvVars() → passed to server fork              │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│ Server (Node.js)                                                │
│                                                                 │
│  activateServerPlugins(app)                                     │
│    └── discoverPlugins(pluginsDir)                              │
│    └── Apply Cradle host activation policy                      │
│    └── For each manifest with cradle.server:                    │
│          import(entryPath) → validate → activate(ctx)           │
│          Register plugin-owned routes in host dispatcher        │
│    └── Create static routes:                                    │
│          GET /api/plugins         → plugin list JSON            │
│          GET /api/plugins/:name/web.mjs → serve web bundle     │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│ Web (Browser)                                                   │
│                                                                 │
│  main.tsx:                                                      │
│    window[Symbol.for('cradle:modules')] = { react, ... }        │
│    loadWebPlugins():                                            │
│      fetch('/api/plugins') → filter hasWeb                      │
│      For each web plugin:                                       │
│        import('/api/plugins/{shortName}/web.mjs')               │
│        mod.activate(ctx)                                        │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Getting Started — Create a Plugin in 5 Minutes

### Step 1: Create the directory

```bash
mkdir -p plugins/my-plugin/src
```

For an in-repository plugin, use the workspace dependency shown below. For an external plugin repository, install the published SDK package instead:

```bash
pnpm add -D @cradleapp/plugin-sdk
```

### Step 2: Create `plugins/my-plugin/package.json`

```json
{
  "name": "@cradle/my-plugin",
  "type": "module",
  "version": "0.0.1",
  "private": true,
  "cradle": {
    "apiVersion": "1",
    "displayName": "My Plugin",
    "description": "Does something useful",
    "server": "src/server.ts",
    "contributes": {
      "capabilities": [
        {
          "id": "route.hello",
          "type": "server-route",
          "layer": "server",
          "label": "Hello route",
          "permissions": []
        }
      ],
      "permissions": []
    }
  },
  "devDependencies": {
    "@cradle/plugin-sdk": "workspace:*"
  }
}
```

### Step 3: Create `plugins/my-plugin/src/server.ts`

```ts
import type { ServerPluginContext } from '@cradle/plugin-sdk/server'

export function activate(ctx: ServerPluginContext): void {
  ctx.routes.register({
    method: 'GET',
    path: '/hello',
    handler: () => ({ message: 'Hello from my plugin!' }),
  })

  ctx.logger.info('My Plugin activated')
}
```

### Step 4: Install dependencies

```bash
pnpm install
```

### Step 5: Start the server

```bash
pnpm dev:server
```

Your route is now live at `GET http://127.0.0.1:21423/api/plugins/my-plugin/hello`

---

## 3. Package Structure

### Directory Layout

```
plugins/
└── my-plugin/
    ├── package.json          # Must have "cradle" field
    ├── vite.config.ts        # Only needed if plugin has web entry
    ├── tsconfig.json         # Optional (can inherit from root)
    ├── SKILL.md              # Optional (for skill registration)
    ├── src/
    │   ├── server.ts         # Server entry (loaded by vite-node in dev)
    │   ├── web.tsx           # Web entry (built to dist/web.mjs)
    │   └── desktop.ts        # Desktop entry
    └── dist/
        └── web.mjs           # Built web bundle (committed or CI-built)
```

### package.json Requirements

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Any valid npm package name, scoped or unscoped (e.g. `@acme/my-plugin` or `my-plugin`) |
| `type` | Yes | Must be `"module"` |
| `private` | Optional | Use `true` for local-only plugins; omit it for plugins you publish independently |
| `cradle` | Yes | Plugin metadata object (see below) |
| `cradle.displayName` | No | Human-readable name for UI |
| `cradle.description` | No | What the plugin does |
| `cradle.icon` | No | Package-relative image file for host UI surfaces |
| `cradle.server` | No* | Path to server entry relative to package root |
| `cradle.web` | No* | Path to web entry (pre-built `.mjs`) |
| `cradle.desktop` | No* | Path to desktop entry |
| `cradle.deployments` | No | `['desktop']` or `['web']` — restricts where plugin loads |
| `cradle.apiVersion` | Yes | Plugin SDK contract version. Must be `"1"` for the current manifest shape. |
| `cradle.contributes` | Yes | Structured static capability and permission declarations. Use empty arrays when the plugin declares no capabilities or permissions. |

\* At least one of `server`, `web`, or `desktop` must be present.

### Permission Enforcement

`cradle.contributes.permissions` is enforced during host activation for external local plugins. Workspace development plugins and bundled resource plugins are trusted by source policy. For `externalLocal` plugins, the package checksum must first match a stored operator trust grant, and every required permission for the layer must be granted by the operator or by Cradle Marketplace install consent from a Cradle-owned installed plugin directory.

Operator grants use these environment variables:

```bash
CRADLE_PLUGIN_ALLOWED_PERMISSIONS=network.local,provider.read
CRADLE_PLUGIN_ALLOWED_MY_PLUGIN_PERMISSIONS=network.local
```

`CRADLE_PLUGIN_ALLOWED_PERMISSIONS` applies to all external local plugins. `CRADLE_PLUGIN_ALLOWED_{ROUTE_SEGMENT}_PERMISSIONS` applies only to one route segment after uppercasing it and replacing non-alphanumeric characters with underscores.

Marketplace install consent records the manifest-derived required permission ids in the install receipt. That receipt is displayed as provenance for any matching package, but it becomes an activation grant only when the host projects it from the Cradle-owned Marketplace installed plugin directory. A copied or hand-written receipt in an arbitrary external plugin directory does not grant permissions.

Marketplace install links can point at any GitHub repository and any normalized package subdirectory, including the repository root. The link only controls where Cradle fetches the package from; checksum trust and install consent still decide whether external code can activate.

If a required permission is missing, the host marks that layer `disabled`. Server and desktop entries do not call `activate()`. Web entries are not served from `/api/plugins/{routeSegment}/web.mjs` and the renderer does not import them.

External local trust is bound to the package checksum. If package contents change, the host disables the plugin until the operator enables that exact package revision again. External local plugins are also blocked while relay host enrollments expose the server.

### Host Activation vs Plugin Settings

Cradle owns plugin package activation. Host activation answers whether the package is active at all: whether Cradle imports the server entry, serves the web bundle, dispatches plugin routes, and keeps runtime registrations such as MCP servers, skills, hooks, provider sources, and issue sources.

Plugin-owned settings answer what an active plugin should do. They belong in plugin storage or plugin-specific APIs. For example, Nowledge Mem may expose its own `enabled` setting, but that setting is not the same as Cradle's activation policy. A disabled package cannot serve its web bundle or private server routes, so management UI for activation must live in Cradle's app-owned plugin management surface, not inside the plugin panel.

The public descriptor includes `activation: { enabled, source, reason?, updatedAt? }`. `source: 'default'` means no user policy exists and the plugin is enabled by default. `source: 'user'` means Cradle has persisted an explicit host activation policy.

### Plugin Identity And Route Segment

`package.json#name` is the canonical plugin identity. The route segment is derived from that identity and is used only for URL routing:

```
@cradle/plugin-foo  →  foo
@cradle/system-info →  system-info
@cradle/my-tool     →  my-tool
@external/tool      →  scope-external--tool
external-tool       →  external-tool
```

Current `@cradle/*` route segments remain legacy-compatible. External scoped packages use an encoded route segment to avoid collisions. Do not use the route segment as plugin ownership identity; use the package name.

---

## 4. Server Plugin API

### Entry Point

```ts
// plugins/my-plugin/src/server.ts
import type { ServerPluginContext } from '@cradle/plugin-sdk/server'

export function activate(ctx: ServerPluginContext): void | Promise<void> {
  // Plugin initialization here
}

// Optional cleanup
export function deactivate(): void | Promise<void> {
  // Cleanup resources
}
```

### `ctx.routes.register(route)` — HTTP Route Registration

Register plugin-owned routes below `/api/plugins/{routeSegment}`. The host owns dispatch and lifecycle cleanup; plugin code owns only the route handler semantics.

```ts
export function activate(ctx: ServerPluginContext): void {
  // GET /api/plugins/my-plugin/status
  ctx.routes.register({
    method: 'GET',
    path: '/status',
    handler: () => ({ ok: true, uptime: process.uptime() }),
  })

  // POST /api/plugins/my-plugin/action
  ctx.routes.register<{ value?: string }>({
    method: 'POST',
    path: '/action',
    handler: ({ body }) => ({ result: 'done', input: body }),
  })
}
```

### Managed sidecars and uninstall lifecycle

Plugins that own optional executables or other retained artifacts should expose them through `ctx.resources.register(...)`. Cradle assigns the plugin namespace, while the adapter owns declaration, projection, and install/update/uninstall behavior. Use `ctx.downloads` for HTTPS artifacts, `ctx.paths.dataDir` for plugin-owned files, and `ctx.secrets` for encrypted values that must not enter plugin storage or public status responses.

`ctx.processes.spawn(...)` accepts only executables and working directories inside `ctx.paths.dataDir`. Cradle supervises these processes, gives them a minimal environment, and stops them when the plugin deactivates. A plugin with retained state must register `ctx.lifecycle.registerUninstall(...)`; inspection describes removed and preserved data, while execution performs plugin-specific cleanup after Cradle stops its processes and uninstalls its managed resources.

Plugin source removal is a two-step host transaction: inspect the uninstall plan, show it to the operator, then submit its short-lived confirmation token. If resource or lifecycle cleanup fails, Cradle keeps the plugin active and retryable instead of deleting the source.

```ts
export function activate(ctx: ServerPluginContext): void {
  ctx.resources.register(runtimeAdapter)

  ctx.lifecycle.registerUninstall({
    async inspect() {
      return {
        summary: 'Remove generated state while retaining account files.',
        data: [
          { id: 'config', label: 'Generated configuration', effect: 'remove' },
          { id: 'accounts', label: 'Account files', effect: 'preserve' },
        ],
      }
    },
    async execute() {
      await removeGeneratedConfiguration(ctx.paths.dataDir)
      ctx.secrets.delete('api-key')
    },
  })
}
```

### `ctx.mcp.registerServer(config)` — MCP Server Registration

Register an MCP (Model Context Protocol) server that agents can discover and use:

```ts
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

export function activate(ctx: ServerPluginContext): void {
  const disposable = ctx.mcp.registerServer({
    transport: 'stdio',
    name: 'my-tool',
    command: 'node',
    args: [resolve(__dirname, 'mcp-server.mjs')],
    env: { MY_CONFIG: 'value' },
    when: () => !!ctx.sharedConfig.get('MY_FEATURE_ENABLED'),
  })

  // The host tracks returned disposables automatically. Keep this value only
  // when the plugin needs to dispose the registration before deactivation.
  void disposable
}
```

Streamable HTTP MCP servers are already running at an HTTP endpoint. Use headers only for values the runtime client must send; headers may contain secrets and are not exposed through public plugin capability metadata.

```ts
export function activate(ctx: ServerPluginContext): void {
  const token = ctx.sharedConfig.get('MY_TOOL_TOKEN')

  ctx.mcp.registerServer({
    transport: 'streamable-http',
    name: 'my-http-tool',
    url: 'https://mcp.example.test/mcp',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  })
}
```

Server registrations return `Disposable` handles and are also tracked in `ctx.subscriptions`. Use namespace APIs such as `ctx.routes.register`, `ctx.mcp.registerServer`, `ctx.skills.register`, `ctx.providers.externalSources.register`, and `ctx.runtimes.register`. When `when` is asynchronous, await the result if later initialization depends on the MCP server being registered.

**`McpServerConfig` fields:**

| Field | Type | Description |
|-------|------|-------------|
| `transport` | `'stdio' \| 'streamable-http'` | MCP transport kind |
| `name` | `string` | Unique identifier for the MCP server |
| `command` | `string` | Stdio-only executable command (e.g. `'node'`, `'python'`) |
| `args` | `string[]` | Stdio-only command arguments |
| `env` | `Record<string, string>` | Stdio-only optional environment variables |
| `url` | `string` | Streamable HTTP-only MCP endpoint URL |
| `headers` | `Record<string, string>` | Streamable HTTP-only optional request headers; may contain secrets |
| `when` | `() => boolean \| Promise<boolean>` | Optional predicate — skips registration if returns `false` |

### `ctx.skills.register(skill)` — Skill Registration

Register a skill (a Markdown file describing a capability for agent discovery):

```ts
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

export function activate(ctx: ServerPluginContext): void {
  ctx.skills.register({
    name: 'browser-automation',
    description: 'Browser automation for AI agents via CDP',
    skillFile: resolve(__dirname, 'SKILL.md'),
  })
}
```

`skillFile` should point at the real packaged `SKILL.md` that ships with the plugin. Cradle projects the full containing skill package directory into known runtime-native skill roots under a reserved path such as `cradle/plugin-browser-automation`. Agent-scoped runtime homes receive this projection automatically. Provider-specific global roots like `~/.codex/skills` or `~/.claude/skills` receive it only when the app feature flag `nativeProviderSkillProjection` is enabled for no-agent provider starts. Bundled `references/`, `scripts/`, and `assets/` remain available to agents that load skills from the filesystem. The projection is removed when the plugin registration is disposed or the plugin is disabled.

### `ctx.providers.externalSources.register(source)` — External Provider Source

插件可以提供外部 provider 数据源。这个能力只返回标准化数据，不允许插件渲染 Provider settings UI，也不允许插件直接写 Cradle 的 `provider_targets` 或 `agent_credentials`。Cradle host 会读取 snapshot、加密 credential、投影 provider target、处理 missing/stale 状态，并用固定 Provider UI 展示。

```ts
import type { ServerPluginContext } from '@cradle/plugin-sdk/server'

export function activate(ctx: ServerPluginContext): void {
  ctx.providers.externalSources.register({
    id: 'fixture-providers',
    label: 'Fixture Providers',
    capabilities: { refresh: true },
    async readSnapshot() {
      return {
        source: { status: 'ok' },
        inventory: { mcpServers: 2, prompts: 1, skills: 3 },
        providers: [
          {
            externalId: 'codex:fixture-openai',
            app: 'codex',
            name: 'Fixture OpenAI',
            providerKind: 'openai-compatible',
            config: {
              baseUrl: 'https://openai.example.test',
              model: 'gpt-test',
            },
            credential: {
              kind: 'api-key',
              value: 'test-secret-value',
              label: 'Fixture OpenAI',
            },
            metadata: {
              baseUrl: 'https://openai.example.test',
              model: 'gpt-test',
              apiFormat: 'openai_responses',
            },
          },
        ],
      }
    },
  })
}
```

Provider source contract 的边界是：

- 插件读取外部 namespace，例如本地配置文件、SQLite DB 或远端 registry。
- 插件返回 `ExternalProviderSourceSnapshot`，其中 provider record 使用稳定 `externalId`。
- 插件不得把 plaintext secret 放进 `config`；如需提供 API key，只能放在 `credential.value`。
- 插件不拥有 provider profile 的 enabled/disabled 状态；Cradle host 负责初始启用策略和用户开关。
- 插件不贡献 badge、button、React component、surface descriptor 或 action ref。
- Cradle host 固定渲染 external source UI，并负责 profile read-only guard。

### `ctx.issues.externalSources.register(source)` — External Issue Source

插件可以提供外部 issue 数据源，例如 GitHub Issues。这个能力只读取外部系统并返回标准化 snapshot；插件不得写 `issues`，不得创建普通 Cradle issue，也不得贡献 Settings 或 Kanban UI。Cradle host 负责 workspace 仓库绑定、共享 repository cursor、ETag/rate-limit 状态、`external_issue_items` 投影、missing 标记和本地 Kanban status overlay。

```ts
import type { ServerPluginContext } from '@cradle/plugin-sdk/server'

export function activate(ctx: ServerPluginContext): void {
  ctx.issues.externalSources.register({
    id: 'github-issues',
    label: 'GitHub Issues',
    capabilities: { refresh: true },
    async readSnapshot({ repository, etag }) {
      return {
        source: {
          status: 'ok',
          etag,
          message: `Read ${repository.owner}/${repository.name}`,
        },
        issues: [
          {
            externalId: 'I_kwDOExample',
            externalKey: `${repository.owner}/${repository.name}#1`,
            externalUrl: `https://github.com/${repository.owner}/${repository.name}/issues/1`,
            repository,
            number: 1,
            title: 'Example external issue',
            state: 'open',
            labels: ['bug'],
            assignees: [],
          },
        ],
      }
    },
  })
}
```

Issue source contract 的边界是：

- 插件读取 GitHub 或其它外部 issue namespace，并返回 `ExternalIssueSourceSnapshot`。
- `externalId` 和 `externalKey` 必须稳定；GitHub source 应优先使用 `node_id` 和 `owner/repo#number`。
- title、body、labels、assignees、milestone、state、URL 和 timestamps 由外部系统拥有，刷新会覆盖这些字段。
- Cradle 只允许用户修改外部卡片的 `statusId`。
- repository 选择由 Cradle-owned binding 决定，插件不选择 workspace。

### `ctx.storage` — Plugin KV Storage

Async key-value store scoped to the plugin. The server host stores values in the Cradle-owned `plugin_storage_entries` table and isolates data by plugin package identity plus key. Use this for small plugin-owned preferences or cursors. Host-owned projections such as provider records, fingerprints, credential refs, and sync status still belong in their dedicated host pipelines.

```ts
export async function activate(ctx: ServerPluginContext): Promise<void> {
  // Read
  const lastRun = await ctx.storage.get('lastRun')

  // Write
  await ctx.storage.set('lastRun', new Date().toISOString())

  // Delete
  await ctx.storage.delete('tempData')
}
```

### `ctx.runtimes.register(runtime, metadata)` — Chat/Jarvis Runtime Provider

Plugins can provide a full Chat Runtime provider for Chat and Jarvis. The plugin owns its runtime id and implementation semantics; Chat Runtime owns the catalog, session lifecycle, persistence, and provider-target compatibility checks.

Declare the capability before registering it at runtime:

```json
{
  "cradle": {
    "apiVersion": "1",
    "server": "src/server.ts",
    "contributes": {
      "capabilities": [
        {
          "id": "runtime.my-cloud-agent",
          "type": "chat-runtime",
          "layer": "server",
          "label": "My Cloud Agent runtime",
          "permissions": []
        }
      ],
      "permissions": []
    }
  }
}
```

Then register a runtime object that satisfies Cradle's server `ChatRuntime` contract:

```ts
import type { ServerPluginContext } from '@cradle/plugin-sdk/server'

export function activate(ctx: ServerPluginContext): void {
  ctx.runtimes.register(myRuntimeProvider, {
    runtimeKind: 'my-cloud-agent',
    label: 'My Cloud Agent',
    description: 'Runs turns through my hosted agent runtime',
    providerKinds: ['openai-compatible'],
    iconKey: 'custom',
    surfaces: ['chat', 'jarvis'],
    sortOrder: 80,
  })
}
```

`runtimeKind` must match `myRuntimeProvider.runtimeKind`. `providerKinds` controls which Cradle provider targets are selectable for this runtime. `surfaces` controls where the runtime appears; use `['chat', 'jarvis']` when the same runtime can back both ordinary Chat sessions and Jarvis sessions.

### `ctx.hooks` — Chat Lifecycle Hooks

Intercept or observe LLM interactions:

```ts
export function activate(ctx: ServerPluginContext): void {
  // Modify queries before they reach the LLM
  const dispose1 = ctx.hooks.chat.onBeforeQuery((queryCtx) => {
    // Add system context
    queryCtx.metadata.myPlugin = { injectedAt: Date.now() }
    return queryCtx // Must return the (possibly modified) context
  })

  // Observe responses (read-only)
  const dispose2 = ctx.hooks.chat.onAfterResponse((responseCtx) => {
    console.log(`Model ${responseCtx.model} responded in ${responseCtx.durationMs}ms`)
    if (responseCtx.usage) {
      console.log(`Tokens: ${responseCtx.usage.inputTokens} in, ${responseCtx.usage.outputTokens} out`)
    }
  })
}
```

**`QueryHookContext` fields:**

| Field | Type | Description |
|-------|------|-------------|
| `messages` | `Array<{role, content}>` | Messages being sent to the LLM |
| `model` | `string` | Model identifier |
| `threadId` | `string` | Conversation thread ID |
| `metadata` | `Record<string, unknown>` | Extensible metadata bag |

**`ResponseHookContext` fields:**

| Field | Type | Description |
|-------|------|-------------|
| `threadId` | `string` | Thread ID |
| `model` | `string` | Model used |
| `usage` | `{inputTokens, outputTokens}?` | Token usage stats |
| `durationMs` | `number` | Response duration in ms |

### `ctx.events` — Event Bus

Subscribe to and emit events across plugins:

```ts
export function activate(ctx: ServerPluginContext): void {
  // Subscribe to events
  const disposable = ctx.events.on('thread.created', (data) => {
    console.log('New thread:', data)
  })

  // Emit events (other plugins can listen)
  ctx.events.emit('my-plugin.ready', { version: '1.0' })
}
```

### `ctx.sharedConfig` — Desktop-Provided Configuration

A `ReadonlyMap<string, string>` populated from environment variables with prefix `CRADLE_PLUGIN_`. Desktop plugins write these via `ctx.sharedConfig.set()`.

```ts
export function activate(ctx: ServerPluginContext): void {
  const socketPath = ctx.sharedConfig.get('BROWSER_BACKEND_SOCKET')
  if (!socketPath) {
    ctx.logger.warn('No socket path — running in web-only mode')
    return
  }
  // Use the socket path...
}
```

**Key mapping:** Desktop calls `ctx.sharedConfig.set('MY_KEY', 'value')` → becomes env `CRADLE_PLUGIN_MY_KEY=value` → server reads `ctx.sharedConfig.get('MY_KEY')`.

### `ctx.logger` — Scoped Logger

```ts
ctx.logger.info('Plugin initialized')
ctx.logger.warn('Deprecated API used')
ctx.logger.error('Failed to connect', errorObj)
ctx.logger.debug('Verbose diagnostic info')
```

Output format: `[plugin:@cradle/my-plugin] message`

### `ctx.manifest` — Plugin Metadata

The parsed `PluginManifest` for introspection:

```ts
interface PluginManifest {
  name: string          // "@cradle/my-plugin"
  version: string       // "0.0.1"
  packageDir: string    // Absolute path to plugin directory
  cradle: CradlePluginMeta
}
```

---

## 5. Web Plugin API

### Overview

Web plugins run in the browser. They must be **pre-built** as ES modules because they are served as static `.mjs` files from the server to the browser via dynamic `import()`.

### Entry Point

```tsx
// plugins/my-plugin/src/web.tsx
import { useState } from 'react'
import type { WebPluginContext } from '@cradle/plugin-sdk/web'

export function activate(ctx: WebPluginContext): void {
  ctx.panels.register({
    id: 'my-panel',
    title: 'My Panel',
    component: MyPanel,
    location: 'sidebar',
  })
}

function MyPanel({ isActive }: { isActive: boolean }) {
  const [count, setCount] = useState(0)
  return (
    <div className="p-4">
      <p>Count: {count}</p>
      <button onClick={() => setCount(c => c + 1)}>Increment</button>
    </div>
  )
}
```

Web panel and command registrations are tracked in `ctx.subscriptions` and are disposed by the host when the web plugin layer deactivates. Use namespace APIs such as `ctx.panels.register` and `ctx.commands.register`. Keep a returned `Disposable` only when the plugin needs to remove a panel or command before full deactivation.

### `ctx.panels.register(panel)` — UI Panel Registration

Register a React component as a panel in the Cradle UI:

```ts
ctx.panels.register({
  id: 'unique-panel-id',       // Must be unique across all plugins
  title: 'Panel Title',        // Displayed in UI
  icon: MyIconComponent,       // Optional: React component or icon name string
  component: MyPanelComponent, // React component to render
  location: 'sidebar',         // 'main' | 'sidebar' | 'bottom'
  order: 10,                   // Lower = earlier in list
})
```

**Panel component props:**

```ts
interface PanelProps {
  isActive: boolean  // Whether the panel is currently visible
}
```

**Location options:**

| Location | Description |
|----------|-------------|
| `'main'` | Tab area (main content) |
| `'sidebar'` | Left sidebar under "Extensions" section |
| `'bottom'` | Bottom panel area |

Returns a `Disposable` — call `.dispose()` to unregister.

### `ctx.commands.register(cmd)` — Command Registration

Register a command accessible via the command palette:

```ts
ctx.commands.register({
  id: 'my-plugin.doThing',
  title: 'Do Something Useful',
  description: 'Runs the plugin action through the host command palette',
  keywords: ['plugin', 'action'],
  category: 'My Plugin',
  icon: MyIcon,               // Optional
  keybinding: 'ctrl+shift+m', // Optional
  async execute() {
    const res = await ctx.routes.fetch('/action')
    const data = await res.json()
    ctx.logger.info('Action result:', data)
    ctx.notifications.show({
      type: 'success',
      title: 'Action completed',
      description: String(data.status),
    })
  },
})
```

The host owns command palette rendering, matching, recent command ordering, and error fallback toasts. Plugins own only the command metadata and `execute()` handler. Command ids are plugin-local; the host scopes them as `{pluginIdentity}:{commandId}` before storing them in the renderer command registry.

### `ctx.notifications.show(notification)` — Host Toast Bridge

Show a notification through Cradle's host toast surface:

```ts
ctx.notifications.show({
  id: 'sync-finished',
  type: 'success',
  title: 'Sync finished',
  description: '12 records refreshed',
  timeout: 5000,
})
```

Notification ids are plugin-local. When an `id` is provided, the host scopes it by plugin identity so one plugin cannot update another plugin's toast. `type` supports `info`, `success`, `warning`, and `error`; omitted types render as `info`.

### `ctx.storage` — localStorage-backed KV

Synchronous key-value store scoped to the plugin:

```ts
ctx.storage.set('preference', 'dark')
const pref = ctx.storage.get('preference') // 'dark'
ctx.storage.delete('preference')
```

Storage keys are namespaced: `cradle-plugin:@cradle/my-plugin:preference`

### `ctx.logger` — Scoped Console Logger

Same interface as server logger but outputs to browser console:

```ts
ctx.logger.info('Panel rendered')
ctx.logger.error('API call failed', err)
```

### `ctx.routes` — Plugin Server Route Client

Web plugins call their own server-side routes through the plugin-scoped route client:

```ts
const url = ctx.routes.url('/info')
const response = await ctx.routes.fetch('/info')
```

The host owns the server base URL and route segment. `ctx.routes` only accepts paths relative to the current plugin's route scope, so web plugins should not read `window.cradle`, `import.meta.env`, or manually build `/api/plugins/{routeSegment}` URLs.

---

## 6. Desktop Plugin API

Desktop plugins run in Electron's main process. They have full access to Node.js APIs, Electron APIs, and system resources.

### Entry Point

```ts
// plugins/my-plugin/src/desktop.ts
import type { DesktopPluginContext } from '@cradle/plugin-sdk/desktop'

export function activate(ctx: DesktopPluginContext): void {
  // Pass config to the server layer
  ctx.sharedConfig.set('MY_SECRET', process.env.MY_API_KEY ?? '')

  // Listen for webview creation
  ctx.webviews.onCreated((webview, tabId) => {
    ctx.logger.info(`Webview created: ${tabId}`)
    webview.cdp.attach('1.3')
    void webview.cdp.sendCommand('Runtime.enable')
  })
}

export function deactivate(): void {
  // Cleanup
}
```

Desktop event and shared-config registrations are tracked in `ctx.subscriptions` and are disposed by the host after `deactivate()` runs.

### `ctx.sharedConfig.set(key, value)` — Cross-Layer Config

Writes a value that becomes available to the server plugin via `ctx.sharedConfig`:

```ts
// Desktop:
ctx.sharedConfig.set('BROWSER_BACKEND_SOCKET', '/tmp/my-socket.sock')

// Server reads it as:
const socket = ctx.sharedConfig.get('BROWSER_BACKEND_SOCKET')
```

The value is passed as environment variable `CRADLE_PLUGIN_BROWSER_BACKEND_SOCKET` to the server process.

### `ctx.webviews.onCreated(handler)` — Webview Facade

Called whenever a new webview (tab) is created in the Electron renderer:

```ts
ctx.webviews.onCreated((webview, tabId) => {
  webview.cdp.attach('1.3')
  void webview.cdp.sendCommand('Runtime.enable')
  ctx.logger.info(`${tabId}: ${webview.getUrl()}`)
})
```

The handler receives the SDK-owned `DesktopWebview` facade instead of a direct Electron object. The facade exposes navigation, URL/title lookup, PNG capture, close, destroyed event subscription, and a CDP session. Returns a `Disposable` for cleanup.

### Browser Panel Tab Bridge

Desktop plugins can ask the active renderer to create, activate, or inspect Cradle's visible browser panel tabs. This is useful for plugins that own a browser automation backend and need to keep backend webview IDs mapped to renderer tab IDs.

```ts
const rendererTabId = await ctx.browserTabs.request('https://example.com')
if (!rendererTabId) {
  throw new Error('Browser panel tab was not created')
}

const activated = await ctx.browserTabs.activate(rendererTabId)
const hidden = await ctx.browserTabs.goOffScreen(rendererTabId)
const activeTabId = await ctx.browserTabs.getActive()
```

| Method | Description |
|--------|-------------|
| `browserTabs.request(url?)` | Creates a visible browser panel tab in the active renderer and returns its renderer tab ID. |
| `browserTabs.activate(tabId)` | Opens the browser panel and activates an existing renderer tab. Returns `false` when the renderer does not know the tab. |
| `browserTabs.goOffScreen(tabId?)` | Hides the browser panel without closing tabs. Returns `false` when a provided tab ID is unknown. |
| `browserTabs.getActive()` | Returns the active renderer browser panel tab ID, if one is available. |

### `ctx.userDataPath` — Electron User Data

Absolute path to Electron's userData directory. Use for persistent storage:

```ts
import { join } from 'node:path'
const dbPath = join(ctx.userDataPath, 'my-plugin.db')
```

---

## 7. React Sharing & Build Configuration

### The Problem

Web plugins use React but are loaded via dynamic `import()` at runtime. If the plugin bundles its own React, you get **two React instances**, which breaks hooks (`useState`, `useEffect`, etc.).

### The Solution

Cradle uses a **shared React mechanism**:

1. **Host exposes React** — `main.tsx` sets `window[Symbol.for('cradle:modules')]` with all React modules
2. **Import map** — Bare `import { useState } from 'react'` in plugin code resolves via import map to wrapper modules that re-export from `window[Symbol.for('cradle:modules')]`
3. **Result** — Plugin code uses the **same React instance** as the host

### How It Works (Dev Mode)

```
Plugin code:  import { useState } from 'react'
                          ↓  (import map)
Browser fetches:  /__plugin-deps/react.mjs
                          ↓
Wrapper module:   const __mod = window[Symbol.for('cradle:modules')]['react']
                  export const { useState, useEffect, ... } = __mod
                          ↓
Result: Same React instance ✓
```

### How It Works (Production)

The server rewrites bare React imports in served `.mjs` files:

```
from 'react'  →  from 'http://web-host/__plugin-deps/react.mjs'
from 'react/jsx-runtime'  →  from 'http://web-host/__plugin-deps/react-jsx-runtime.mjs'
from 'react/jsx-dev-runtime'  →  from 'http://web-host/__plugin-deps/react-jsx-dev-runtime.mjs'
```

### Required Vite Build Config

Every web plugin **must** externalize React:

```ts
// plugins/my-plugin/vite.config.ts
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    lib: {
      entry: {
        web: resolve(__dirname, 'src/web.tsx'),
      },
      formats: ['es'],
      fileName: (_format, entryName) => `${entryName}.mjs`,
    },
    rollupOptions: {
      external: ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
    },
    target: 'esnext',
    minify: false,
    outDir: 'dist',
  },
})
```

**Critical rules:**
- Output format must be `'es'` (ES modules)
- File extension must be `.mjs`
- `react`, `react-dom`, `react/jsx-runtime`, `react/jsx-dev-runtime` must be external
- `minify: false` recommended for debuggability (server does the import rewriting via string replacement)

### Build Command

```bash
cd plugins/my-plugin && pnpm build
# Or from monorepo root:
pnpm --filter @cradle/my-plugin build
```

The `cradle.web` field in `package.json` should point to the built output: `"web": "dist/web.mjs"`.

---

## 8. Cross-Layer Communication

### Desktop → Server (via Shared Config)

```
┌─────────────┐    env vars    ┌────────────┐
│   Desktop   │ ─────────────→ │   Server   │
│ setShared   │  CRADLE_PLUGIN_│ sharedConfig│
│ Config()    │  PREFIX        │  .get()    │
└─────────────┘                └────────────┘
```

Desktop plugins run **before** the server process is forked. Values set via `ctx.sharedConfig.set()` are available immediately when the server starts.

### Web → Server (via HTTP)

Web plugins call their server routes through `ctx.routes`:

```ts
// In web plugin
const res = await ctx.routes.fetch('/data')
```

### Server → Web (via Events/Polling)

No built-in push mechanism. Options:
1. **Polling** — Web plugin periodically fetches from server route
2. **Server-Sent Events** — Register an SSE route on the server

```ts
// Server
app.get('/stream', function* () {
  while (true) {
    yield { data: JSON.stringify({ time: Date.now() }) }
  }
})
```

### Plugin → Plugin (via Event Bus)

Server plugins share a global event bus:

```ts
// Plugin A
ctx.events.emit('pluginA.dataReady', { items: [...] })

// Plugin B
ctx.events.on('pluginA.dataReady', (data) => {
  console.log('Got data from Plugin A:', data)
})
```

---

## 9. DevTool & Debugging

### Accessing the DevTool

Navigate to `http://localhost:5174/#/devtool` (or use the DevTool window in the desktop app).

The **Plugins** tab shows:
- List of discovered plugins
- Topology graph: Platform → Plugin → Capability
- Registered panels, commands, entry points
- Load status and errors

### Debugging Server Plugins

- Server plugins are loaded via `vite-node` in development — hot reload works
- Console output is tagged: `[plugin:@cradle/my-plugin] message`
- Startup errors appear in the server terminal

### Debugging Web Plugins

- Open browser DevTools → Console
- Filter by `[plugin:@cradle/my-plugin]`
- Network tab shows the `web.mjs` fetch and import map resolution
- React DevTools work normally (same React instance as host)

### Common Issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| `Invalid hook call` | React not externalized | Add `react` to `rollupOptions.external` |
| `process is not defined` in `web.mjs` | JSX dev runtime bundled into a browser plugin | Add `react/jsx-dev-runtime` to `rollupOptions.external` |
| `Plugin does not export 'activate'` | Missing/wrong export | Ensure `export function activate(ctx)` |
| Panel renders but hooks fail | Bundled React copy | Check `dist/web.mjs` has no React code, only `from 'react'` imports |
| Route 404 | Wrong route segment | Check `GET /api/plugins` for the plugin `routeSegment` |
| `sharedConfig` is empty | Desktop plugin not loaded first | Ensure `cradle.desktop` entry exists and runs before server |

---

## 10. API Reference (TypeScript Interfaces)

### Shared Types (`@cradle/plugin-sdk`)

```ts
interface Disposable {
  dispose(): void
}

interface PluginManifest {
  name: string
  version: string
  packageDir: string
  cradle: CradlePluginMeta
}

interface PluginSourceDescriptor {
  kind: 'workspaceDev' | 'bundledResource' | 'externalLocal'
  packageDir: string
  trusted: boolean
  reason?: string
  checksum?: string
  provenance?: PluginSourceProvenance
}

interface PluginSourceProvenance {
  kind: 'marketplace-install'
  installedAt: string
  mode: 'alreadyAvailable' | 'downloaded'
  source: string
  repository: string
  path: string
  packageName: string
  version: string
  channel: string
  ref: string
  originalUrl?: string
  packageChecksum?: string
}

interface CradlePluginMeta {
  apiVersion: '1'
  displayName?: string
  description?: string
  icon?: string
  deployments?: Array<'desktop' | 'web'>
  server?: string
  web?: string
  desktop?: string
  contributes: {
    capabilities: Array<{
      id: string
      type: string
      layer?: 'server' | 'web' | 'desktop'
      label?: string
      description?: string
      permissions: string[]
      metadata?: Record<string, unknown>
    }>
    permissions: Array<{
      id: string
      label?: string
      description?: string
      required?: boolean
    }>
  }
}

interface Logger {
  info(msg: string, ...args: unknown[]): void
  warn(msg: string, ...args: unknown[]): void
  error(msg: string, ...args: unknown[]): void
  debug(msg: string, ...args: unknown[]): void
}
```

### Server Types (`@cradle/plugin-sdk/server`)

```ts
interface ServerPluginContext {
  routes: ServerPluginRouteRegistry
  mcp: ServerPluginMcpRegistry
  skills: ServerPluginSkillRegistry
  providers: ServerPluginProviderRegistries
  runtimes: ServerPluginRuntimeRegistry
  resources: PluginManagedResourceRegistry
  downloads: PluginDownloadService
  paths: PluginPaths
  secrets: PluginSecrets
  processes: PluginProcessService
  lifecycle: PluginLifecycle
  subscriptions: Disposable[]
  storage: PluginStorage
  logger: Logger
  sharedConfig: ReadonlyMap<string, string>
  manifest: PluginManifest
  hooks: ServerPluginHooks
  events: PluginEventBus
}

interface ServerPluginMcpRegistry {
  registerServer(config: McpServerConfig): Disposable | Promise<Disposable | undefined> | undefined
}

interface ServerPluginSkillRegistry {
  register(skill: SkillDefinition): Disposable
}

interface ServerPluginProviderRegistries {
  externalSources: ExternalProviderSourceRegistry
}

interface ServerPluginRuntimeRegistry {
  register(runtime: unknown, metadata: ChatRuntimeContributionMetadata): Disposable
}

interface ChatRuntimeContributionMetadata {
  runtimeKind: string
  label: string
  description?: string
  providerKinds: string[]
  iconKey?: string
  surfaces?: Array<'chat' | 'jarvis'>
  sortOrder?: number
}

type McpServerConfig = StdioMcpServerConfig | StreamableHttpMcpServerConfig

interface StdioMcpServerConfig {
  transport: 'stdio'
  name: string
  command: string
  args: string[]
  env?: Record<string, string>
  when?: () => boolean | Promise<boolean>
}

interface StreamableHttpMcpServerConfig {
  transport: 'streamable-http'
  name: string
  url: string
  headers?: Record<string, string>
  when?: () => boolean | Promise<boolean>
}

interface SkillDefinition {
  name: string
  description: string
  skillFile: string
}

interface PluginStorage {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
}

interface ServerPluginHooks {
  chat: ServerPluginChatHooks
}

interface ServerPluginChatHooks {
  onBeforeQuery(handler: BeforeQueryHandler): Disposable
  onAfterResponse(handler: AfterResponseHandler): Disposable
}

type BeforeQueryHandler = (ctx: QueryHookContext) => QueryHookContext | Promise<QueryHookContext>

interface QueryHookContext {
  messages: Array<{ role: string; content: string }>
  model: string
  threadId: string
  metadata: Record<string, unknown>
}

type AfterResponseHandler = (ctx: ResponseHookContext) => void | Promise<void>

interface ResponseHookContext {
  threadId: string
  model: string
  usage?: { inputTokens: number; outputTokens: number }
  durationMs: number
}

interface PluginEventBus {
  on(event: string, handler: (data: unknown) => void): Disposable
  emit(event: string, data: unknown): void
}
```

### Web Types (`@cradle/plugin-sdk/web`)

```ts
interface WebPluginContext {
  routes: WebPluginRouteClient
  notifications: WebPluginNotificationBridge
  panels: WebPluginPanelRegistry
  commands: WebPluginCommandRegistry
  subscriptions: Disposable[]
  storage: WebPluginStorage
  logger: Logger
}

interface WebPluginRouteClient {
  url(path: string): string
  fetch(path: string, init?: RequestInit): Promise<Response>
}

interface WebPluginPanelRegistry {
  register(panel: PanelRegistration): Disposable
}

interface WebPluginCommandRegistry {
  register(cmd: CommandRegistration): Disposable
}

interface WebPluginNotificationBridge {
  show(notification: PluginNotification): void
}

type PluginNotificationType = 'info' | 'success' | 'warning' | 'error'

interface PluginNotification {
  title: string
  description?: string
  type?: PluginNotificationType
  id?: string
  timeout?: number
}

interface PanelRegistration {
  id: string
  title: string
  icon?: ComponentType<{ className?: string }> | string
  component: ComponentType<PanelProps>
  location?: 'main' | 'sidebar' | 'bottom'
  order?: number
}

interface PanelProps {
  isActive: boolean
}

interface CommandRegistration {
  id: string
  title: string
  description?: string
  keywords?: string | string[]
  category?: string
  icon?: ComponentType<{ className?: string }> | string
  keybinding?: string
  execute(): void | Promise<void>
}

interface WebPluginStorage {
  get(key: string): string | null
  set(key: string, value: string): void
  delete(key: string): void
}
```

### Desktop Types (`@cradle/plugin-sdk/desktop`)

```ts
interface DesktopPluginContext {
  userDataPath: string
  webviews: DesktopPluginWebviewRegistry
  browserTabs: DesktopPluginBrowserTabBridge
  sharedConfig: DesktopPluginSharedConfigRegistry
  subscriptions: Disposable[]
  logger: Logger
  manifest: PluginManifest
}

interface DesktopPluginWebviewRegistry {
  onCreated(handler: (webview: DesktopWebview, tabId: string) => void): Disposable
}

interface DesktopWebview {
  readonly tabId: string
  isDestroyed(): boolean
  navigate(url: string): Promise<void>
  getUrl(): string
  getTitle(): string
  capturePng(): Promise<Uint8Array>
  close(): void
  onDestroyed(handler: () => void): Disposable
  cdp: DesktopWebviewCdpSession
}

interface DesktopWebviewCdpSession {
  attach(protocolVersion?: string): void
  detach(): void
  sendCommand<T = unknown>(command: string, params?: Record<string, unknown>): Promise<T>
  onDetached(handler: (reason: string) => void): Disposable
}

interface DesktopPluginBrowserTabBridge {
  request(url?: string): Promise<string | undefined>
  activate(tabId: string): Promise<boolean>
  goOffScreen(tabId?: string): Promise<boolean>
  getActive(): Promise<string | undefined>
}

interface DesktopPluginSharedConfigRegistry {
  set(key: string, value: string): void
}
```

---

## 11. Examples

### Example 1: Minimal Server-Only Plugin

A plugin that exposes a single API route.

**`plugins/hello/package.json`**

```json
{
  "name": "@cradle/hello",
  "type": "module",
  "version": "0.0.1",
  "private": true,
  "cradle": {
    "apiVersion": "1",
    "displayName": "Hello World",
    "description": "Minimal example plugin",
    "server": "src/server.ts",
    "contributes": {
      "capabilities": [
        {
          "id": "route.greet",
          "type": "server-route",
          "layer": "server",
          "label": "Greeting route",
          "permissions": []
        },
        {
          "id": "route.health",
          "type": "server-route",
          "layer": "server",
          "label": "Health route",
          "permissions": []
        }
      ],
      "permissions": []
    }
  },
  "devDependencies": {
    "@cradle/plugin-sdk": "workspace:*"
  }
}
```

**`plugins/hello/src/server.ts`**

```ts
import type { ServerPluginContext } from '@cradle/plugin-sdk/server'

export function activate(ctx: ServerPluginContext): void {
  ctx.routes.register<unknown, Record<string, string>, { name?: string }>({
    method: 'GET',
    path: '/greet',
    handler: ({ query }) => {
      const name = query.name ?? 'World'
      return { greeting: `Hello, ${name}!` }
    },
  })

  ctx.routes.register({
    method: 'GET',
    path: '/health',
    handler: () => ({ status: 'ok', timestamp: Date.now() }),
  })

  ctx.logger.info('Hello plugin ready')
}
```

**Test it:**

```bash
curl http://127.0.0.1:21423/api/plugins/hello/greet?name=Developer
# {"greeting":"Hello, Developer!"}
```

---

### Example 2: Full Server + Web Plugin (system-info pattern)

A plugin with an API route AND a sidebar panel.

**`plugins/my-monitor/package.json`**

```json
{
  "name": "@cradle/my-monitor",
  "type": "module",
  "version": "0.0.1",
  "private": true,
  "cradle": {
    "apiVersion": "1",
    "displayName": "System Monitor",
    "description": "Shows system metrics in a sidebar panel",
    "server": "src/server.ts",
    "web": "dist/web.mjs",
    "contributes": {
      "capabilities": [
        {
          "id": "route.metrics",
          "type": "server-route",
          "layer": "server",
          "label": "Metrics route",
          "permissions": []
        },
        {
          "id": "panel.monitor-panel",
          "type": "web-panel",
          "layer": "web",
          "label": "System Monitor panel",
          "permissions": []
        },
        {
          "id": "command.my-monitor.refresh",
          "type": "web-command",
          "layer": "web",
          "label": "Refresh System Metrics",
          "permissions": []
        }
      ],
      "permissions": []
    }
  },
  "scripts": {
    "build": "vite build"
  },
  "devDependencies": {
    "@cradle/plugin-sdk": "workspace:*",
    "@types/react": "^19.2.1",
    "@vitejs/plugin-react": "^5.1.1",
    "react": "^19.2.1",
    "vite": "^8.0.0"
  }
}
```

**`plugins/my-monitor/vite.config.ts`**

```ts
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    lib: {
      entry: { web: resolve(__dirname, 'src/web.tsx') },
      formats: ['es'],
      fileName: (_format, entryName) => `${entryName}.mjs`,
    },
    rollupOptions: {
      external: ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
    },
    target: 'esnext',
    minify: false,
    outDir: 'dist',
  },
})
```

**`plugins/my-monitor/src/server.ts`**

```ts
import { cpus, totalmem, freemem, hostname, uptime } from 'node:os'
import type { ServerPluginContext } from '@cradle/plugin-sdk/server'

export function activate(ctx: ServerPluginContext): void {
  ctx.routes.register({
    method: 'GET',
    path: '/metrics',
    handler: () => {
      const totalMem = totalmem()
      const freeMem = freemem()
      const memoryUsedGB = Math.round((totalMem - freeMem) / 1073741824 * 100) / 100
      const memoryTotalGB = Math.round(totalMem / 1073741824 * 100) / 100
      return {
        hostname: hostname(),
        cpuCores: cpus().length,
        memoryUsedGB,
        memoryTotalGB,
        uptimeHours: Math.round(uptime() / 3600 * 100) / 100,
      }
    },
  })

  ctx.logger.info('Monitor server activated')
}
```

**`plugins/my-monitor/src/web.tsx`**

```tsx
import { useState, useEffect } from 'react'
import type { WebPluginContext } from '@cradle/plugin-sdk/web'

interface Metrics {
  hostname: string
  cpuCores: number
  memoryUsedGB: number
  memoryTotalGB: number
  uptimeHours: number
}

function MonitorPanel({ isActive, routes }: { isActive: boolean; routes: WebPluginContext['routes'] }) {
  const [metrics, setMetrics] = useState<Metrics | null>(null)

  useEffect(() => {
    if (!isActive) return

    const load = () =>
      routes.fetch('/metrics')
        .then(r => r.json())
        .then(setMetrics)
        .catch(console.error)

    load()
    const interval = setInterval(load, 5000)
    return () => clearInterval(interval)
  }, [isActive])

  if (!metrics) return <div className="p-4 text-muted-foreground">Loading...</div>

  return (
    <div className="p-3 text-sm space-y-1">
      <div className="font-medium mb-2">System Monitor</div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">Host</span>
        <span>{metrics.hostname}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">CPU Cores</span>
        <span>{metrics.cpuCores}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">Memory</span>
        <span>{metrics.memoryUsedGB}/{metrics.memoryTotalGB} GB</span>
      </div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">Uptime</span>
        <span>{metrics.uptimeHours}h</span>
      </div>
    </div>
  )
}

export function activate(ctx: WebPluginContext): void {
  ctx.panels.register({
    id: 'monitor-panel',
    title: 'System Monitor',
    component: props => <MonitorPanel {...props} routes={ctx.routes} />,
    location: 'sidebar',
    order: 50,
  })

  ctx.commands.register({
    id: 'my-monitor.refresh',
    title: 'Refresh System Metrics',
    async execute() {
      const data = await ctx.routes.fetch('/metrics').then(r => r.json())
      ctx.logger.info('Current metrics:', data)
    },
  })
}
```

**Build and test:**

```bash
pnpm --filter @cradle/my-monitor build
pnpm dev:server
pnpm dev:web
# Panel appears in sidebar under "Extensions"
```

---

### Example 3: MCP + Skill Plugin (browser-use pattern)

A plugin that provides an MCP server and skill for agent use, with desktop integration.

**`plugins/my-tool/package.json`**

```json
{
  "name": "@cradle/my-tool",
  "type": "module",
  "version": "0.0.1",
  "private": true,
  "cradle": {
    "apiVersion": "1",
    "displayName": "My AI Tool",
    "description": "Provides tool X for AI agents",
    "server": "dist/server.mjs",
    "desktop": "dist/desktop.mjs",
    "deployments": ["desktop"],
    "contributes": {
      "capabilities": [
        {
          "id": "mcp.my-tool",
          "type": "mcp-server",
          "layer": "server",
          "label": "My Tool MCP server",
          "permissions": ["desktop.my-tool-socket"]
        },
        {
          "id": "skill.my-tool",
          "type": "skill",
          "layer": "server",
          "label": "My Tool skill",
          "permissions": []
        },
        {
          "id": "desktop.shared-config.my-tool-socket",
          "type": "desktop.sharedConfigEndpoint",
          "layer": "desktop",
          "label": "My Tool socket path",
          "permissions": ["desktop.my-tool-socket"]
        }
      ],
      "permissions": [
        {
          "id": "desktop.my-tool-socket",
          "label": "Share My Tool desktop socket with the server layer",
          "required": true
        }
      ]
    }
  },
  "scripts": {
    "build": "vite build"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.1"
  },
  "devDependencies": {
    "@cradle/plugin-sdk": "workspace:*",
    "@types/node": "^22.0.0",
    "vite": "^8.0.0"
  }
}
```

**`plugins/my-tool/vite.config.ts`**

```ts
import { resolve } from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    lib: {
      entry: {
        'mcp-server': resolve(__dirname, 'src/mcp-server.ts'),
        'server': resolve(__dirname, 'src/server.ts'),
        'desktop': resolve(__dirname, 'src/desktop.ts'),
      },
      formats: ['es'],
      fileName: (_format, entryName) => `${entryName}.mjs`,
    },
    rollupOptions: {
      external: [
        /^node:/,
        '@modelcontextprotocol/sdk/server/stdio.js',
        '@modelcontextprotocol/sdk/server/index.js',
        '@modelcontextprotocol/sdk/server/mcp.js',
        '@cradle/plugin-sdk/server',
        '@cradle/plugin-sdk/desktop',
      ],
    },
    target: 'node20',
    minify: false,
    outDir: 'dist',
  },
})
```

**`plugins/my-tool/src/desktop.ts`**

```ts
import { join } from 'node:path'
import type { DesktopPluginContext } from '@cradle/plugin-sdk/desktop'

export function activate(ctx: DesktopPluginContext): void {
  // Create a Unix socket path for IPC
  const socketPath = join(ctx.userDataPath, 'my-tool.sock')
  ctx.sharedConfig.set('MY_TOOL_SOCKET', socketPath)

  // Start background service, attach to webviews, etc.
  ctx.logger.info(`Desktop plugin ready, socket: ${socketPath}`)
}
```

**`plugins/my-tool/src/server.ts`**

```ts
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ServerPluginContext } from '@cradle/plugin-sdk/server'

const __dirname = dirname(fileURLToPath(import.meta.url))

export function activate(ctx: ServerPluginContext): void {
  const socketPath = ctx.sharedConfig.get('MY_TOOL_SOCKET')

  // Only register MCP server when socket is available (desktop mode)
  if (socketPath) {
    ctx.mcp.registerServer({
      transport: 'stdio',
      name: 'my-tool',
      command: 'node',
      args: [resolve(__dirname, 'mcp-server.mjs')],
      env: { MY_TOOL_SOCKET: socketPath },
    })
  }

  // Register skill for agent discovery
  ctx.skills.register({
    name: 'my-tool',
    description: 'Tool X for AI agents — use when user needs to do Y',
    skillFile: resolve(__dirname, 'SKILL.md'),
  })

  ctx.logger.info('My Tool server activated')
}
```

**`plugins/my-tool/SKILL.md`**

```markdown
# My Tool

Use this tool when the user needs to perform task Y.

## Capabilities
- Capability A
- Capability B

## Usage
Invoke via MCP tool call: `my-tool.action`
```

---

## 12. Validation & Error Handling

### Module Validation

The host validates plugin modules at load time. If validation fails, a `PluginLoadError` is thrown and the plugin is skipped (other plugins continue loading).

**Requirements:**
1. Module must be a non-null object
2. Must export `activate` as a function
3. If `deactivate` is exported, it must be a function

**Error messages:**

```
[plugin:@cradle/foo] server entry did not export a module object. Got: undefined
[plugin:@cradle/foo] server entry does not export 'activate' function. Got exports: [default, helper]
[plugin:@cradle/foo] server entry exports 'deactivate' but it's not a function (got string)
```

### Graceful Degradation

- If `plugins/` directory doesn't exist, discovery returns empty array — no error
- Individual plugin failures don't crash the system
- Web plugin loading uses `Promise.allSettled` — one failure doesn't block others
- Invalid `package.json` files are silently skipped

---

## npm release

The SDK is published to npm as **`@cradleapp/plugin-sdk`** via GitHub Actions (`.github/workflows/release-plugin-sdk.yml`) using [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) (OIDC — no long-lived tokens).

### One-time npm setup

On [npmjs.com](https://www.npmjs.com), open `@cradleapp/plugin-sdk` → **Trusted publishing** and add:

| Field | Value |
|-------|-------|
| Provider | GitHub Actions |
| Repository | `wibus-wee/cradle-app` |
| Workflow filename | `release-plugin-sdk.yml` |

Optionally set **Publishing access** to disallow traditional tokens once CI publish is verified.

Later releases use `/release-sdk` or git tags (see `.claude/skills/release-sdk/SKILL.md`).

### Release channels

| Channel | Git tag | npm dist-tag | npm version example |
|---------|---------|--------------|---------------------|
| dev | `sdk-dev-20260707.1` | `dev` | `0.0.0-dev.<run_number>` |
| release | `sdk-v0.2.1` | `latest` | `0.2.1` |

Install dev builds: `pnpm add -D @cradleapp/plugin-sdk@dev`

The monorepo keeps the workspace package name `@cradle/plugin-sdk`; CI rewrites the publish name to `@cradleapp/plugin-sdk` at release time.

---

## 13. File Reference

| File | Purpose |
|------|---------|
| `packages/plugin-sdk/package.json` | SDK package exports and local maintenance scripts, including the package-owned `typecheck` gate |
| `packages/plugin-sdk/tsconfig.json` | SDK typecheck/declaration compiler options for the exported context interfaces |
| `packages/plugin-sdk/src/index.ts` | Shared types (`PluginManifest`, `Logger`, `Disposable`) |
| `packages/plugin-sdk/src/server.ts` | Server plugin context interface |
| `packages/plugin-sdk/src/web.ts` | Web plugin context interface |
| `packages/plugin-sdk/src/desktop.ts` | Desktop plugin context interface |
| `packages/plugin-sdk/src/vite-plugin-import-map.ts` | Shared Vite import map + React wrapper modules for runtime-loaded web plugins |
| `apps/server/src/plugins/discovery.ts` | Plugin discovery (reads `plugins/*/package.json`) |
| `apps/server/src/plugins/loader.ts` | Server plugin activation orchestrator |
| `apps/server/src/plugins/validation.ts` | Module validation + `PluginLoadError` |
| `apps/server/src/plugins/context.ts` | Creates `ServerPluginContext` instances |
| `apps/server/src/plugins/static-server.ts` | Serves web bundles + plugin list API |
| `apps/server/src/plugins/event-bus.ts` | Global plugin event bus |
| `apps/web/src/lib/plugin-host.ts` | Browser-side plugin loader |
| `apps/web/src/lib/plugin-store.ts` | Zustand store for panels/commands |
| `apps/web/src/lib/vite-plugin-import-map.ts` | Compatibility re-export for the shared plugin import map |
| `apps/web/src/main.tsx` | Sets `window[Symbol.for('cradle:modules')]`, calls `loadWebPlugins()` |
| `apps/desktop/src/main/plugin-loader.ts` | Desktop plugin activation |
| `apps/desktop/src/main/plugin-discovery.ts` | Desktop-side plugin discovery |
| `plugins/system-info/` | Reference: server + web plugin |
| `plugins/browser-use/` | Reference: server + desktop + MCP plugin |
