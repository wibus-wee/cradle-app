<!-- Once this directory changes, update this README.md -->

# Automation

Agent-authored automation registry and viewer UI. Agent task recipes use the shared composer model picker. The server owns Automation's HTTP contract, scheduling, persistence, and latest-run list projection; this feature owns the generated SDK adapter, query lifecycle, UI projection, and invalidation.

## Files

- **api/automation.ts**: Typed gateway over Automation operations in `sdk.gen.ts`. It derives request and response types from `types.gen.ts`, so the shared generated client supplies authentication, base URL, and errors.
- **api/automation.test.ts**: Verifies generated-operation options, one list request, and error propagation.
- **automation-dashboard.tsx**: Registry/viewer surface for definitions, settings-style inline create draft with composer-owned runtime/model picker, latest run state, run history, chat/backend run links, recipe snapshots, inputs, and artifacts.
- **index.ts**: Public feature exports used by Home.
- **use-automations.ts**: TanStack Query keys, query hooks, and mutation invalidation for definition summaries, run history, artifacts, and triage.
- **use-automations.test.tsx**: Verifies Automation query keys and cross-consumer invalidation.

The dashboard never calls transport code or creates Automation cache keys directly. It reads `latestRun` from the server-projected definition list, while selected definitions load full history and artifacts on demand.
