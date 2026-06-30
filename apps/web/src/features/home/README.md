<!-- Once this directory changes, update this README.md -->

# Features/Home

Root index route start surface.
Home reuses the new-chat entry point so first-run users can start with a real prompt instead of an empty activity dashboard.
Home owns no extra instructional chrome; chat creation, workspace selection, runtime selection, and first-turn streaming stay owned by `features/new-chat` and `features/chat`.

## Files

- **home-dashboard-loader.ts**: Home route 的共享 lazy loader 与 route preload 入口。
- **home-dashboard.tsx**: Root start component — renders the reusable New Chat entry surface with no mock activity data or extra instructional UI.
