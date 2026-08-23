<!-- Once this directory changes, update this README.md -->

# E2E Feature Inventory

This directory owns the executable user-journey inventory. The broader module and state-combination audit lives in [`../../COVERAGE.md`](../../COVERAGE.md). Retired scenarios live in `e2e/_archive/features/` and are not part of the active suite.

The active suite contains 62 scenarios: 20 `@P0` smoke journeys and 42 `@P1` deeper journeys. Every scenario is tagged `@essence`, one priority, and one stable `@CRADLE-*` ID.

| Feature | Stable IDs | Journey boundary |
| --- | --- | --- |
| `agent-identity.feature` | `CRADLE-AGENT-ID-001` | Agent identity create and delete |
| `await.feature` | `CRADLE-AWAIT-001` | Persistent JavaScript Await resumed by an external event |
| `chat.feature` | `CRADLE-CHAT-001`–`007`, `009`–`013` | Claude multi-turn, stop, failure recovery, reload, queue management, reasoning, session lifecycle, parallel tool blocks with incremental tool input, redacted thinking, and mid-stream disconnect recovery |
| `claude-agent.feature` | `CRADLE-AGENT-001`, `002`, `004` | Real Claude Agent approval allow/deny and Read tool loop |
| `claude-agent-tools.feature` | `CRADLE-AGENT-005`–`009` | Tool matrix over canonical kinds: TodoWrite, TaskCreate, WebFetch, MCP naming convention, and generic ScheduleWakeup |
| `codex.feature` | `CRADLE-CODEX-001`–`004` | Real Codex app-server single/multi-turn, rollback, and `btw` |
| `codex-tools.feature` | `CRADLE-CODEX-005`–`008` | Real Codex local tool execution: shell command round-trip, `update_plan` execution with result crossing back, apply_patch file change, and sandbox-escape approval |
| `composer.feature` | `CRADLE-COMP-003` | Bang command execution and persisted output |
| `context.feature` | `CRADLE-CONTEXT-001` | `@mention` filesystem context carried into the provider request |
| `diff.feature` | `CRADLE-DIFF-001` | Real uncommitted diff review and external refresh |
| `first-run.feature` | `CRADLE-FIRST-RUN-001` | Clean-install onboarding through first Claude reply |
| `git.feature` | `CRADLE-GIT-001`, `002` | Header branch state, picker, create, and switch |
| `issue-agent.feature` | `CRADLE-ISSUE-AGENT-001`–`004` | Delegation completion/rerun, active-run cancellation, isolated Work, and retained cancellation audit state |
| `provider.feature` | `CRADLE-PROVIDER-001`–`003` | Anthropic profile create, use, disable, and delete, including active-run cancellation and queued continuation removal |
| `search.feature` | `CRADLE-SEARCH-001`, `003` | Session result navigation and command execution |
| `settings.feature` | `CRADLE-SETTINGS-001` | Theme mutation and reload persistence |
| `stream-vocabulary.feature` | `CRADLE-CHAT-011`–`013` | Stream wire vocabulary: parallel tool_use blocks, chunked tool input, redacted thinking + ping, mid-stream disconnect |
| `tabs.feature` | `CRADLE-TAB-001` | Two live chats switch, reload, and close without content bleed |
| `terminal.feature` | `CRADLE-PTY-001`, `002` | Workspace PTY and multi-session input routing |
| `usage.feature` | `CRADLE-USAGE-001` | Exact usage aggregation after a real Agent run |
| `work.feature` | `CRADLE-WORK-001`–`003`, `CRADLE-WS-004`–`005` | Isolated Work, managed worktree, provider failure/stop recovery, real file mutation, persisted primary thread, and destructive Workspace cleanup |
| `workspace-kanban.feature` | `CRADLE-WS-001`–`003`, `CRADLE-KANBAN-001`–`003`, `CRADLE-CHAT-008` | Workspace directory flow, overview, lifecycle, board, issue, and search |

## Tags

- `@essence`: the curated active suite.
- `@P0`: release-blocking smoke journey with high fan-out or destructive state risk.
- `@P1`: deeper state branch in the active suite.
- `@first-run`: scenario starts without setup persistence.
- `@CRADLE-*`: stable scenario identity used by reports and focused runs.

Feature prose describes observable user behavior. Provider scripts, exact request matching, temporary repositories, and other deterministic setup belong in support helpers rather than in Gherkin.

## Dedicated process suites

| Suite | Stable IDs | Journey boundary | Command |
| --- | --- | --- | --- |
| [`fabric-two-node.spec.ts`](../fabric/fabric-two-node.spec.ts) | `CRADLE-FABRIC-001` | Real relayd, two independent Cradle Server databases, UI pairing, bidirectional Workspace, Chat, Node-owned Work/worktree routing, remote tool approval and continuation in both directions, cross-controller Session discovery, and reconnect recovery | `pnpm e2e:fabric` |

Fabric uses a dedicated Playwright configuration because its acceptance
boundary requires three long-lived backend processes and two browser contexts.
It runs as a separate PR job rather than changing the Cucumber scenario count
or priority tags above.
