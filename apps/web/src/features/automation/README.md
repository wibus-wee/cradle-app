<!-- Once this directory changes, update this README.md -->

# Automation

Agent-authored automation registry and viewer UI. Agent task recipes use the shared composer model picker. The server owns Automation's HTTP contract, scheduling, persistence, and latest-run list projection; this feature owns the generated SDK adapter, query lifecycle, UI projection, and invalidation.

## Files

- **api/automation.ts**: Typed gateway over Automation operations in `sdk.gen.ts`. It derives request and response types from `types.gen.ts`, so the shared generated client supplies authentication, base URL, and errors.
- **api/automation.test.ts**: Verifies generated-operation options, one list request, and error propagation.
- **automation-dashboard.tsx**: Thin query/mutation and draft orchestration Container for the registry, selected definition, run history, artifacts, and create/edit actions.
- **automation-dashboard-view.tsx**: Fixture-driven responsive dashboard shell for triage, workspace filtering, definition selection, loading/error state, and a supplied detail/create View.
- **automation-create-panel-container.tsx**: Provider target, runtime catalog, model cache, and thinking-effort adapter for create/edit.
- **automation-create-panel-view.tsx / automation-schedule-builder-view.tsx**: Props-only responsive form and RRULE editor used by production and Storybook.
- **automation-detail-view.tsx**: Fixture-driven overview, run timeline, and artifact preview View using definition/run/artifact owner contracts and callbacks only.
- **automation-draft.ts / automation-presentation.ts**: Pure schedule, validation, time, trigger, recipe, and latest-run derivation used by Containers and Views.
- **automation-*-view.tsx**: Independent definition, triage, draft, empty, run, artifact, status, field, and detail presentation modules. Storybook fixtures cover desktop/mobile dashboard, create/edit, running, complete, failed, loading, and artifact states.
- **types.ts**: Presentation-facing Automation shapes used by Views and pure helpers.
- **index.ts**: Public feature exports used by Home.
- **use-automations.ts**: TanStack Query keys, query hooks, and mutation invalidation for definition summaries, run history, artifacts, and triage.
- **use-automations.test.tsx**: Verifies Automation query keys and cross-consumer invalidation.

The dashboard never calls transport code or creates Automation cache keys directly. It reads `latestRun` from the server-projected definition list, while selected definitions load full history and artifacts on demand.
