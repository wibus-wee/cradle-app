<!-- Once this directory changes, update this README.md -->

# E2E Support Architecture

Support code owns deterministic infrastructure and interaction mechanics; it does not own user-journey intent.

| Area | Owner |
| --- | --- |
| `hooks.ts` | Scenario launch, Playwright tracing, screenshots/video, console capture, and simulator request ledger |
| `world.ts` | Cucumber World, browser/context/page, temporary workspaces, scenario memory, and runtime configuration |
| `server-lifecycle.ts` | Managed server, crash/restart with preserved data and port, and production web preview without `CRADLE_MOCK_LLM_URL` |
| `model-api-simulator.ts` | `@cradle/model-api-simulator` in `probes-only` auto-response mode |
| `providers.ts` | Provider/profile/Agent prerequisites and workspace prerequisite |
| `scenarios/` | Strict OpenAI Responses and Anthropic Messages exchanges |
| `helpers/chat-scenario.ts` | Cross-turn Chat scripts, gates, queue timing, approvals, and tool loops |
| `helpers/issue-agent-scenario.ts` | Issue delegation, rerun, and cancellation scripts |
| `pages/` | Stable selectors and reusable UI mechanics |
| `database.ts` | Explicit fixture-only database support; never the proof of a user-visible outcome |
| `world-utils.ts` | Artifact paths and scenario-safe names |

## Page Objects

| File | Surface |
| --- | --- |
| `pages/await.ts` | Await creation and resolution |
| `pages/chat.ts` | New Chat, Chat, approval, messages, sessions, and queue |
| `pages/diff.ts` | Diff review |
| `pages/first-run.ts` | Onboarding |
| `pages/git.ts` | Branch controls |
| `pages/kanban.ts` | Board, Issue detail, activity, and delegation |
| `pages/search.ts` | Global search |
| `pages/settings.ts` | Settings shell and appearance |
| `pages/terminal.ts` | Bottom panel and PTY sessions |
| `pages/usage.ts` | Usage dashboard, range selection, and downloaded CSV |
| `pages/work.ts` | New Work and managed Work verification |
| `pages/workspace.ts` | Workspace list, Directory Browser, and overview |

## Runtime Rules

- Claude scenarios launch the real Claude Agent SDK; Codex scenarios launch the real Codex app-server.
- Only upstream model HTTP is simulated. Unmatched conversation requests fail; probe endpoints such as token counting may auto-respond.
- Temporary workspaces live under the managed home accepted by Directory Browser. The server sets that data directory as Git's discovery ceiling so repository grouping cannot merge independent scenario fixtures with the checkout.
- Agent-scoped provider sessions use Agent Home as their runtime `cwd`. Tests that mutate an isolated Work must target the provider-owned `CRADLE_WORKSPACE_PATH` instead of assuming relative paths resolve inside the worktree.
- Title-generation and primary-turn requests share provider infrastructure. Match primary turns by semantic body content and enqueue follow-up replies at the action boundary when background title work can interleave.
- `CRADLE_E2E_NODE` selects the Node binary used by managed child processes.
- `CRADLE_E2E_BROWSER_PATH` may point Playwright at an already-installed Chromium executable.
