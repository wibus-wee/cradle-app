# Cradle Server — Capability Specifications

This directory contains the capability specifications for the Cradle Server migration.

Each capability is documented in its own file following the per-capability reconstruction workflow defined in the migration plan.

## Structure

- `index.md` — Capability list (this file)
- `legacy-service-inventory.md` — Old Service evidence list
- `<capability-name>.md` — Individual capability specifications

## Status Key

- 🔍 Investigating
- 📝 SPEC Written
- 🚧 Implementing
- ✅ Complete
- ⏸️ Deferred

## Capability List

### Tier 1 — Foundation (must be completed first)

| # | Capability | Status | Description |
|---|-----------|--------|-------------|
| 0 | health | ✅ | HTTP health check endpoint |
| 1 | database | ✅ | SQLite database lifecycle, migrations, typed access |
| 2 | workspace | ✅ | Workspace CRUD, file listing, path resolution |
| 3 | session | ✅ | Chat sessions CRUD, message history |
| 4 | agent-identity | ✅ | Agent persona definitions CRUD |

### Tier 2 — Core Product Value

| # | Capability | Status | Description |
|---|-----------|--------|-------------|
| 5 | chat-runtime | ✅ | Send messages, stream responses, abort turns |
| 6 | profiles | ✅ | Saved runtime profile CRUD and lifecycle cleanup |
| 7 | secrets | ✅ | Server-owned encrypted secret storage |
| 8 | providers | ✅ | Provider health check and model metadata |
| 9 | kanban | ✅ | Boards, statuses, issue core loop, comments |
| 10 | search | ✅ | Full-text thread search (FTS5 + jieba) |
| 11 | usage-tracking | ✅ | Token usage logs, daily/summary aggregation |

### Tier 3 — Extended Capabilities

| # | Capability | Status | Description |
|---|-----------|--------|-------------|
| 12 | skills | ✅ | Skill catalog CRUD, import/export, source fetching |
| 13 | workflow-rules | ✅ | Workflow rules read/write by scope |
| 14 | issue-agent | ✅ | Issue delegation, agent sessions, activities, rerun |
| 15 | agent-interaction-runtime | ✅ | Agent session lifecycle and append-only activity records |
| 16 | git | ✅ | Workspace-owned status, branches, graph, checkout, fetch |
| 17 | pty | ✅ | Session-owned cli-tui terminal runtime, stream, input, cleanup |

### Tier 4 — Advanced / Deferred

| # | Capability | Status | Description |
|---|-----------|--------|-------------|
| 18 | acp | ✅ | ACP registry, install lifecycle, installed-agent inventory, and audit queries |
| 19 | observability | ✅ | Telemetry recording, incident rules |
| 20 | preferences | ✅ | User preferences store |
| 21 | cursor-agent | 📝 | Cursor Agent runtime, checkpoints, queue/immediate messaging, tools, MCP, CLI/headless, and background-agent feature model |
