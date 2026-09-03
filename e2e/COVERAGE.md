# E2E Journey and State Coverage

This document is the audit map for Cradle's active E2E suite. Executable scenario ownership remains in [`src/features/README.md`](src/features/README.md); this file owns module disposition, cross-module relationships, state-fusion coverage, and the prioritized gap backlog.

## Coverage Summary

| Layer | Directly asserted | Traversed indirectly | User-visible gap | Service/infra contract |
| --- | ---: | ---: | ---: | ---: |
| Web feature namespaces | 23 | 12 | 14 | 1 |
| Server module namespaces | 33 | 15 | 18 | 7 |

These counts classify ownership, not line coverage. A namespace is “direct” only when an active scenario asserts behavior owned by it. “Indirect” means the real module participates in a journey without a domain-specific assertion. “Gap” means it owns user-visible behavior with no active journey. “Contract” means browser E2E is not the primary verification layer.

## System Journey Graph

```text
Onboarding ──> Profiles / Provider Targets ──> Agent Identity / Runtime
     │                         │                         │
     └──> Workspace ──> New Chat ──> Session ──> Run / Message / Queue
              │             │             │          ├── Approval / Tool
              │             │             │          ├── Await / Continue
              │             │             │          └── Usage / Activity
              │             │             └── Tabs / Search / Export
              │             ├── Context / Filesystem
              │             └── Git / Diff / PTY
              ├── Kanban / Issue ──> Delegation ──> Agent Session ──> Chat
              │                                      └── isolated ──> Work
              └── New Work ──> Worktree ──> Primary Thread ──> Delivery / PR
```

The highest-risk joins are lifecycle joins: a provider request may outlive a view, a queue item may outlive a run, an Issue delegation may be rebound to another Chat, and an isolated Work owns both Git state and a primary Session. Reload and cancellation tests must therefore assert every user-visible projection of the same state, not only the initiating control.

## State-Fusion Matrix

| State combination | Active scenario | What is proved |
| --- | --- | --- |
| Clean install × provider setup × workspace × first run | `CRADLE-FIRST-RUN-001` | Setup persistence reaches a real Claude reply |
| Claude runtime × multi-turn context | `CRADLE-CHAT-001` | Context survives the first completed run |
| Streaming × stop × next run × reload | `CRADLE-CHAT-002` | Abort returns Chat, sidebar, and composer to idle and allows recovery |
| Provider failure × retry × reload | `CRADLE-CHAT-003` | Error state does not poison the next persisted turn |
| Streaming × reload × eventual completion | `CRADLE-CHAT-004` | In-flight state rehydrates to the final message |
| Streaming × queue × reload × auto-drain × title generation | `CRADLE-CHAT-009` | A queued continuation persists and executes after the exact parent run |
| Active stream × durable queue × Server process crash × startup recovery | `CRADLE-CHAT-014` | The interrupted run no longer blocks admission, then startup schedules and completes the persisted continuation without a client nudge; event-sourcing parity tests own the exact `response.interrupted` fact |
| Streaming × multiple queue items × edit × reorder × cancel × reload | `CRADLE-CHAT-010` | Final durable queue order is the only order executed |
| Approval pending × reload × allow/deny | `CRADLE-AGENT-001`, `002` | Pending permission state rehydrates and both decisions control the real runtime continuation |
| Claude runtime × Read tool × tool result × final reply | `CRADLE-AGENT-004` | The simulator drives a real Claude Agent tool loop rather than replacing the runtime |
| Claude runtime × parallel tool_use blocks × incremental tool input | `CRADLE-CHAT-011` | Concurrent content blocks project as separate tool calls; chunked `input_json_delta` reassembles |
| Claude runtime × redacted thinking × SSE ping | `CRADLE-CHAT-012` | Opaque encrypted thinking blocks do not block answer projection |
| Streaming transport failure (mid-stream disconnect) × retry | `CRADLE-CHAT-013` | A cut SSE stream never persists a partial answer and the next turn recovers |
| Claude runtime × TodoWrite / TaskCreate / WebFetch / MCP naming / generic tools | `CRADLE-AGENT-005`–`009` | Each canonical tool kind completes a real execution and input-projection loop |
| Codex × real shell execution (`exec_command`) × terminal tool UI | `CRADLE-CODEX-005` | The app-server runs the command locally and the output crosses back through the model continuation |
| Codex × update_plan execution round-trip | `CRADLE-CODEX-006` | The plan handler executes and its result crosses back through the model continuation; plan-item UI projection stays a backlog item |
| Codex × apply_patch file change × file-diff UI | `CRADLE-CODEX-007` | In-workspace patches execute under sandbox and project file-change tool state |
| Codex × sandbox escape × real approval round-trip | `CRADLE-CODEX-008` | With Approval-required access mode, an out-of-workspace command requests approval, and Allow resumes the same turn |
| Codex runtime × real app-server × model simulator | `CRADLE-CODEX-001` | A native Codex turn reaches the strict OpenAI Responses simulator and projects its reply |
| Codex × rollback branch / transient `btw` × reload × next main turn | `CRADLE-CODEX-002`, `CRADLE-CODEX-003`, `CRADLE-CODEX-004` | Persistent history branches correctly; transient questions disappear on reload and never enter the next main-thread model request |
| Codex active turn × independent title provider × regenerate | `CRADLE-CODEX-009` | Title traffic uses its configured provider host without starving or consuming the active main turn |
| Filesystem context × provider request | `CRADLE-CONTEXT-001` | Selected `AGENTS.md` content crosses the UI/runtime boundary |
| Two live sessions × tabs × reload × close | `CRADLE-TAB-001` | Active content and session identity do not bleed across tabs |
| Issue × delegation × Agent Session × reload × rerun × new Chat | `CRADLE-ISSUE-AGENT-001` | Delegation state persists and rerun attaches its own completed Chat |
| Issue × active Run × reload × undelegate × abort | `CRADLE-ISSUE-AGENT-002` | Cancellation removes delegation and prevents a gated reply from persisting |
| Issue × isolated delegation × Work × worktree × linked Chat | `CRADLE-ISSUE-AGENT-003` | The Issue-owned action creates a Work-owned isolated execution without losing linkage |
| Issue × active isolated Work × reload × undelegate × abort | `CRADLE-ISSUE-AGENT-004` | Cancellation stops runtime work while retaining the Work and worktree as explicit audit state |
| Work × Git × worktree × file mutation × Session | `CRADLE-WORK-001` | Isolated execution uses a managed worktree and persistent primary thread |
| Work × provider failure × reload × retry × worktree × Session | `CRADLE-WORK-002` | A failed initial run retains exactly one isolated Work primary thread; reload and retry recover in that same session and mutate its worktree |
| Work × stop × reload × retry × worktree × Session | `CRADLE-WORK-003` | Stopping an active initial run returns the Work UI to idle without duplicating its isolated primary thread; reload and retry recover in that same session and mutate its worktree |
| Workspace removal × Work primary Session × live PTY × managed worktree × reload | `CRADLE-WS-004` | Destructive Workspace removal explicitly releases Session-owned runtime/PTY resources, removes Work and managed checkout state, and leaves no stale server or filesystem projection |
| Workspace removal × active Work run × runtime cancellation × delayed provider response × reload | `CRADLE-WS-005` | Destructive Workspace removal cancels the active Work run before Session disposal, so a delayed provider response cannot recreate deleted state |
| Source Workspace × Issue/Kanban/Automation × dry-run preview × target Workspace × reload | `CRADLE-WS-006` | The UI previews exact cross-owner counts before atomically moving all three entity types; Issue and Automation target ownership and the migrated board contents persist |
| Automation × real Agent run × triage × artifact × linked Session × reload | `CRADLE-AUTO-001` | A manual Automation run completes through Claude Agent, creates one reviewable result and transcript artifact, leaves triage after resolution, and retains the same linked Session and output after reload |
| Git branch × external file changes × diff refresh | `CRADLE-GIT-001`, `002`, `CRADLE-DIFF-001` | Repository projections refresh from real Git/filesystem state |
| Await pending × external event × Agent continuation | `CRADLE-AWAIT-001` | Durable pending work resumes from an external signal |
| Await cancel/expiry × Server crash × late external resolution × next Agent turn | `CRADLE-AWAIT-002` | Both terminal states persist across process recovery, reject late delivery without transcript pollution, and leave the Session usable |
| Multiple PTYs × active-session input routing | `CRADLE-PTY-002` | Input reaches only the selected terminal session |
| Completed Agent run × usage aggregation × selected range × CSV export × reload | `CRADLE-USAGE-001` | Runtime usage is counted once, the selected range persists, and the downloaded export contains the same aggregate |
| Active Codex run × storage inventory × transcript purge × full Session deletion × reload | `CRADLE-STORAGE-001` | Active Session cleanup controls remain locked while another Session is purged without losing metadata, then fully deleted; the protected run completes afterward |
| Provider profile × Agent selection × disable | `CRADLE-PROVIDER-001` | A UI-created provider can run and later become unavailable |
| Provider disable/delete × two active sessions × queued continuation × runtime cancellation | `CRADLE-PROVIDER-002`, `CRADLE-PROVIDER-003` | Disabling or deleting a UI-created provider cancels every in-flight run and prevents a queued continuation in another session from executing |
| Fabric pairing × two databases × bidirectional Workspace/Chat/Work × Node-owned worktrees × remote tool approval × Session discovery × relay/server restart | `CRADLE-FABRIC-001` | Two real Nodes enroll through the UI, create Work and managed worktrees on the selected authority in both directions, continue each Work conversation, approve a remote Claude Agent tool request from each controller, discover conversations created by the other controller, and recover mounted routing without re-pairing |
| Native Mobile Controller × two Node grants × cache isolation × Chat SSE × grant/principal revocation | `CRADLE-FABRIC-002` | A signed Release iOS app enrolls through the real owner UI, selects both Nodes without Server credentials, keeps Workspace state Node-scoped, continues a real Codex conversation over Fabric streaming, preserves one Node after a grant removal, and fails closed after Controller revocation |

## Web Feature Namespace Disposition

| Classification | Namespaces | Evidence or required journey |
| --- | --- | --- |
| Direct | `agent-management`, `automation`, `chat`, `composer-toolbar`, `context`, `diff-review`, `git`, `kanban`, `new-chat`, `new-work`, `nodes`, `onboarding`, `search`, `session`, `session-await`, `settings`, `split-view`, `storage`, `usage`, `work`, `workspace`, `workspace-detail` | Active IDs listed in the state matrix and feature inventory |
| Indirect | `activity`, `agent-runtime`, `agent-runtimes`, `background-activity`, `code-activity`, `filesystem`, `home`, `mcp-servers`, `model-registry`, `plugins`, `tui`, `window-controls` | Real code is traversed, but its own visible contract is not asserted |
| User-visible gap | `assets`, `browser`, `changelog`, `chronicle`, `desktop-tray`, `devtool`, `download-center`, `editor`, `managed-resources`, `pull-requests`, `server-connection`, `shortcuts`, `skills`, `system-agent` | Add only journeys that cross a lifecycle or destructive boundary; avoid shallow navigation checks |
| Service/infra contract | `product-analytics` | Verify event correctness at the event boundary; add browser coverage only for user-visible consent controls |

## Server Module Namespace Disposition

| Classification | Namespaces | Evidence or required journey |
| --- | --- | --- |
| Direct | `agent-identity`, `agent-interaction-runtime`, `agent-tools`, `automation`, `chat-runtime`, `chat-runtime-engine`, `chat-runtime-providers`, `codex-app-server`, `conversation-bridge`, `diff-review`, `fabric`, `filesystem`, `git`, `issue`, `issue-agent`, `javascript-eval`, `kanban`, `preferences`, `profiles`, `provider-runtime`, `provider-targets`, `pty`, `relay-transport`, `search`, `session`, `session-await`, `storage`, `turn-checkpoint`, `usage`, `work`, `workspace`, `worktree` | Active scenarios assert their user-visible lifecycle effects |
| Indirect | `background-activity`, `code-activity`, `desktop`, `mcp-servers`, `model-registry`, `provider-auth`, `provider-catalog`, `provider-contracts`, `secrets`, `skills`, `thread-handoff`, `workflow-rules`, `pull-request`, `managed-resources`, `plugins` | Participates in a real path or supplies runtime metadata, but no owning assertion exists |
| User-visible gap | `acp`, `assets`, `chat-artifacts`, `chronicle`, `download-center`, `external-issue-sources`, `external-provider-sources`, `external-session-import`, `github-auth`, `image-ocr`, `kimi-server`, `link-preview`, `opencode-server`, `plugin-marketplace`, `provider-extensions`, `recall`, `session-group`, `sync-gateway` | Needs an end-user journey before release confidence can include the namespace |
| Service/infra contract | `background-job`, `blob-store`, `codex-reset-watch`, `health`, `maintenance`, `observability`, `test-reset` | Prefer focused service/contract verification; `test-reset` is harness-only |

## Prioritized Missing Journeys

The backlog below is ordered by semantic fan-out and state-corruption risk, not by screen count.

| Priority | Proposed journey | State fusion and owning namespaces |
| --- | --- | --- |
| P1 | Automation failure/cancel with linked Session and notification | automation × background job/activity × session |
| P1 | Pull-request delivery from Work, update, and failure recovery | Work × Git × pull request × provider auth |
| P1 | Fabric Node disconnect/reconnect during an active terminal or Agent run | Fabric Node × relay × PTY/runtime × Session |
| P1 | Runtime process environment configuration edit while idle versus locked during a run | Agent runtime configuration × session × active process lifecycle |
| P1 | Skill create/import/delete, then invoke from a real Agent | skills × Agent identity × runtime tool catalog |
| P1 | Plugin install/enable/disable/reload with a visible contribution | marketplace × plugin lifecycle × shell state |
| P1 | Browser/asset/OCR path from capture or upload into a persisted prompt | browser × assets × OCR × context × session |
| P1 | External issue/session import deduplicates and survives reload | external sources × issue/session ownership × idempotency |
| P1 | Chronicle/Recall opt-in, write, query, delete, and disabled behavior | preferences × chronicle/recall × privacy lifecycle |

## Acceptance Rules

Before adding a scenario, identify at least two linked owners and the conflicting states being fused. A scenario that only opens a page does not close a lifecycle risk.

Every accepted scenario must:

1. Drive the behavior under test through the real UI.
2. Use real Claude Agent or real Codex app-server where a runtime is involved.
3. Assert all visible projections of the shared state after reload, cancellation, or failure.
4. Match scripted provider turns semantically and assert simulator exhaustion.
5. Carry `@essence`, exactly one priority tag, and a unique stable ID.
6. Update the feature inventory and this matrix when ownership or disposition changes.
