<!-- Once this directory changes, update this README.md -->

# E2E Support Architecture

Support code owns deterministic infrastructure and interaction mechanics; it does not own user-journey intent.

| Area | Owner |
| --- | --- |
| `hooks.ts` | Scenario launch, Playwright tracing, screenshots/video, console capture, and simulator request ledger |
| `world.ts` | Cucumber World, browser/context/page, temporary workspaces, scenario memory, and runtime configuration |
| `server-lifecycle.ts` | Managed server, crash/restart with preserved data and port, deterministic npm plugin fixture boundary, and production web preview without `CRADLE_MOCK_LLM_URL` |
| `model-api-simulator.ts` | `@cradle/model-api-simulator` in `probes-only` auto-response mode |
| `providers.ts` | Provider/profile/Agent prerequisites and workspace prerequisite |
| `scenarios/` | Strict OpenAI Responses and Anthropic Messages exchanges |
| `helpers/chat-scenario.ts` | Cross-turn Chat scripts, gates, queue timing, approvals, and tool loops |
| `helpers/automation-scenario.ts` | Gated Automation cancellation and linked Session title scripts |
| `helpers/external-session-import-scenario.ts` | Read-only external Claude JSONL fixture and source-integrity sentinel |
| `helpers/issue-agent-scenario.ts` | Issue delegation, rerun, and cancellation scripts |
| `helpers/skill-scenario.ts` | Strict Workspace Skill invocation request and response script |
| `pages/` | Stable selectors and reusable UI mechanics |
| `database.ts` | Explicit fixture-only database support; never the proof of a user-visible outcome |
| `world-utils.ts` | Artifact paths and scenario-safe names |

## Page Objects

| File | Surface |
| --- | --- |
| `pages/agent-runtimes.ts` | Local ACP validation, canonical mutation contracts, reload recovery, and deletion |
| `pages/await.ts` | Await creation and resolution |
| `pages/automation.ts` | Automation definition fixture, completion/cancellation, triage, artifacts, reload, and linked Session |
| `pages/chat.ts` | New Chat, Chat, approval, messages, sessions, and queue |
| `pages/diff.ts` | Diff review |
| `pages/external-session-import.ts` | External session discovery, import, transcript, and duplicate-prevention checks |
| `pages/first-run.ts` | Onboarding |
| `pages/git.ts` | Branch controls |
| `pages/kanban.ts` | Board, Issue detail, activity, and delegation |
| `pages/mcp-servers.ts` | Local MCP validation, exact mutation contracts, secret-safe reload projections, disable, and deletion |
| `pages/plugins.ts` | Plugin Center install/trust/toggle flow and visible panel contribution |
| `pages/search.ts` | Global search |
| `pages/session-groups.ts` | Session Group creation, membership, expansion, rename, and non-destructive deletion |
| `pages/settings.ts` | Settings shell, appearance, and Server Endpoint validation, probing, reload, and recovery |
| `pages/skills.ts` | Workspace Skill creation, Composer invocation, deletion, and Session evidence |
| `pages/storage.ts` | Storage session inventory and destructive cleanup controls |
| `pages/terminal.ts` | Bottom panel and PTY sessions |
| `pages/usage.ts` | Usage dashboard, range selection, and downloaded CSV |
| `pages/work.ts` | New Work and managed Work verification |
| `pages/workspace-editor.ts` | Workspace file tree, Monaco editor, save lifecycle, and real file-content assertions |
| `pages/workspace-migration.ts` | Workspace migration prerequisites, wizard, preview, and Issue/Automation ownership projections |
| `pages/workspace.ts` | Workspace list, Directory Browser, and overview |

## Runtime Rules

- Claude scenarios launch the real Claude Agent SDK; Codex scenarios launch the real Codex app-server.
- Only upstream model HTTP is simulated. Unmatched conversation requests fail; probe endpoints such as token counting may auto-respond.
- Temporary workspaces live under the managed home accepted by Directory Browser. The server sets that data directory as Git's discovery ceiling so repository grouping cannot merge independent scenario fixtures with the checkout.
- Agent-scoped provider sessions use Agent Home as their runtime `cwd`. Tests that mutate an isolated Work must target the provider-owned `CRADLE_WORKSPACE_PATH` instead of assuming relative paths resolve inside the worktree.
- Title-generation and primary-turn requests share provider infrastructure. Match primary turns by semantic body content and enqueue follow-up replies at the action boundary when background title work can interleave.
- `CRADLE_E2E_NODE` selects the Node binary used by managed child processes.
- `CRADLE_E2E_BROWSER_PATH` may point Playwright at an already-installed Chromium executable.
