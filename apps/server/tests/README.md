# Server Tests

Profile/provider integration suites now exercise typed `config` objects at HTTP boundaries instead of opaque `configJson` strings, keeping the test surface aligned with OpenAPI-facing request schemas.

## Files

- **config.test.ts**: server config parsing and validation.
- **provider-base.test.ts**: provider config parser defaults, including Codex app-server permission fallbacks.
- **agent-runtime-config.test.ts**: runtime config JSON helper preservation for cli-tui launch and Codex session bindings.
- **elysia-skeleton.test.ts**: parallel Elysia migration coverage for `/health`, `/preferences/chat`, structured validation normalization, `/openapi.json`, and `/docs/openapi.json` compatibility.
- **request-id.test.ts**: request-id middleware behavior.
- **openapi.test.ts**: generated OpenAPI JSON exposure, Scalar docs UI route, DTO-backed request schema coverage, and `ApiDoc.responses` response-schema coverage.
- **exception-filter.test.ts**: AppError normalization.
- **database.test.ts**: database lifecycle migrations.
- **health.test.ts**: health endpoint response.
- **workspace.test.ts**: workspace capability CRUD + file IO，包含 non-Cradle-owned workspace write confirmation 与 owner-boundary response metadata。
- **session.test.ts**: session capability CRUD + messages + markdown export.
- **session-await.test.ts**: session await/resume lifecycle, pending states, and resume semantics.
- **session-await-github.test.ts**: GitHub session-await source behavior for check runs, legacy commit statuses, no-signal grace, and PR review modes.
- **chat-runtime.test.ts**: chat run execution, strict AI SDK `UIMessage` snapshot hydration, AI SDK `UIMessageChunk` SSE sequencing, usage writes, active abort flow, and persisted streaming cleanup when an in-memory active run is missing.
- **src/modules/chat-runtime-providers/codex/provider.test.ts**: Codex app-server provider streaming, thread resume, and live `turn/steer` behavior.
- **kanban.test.ts**: Kanban board shell plus Issue-owned status, status-name movement, default status assignment, issue, ID generation, issue search, and comment core loops.
- **system-agent-provider.test.ts**: Jarvis `jar-core` provider integration, including Cradle chat/workspace environment injection for shell commands.
- **issue-agent.test.ts**: issue delegation, activity timeline, rerun, undelegation, and Chat Runtime continuation bridge coverage for queued follow-ups and unsupported live steer rejection.
- **git.test.ts**: workspace-owned git status, branches, commit graph, checkout, and create-branch flows against real local repositories.
- **observability.test.ts**: observability event persistence, incident rules, empty-output failure semantics, and bundle export.
- **preferences.test.ts**: server-owned chat preference defaults、approval mode、JSON persistence 和 invalid payload handling。
- **fetch-retry.test.ts**: retry/backoff helpers for outbound HTTP integrations.
- **pty.test.ts**: session-owned cli-tui terminal runtime, terminal resource snapshots, HTTP control routes, and cleanup.
- **pty-websocket.test.ts**: PTY WebSocket live channel, reconnect, delete-session teardown, and cli-tui session ownership semantics.
- **codex-session-capture.test.ts**: Codex CLI JSONL metadata capture rules for cli-tui resume bindings.
- **chronicle.test.ts**: Chronicle DB-backed snapshot/accessibility/memory ingest, source deduplication, snapshot frame serving, local model resource status, memory search, audio evidence contracts, Slack ingest, activity pipeline tick progression, and summarize error event persistence.
- **chronicle-daemon-manager.test.ts**: Chronicle Rust daemon launch argument construction for opt-in microphone segment capture.
- **agent.test.ts**: agent identity capability CRUD + filters + avatar URL policy + local Claude/Codex import idempotence, including disabled external provider import mapping.
- **workflow-rules.test.ts**: workflow-rules HTTP CRUD + filesystem ownership.
- **profiles.test.ts**: profile CRUD, secret masking, provider metadata endpoints, and Available Model registry mapping persistence.
- **external-provider-sources.test.ts**: host-owned external provider source refresh, record/profile projection, secret storage, missing-record handling, Cradle-owned provider enabled state, and source error persistence.
- **cc-switch-plugin.test.ts**: CC Switch plugin discovery through the host plugin loader, permission grant setup, and fake provider projection into external provider profiles.
- **sdk-providers.test.ts**: unified Claude Agent / Codex metadata probing, model listing, `/chat` execution flows, and Claude Agent subagent preliminary tool output contracts.
- **acp.test.ts**: ACP registry browsing, install lifecycle, installed-agent inventory, and audit queries.
- **acp-chat-runtime.test.ts**: unified ACP chat execution, fail-closed ACP permission behavior after legacy approval SSE removal, session-title sync, and usage persistence.
- **skills.test.ts**: skills inventory, CRUD, import/export, and fetch-source flows across scopes.
- **usage.test.ts**: usage analytics daily totals, summary with matched agent profile names, streak stats, and per-session totals.
- **search.test.ts**: thread search over titles, user content, and assistant plain-text cache derived from `messages.content`, plus read-only Chronicle memory and knowledge search with workspace scoping.
- **test-reset.test.ts**: test-only reset route cleanup boundaries, including isolated HOME skills safety.
