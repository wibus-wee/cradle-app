<!-- Once this directory changes, update this README.md -->

# E2E Step Definitions

Step definitions translate Chinese Gherkin into page-object calls and deterministic scenario setup. They must stay thin: selectors and interaction mechanics belong in `support/pages/`; provider protocol scripts and fixture setup belong in `support/helpers/` or `support/scenarios/`.

| File | Owned vocabulary |
| --- | --- |
| `agent-identity.steps.ts` | Agent settings navigation and identity lifecycle |
| `approval.steps.ts` | Claude approval prompt, allow, deny, and visible result |
| `await.steps.ts` | Await creation, pending state, external resolution, and Agent continuation |
| `chat.steps.ts` | Chat setup, send/stop/reload, queue operations, message/session assertions, and simulator exhaustion |
| `claude-agent-tools.steps.ts` | Tool matrix simulator configuration keyed by canonical tool scenario |
| `codex-tools.steps.ts` | Codex shell/plan/patch/approval simulator configuration and approval allowance |
| `composer.steps.ts` | Bang command execution and persisted command output |
| `diff.steps.ts` | Real repository mutation and diff-review assertions |
| `first-run.steps.ts` | Clean-install provider onboarding and first conversation |
| `git.steps.ts` | Temporary Git repository, branch picker, branch creation, and switching |
| `kanban.steps.ts` | Board/issue lifecycle plus Issue-Agent delegation, rerun, cancellation, and linked Chat |
| `provider.steps.ts` | Provider profile UI lifecycle and runtime selection |
| `search.steps.ts` | Global search result and command navigation |
| `session-environment.steps.ts` | Session Environment navigation and deterministic notes autosave ordering |
| `settings.steps.ts` | Settings navigation and appearance persistence |
| `stream-vocabulary.steps.ts` | Parallel tool blocks, redacted thinking, disconnect, and error-status vocabulary setup |
| `tab-management.steps.ts` | Live tab creation, activation, reload, close, and content isolation |
| `terminal.steps.ts` | Bottom panel, PTY command execution, and active-session routing |
| `usage.steps.ts` | Usage navigation, exact aggregates, range persistence, and CSV assertions |
| `work.steps.ts` | New Work launch and managed worktree/session verification |
| `workspace.steps.ts` | Directory Browser, workspace overview, rename/remove, and selection |

## Boundaries

- Prefer stable `data-testid` selectors through a page object.
- Do not read SQLite or invoke internal service functions to prove user-visible results.
- API setup is acceptable only for prerequisites already covered by another UI journey; the behavior under test must still use the UI.
- A scripted provider exchange must match the intended request body and every scenario must assert that the simulator queue is exhausted.
- Do not add compatibility aliases for removed step wording. Update the active feature and its single owning step instead.
