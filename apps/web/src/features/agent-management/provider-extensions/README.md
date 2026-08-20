<!-- Once this directory changes, update this README.md -->

# Provider Extensions UI

This feature renders per-Provider extension state without owning Host lifecycle
or plugin semantics.

| Area | Responsibility |
| --- | --- |
| `provider-extensions-contract.ts` | Adapts the generated Host response type at the dependency boundary. |
| `provider-extensions-view.tsx` | Renders fixture-driven states and emits typed toggle callbacks without reading generated clients. |
| `provider-extensions-container.tsx` | Owns generated API queries, mutations, errors, and cache invalidation. |
| `fixtures.ts` and stories | Exercise loading-independent disabled, enabling, enabled, suspended, error, and inapplicable states. |

Both manual and external Provider detail surfaces mount the Container with their
durable Provider target id. The View receives safe extension rows and one
Enable/Disable callback only; it does not read queries, routes, stores, Electron,
session context, or plugin implementations.

An unavailable extension cannot be newly enabled. A desired binding remains
switchable off so the Host can run registered cleanup or cancel a safely
suspended Host-owned binding instead of trapping the user in an enabled state.
