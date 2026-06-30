<!-- Once this directory changes, update this README.md -->

# Features/Devtool/Observability

Observability pane for the `/devtool` window.
This slice renders canonical local observability events and incidents emitted by the main process, and supports flush/export actions for debugging.

## Files

- **use-observability-events.ts**: Zustand store and preload bridge wiring for observability stream/snapshot/export actions; export now serializes the typed bundle returned by the preload bridge directly
- **observability-events-table.tsx**: Left-pane list view for mixed event/incident rows, including correct per-kind timestamp selection for the shared union payload
- **observability-event-detail.tsx**: Right-pane payload inspector with clear/flush/export controls
