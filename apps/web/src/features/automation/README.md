<!-- Once this directory changes, update this README.md -->

# Automation

Agent-authored automation registry and viewer UI. Agent task recipes use the shared composer model picker and accept `low`, `medium`, `high`, and `xhigh` thinking effort.

## Files

- **api-client.ts**: `/automations` endpoints 的本地 fetch boundary，保留与 server automation contract 对齐的 feature-local response parser。
- **api-client.test.ts**: 覆盖 server-shaped automation payload parsing 的 contract regression tests。
- **automation-dashboard.tsx**: Registry/viewer surface for definitions, settings-style inline create draft with composer-owned runtime/model picker, latest run state, run history, chat/backend run links, recipe snapshots, inputs, and artifacts.
- **automation-detail-view.tsx**: Fixture-driven overview, run timeline, and artifact preview View using definition/run/artifact owner contracts and callbacks only.
- **automation-draft.ts / automation-presentation.ts**: Pure schedule, validation, time, trigger, recipe, and latest-run derivation used by Containers and Views.
- **automation-*-view.tsx**: Independent definition, run, artifact, status, field, and detail presentation modules. Storybook fixtures cover running, complete, failed, loading, and artifact states.
- **index.ts**: Public feature exports used by Home.
- **types.ts**: Temporary local API payload contracts owned by this feature.
- **use-automations.ts**: TanStack Query hooks and mutation for definition, run, artifact, and run-now operations.
