# E2E Journey and State Coverage

This document is the audit map for Cradle's active E2E suite. Executable scenario ownership remains in [`src/features/README.md`](src/features/README.md); this file owns module disposition, cross-module relationships, state-fusion coverage, and the prioritized gap backlog.

## Coverage Summary

| Layer | Directly asserted | Traversed indirectly | User-visible gap | Service/infra contract |
| --- | ---: | ---: | ---: | ---: |
| Web feature namespaces | 20 | 10 | 15 | 1 |
| Server module namespaces | 30 | 15 | 19 | 6 |

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
| Streaming × multiple queue items × edit × reorder × cancel × reload | `CRADLE-CHAT-010` | Final durable queue order is the only order executed |
| Approval pending × reload × allow/deny | `CRADLE-AGENT-001`, `002` | Pending permission state rehydrates and both decisions control the real runtime continuation |
| Claude runtime × Read tool × tool result × final reply | `CRADLE-AGENT-004` | The simulator drives a real Claude Agent tool loop rather than replacing the runtime |
| Codex × rollback branch / transient `btw` | `CRADLE-CODEX-002`–`004` | Persistent history branches correctly and transient turns do not leak |
| Filesystem context × provider request | `CRADLE-CONTEXT-001` | Selected `AGENTS.md` content crosses the UI/runtime boundary |
| Two live sessions × tabs × reload × close | `CRADLE-TAB-001` | Active content and session identity do not bleed across tabs |
| Issue × delegation × Agent Session × reload × rerun × new Chat | `CRADLE-ISSUE-AGENT-001` | Delegation state persists and rerun attaches its own completed Chat |
| Issue × active Run × reload × undelegate × abort | `CRADLE-ISSUE-AGENT-002` | Cancellation removes delegation and prevents a gated reply from persisting |
| Issue × isolated delegation × Work × worktree × linked Chat | `CRADLE-ISSUE-AGENT-003` | The Issue-owned action creates a Work-owned isolated execution without losing linkage |
| Issue × active isolated Work × reload × undelegate × abort | `CRADLE-ISSUE-AGENT-004` | Cancellation stops runtime work while retaining the Work and worktree as explicit audit state |
| Work × Git × worktree × file mutation × Session | `CRADLE-WORK-001` | Isolated execution uses a managed worktree and persistent primary thread |
| Git branch × external file changes × diff refresh | `CRADLE-GIT-001`, `002`, `CRADLE-DIFF-001` | Repository projections refresh from real Git/filesystem state |
| Await pending × external event × Agent continuation | `CRADLE-AWAIT-001` | Durable pending work resumes from an external signal |
| Multiple PTYs × active-session input routing | `CRADLE-PTY-002` | Input reaches only the selected terminal session |
| Completed Agent run × usage aggregation × reload | `CRADLE-USAGE-001` | Runtime usage is counted once and persists |
| Provider profile × Agent selection × disable | `CRADLE-PROVIDER-001` | A UI-created provider can run and later become unavailable |
| Fabric pairing × two databases × bidirectional Workspace/Chat/Work × Node-owned worktrees × remote tool approval × Session discovery × relay/server restart | `CRADLE-FABRIC-001` | Two real Nodes enroll through the UI, create Work and managed worktrees on the selected authority in both directions, continue each Work conversation, approve a remote Claude Agent tool request from each controller, discover conversations created by the other controller, and recover mounted routing without re-pairing |

## Web Feature Namespace Disposition

| Classification | Namespaces | Evidence or required journey |
| --- | --- | --- |
| Direct | `agent-management`, `chat`, `composer-toolbar`, `context`, `diff-review`, `git`, `kanban`, `new-chat`, `new-work`, `nodes`, `onboarding`, `search`, `session`, `session-await`, `settings`, `split-view`, `usage`, `work`, `workspace`, `workspace-detail` | Active IDs listed in the state matrix and feature inventory |
| Indirect | `activity`, `agent-runtime`, `agent-runtimes`, `code-activity`, `filesystem`, `home`, `mcp-servers`, `model-registry`, `plugins`, `tui` | Real code is traversed, but its own visible contract is not asserted |
| User-visible gap | `assets`, `automation`, `browser`, `changelog`, `chronicle`, `desktop-tray`, `devtool`, `download-center`, `editor`, `managed-resources`, `pull-requests`, `session-environment`, `shortcuts`, `skills`, `system-agent` | Add only journeys that cross a lifecycle or destructive boundary; avoid shallow navigation checks |
| Service/infra contract | `product-analytics` | Verify event correctness at the event boundary; add browser coverage only for user-visible consent controls |

## Server Module Namespace Disposition

| Classification | Namespaces | Evidence or required journey |
| --- | --- | --- |
| Direct | `agent-identity`, `agent-interaction-runtime`, `agent-tools`, `chat-runtime`, `chat-runtime-engine`, `chat-runtime-providers`, `codex-app-server`, `conversation-bridge`, `diff-review`, `fabric`, `filesystem`, `git`, `issue`, `issue-agent`, `javascript-eval`, `kanban`, `preferences`, `profiles`, `provider-runtime`, `provider-targets`, `pty`, `relay-transport`, `search`, `session`, `session-await`, `turn-checkpoint`, `usage`, `work`, `workspace`, `worktree` | Active scenarios assert their user-visible lifecycle effects |
| Indirect | `background-activity`, `code-activity`, `desktop`, `mcp-servers`, `model-registry`, `provider-auth`, `provider-catalog`, `provider-contracts`, `secrets`, `skills`, `thread-handoff`, `workflow-rules`, `pull-request`, `managed-resources`, `plugins` | Participates in a real path or supplies runtime metadata, but no owning assertion exists |
| User-visible gap | `acp`, `assets`, `automation`, `chronicle`, `download-center`, `external-issue-sources`, `external-provider-sources`, `external-session-import`, `github-auth`, `image-ocr`, `kimi-server`, `link-preview`, `opencode-server`, `plugin-marketplace`, `provider-extensions`, `recall`, `session-environment`, `session-group`, `sync-gateway` | Needs an end-user journey before release confidence can include the namespace |
| Service/infra contract | `background-job`, `blob-store`, `health`, `maintenance`, `observability`, `test-reset` | Prefer focused service/contract verification; `test-reset` is harness-only |

## Prioritized Missing Journeys

The backlog below is ordered by semantic fan-out and state-corruption risk, not by screen count.

| Priority | Proposed journey | State fusion and owning namespaces |
| --- | --- | --- |
| P0 | Stop/fail Work, reload, retry, and verify exactly one active primary thread | Work × Session × runtime × worktree × recovery |
| P0 | Disable/delete a provider while one run is active and another session is queued | profiles × provider target × active Run × queue × recovery |
| P0 | Remove/rename workspace while Sessions, PTYs, and Work reference it | workspace × session × PTY × Work × destructive confirmation |
| P0 | Application process restart with active stream and queued continuation | desktop lifecycle × persisted Run × queue × rehydration |
| P1 | Await timeout/cancel/restart plus late external resolution | Await × terminal state × idempotent external event |
| P1 | Automation run success/failure/cancel with linked Session and notification | automation × background job/activity × session |
| P1 | Pull-request delivery from Work, update, and failure recovery | Work × Git × pull request × provider auth |
| P1 | Fabric Node disconnect/reconnect during an active terminal or Agent run | Fabric Node × relay × PTY/runtime × Session |
| P1 | Session environment edit while idle versus locked during a run | environment × session × runtime process configuration |
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
