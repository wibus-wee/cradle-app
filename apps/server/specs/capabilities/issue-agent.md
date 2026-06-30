# Capability: Issue Agent

## User / System Goal

- 用户可以把某个 issue 委派给一个 agent profile，并看到该委派对应的 agent session 与 activity timeline。
- issue-agent 负责 issue delegation owner 语义；agent session / activity 由 agent-interaction-runtime 拥有；chat runtime 继续负责 chat session、timeline、usage 的执行与持久化。
- 第一阶段只交付 HTTP-first 最小闭环：delegate、list sessions、list activities、rerun、undelegate、读取当前 delegation state。

## Current Behavior Evidence

- 旧 main 层存在 `issue-delegation`、`issue-agent-runner`、`issue-agent-query` 三块分离的写侧 / 运行时 / 读侧原型。
- renderer 当前真实产品路径主要依赖：委派、查看最新 agent session 状态、查看 activity、重新运行、打开关联 chat。
- E2E 用户价值集中在：委派完成、取消委派、重新运行生成新的聊天会话。

## Target API (Slice 1)

- `GET /issues/:issueId/delegation`
- `POST /issues/:issueId/delegation`
- `DELETE /issues/:issueId/delegation`
- `GET /issues/:issueId/agent-sessions`
- `GET /issue-agent-sessions/:agentSessionId/activities` (current UI/CLI path; implemented through Agent Interaction Runtime)
- `POST /issue-agent-sessions/:agentSessionId/rerun`

## Target Module Design

- `IssueAgentModule`
  - `IssueAgentController`: HTTP 参数校验
  - `IssueAgentService`: delegation 语义、rerun/undelegate 边界、后台 watcher 编排
- `AgentInteractionRuntimeModule`
  - owns DB-backed agent session/activity writes and generic session/activity reads
- Delegation state is exposed through Issue-owned route paths while issue-agent owns delegation semantics and Agent Interaction Runtime owns session/activity semantics.
- 不复制 chat runtime provider 逻辑；统一调用既有 `Session` + `ChatRuntimeService`。

## Test Plan

- delegate 会创建 agent session、触发 chat run、产生活动，并可打开关联 chat 看到 assistant 输出。
- rerun 会复用同一 agent session 语义，但生成新的 chat session 并完成一次新的运行。
- undelegate 会清空当前 delegation state，并留下 `Delegation removed` activity。
- 缺失 issue / profile / session 与非法输入返回结构化错误。
