# Server Plugin Host

这个目录负责 Cradle 的服务端插件宿主。服务端插件宿主读取插件包、建立 host-owned descriptor、激活 server entry，并把插件注册的 MCP、skill、hook 等能力投影成带 owner 的 capability record。

## 文件

- **context.ts**：创建传给 server plugin entry 的 `ServerPluginContext`，并记录 owner-scoped capability registration。
- **activation-policy.ts**：读写 Cradle-owned plugin activation policy。这个 policy 决定插件包是否被 host 激活，不属于 plugin-scoped KV storage。
- **discovery.ts**：从配置的插件目录读取 plugin package，返回有效 manifest 或无效 package diagnostics。
- **event-bus.ts**：提供 server plugin 使用的进程内 plugin event bus。
- **external-issue-source-registry.ts**：保存插件注册的 external issue source readers；插件只读取外部系统并返回标准 snapshot，Cradle host 负责 workspace 绑定、外部 issue 投影、Kanban 只读卡片和 status overlay。
- **external-provider-source-registry.ts**：保存插件注册的 external provider source readers；插件只提供标准 snapshot，Cradle host 负责 profile/secret 投影与固定 UI。
- **hooks.ts**：注册 chat lifecycle hooks，并投影插件拥有的 hook capability records。
- **index.ts**：导出 server plugin host API，供 server 其它模块使用。
- **install-receipt.ts**：读取 plugin package 内的 Marketplace install receipt，并投影为 descriptor source provenance。
- **loader.ts**：发现 plugin packages，构建 governed descriptors，尊重 desktop fork 传入的 primary plugin source kind，按 activation policy 激活或禁用 plugin layers，并把 `/api/plugins/:routeSegment` 请求交给 host-owned route dispatcher。
- **loader.test.ts**：覆盖 server plugin activation 后由 `deactivateAllPlugins()` 清理 owner-scoped registrations 和 capability records，也覆盖 host activation hot disable / re-enable，以及 plugin skill native projection cleanup。
- **mcp-registry.ts**：保存 stdio 和 streamable HTTP MCP server registrations，并投影 owner-scoped MCP capability records；HTTP headers 只保留在 runtime config 中，不写入公开 capability metadata。
- **runtime-registry.ts**：维护 host-owned plugin descriptors、source descriptors、layer lifecycle states、route ownership 和 capability records。
- **runtime-registry.test.ts**：覆盖 identity、route collision、source classification 和 capability id 行为的 focused tests。
- **route-registry.ts**：保存 plugin-owned HTTP route handlers，并由 host dispatcher 在请求时按 route segment、method 和 path 分发。禁用插件时清除这里的 owner-scoped routes。
- **skill-registry.ts**：保存 plugin skill registrations，投影 owner-scoped skill capability records，并通知 Skills module 刷新 runtime native skill projections。
- **static-server.ts**：提供 governed `/api/plugins` descriptor list、validated web plugin bundles、生产 web bundle 共享 React import rewrite，以及 `/api/plugins/-/deps/*` renderer shared-module wrapper。
- **storage.ts**：提供 plugin-scoped server KV storage；使用 Cradle DB 的 `plugin_storage_entries` 表，按 plugin package identity 和 key 隔离。
- **storage.test.ts**：覆盖 plugin storage 的持久化、同 key owner 隔离和删除语义。
- **validation.ts**：验证 plugin module exports，并报告结构化 plugin load errors。

## Host activation policy

Plugin activation is Cradle host-owned lifecycle state. It answers whether a plugin package should be active at all. The policy is persisted in `plugin_activation_policies` and projected into `PluginDescriptor.activation`.

This is intentionally separate from plugin-owned settings. For example, Nowledge Mem may keep an internal `enabled` setting in its own namespace, but that setting only controls Nowledge Mem behavior after Cradle has activated the package. The host activation policy controls whether Cradle imports the server entry, serves the web bundle, exposes plugin routes, and keeps runtime registrations such as MCP servers, skills, hooks, provider sources, and issue sources.

Disabling a plugin through `disablePlugin()` writes the policy, calls the plugin `deactivate()` hook when present, disposes tracked subscriptions, clears dispatcher routes, removes runtime capabilities, and leaves the descriptor visible with disabled layers so management APIs can re-enable it. Re-enabling through `enablePlugin()` writes the policy back to enabled, retries server activation, and serves the web bundle again when the layer is valid.

## Plugin skill projection

`ctx.skills.register(...)` remains the server plugin API for contributing agent skills. Register the skill `name` as the invocable id agents will call (Claude leaf scanners key off directory basename). Prefer `cradle-plugin-{name}` so inventory, `/skill` invoke, and on-disk basename match without projection stacking prefixes.

The plugin host stores each registration with its plugin owner, records a public `skill` capability, and asks the Skills module to reconcile known runtime-native skill roots. When an agent-scoped runtime home exists, the Skills module projects the full skill package directory into `~/.cradle/agents/{agentId}/skills/{skillName}` (flat). The existing `.agents/skills` and `.claude/skills` links inside the agent home make that projection visible to native runtime scanners without copying files or writing marker files. When Codex or Claude starts without an agent id, provider-specific global native roots are known only if the app feature flag `nativeProviderSkillProjection` is enabled. With the flag enabled, plugin skills are projected to `~/.codex/skills/cradle/{skillName}` (nested) and `~/.claude/skills/{skillName}` (flat).

Plugin disable and `deactivateAllPlugins()` dispose the skill registration through `ctx.subscriptions`, which removes the capability record and reconciles native projections so disabled plugin skills disappear from known runtime skill roots. Cradle-owned builtin skill projections remain because they are not owned by the plugin lifecycle. Re-enabling the plugin recreates the registration and restores the plugin projection.
