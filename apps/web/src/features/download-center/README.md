<!-- Once this directory changes, update this README.md -->

# Features/Download Center

Download Center projects server and Desktop download transports into shared application chrome. Transport subscriptions, cancellation, and navigation stay in adapters; visible task states render from the shared `@cradle/download-center` contract.

## Files

- **download-center-chrome.tsx**: Application adapter that subscribes to the shared task projection and translates View callbacks into cancellation and navigation commands.
- **download-center-view.tsx**: Props-only popover surface for active and recent tasks.
- **download-task-row-view.tsx**: Props-only task lifecycle row for queued, downloading, verifying, completed, failed, and cancelled states.
- **download-center-view.stories.tsx**: Storybook lifecycle catalog plus an interactive chrome popover.
- **fixtures/download-tasks.ts**: Stable shared-contract fixtures for every task status.
- **presentation.ts**: Pure status, error, and retry-destination projection helpers.
- **transport.ts**: Desktop/server host transport adapters.
- **types.ts**: Renderer aliases for shared download contracts and projection helpers.
- **use-download-center.ts**: External-store subscription and owner/task projections.
