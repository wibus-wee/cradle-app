<!-- Once this directory changes, update this README.md -->

# src/main/db/schema

数据库 schema 按上下文拆分在这里，避免所有表长期堆在一个文件里。
`index.ts` 是唯一 canonical export surface，外部仍通过 `src/main/db/schema` 导入。
新增表时先判断 owner context，再落到对应模块，而不是回到单体 schema。

## Files

- **backend-control-plane.ts**: backend binding、run、run snapshot/event 与 session-start capability snapshot 相关表；`backend_runs` 是 Chat Runtime run 查询状态，`messages.message_json` 是 Chat message hydration 真相源，`chat_session_queue_items` 是 durable queue 状态；binding 只保留 Cradle-owned backend snapshot + requested model，run snapshot/event 表承载 Cradle-owned harness envelope 与 ordered forensic event stream，不复制 provider-owned goal/plan/tool 语义；snapshot/event 使用毫秒时间并在 session/run 删除后保留取证记录，只将对应 FK 置空
- **automation.ts**: Agent-authored automation definition、run、artifact 与 event 相关表；只写 automation namespace，通过 ID 引用 normal chat session/backend run
- **assets.ts**: Cradle-owned reusable asset metadata 表；文件字节落在 server data directory 下的 `assets/` namespace，业务模块只保存 asset id / `cradle-asset://` 引用，不拥有压缩或文件生命周期
- **index.ts**: Schema barrel，聚合导出所有 context-specific schema 模块
- **shared.ts**: 共享列片段与 `workspaces` 表；workspace records own project pin state for app sidebar ordering
- **identity.ts**: Agent identity / credential 相关表；agent thinking effort 只持久化真实 provider 档位：`none`、`minimal`、`low`、`medium`、`high`、`xhigh`、`max`
- **chat.ts**: Product session、message、usage log、Chat Session continuation queue 相关表；`sessions.archived_at` 是 Session-owned 软归档状态，`sessions.parent_session_id` 与 `sessions.side_context_source` 保存 Chat Runtime-owned side session 关系，默认列表隐藏 archived rows 但不删除 messages/usage/runtime history；`messages.message_json` 是 chat hydration 真相源，`messages.content` 是派生纯文本 cache，`chat_session_queue_items` 由 Chat Runtime 拥有，只用于持久化 durable `queue` follow-up、chat-owned context parts、concrete thinking effort，以及 Cradle-owned runtime access / interaction mode 快照；`run_stream_checkpoints` 是 ephemeral streaming checkpoint 状态（非 domain fact），按 run 覆盖写入，crash recovery 时提升为 `AssistantMessageCompleted`，terminal / session delete 时显式清理；`session_events.version` 单调递增但不保证连续
- **chronicle.ts**: Chronicle 本地活动记忆相关表，包含 screen snapshot、accessibility evidence/event history、activity session/segment/pipeline run、knowledge card/version/source、dream run/candidate、raw audio segment、audio transcript、speaker profile、memory、memory chunk/keyword/embedding index、model resource status 与 event
- **external-sources.ts**: Plugin-provided external provider source、source record 与 external runtime target 表；Cradle 只写自己的 external-source namespace，不写外部产品 namespace，也不再把外部记录投影进 manual profile 表
- **handoff.ts**: Agent-to-Agent handoff proposal lifecycle 表；只拥有交接 proposal/status/result，通过 ID 引用 chat session 和 agent identity
- **runtime.ts**: Runtime audit 相关表
- **acp.ts**: ACP agent 与 ACP audit 相关表
- **issue.ts**: Workspace-scoped Issue、状态、里程碑、due date、评论、source chat session provenance、field-change audit history、关联相关表；当前 SQLite 物理表名仍沿用 `kanban_*`
- **kanban.ts**: Kanban board/view configuration 相关表
- **model-registry.ts**: 全局 model registry mappings 表，保存 Cradle-owned provider model ID 到 models.dev/manual registry entry 的映射，供所有 provider target 与 custom model enrichment 共享
- **agent-interaction.ts**: Agent Interaction Runtime session / activity 相关表；物理表名为 `agent_sessions` 与 `agent_activities`，由交互运行时拥有，Issue Agent 只通过服务层引用
- **observability.ts**: local observability append-only events 与 dedupe incident 相关表；session/run/message 删除后保留取证记录并将 FK 置空
- **plugin.ts**: Cradle plugin host 拥有的 plugin-scoped persistent storage 表；按 plugin package identity 和 key 隔离，不写入其他产品 namespace
- **session-await.ts**: Session Await durable wait 表、host-owned GitHub API cache 与 bypass rules；await records 保存恢复文本、source/delivery failure 分类、GitHub filter JSON、timer/fire/expiry 时间和 bypass check 投影
