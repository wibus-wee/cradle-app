<!-- Once this directory changes, update this README.md -->

# Features/Download Center

Download Center projects server and Desktop download transports into Settings > Downloads. Transport subscriptions, cancellation, and navigation stay in adapters; visible task states render from the shared `@cradle/download-center` contract.

## Files

- **download-task-row-view.tsx**: Props-only task lifecycle row for queued, downloading, verifying, completed, failed, and cancelled states.
- **fixtures/download-tasks.ts**: Stable shared-contract fixtures for every task status.
- **presentation.ts**: Pure status, average transfer-rate, error, and retry-destination projection helpers.
- **transport.ts**: Desktop/server host transport adapters.
- **types.ts**: Renderer aliases for shared download contracts and projection helpers.
- **use-download-center.ts**: External-store subscription and owner/task projections.
