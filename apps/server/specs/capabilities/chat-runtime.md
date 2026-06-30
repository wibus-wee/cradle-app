# Capability: Chat Runtime

## User / System Goal

- 系统需要在已有 session 上发起 chat run，流式广播 AI SDK `UIMessageChunk` SSE，并支持中止。
- `messages.messageJson` 是 chat hydration 的唯一真相源；`messages.content` 只是派生纯文本缓存，绝不能反向重建 UIMessage。
- server 必须成为 chat write-side owner：负责 `messages`、`backend_runs`、`usage_logs` 的一致写入。
- chat runtime 当前支持 `openai-compatible`、ACP Chat、Claude Agent、Codex、System Agent (`jar-core`) 以及调试/测试用 mock runtime，并统一收敛到 AI SDK `UIMessageChunk` provider boundary。

## Current Capability Contract

- `POST /chat/sessions/:sessionId/response` 会创建 user/assistant message rows，并返回 AI SDK `UIMessageChunk` SSE stream。
- `GET /chat/sessions/:sessionId/messages` 返回按 `createdAt` 排序的全部 message snapshot rows；若 `messageJson` 非法，接口返回结构化 `chat_message_snapshot_invalid` 错误。
- `POST /chat/sessions/:sessionId/cancel` 会中止当前 active run，并将 assistant / backend run 收口为 `aborted`。
- stream 事件协议只暴露 AI SDK `UIMessageChunk` JSON frames，例如 `start`、`text-start`、`text-delta`、`tool-input-available`、`tool-approval-request`、`tool-output-available`、`finish`、`abort`、`error`。不再暴露 Cradle-owned delta events。

## Target API

- `POST /chat/sessions/:sessionId/response` → 在已有 session 上发起一次 turn 并直接返回 AI SDK `UIMessageChunk` SSE stream
- `GET /chat/sessions/:sessionId/messages` → 返回 message snapshot hydration 结果（直接读取 `messageJson`）
- `POST /chat/sessions/:sessionId/cancel` → 中止当前 session 的 active run

## Stream Protocol Contract

- SSE frame data 必须是 AI SDK `UIMessageChunk` JSON object，不能包成 Cradle-owned wrapper event。
- terminal frame 之后发送 `data: [DONE]` 作为 stream close marker。
- Subagent progress 必须作为 parent tool part 的 AI SDK preliminary `tool-output-available` output 展示，不能使用 client-side `parentToolCallId` delta routing。
- Native tool approval 必须使用 AI SDK `tool-approval-request` chunk 和 message-history continuation，不得使用独立 approval SSE。
- 坏 snapshot 不允许回退到 `content` 重建，必须在 hydration 边界 fail fast。

## Target Module Design

- `ChatRuntimeModule`
  - `chat-runtime/index.ts`: Elysia route surface
  - `ChatRuntimeModel`: HTTP 参数校验与 body schema
  - `ChatRuntimeService`: run orchestration、active run registry、abort
  - `ChatTurnContext`: history + system prompt assembly
  - `ChatRuntimeProviderRegistry`: runtime provider owner
  - `OpenAICompatibleChatProvider` / `AcpChatProvider` / `ClaudeAgentProvider` / `CodexProvider` / `SystemAgentProvider` / mock runtime variants

## Test Plan

- 成功 run 会写入 user/assistant message snapshot、usage，并可被搜索读到。
- abort 会把 assistant message / backend run 收口为 `aborted`。
- 缺失 session、缺失 text、缺失 run 返回结构化错误。
- 直接消费 SSE stream，断言 frame 是 AI SDK `UIMessageChunk`，包含 `finish` 和 `[DONE]`，且不包含 Cradle delta event wrapper。
- subagent progress 通过 parent tool output 的 `preliminary: true` 表达。
- hydration 对非法 `messageJson` 返回结构化 `chat_message_snapshot_invalid`，而不是使用 `content` 兜底。
