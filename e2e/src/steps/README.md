<!-- Once this directory changes, update this README.md -->

# E2E Step Definitions

Step definitions translate Chinese Gherkin into page-object calls and deterministic scenario setup. They must stay thin: selectors and interaction mechanics belong in `support/pages/`; provider protocol scripts and fixture setup belong in `support/helpers/` or `support/scenarios/`.

| File | Owned vocabulary |
| --- | --- |
| `agent-identity.steps.ts` | Agent settings navigation and identity lifecycle |
| `automation.steps.ts` | Automation completion/cancellation, triage, artifact, reload, and linked Session assertions |
| `approval.steps.ts` | Claude approval prompt, allow, deny, and visible result |
| `await.steps.ts` | Await creation, pending state, external resolution, and Agent continuation |
| `chat.steps.ts` | Chat setup, send/stop/reload, queue operations, message/session assertions, and simulator exhaustion |
| `claude-agent-tools.steps.ts` | Tool matrix simulator configuration keyed by canonical tool scenario |
| `codex-tools.steps.ts` | Codex shell/plan/patch/approval simulator configuration and approval allowance |
| `composer.steps.ts` | Bang command execution and persisted command output |
| `diff.steps.ts` | Real repository mutation and diff-review assertions |
| `external-session-import.steps.ts` | External Claude history fixture discovery, import, persisted transcript, and idempotency assertions |
| `first-run.steps.ts` | Clean-install provider onboarding and first conversation |
| `git.steps.ts` | Temporary Git repository, branch picker, branch creation, and switching |
| `kanban.steps.ts` | Board/issue lifecycle plus Issue-Agent delegation, rerun, cancellation, and linked Chat |
| `plugins.steps.ts` | Plugin source install, trust, activation, disable, reload, and visible contribution assertions |
| `provider.steps.ts` | Provider profile UI lifecycle and runtime selection |
| `search.steps.ts` | Global search result and command navigation |
| `settings.steps.ts` | Settings navigation and appearance persistence |
| `skills.steps.ts` | Workspace Skill creation, explicit runtime invocation, deletion, and historical Session assertions |
| `storage.steps.ts` | Storage inventory, active-session protection, transcript purge, and session deletion |
| `stream-vocabulary.steps.ts` | Parallel tool blocks, redacted thinking, disconnect, and error-status vocabulary setup |
| `tab-management.steps.ts` | Live tab creation, activation, reload, close, and content isolation |
| `terminal.steps.ts` | Bottom panel, PTY command execution, and active-session routing |
| `usage.steps.ts` | Usage navigation, exact aggregates, range persistence, and CSV assertions |
| `work.steps.ts` | New Work launch and managed worktree/session verification |
| `workspace-migration.steps.ts` | Workspace migration setup, preview, commit, and cross-feature ownership assertions |
| `workspace.steps.ts` | Directory Browser, workspace overview, rename/remove, and selection |

## Boundaries

- Prefer stable `data-testid` selectors through a page object.
- Do not read SQLite or invoke internal service functions to prove user-visible results.
- API setup is acceptable only for prerequisites already covered by another UI journey; the behavior under test must still use the UI.
- A scripted provider exchange must match the intended request body and every scenario must assert that the simulator queue is exhausted.
- Do not add compatibility aliases for removed step wording. Update the active feature and its single owning step instead.
